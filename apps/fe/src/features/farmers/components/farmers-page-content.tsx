/**
 * Farmer admin list — mirrors the admin/users list layout end-to-end:
 * stats cards, multi-select filters, URL-backed pagination, soft-delete
 * + restore flow with distinct row affordances for tombstoned rows.
 *
 * Data:
 *   - `useFarmersList` — paginated, server-side filtered. Tenant scope
 *     comes from the `active-coop-id` cookie set by the header
 *     CoopSwitcher, so no per-page cooperative filter is needed here.
 *
 * Kept client-side only:
 *   - Status filter's `"deleted"` pseudo-option flips `includeDeleted`
 *     on the SWR query and narrows the visible rows to tombstones.
 *   - Certification filter currently boolean (RA vs non-RA).
 */

import type { CreateFarmerInput, UpdateFarmerInput } from '@thinkcocoa/shared';
import {
  Building2,
  CalendarClock,
  CircleDot,
  Download,
  EllipsisVertical,
  Eye,
  History,
  LandPlot,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SquareArrowOutUpRight,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ColumnSorter } from '@/components/ui/column-sorter';
import { DataPagination } from '@/components/ui/data-pagination';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PermissionGate } from '@/features/auth';
import { ClmrsStatusPill } from '@/features/clmrs/components/clmrs-status-pill';
import type { ClmrsFarmerStatus } from '@/features/clmrs/lib/mock';
import { formatGhanaDate } from '@/lib/datetime';
import { LIST_SUB_LINK } from '@/lib/link-styles';
import { formatSociety, sortSocieties } from '@/lib/society';
import {
  type ApiFarmer,
  createFarmer,
  deleteFarmer,
  downloadFarmersCsv,
  restoreFarmer,
  updateFarmer,
  useApiErrorMessage,
  useApiErrorToast,
  useApiSuccessToast,
  useFarmerFullStats,
  useFarmersList,
} from '@/shared/api';
import { useClmrsRecords } from '@/shared/api/clmrs';
import { FarmerRefCell, RefCell } from '@/shared/components/composed/entity-ref-cell';
import { ListSearch } from '@/shared/components/composed/list-search';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { useTableSort } from '@/shared/hooks/use-table-sort';
import { selectActiveCoop, useActiveCoop } from '@/shared/store/useActiveCoop';
import { type FarmerStatusBucket, farmerStatusBucket } from '../types/farmers';
import { CertificationOutcomeBadge } from './certification-outcome-badge';
import { FarmerDialog } from './farmer-dialog';
import { FarmersCsvImportDialog } from './farmers-csv-import-dialog';
import { FarmersSlimStats } from './farmers-slim-stats';

const PAGE_LIMIT = 10;

const STATUS_TONE: Record<FarmerStatusBucket, StatusTone> = {
  active: 'success',
  inactive: 'danger',
  deleted: 'neutral',
};

/** Renewals window — long enough to book and run an audit, short enough
 *  that the list stays actionable. Mirrors the BE's `expiring` band. */
const RENEWAL_WINDOW_DAYS = 90;

/**
 * The certificate's expiry, as the second line of the certificate cell.
 * Calls out the two states someone has to act on — lapsed, and lapsing
 * inside the renewals window. A certificate with a year left is just a
 * date: no colour, nothing to do.
 */
function CertificateExpiry({ farmer }: { farmer: ApiFarmer }) {
  const intl = useIntl();
  if (!farmer.raExpiryDate) return <span className="text-muted-foreground">—</span>;
  const days = Math.ceil((new Date(farmer.raExpiryDate).getTime() - Date.now()) / 86_400_000);
  const tone = days < 0 ? 'text-destructive' : days <= RENEWAL_WINDOW_DAYS ? 'text-amber-600' : '';
  const suffix =
    days < 0
      ? intl.formatMessage({ id: 'farmers.certExpiry.lapsed' })
      : days <= RENEWAL_WINDOW_DAYS
        ? intl.formatMessage({ id: 'farmers.certExpiry.inDays' }, { n: days })
        : '';
  return (
    <span className={tone} title={farmer.raCertificateNumber ?? undefined}>
      {formatGhanaDate(farmer.raExpiryDate)}
      {suffix ? ` · ${suffix}` : ''}
    </span>
  );
}

