/**
 * Reports page — mirrors the Pencil `LQckI` design.
 *
 * Vertical stack: horizontal tabs bar → detail card (filters + export)
 * → Export History card (table of every past run across all report
 * types, with pagination).
 *
 * Export is queued on the BE; the FE polls every 10 s and auto-triggers
 * a download once the run completes. History refreshes whenever a new
 * run finishes.
 */

import {
  BadgeCheck,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  History,
  Info,
  LandPlot,
  Loader2,
  type LucideIcon,
  Route as RouteIcon,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { DataPagination } from '@/components/ui/data-pagination';
import { DateRangePicker, type DateRangeValue } from '@/components/ui/date-range-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusTag } from '@/components/ui/status-tag';
import { formatDate, formatDateTime } from '@/lib/datetime';
import {
  type ReportCode,
  type ReportFormat,
  type ReportRun,
  reportDownloadUrl,
  runReport,
  useApiErrorToast,
  useApiSuccessToast,
  useReportRun,
  useReportRuns,
  useReportSocieties,
  useRevalidateReportRuns,
  useUsersList,
} from '@/shared/api';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';

interface ReportType {
  id: string;
  /** URL-safe slug used as the `?tab=` value. */
  slug: string;
  title: string;
  shortLabel: string;
  filename: string;
  icon: LucideIcon;
  description: string;
}

const REPORTS: ReportType[] = [
  {
    id: 'certification_status',
    slug: 'certification',
    title: 'Certification Status Report',
    shortLabel: 'Certification',
    filename: 'ThinkCocoa_Certification_Status_Report',
    icon: BadgeCheck,
    description:
      'Certification status of farmers and societies — covers certificate validity, audit outcomes and pending renewals for the selected season.',
  },
  {
    id: 'corrective_actions',
    slug: 'corrective-actions',
    title: 'Corrective Actions Report',
    shortLabel: 'Corrective Actions',
    filename: 'ThinkCocoa_Corrective_Actions_Report',
    icon: ClipboardList,
    description:
      'Outstanding corrective actions from inspection visits — grouped by parcel and farmer, with due dates and current status.',
  },
  {
    id: 'eudr_compliance',
    slug: 'eudr',
    title: 'EUDR Compliance Report',
    shortLabel: 'EUDR',
    filename: 'ThinkCocoa_EUDR_Compliance_Report',
    icon: ShieldCheck,
    description:
      'EUDR due-diligence statement bundle — parcel-level geolocation, risk assessment outcomes and deforestation evidence per cooperative.',
  },
  {
    id: 'farmer_coaching_v3',
    slug: 'farmer-coaching',
    title: 'Farmer Coaching Report (v3)',
    shortLabel: 'Farmer Coaching',
    filename: 'ThinkCocoa_Farmer_Coaching_Report_v3',
    icon: GraduationCap,
    description:
      'Coaching visits across the selected season — GAP, IPM, EUDR and CLMRS scores per farmer with follow-up flags.',
  },
  {
    id: 'gmr_template',
    slug: 'gmr',
    title: 'GMR Template',
    shortLabel: 'GMR',
    filename: 'ThinkCocoa_GMR_Template',
    icon: FileSpreadsheet,
    description:
      'Group management record template — pre-filled with the active season, society and program rows ready for downstream submission.',
  },
  {
    id: 'traceability_report',
    slug: 'traceability',
    title: 'Traceability Report Template',
    shortLabel: 'Traceability',
    filename: 'ThinkCocoa_Traceability_Report_Template',
    icon: RouteIcon,
    description:
      'End-to-end lot trace — primary + secondary evacuations linked to source farmers, with weight and grade reconciliation.',
  },
  {
    id: 'training_attendance',
    slug: 'training',
    title: 'Training Attendance Register',
    shortLabel: 'Training',
    filename: 'ThinkCocoa_Training_Attendance_Report',
    icon: GraduationCap,
    description:
      'Training attendance — one row per participant per session, with program, trainer, topics, gender totals, consent and trainer evaluation.',
  },
];

const REPORT_BY_SLUG = new Map(REPORTS.map((r) => [r.slug, r] as const));

/** UI label → BE outputFormat enum. PDF is rendered from the report's own
 *  CSV server-side, so its columns always match the CSV export's. */
const FORMAT_OPTIONS: ReadonlyArray<{ label: string; value: ReportFormat }> = [
  { label: 'XLSX', value: 'excel' },
  { label: 'CSV', value: 'csv' },
  { label: 'PDF', value: 'pdf' },
];

function formatLabel(value: string): string {
  return FORMAT_OPTIONS.find((f) => f.value === value)?.label ?? value.toUpperCase();
}

/** Subset of report IDs that actually have a BE generator wired today.
 *  The other tabs still render but their Export button is disabled
 *  until the corresponding generator lands. */
const WIRED_REPORT_CODES: ReadonlySet<string> = new Set([
  'farmer_coaching_v3',
  'traceability_report',
  'certification_status',
  'corrective_actions',
  'gmr_template',
  'eudr_compliance',
  'training_attendance',
]);

const HISTORY_PAGE_SIZE = 5;

/** Trigger a file download by injecting a hidden `<a>` and clicking it.
 *  The BE endpoint replies with a 302 to a presigned Spaces URL that
 *  carries `Content-Disposition: attachment; filename=…`, so the browser
 *  saves the file with the right name on its own. We deliberately do
 *  NOT set the `download` attribute here — on cross-origin redirects the
 *  HTML spec drops it, and some Chromium builds end up issuing the save
 *  twice while reconciling the dropped attribute. */
function triggerDownload(runId: string): void {
  const a = document.createElement('a');
  a.href = reportDownloadUrl(runId);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function ReportsPageContent() {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  useBreadcrumb([{ label: t('navigation.reports') }]);

  // Tab is mirrored to `?tab=<slug>` so individual report views are
  // deep-linkable. Unknown / missing slugs fall back to the first tab.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabSlug = searchParams.get('tab');
  const selected = (tabSlug && REPORT_BY_SLUG.get(tabSlug)) || REPORTS[0]!;
  const selectedId = selected.id;
  const setSelectedSlug = (slug: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', slug);
        return next;
      },
      { replace: true },
    );
  };

  const [dateRange, setDateRange] = useState<DateRangeValue>({});
  const [society, setSociety] = useState<string>('');
  const [fieldOfficer, setFieldOfficer] = useState<string>('');
  const [format, setFormat] = useState<string>('');
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);

  // Zero-pad + ISO-date-only (`YYYY-MM-DD`) — safe to compare and to
  // send to the BE, which parses via `new Date(dateFrom)`.
  const toIsoDate = (d: Date | undefined): string | null => {
    if (!d) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const dateFromIso = toIsoDate(dateRange.from);
  const dateToIso = toIsoDate(dateRange.to);

  // History card state
  const [historyPage, setHistoryPage] = useState(1);

  const SelectedIcon = selected.icon;
  const isWired = WIRED_REPORT_CODES.has(selected.id);
  const canExport = Boolean(dateFromIso && dateToIso && format && isWired) && !pendingRunId;

  const errorToast = useApiErrorToast();
  const successToast = useApiSuccessToast();
  const revalidateRuns = useRevalidateReportRuns();

  // History scoped to the currently-selected tab — switching tabs
  // refetches with the new reportCode filter.
  const { data: runsData } = useReportRuns({ reportCode: selected.id });
  const allRuns = runsData?.items ?? [];

  // Society options: distinct values from the selected report's source
  // table. Only fetched when the tab is a wired report; others get an
  // empty list so the dropdown shows just "All societies".
  const { data: societiesData } = useReportSocieties(isWired ? (selected.id as ReportCode) : null);
  const societyOptions = societiesData?.items ?? [];

  // Field Officer options — users with the field_officer role, so the
  // report can be scoped to a single officer's contribution. Label
  // adapts per report — see fieldOfficerLabelKey below.
  const { data: fieldOfficerData } = useUsersList({
    roleCode: 'field_officer',
    pageSize: 100,
  });
  const fieldOfficerOptions = (fieldOfficerData?.items ?? []).map((u) => ({
    id: u.id,
    name: u.fullName || u.email,
  }));

  // id → name lookup so the history table can show the field-officer a
  // run was scoped to by name instead of a raw UUID.
  const officerNameById = useMemo(
    () => new Map(fieldOfficerOptions.map((o) => [o.id, o.name] as const)),
    [fieldOfficerOptions],
  );

  // Report-specific label for the Field Officer / Staff filter. Falls
  // back to "Field officer" when the report doesn't rename the role.
  const fieldOfficerLabelKey: string =
    (
      {
        farmer_coaching_v3: 'reports.filters.coachPlaceholder',
        farmer_training_v3: 'reports.filters.trainerPlaceholder',
        cocoa_purchases: 'reports.filters.purchasingClerkPlaceholder',
      } as Record<string, string>
    )[selected.id] ?? 'reports.filters.fieldOfficerPlaceholder';

  // History column header for the officer role — reuse the tab's
  // report-specific filter label (Coach / Trainer / Purchasing clerk /
  // Field officer) minus its trailing "…" so the column matches the
  // filter the user is looking at.
  const officerColLabel = t(fieldOfficerLabelKey).replace(/(\.\.\.|…)\s*$/, '');

  // Society is derived from cocoa-purchase / farmer records, so it's
  // meaningless on Secondary Evacuation (depot-level, no per-farmer
  // attribution). Suppress the filter there.
  const showSociety = selected.id !== 'secondary_evacuation';

  // When District changes, wipe Society so a stale selection from
  // another district doesn't silently ride along in the export.
  useEffect(() => {
    setSociety('');
  }, []);

  // Paginate client-side. List is bounded (≤100) so this is fast and
  // avoids a second BE call.
  const historyTotalPages = Math.max(1, Math.ceil(allRuns.length / HISTORY_PAGE_SIZE));
  const historyOffset = (historyPage - 1) * HISTORY_PAGE_SIZE;
  const historyRows = allRuns.slice(historyOffset, historyOffset + HISTORY_PAGE_SIZE);

  // SWR-polled status for the most recently triggered run. When it
  // flips to `completed`, kick the browser into downloading the file.
  const { data: polledRun } = useReportRun(pendingRunId);
  const downloadedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!polledRun || !pendingRunId) return;
    if (polledRun.status === 'completed' && !downloadedRef.current.has(polledRun.id)) {
      downloadedRef.current.add(polledRun.id);
      triggerDownload(polledRun.id);
      successToast({ id: 'reports.toast.completed' });
      setPendingRunId(null);
      revalidateRuns();
    } else if (polledRun.status === 'failed' && !downloadedRef.current.has(polledRun.id)) {
      downloadedRef.current.add(polledRun.id);
      errorToast(new Error(polledRun.errorMessage ?? t('reports.toast.failed')));
      setPendingRunId(null);
      revalidateRuns();
    }
    // `t` is deliberately absent: react-intl hands back a new formatter every
    // render, so listing it would re-run this effect constantly. It is only
    // read for a toast message, and its output for a fixed id does not change
    // within a locale.
  }, [polledRun, pendingRunId, successToast, errorToast, revalidateRuns]);

  const handleExport = async () => {
    if (!canExport || !isWired) return;
    try {
      const { runId } = await runReport({
        reportCode: selected.id as ReportCode,
        outputFormat: format as ReportFormat,
        parameters: {
          dateFrom: dateFromIso,
          dateTo: dateToIso,
          // Report always covers the active cooperative (header selector);
          // no separate district picker — it would duplicate that scope.
          districtId: null,
          societyId: society && society !== 'all' ? society : null,
          fieldOfficerUserId: fieldOfficer && fieldOfficer !== 'all' ? fieldOfficer : null,
        },
      });
      setPendingRunId(runId);
      successToast({ id: 'reports.toast.queued' });
      revalidateRuns();
    } catch (err) {
      errorToast(err);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-2xl text-foreground">{t('reports.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('reports.subtitle')}</p>
      </header>

      {/* Tabs bar */}
      <div className="flex flex-wrap gap-1 rounded-lg border bg-muted p-1">
        {REPORTS.map((r) => {
          const Icon = r.icon;
          const isActive = r.id === selectedId;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedSlug(r.slug)}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 font-medium text-[13px] transition-colors ${
                isActive
                  ? 'border-border bg-background text-foreground shadow-xs'
                  : 'border-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground'
              }`}
            >
              <Icon className="size-[15px]" />
              <span>{t(`reports.type.${r.id}.short`)}</span>
            </button>
          );
        })}
      </div>

      {/* Detail card */}
      <div className="flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
        <div className="flex flex-col gap-2.5 px-6 py-5">
          <div className="flex items-center gap-3">
            <StatusTag tone="success" variant="icon">
              <SelectedIcon className="size-5" />
            </StatusTag>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h2 className="truncate font-semibold text-foreground text-lg">
                {t(`reports.type.${selected.id}.title`)}
              </h2>
              <span className="truncate text-muted-foreground text-xs">{selected.filename}</span>
            </div>
            <StatusTag tone="success">
              <FileText className="size-3" />
              {formatLabel(format || FORMAT_OPTIONS[0]!.value)}
            </StatusTag>
          </div>
          <p className="text-muted-foreground text-[13px]">
            {t(`reports.type.${selected.id}.description`)}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 px-6 xs:grid-cols-2 xl:grid-cols-6">
          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
            placeholder={t('reports.filters.dateRangePlaceholder')}
            presets="seasons"
            className="w-full"
          />
          {showSociety && (
            <Select value={society || undefined} onValueChange={(v) => setSociety(v)}>
              <SelectTrigger
                className="h-10 w-full"
                onClear={society ? () => setSociety('') : undefined}
              >
                <LandPlot className="size-4 text-muted-foreground" />
                <SelectValue placeholder={t('reports.filters.societyPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('reports.filters.societyAllItem')}</SelectItem>
                {societyOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={fieldOfficer || undefined} onValueChange={(v) => setFieldOfficer(v)}>
            <SelectTrigger
              className="h-10 w-full"
              onClear={fieldOfficer ? () => setFieldOfficer('') : undefined}
            >
              <UserRound className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t(fieldOfficerLabelKey)} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('reports.filters.fieldOfficerAllItem')}</SelectItem>
              {fieldOfficerOptions.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={format || undefined} onValueChange={(v) => setFormat(v)}>
            <SelectTrigger
              className="h-10 w-full"
              onClear={format ? () => setFormat('') : undefined}
            >
              <FileText className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('reports.filters.formatPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {FORMAT_OPTIONS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Info className="size-3.5" aria-hidden />
            <span>
              {!isWired
                ? t('reports.footer.notWired')
                : pendingRunId
                  ? t('reports.footer.generating')
                  : t('reports.footer.hint')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-9"
              disabled={!canExport}
              onClick={handleExport}
            >
              {pendingRunId ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              {pendingRunId ? t('reports.actions.exportPending') : t('reports.actions.export')}
            </Button>
          </div>
        </div>
      </div>

      {/* Export History card */}
      <div className="flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
        <div className="flex flex-col gap-0.5 border-b px-5 py-4">
          <span className="flex items-center gap-2 font-semibold text-base text-foreground">
            <History className="size-4 text-muted-foreground" />
            {t('reports.history.heading')}
          </span>
          <span className="text-[13px] text-muted-foreground">{t('reports.history.subtitle')}</span>
        </div>

        {historyRows.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">
            {t('reports.history.empty')}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              {/* Columns mirror the export filters (duration, society,
                  field officer, format) plus the run result (exported-at
                  + file). Reports are scoped to the active cooperative
                  (header selector), so there's no district column. */}
              <table className="w-full min-w-[980px] table-fixed">
                <thead>
                  <tr className="border-b bg-muted text-left [&>th]:px-5 [&>th]:py-2.5 [&>th]:font-semibold [&>th]:text-[11px] [&>th]:text-muted-foreground [&>th]:uppercase [&>th]:tracking-wide">
                    <th className="w-[240px]">{t('reports.history.col.duration')}</th>
                    <th className="w-[150px]">{t('reports.history.col.society')}</th>
                    <th className="w-[160px]">{officerColLabel}</th>
                    <th className="w-[150px]">{t('reports.history.col.exported')}</th>
                    <th className="min-w-[260px]">{t('reports.history.col.file')}</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((run) => (
                    <HistoryRow
                      key={run.id}
                      run={run}
                      t={t}
                      officerName={(id) => officerNameById.get(id) ?? id}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
              <span className="text-[13px] text-muted-foreground">
                {intl.formatMessage(
                  { id: 'reports.history.showing' },
                  {
                    from: historyOffset + 1,
                    to: Math.min(historyOffset + HISTORY_PAGE_SIZE, allRuns.length),
                    total: allRuns.length,
                  },
                )}
              </span>
              {historyTotalPages > 1 && (
                <DataPagination
                  page={historyPage}
                  totalPages={historyTotalPages}
                  onPageChange={setHistoryPage}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function HistoryRow({
  run,
  t,
  officerName,
}: {
  run: ReportRun;
  t: (k: string) => string;
  officerName: (id: string) => string;
}): React.ReactElement {
  const params = (run.parameters ?? {}) as {
    season?: string;
    dateFrom?: string;
    dateTo?: string;
    districtId?: string | null;
    societyId?: string | null;
    fieldOfficerUserId?: string | null;
  };
  // Duration = the explicit start → end window the report covers.
  // Prefer the stored `dateFrom`/`dateTo`; legacy runs only kept a
  // `YYYY/YY` season string, so derive the cocoa-year window from it
  // (Oct 1 startYear → Sep 30 the following year).
  const seasonToRange = (season?: string): { from?: string; to?: string } => {
    const m = (season ?? '').match(/^(\d{4})/);
    if (!m) return {};
    const startYear = Number(m[1]);
    return { from: `${startYear}-10-01`, to: `${startYear + 1}-09-30` };
  };
  const legacy = params.dateFrom ? {} : seasonToRange(params.season);
  const durationFrom = params.dateFrom ?? legacy.from;
  const durationTo = params.dateTo ?? legacy.to;
  const isCompleted = run.status === 'completed' && run.file;
  const isFailed = run.status === 'failed';
  const isPending = run.status === 'queued' || run.status === 'running';

  return (
    <tr className="border-b last:border-b-0 [&>td]:align-middle">
      <td className="px-5 py-3">
        {durationFrom && durationTo ? (
          <StatusTag tone="lime" className="text-[12px] tabular-nums">
            {formatDate(durationFrom)}
            <span className="opacity-60">→</span>
            {formatDate(durationTo)}
          </StatusTag>
        ) : (
          <span className="text-[12px] text-muted-foreground">—</span>
        )}
      </td>
      <td className="truncate px-5 py-3 text-[12px] text-muted-foreground">
        {params.societyId ?? t('reports.history.allSocieties')}
      </td>
      <td className="truncate px-5 py-3 text-[12px] text-muted-foreground">
        {params.fieldOfficerUserId
          ? officerName(params.fieldOfficerUserId)
          : t('reports.filters.fieldOfficerAllItem')}
      </td>
      <td className="whitespace-nowrap px-5 py-3 text-[12px] text-muted-foreground">
        {formatDateTime(run.createdAt)}
      </td>
      <td className="px-5 py-3">
        {isCompleted ? (
          <a
            href={reportDownloadUrl(run.id)}
            title={run.file?.fileName ?? undefined}
            className="flex min-w-0 max-w-full items-center gap-1.5 font-medium text-[13px] text-blue-700 hover:underline"
          >
            <Download className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">
              {run.file?.fileName ?? t('reports.history.download')}
            </span>
          </a>
        ) : isFailed ? (
          <span className="text-[13px] text-red-700">
            {t('reports.status.failed')}
            {run.errorMessage ? ` · ${run.errorMessage}` : ''}
          </span>
        ) : isPending ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t(`reports.status.${run.status}`)}
          </span>
        ) : (
          <span className="text-[13px] text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}