export function FarmersPageContent() {
  const intl = useIntl();
  const navigate = useNavigate();
  const getErrorMessage = useApiErrorMessage();
  const errorToast = useApiErrorToast();
  const successToast = useApiSuccessToast();
  const t = (k: string) => intl.formatMessage({ id: k });
  useBreadcrumb([{ label: t('farmers.title') }]);

  // ── URL-backed state ──────────────────────────────────────────
  // Why: refresh / direct-link rehydrates filters; back-button walks
  // filter changes; admins can share `/farmers?societies=A,B&sort=name
  // &page=3`. Multi-selects encode as comma-joined values so the URL
  // stays readable.
  //
  // Single batched updater (`updateUrl`) so a filter change + page
  // reset commit in one `setSearchParams` — react-router's setter
  // reads the searchParams ref at call time, so back-to-back calls
  // in the same handler stomp each other.
  const [searchParams, setSearchParams] = useSearchParams();

  const urlQ = searchParams.get('q') ?? '';
  const societyParam = searchParams.get('society') ?? '';
  const statusParam = searchParams.get('status') ?? '';
  const certificationParam = searchParams.get('certification') ?? '';
  const certExpiryParam = searchParams.get('certExpiry') ?? '';
  const clmrsParam = searchParams.get('clmrs') ?? '';
  // URL-backed single-column sort shared with every other list screen.
  // `sort` is the encoded token forwarded to `useFarmersList`; `hasSort`
  // drives the reset control; `sorterPropsFor` wires each header cell.
  const { sort, hasSort, sortSpec, sorterPropsFor } = useTableSort();
  const pageRaw = searchParams.get('page');
  const pageParsed = pageRaw === null ? NaN : Number(pageRaw);
  const page = Number.isFinite(pageParsed) && pageParsed >= 1 ? Math.floor(pageParsed) : 1;

  /** Apply a batch of `{key: value|null}` URL updates atomically. */
  const updateUrl = (updates: Record<string, string | number | null>) => {
    setSearchParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(updates)) {
          if (v === null || v === '' || v === undefined) {
            out.delete(k);
          } else {
            out.set(k, String(v));
          }
        }
        return out;
      },
      { replace: true },
    );
  };

  // Setters for single-select filters — write the value (or delete the
  // key when 'all' / empty) and reset to page 1.
  const setSociety = (next: string) => updateUrl({ society: next || null, page: null });
  const setStatus = (next: string) => updateUrl({ status: next || null, page: null });
  const setCertification = (next: string) => updateUrl({ certification: next || null, page: null });
  const setCertExpiry = (next: string) => updateUrl({ certExpiry: next || null, page: null });
  const setClmrs = (next: string) => updateUrl({ clmrs: next || null, page: null });
  const setPage = (next: number) => updateUrl({ page: next <= 1 ? null : next });

  const includeDeleted = statusParam === 'deleted';

  // Permission gating is via <PermissionGate> in JSX below. Server
  // enforces too; hiding controls the user can't use keeps the UI
  // honest and avoids 403 toasts.

  const [createOpen, setCreateOpen] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Export the CURRENT filtered set (server applies the same filters +
  // active-coop scope via the cookie). Streams CSV then downloads it.
  const handleExportCsv = async () => {
    setExporting(true);
    try {
      await downloadFarmersCsv({
        q: urlQ || undefined,
        society: societyParam || undefined,
        certificationStatus: certificationParam || undefined,
        certExpiry: certExpiryParam || undefined,
        includeDeleted: includeDeleted ? 'true' : undefined,
      });
    } catch (err) {
      errorToast(err);
    } finally {
      setExporting(false);
    }
  };
  const [editTarget, setEditTarget] = useState<ApiFarmer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiFarmer | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<ApiFarmer | null>(null);

  // Cooperative / society / certification filters are now server-side
  // — BE accepts comma-separated lists and runs `IN (...)` for 2+
  // values. Sending the joined CSV directly keeps `total` honest so
  // pagination matches the actual filtered count (previously, multi-
  // select would bypass the server filter and the page count reflected
  // the full unfiltered table — 4145 / 10 ≈ 415 pages, with each page
  // showing only the rows that happened to match in that 10-row slice).
  const {
    data: listResp,
    isLoading,
    isValidating,
    error: listError,
  } = useFarmersList({
    page,
    pageSize: PAGE_LIMIT,
    q: urlQ || undefined,
    society: societyParam || undefined,
    certificationStatus: certificationParam || undefined,
    certExpiry: certExpiryParam || undefined,
    includeDeleted: includeDeleted || undefined,
    // Forward the URL sort token verbatim so the BE handles ordering.
    // Skipping when undefined lets the BE keep its desc(createdAt) default.
    sort,
  });

  const items = listResp?.items ?? [];
  const total = listResp?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  // Distinguish "first paint, no data yet" (skeleton) from "page or
  // filter changed, previous data carried forward by keepPreviousData"
  // (dim the table). Without this split, page clicks would still
  // collapse the layout because the table-body branch keys on
  // `isLoading` alone.
  const initialLoading = isLoading && !listResp;
  const refetching = isValidating && !!listResp;

  // Cooperative / society / certification all go through the BE's
  // multi-select filter now, so the only client-side narrowing left is
  // the status bucket (active/inactive/deleted) — it's a derived value
  // synthesised from `isActive` + `deletedAt`, and the BE filter API
  // currently exposes those columns as separate booleans rather than a
  // bucket enum. Once that's promoted server-side we can drop this
  // pass entirely and trust `total` from the response.

  // Worst CLMRS status per farmer, derived from `/api/clmrs-records`
  // (coaching-visit-backed). open > pending > closed > none.
  const activeCoop = useActiveCoop(selectActiveCoop);
  const { data: clmrsData } = useClmrsRecords(activeCoop?.cooperativeCode ?? null);
  const clmrsStatusByFarmer = useMemo(() => {
    const rank: Record<ClmrsFarmerStatus, number> = { none: 0, closed: 1, pending: 2, open: 3 };
    const m = new Map<string, ClmrsFarmerStatus>();
    for (const r of clmrsData?.records ?? []) {
      const s: ClmrsFarmerStatus = r.case
        ? r.case.status === 'open'
          ? 'open'
          : 'closed'
        : 'pending';
      const cur = m.get(r.flag.farmerId) ?? 'none';
      if (rank[s] > rank[cur]) m.set(r.flag.farmerId, s);
    }
    return m;
  }, [clmrsData]);
  const farmerClmrsStatus = (id: string): ClmrsFarmerStatus =>
    clmrsStatusByFarmer.get(id) ?? 'none';

  const filteredItems = items.filter((f) => {
    const bucket = farmerStatusBucket(f);
    if (statusParam && bucket !== statusParam) return false;
    if (!statusParam && bucket === 'deleted') return false;
    if (clmrsParam && farmerClmrsStatus(f.id) !== clmrsParam) return false;
    return true;
  });

  // CLMRS status is client-side mock (getFarmerClmrsStatus) with no
  // backend, so the `clmrs` sort — like the CLMRS filter above — is
  // applied in-memory over the current page. Severity rank:
  // open > pending > closed > none. Every OTHER field (including RA
  // certificate) is sorted server-side via the `sort` param so it orders
  // the whole dataset, not just the page — displayItems === filteredItems
  // then.
  const clmrsSort = sortSpec.find((s) => s.field === 'clmrs');
  const displayItems = clmrsSort
    ? [...filteredItems].sort((a, b) => {
        const rank: Record<string, number> = { open: 0, pending: 1, closed: 2, none: 3 };
        const d = rank[farmerClmrsStatus(a.id)] - rank[farmerClmrsStatus(b.id)];
        return clmrsSort.dir === 'desc' ? -d : d;
      })
    : filteredItems;

  // Society filter options — pulled from the full-stats endpoint so we
  // see every distinct society across the tenant (not just the rows
  // visible on the current paginated page).
  const { data: fullStats } = useFarmerFullStats();
  const availableSocieties = useMemo(() => {
    return sortSocieties((fullStats?.bySociety ?? []).map((r) => r.society).filter(Boolean));
  }, [fullStats]);

  const resetFilters = () => {
    // Wipe every farmer-page param in one render. Going via setSearchParams
    // directly avoids the stomping issue with calling each setter
    // individually (react-router reads searchParamsRef at call time).
    setSearchParams({}, { replace: true });
  };

  const handleCreate = async (data: CreateFarmerInput | UpdateFarmerInput) => {
    try {
      await createFarmer(data as CreateFarmerInput);
      const create = data as CreateFarmerInput;
      successToast({
        id: 'farmers.toast.created',
        values: {
          name: `${create.firstName ?? ''} ${create.lastName ?? ''}`.trim() || '—',
        },
      });
      setCreateOpen(false);
    } catch (err) {
      errorToast(err);
      throw err;
    }
  };

  const handleEdit = async (data: CreateFarmerInput | UpdateFarmerInput) => {
    if (!editTarget) return;
    try {
      await updateFarmer(editTarget.id, data);
      successToast({
        id: 'farmers.toast.updated',
        values: {
          name:
            `${editTarget.firstName ?? ''} ${editTarget.lastName ?? ''}`.trim() ||
            editTarget.farmerCode,
        },
      });
      setEditTarget(null);
    } catch (err) {
      errorToast(err);
      throw err;
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteFarmer(deleteTarget.id);
      successToast({
        id: 'farmers.toast.deleted',
        values: {
          name:
            `${deleteTarget.firstName ?? ''} ${deleteTarget.lastName ?? ''}`.trim() ||
            deleteTarget.farmerCode,
        },
      });
      setDeleteTarget(null);
    } catch (err) {
      errorToast(err);
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    try {
      await restoreFarmer(restoreTarget.id);
      successToast({
        id: 'farmers.toast.restored',
        values: {
          name:
            `${restoreTarget.firstName ?? ''} ${restoreTarget.lastName ?? ''}`.trim() ||
            restoreTarget.farmerCode,
        },
      });
      setRestoreTarget(null);
    } catch (err) {
      errorToast(err);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-2xl text-foreground">{t('farmers.title')}</h1>
            <p className="text-muted-foreground text-sm">{t('farmers.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Hard-coded `?entity=farmers` matches the URL contract
                of the audit-log page: that param accepts a CSV of
                `entity_table` values, and `farmers` is one of the
                curated `SCOPE_OPTIONS`. Landing pre-filtered keeps the
                click count to one when an admin chases "what changed
                about farmers this week". */}
            <PermissionGate codes={['farmer:notification']}>
              <Button variant="outline" asChild>
                <Link to="/notifications?entity=farmers">
                  <History className="size-4" />
                  {t('common.history')}
                </Link>
              </Button>
            </PermissionGate>
            <PermissionGate codes={['farmer:create']}>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                {t('farmers.addFarmer')}
              </Button>
            </PermissionGate>
            {/* Overflow menu — Import / Export CSV tucked behind a "⋮"
                so the header stays uncluttered. */}
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t('common.moreActions')}>
                  <EllipsisVertical className="size-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto min-w-[176px] p-1">
                <PermissionGate codes={['farmer:create']}>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setCsvImportOpen(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <Upload className="size-4" />
                    {t('farmers.importCsv')}
                  </button>
                </PermissionGate>
                <button
                  type="button"
                  disabled={exporting}
                  onClick={() => {
                    setMenuOpen(false);
                    handleExportCsv();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                >
                  <Download className="size-4" />
                  {t('farmers.exportCsv')}
                </button>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {listError && <ErrorBanner message={getErrorMessage(listError)} />}

        {/* Inline slim stats — Pencil-matched at-a-glance summary sits
            above the filter bar. Same component also lives on the
            dashboard; both share one server-side LRU, so rendering
            here costs essentially nothing extra. */}
        <FarmersSlimStats filteredCount={total} />

        {/* Filter bar */}
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-2 xs:grid-cols-2 lg:grid-cols-6">
            <ListSearch
              className="col-span-1 lg:col-span-2"
              value={urlQ}
              onValueChange={(next) => updateUrl({ q: next || null, page: null })}
              placeholder={t('farmers.filters.searchPlaceholder')}
            />
            <Select value={societyParam || undefined} onValueChange={(v) => setSociety(v)}>
              <SelectTrigger
                className="w-full"
                onClear={societyParam ? () => setSociety('') : undefined}
              >
                <Building2 className="size-4 text-muted-foreground" />
                <SelectValue placeholder={t('farmers.filters.allSocieties')} />
              </SelectTrigger>
              <SelectContent>
                {availableSocieties.map((s) => (
                  <SelectItem key={s} value={s}>
                    {formatSociety(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={certificationParam || undefined}
              onValueChange={(v) => setCertification(v)}
            >
              <SelectTrigger
                className="w-full"
                onClear={certificationParam ? () => setCertification('') : undefined}
              >
                <ShieldCheck className="size-4 text-muted-foreground" />
                <SelectValue placeholder={t('farmers.filters.allCertifications')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="certified">
                  {t('farmers.certification.outcome.certified')}
                </SelectItem>
                <SelectItem value="certified_with_ca">
                  {t('farmers.certification.outcome.certified_with_ca')}
                </SelectItem>
                <SelectItem value="not_certified">
                  {t('farmers.certification.outcome.not_certified')}
                </SelectItem>
                <SelectItem value="disqualified">
                  {t('farmers.certification.outcome.disqualified')}
                </SelectItem>
                <SelectItem value="none">{t('farmers.certification.outcome.none')}</SelectItem>
              </SelectContent>
            </Select>
            {/* Certificate validity, separate from the outcome above: the
                buyer's question is "what renews this quarter?", and an
                outcome word cannot answer it. */}
            <Select value={certExpiryParam || undefined} onValueChange={(v) => setCertExpiry(v)}>
              <SelectTrigger
                className="w-full"
                onClear={certExpiryParam ? () => setCertExpiry('') : undefined}
              >
                <CalendarClock className="size-4 text-muted-foreground" />
                <SelectValue placeholder={t('farmers.filters.allCertExpiry')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expiring">{t('farmers.certExpiry.expiring')}</SelectItem>
                <SelectItem value="expired">{t('farmers.certExpiry.expired')}</SelectItem>
                <SelectItem value="valid">{t('farmers.certExpiry.valid')}</SelectItem>
                <SelectItem value="none">{t('farmers.certExpiry.none')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={clmrsParam || undefined} onValueChange={(v) => setClmrs(v)}>
              <SelectTrigger
                className="w-full"
                onClear={clmrsParam ? () => setClmrs('') : undefined}
              >
                <ShieldAlert className="size-4 text-muted-foreground" />
                <SelectValue placeholder={t('farmers.filters.allClmrs')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">{t('farmers.filters.clmrsOpen')}</SelectItem>
                <SelectItem value="pending">{t('farmers.filters.clmrsPending')}</SelectItem>
                <SelectItem value="closed">{t('farmers.filters.clmrsClosed')}</SelectItem>
                <SelectItem value="none">{t('farmers.filters.clmrsNone')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusParam || undefined} onValueChange={(v) => setStatus(v)}>
              <SelectTrigger
                className="w-full"
                onClear={statusParam ? () => setStatus('') : undefined}
              >
                <CircleDot className="size-4 text-muted-foreground" />
                <SelectValue placeholder={t('farmers.filters.allStatuses')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{t('farmers.status.active')}</SelectItem>
                <SelectItem value="deleted">{t('farmers.status.deleted')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(urlQ || societyParam || statusParam || certificationParam || clmrsParam || hasSort) && (
            <button
              type="button"
              onClick={resetFilters}
              className="shrink-0 text-muted-foreground text-sm hover:text-foreground"
            >
              {t('farmers.filters.reset')}
            </button>
          )}
        </div>

        {/* Table + pager wrapper. Pinned under the AppHeader (`top-12`
            = header h-12) and capped to the viewport height below it, so
            it becomes a self-contained scroll frame: the table area
            scrolls (both axes) inside, the header freezes at its top, and
            the pager stays visible at the bottom. This keeps horizontal
            overflow inside the table (no page x-stretch) AND gives a
            frozen header — without depending on the responsive height of
            everything above the table. */}
        <div className="sticky top-16 flex max-h-[calc(100vh-5rem)] flex-col gap-3">
          {/* The table's scroll box: fills the wrapper (`flex-1 min-h-0`)
              and owns both-axis scroll. The Table primitive's own
              container is set `overflow-visible` so there's a single
              scroller here — the sticky header (top-0) and sticky first
              column both anchor to it. */}
          <div className="min-h-0 flex-1 overflow-auto border-y border-border bg-card">
            <Table className="table-fixed" containerClassName="overflow-visible">
              {/* `sticky top-0` freezes the header against this box's
                  vertical scroll; `[&_th]:bg-muted` keeps every header
                  cell opaque (no hover bleed-through, opaque over rows). */}
              <TableHeader className="sticky top-0 z-20 [&_th]:bg-muted">
                <TableRow className="bg-muted">
                  {/* Sticky first column — merged Farmer (name over the
                      farmer-ID cross-ref link). `bg-muted` matches the
                      header row so scrolled cells don't bleed through;
                      `z-20` sits above body cells (z-10). The header
                      doubles as a click-to-sort control on the farmer
                      name (via ColumnSorter), so `p-0` lets the sorter
                      button fill the cell. */}
                  <TableHead className="sticky left-0 z-20 w-[220px] bg-muted p-0">
                    <ColumnSorter {...sorterPropsFor('name')} label={t('farmers.table.farmer')} />
                  </TableHead>
                  <TableHead className="w-[140px] p-0">
                    <ColumnSorter
                      {...sorterPropsFor('society')}
                      label={t('farmers.table.society')}
                    />
                  </TableHead>
                  <TableHead className="w-[140px] p-0">
                    <ColumnSorter {...sorterPropsFor('phone')} label={t('farmers.table.phone')} />
                  </TableHead>
                  <TableHead className="w-[140px] p-0">
                    <ColumnSorter
                      {...sorterPropsFor('registration_date')}
                      label={t('farmers.table.startDate')}
                    />
                  </TableHead>
                  <TableHead className="w-[150px] p-0">
                    <ColumnSorter
                      {...sorterPropsFor('certificate')}
                      label={t('farmers.table.certificate')}
                    />
                  </TableHead>
                  <TableHead className="w-[100px] p-0">
                    <ColumnSorter {...sorterPropsFor('clmrs')} label={t('farmers.table.clmrs')} />
                  </TableHead>
                  <TableHead className="w-[120px] p-0">
                    <ColumnSorter
                      {...sorterPropsFor('corrective_actions')}
                      label={t('farmers.table.correctiveActions')}
                    />
                  </TableHead>
                  <TableHead className="w-[110px] p-0">
                    <ColumnSorter {...sorterPropsFor('status')} label={t('farmers.table.status')} />
                  </TableHead>
                  <TableHead className="w-[120px]">{t('farmers.table.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody style={refetching ? { opacity: 0.85 } : undefined}>
                {initialLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                      <Loader2 className="mx-auto size-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : displayItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                      {t('farmers.table.noFarmers')}
                    </TableCell>
                  </TableRow>
                ) : (
                  displayItems.map((f) => {
                    const isDeleted = Boolean(f.deletedAt);
                    const bucket = farmerStatusBucket(f);
                    return (
                      <TableRow
                        key={f.id}
                        // `group/row` + solid `hover:bg-muted` so the
                        // sticky first cell can match exactly via
                        // `group-hover/row:bg-muted`.
                        className={
                          isDeleted
                            ? 'group/row opacity-60 hover:bg-muted'
                            : 'group/row hover:bg-muted'
                        }
                      >
                        {/* Sticky first col — merged Farmer: name over
                            the farmer-ID cross-ref link (→ farmer
                            detail, gated by farmer:read). `bg-card` +
                            `group-hover/row:bg-muted` keep the pinned
                            cell opaque as the row scrolls under it. */}
                        <TableCell className="sticky left-0 z-10 w-[220px] bg-card text-[13px] transition-colors group-hover/row:bg-muted">
                          <FarmerRefCell
                            farmerName={`${f.firstName} ${f.lastName}`.trim() || null}
                            farmerCode={f.id}
                          />
                        </TableCell>
                        <TableCell className="w-[140px]" title={f.society ?? ''}>
                          {f.society ? (
                            <StatusTag tone="lime">
                              <LandPlot className="size-3" />
                              {formatSociety(f.society)}
                            </StatusTag>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell
                          className="w-[140px] truncate text-[13px] text-muted-foreground"
                          title={f.phoneNumber ?? ''}
                        >
                          {f.phoneNumber ? (
                            <a
                              // tel: hands off to the OS dialer (or
                              // FaceTime / Skype on desktops). Strip
                              // spaces so the URI is well-formed even
                              // when the stored value is human-grouped
                              // ("0244 123 456"). The trailing icon mirrors
                              // the farmer / parcel cross-ref cells so the
                              // number reads as an actionable link.
                              href={`tel:${f.phoneNumber.replace(/\s+/g, '')}`}
                              className={LIST_SUB_LINK}
                            >
                              {f.phoneNumber}
                              <SquareArrowOutUpRight className="size-3 shrink-0" />
                            </a>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="w-[140px] text-[13px] text-muted-foreground">
                          {f.registrationDate ? formatGhanaDate(f.registrationDate) : '—'}
                        </TableCell>
                        <TableCell className="w-[150px]">
                          <RefCell
                            name={
                              <CertificationOutcomeBadge
                                outcome={f.latestCertification?.outcome ?? null}
                              />
                            }
                            code={<CertificateExpiry farmer={f} />}
                          />
                        </TableCell>
                        <TableCell className="w-[100px]">
                          <ClmrsStatusPill status={farmerClmrsStatus(f.id)} showNone />
                        </TableCell>
                        <TableCell className="w-[120px]">
                          {f.correctiveActions > 0 ? (
                            <StatusTag tone="caution">
                              <TriangleAlert className="size-3" />
                              {f.correctiveActions}
                            </StatusTag>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusTag tone={STATUS_TONE[bucket]} dot>
                            {t(`farmers.status.${bucket}`)}
                          </StatusTag>
                        </TableCell>
                        <TableCell>
                          {isDeleted ? (
                            // Restore is a delete-permission action — it
                            // toggles the same `deletedAt` column that
                            // soft-delete sets.
                            <PermissionGate codes={['farmer:delete']}>
                              <button
                                type="button"
                                aria-label={t('farmers.actions.restore')}
                                className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                onClick={() => setRestoreTarget(f)}
                              >
                                <RotateCcw className="size-4" />
                              </button>
                            </PermissionGate>
                          ) : (
                            <div className="flex items-center gap-1">
                              <PermissionGate codes={['farmer:read']}>
                                <button
                                  type="button"
                                  className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                  onClick={() => navigate(`/farmers/${f.id}`)}
                                >
                                  <Eye className="size-4" />
                                </button>
                              </PermissionGate>
                              <PermissionGate codes={['farmer:update']}>
                                <button
                                  type="button"
                                  className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                  onClick={() => setEditTarget(f)}
                                >
                                  <Pencil className="size-4" />
                                </button>
                              </PermissionGate>
                              <PermissionGate codes={['farmer:delete']}>
                                <button
                                  type="button"
                                  className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                                  onClick={() => setDeleteTarget(f)}
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              </PermissionGate>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {!initialLoading && (
            // Result count on the left, pager on the right. The pager
            // carries a built-in `w-full` from the shadcn primitive —
            // `mx-0 w-auto` passthrough strips that so it can sit
            // inline. When `totalPages <= 1` the pager renders nothing
            // and the count still shows thanks to its own flex-cell.
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 pb-1">
              <span className="text-[13px] text-muted-foreground tabular-nums">
                {intl.formatMessage(
                  { id: 'common.pager.showing' },
                  {
                    from: total === 0 ? 0 : (page - 1) * PAGE_LIMIT + 1,
                    to: Math.min(total, page * PAGE_LIMIT),
                    total: total.toLocaleString(),
                  },
                )}
              </span>
              <DataPagination
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
                className="mx-0 w-auto"
              />
            </div>
          )}
        </div>
      </div>

      {/* Create dialog */}
      <FarmerDialog open={createOpen} onOpenChange={setCreateOpen} onSubmit={handleCreate} />

      {/* Bulk CSV import */}
      <FarmersCsvImportDialog open={csvImportOpen} onOpenChange={setCsvImportOpen} />

      {/* Edit dialog */}
      <FarmerDialog
        open={!!editTarget}
        onOpenChange={(v) => {
          if (!v) setEditTarget(null);
        }}
        onSubmit={handleEdit}
        initialData={editTarget ?? undefined}
      />

      {/* Delete confirm */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader className="border-b-0">
            <h3 className="font-semibold text-lg">{t('farmers.deleteDialog.title')}</h3>
            <p className="text-muted-foreground text-sm">
              {intl.formatMessage(
                { id: 'farmers.deleteDialog.description' },
                {
                  name: deleteTarget ? `${deleteTarget.firstName} ${deleteTarget.lastName}` : '',
                },
              )}
            </p>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t('farmers.deleteDialog.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t('farmers.deleteDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore confirm */}
      <Dialog
        open={!!restoreTarget}
        onOpenChange={(v) => {
          if (!v) setRestoreTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader className="border-b-0">
            <h3 className="font-semibold text-lg">{t('farmers.restoreDialog.title')}</h3>
            <p className="text-muted-foreground text-sm">
              {intl.formatMessage(
                { id: 'farmers.restoreDialog.description' },
                {
                  name: restoreTarget ? `${restoreTarget.firstName} ${restoreTarget.lastName}` : '',
                },
              )}
            </p>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreTarget(null)}>
              {t('farmers.restoreDialog.cancel')}
            </Button>
            <Button onClick={handleRestore}>{t('farmers.restoreDialog.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
