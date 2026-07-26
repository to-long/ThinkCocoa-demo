/**
 * Audit Log list page — matches Pencil `hnyIP`.
 *
 * Sections (top → bottom):
 *   1. Header        — title "Audit Log" + subtitle
 *   2. Slim stats    — Total Events card + Status / Scope breakdown
 *   3. Filter bar    — search + Action select + Scope select + Status
 *                      select + Date-window select + Reset link
 *   4. Table         — User (name+email+IP stacked, sticky) /
 *                      Timestamp / User Actions / Entity / Changes /
 *                      Status / Actions (eye → detail)
 *   5. Pager footer  — "Showing X-Y of Z results" + prev/next
 *
 * Stats come from `/api/audit-logs/stats` (independent window of 30
 * days). The list itself comes from `/api/audit-logs` with server-side
 * filtering + pagination.
 */

import { Activity, ArrowLeft, CircleDot, Globe, X } from 'lucide-react';
import { useIntl } from 'react-intl';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { DataPagination } from '@/components/ui/data-pagination';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { ErrorBanner } from '@/components/ui/error-banner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  type ApiAuditLog,
  type AuditStatus,
  useAuditLogList,
  useAuditLogStats,
} from '@/shared/api/audit-logs';
import { ListSearch } from '@/shared/components/composed/list-search';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { getLastMenuRoute } from '@/shared/hooks/use-last-menu-route';
import { selectActiveCoopId, useActiveCoop } from '@/shared/store/useActiveCoop';
import { AuditLogTable, scopeLabel } from './audit-log-table';
import { AuditLogsSlimStats } from './audit-logs-slim-stats';

const PAGE_SIZE = 10;

/** Ghana-local `yyyy-MM-dd` for URL params + the date-range picker. */
function fmtIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIsoDate(s: string | null | undefined): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

// Action verbs we surface in the filter dropdown. Anything else still
// flows through the table — these are just the curated common set.
const ACTION_OPTIONS = [
  'create',
  'update',
  'soft-delete',
  'restore',
  'login',
  'logout',
  'run',
  'export',
] as const;

// Real `entity_table` values that audit_logs rows actually carry.
// Picking an option not in this set silently zeroes the result —
// keep in sync with `audit.resource_from_entity_table()` in the
// migration. NO `system` here: that was a placeholder, no audit row
// ever uses it.
const SCOPE_OPTIONS = [
  'farmers',
  'parcels',
  'inspections',
  'trainings',
  'batches',
  'eudr_assessments',
  'cooperatives',
  'users',
  'roles',
  'permissions',
  'sync_jobs',
  'report_runs',
] as const;

export function AuditLogsPageContent() {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const navigate = useNavigate();
  useBreadcrumb([{ label: t('auditLogs.title') }]);

  // Back to the last non-notification page visited this session, or
  // the dashboard on a fresh session. See `useTrackLastMenuRoute`.
  const goBack = () => navigate(getLastMenuRoute() ?? '/');

  // Filter / sort / page state lives in URL search params so refresh,
  // deep-link, back/forward, and share-by-link all just work. Default
  // values are dropped from the URL via `updateUrl` so the canonical
  // "no filter" URL stays clean.
  const [searchParams, setSearchParams] = useSearchParams();

  const urlQ = searchParams.get('q') ?? '';
  // Single-choice facet filters (mirrors the farmer list — one value
  // each, cleared to show "all").
  const actionFilter = searchParams.get('action') ?? '';
  const scopeFilter = searchParams.get('entity') ?? '';
  const statusFilter = searchParams.get('status') ?? '';
  // Single-object pins: clicking entity / user cells in a row narrows
  // the table to that record / actor. Rendered as dismissable chips
  // inside the search input.
  const entityIdFilter = searchParams.get('entityId') ?? '';
  const actorIdFilter = searchParams.get('actorId') ?? '';
  // Explicit date range (replaces the old preset-days window). ISO
  // `yyyy-MM-dd` strings; sent to the BE as `from` / `to`.
  const dateFrom = searchParams.get('dateFrom') ?? '';
  const dateTo = searchParams.get('dateTo') ?? '';
  const pageRaw = searchParams.get('page');
  const pageParsed = pageRaw === null ? NaN : Number(pageRaw);
  const page = Number.isFinite(pageParsed) && pageParsed >= 1 ? Math.floor(pageParsed) : 1;
  // JSON:API sort spec: `-createdAt` = desc, `createdAt` = asc.
  // Anything else (or absent) collapses to "no explicit sort" → BE
  // applies its desc-createdAt default and the header shows the
  // unsorted ArrowUpDown glyph.
  const sortRaw = searchParams.get('sort') ?? '';
  const sortDir: 'asc' | 'desc' | null =
    sortRaw === '-createdAt' ? 'desc' : sortRaw === 'createdAt' ? 'asc' : null;

  /** Batched URL updater. `null` / empty deletes the param. Always
   *  `replace: true` so filter clicks don't pile up history entries.
   *  Uses functional setter to avoid races between back-to-back calls
   *  in the same handler (each read of the old URL would clobber the
   *  previous write otherwise). */
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

  // Filter setters — each one resets the pager so the user lands on
  // page 1 of the new dataset.
  const setActionFilter = (next: string) => updateUrl({ action: next || null, page: null });
  const setScopeFilter = (next: string) => updateUrl({ entity: next || null, page: null });
  const setStatusFilter = (next: string) => updateUrl({ status: next || null, page: null });
  const setSortDir = (next: 'asc' | 'desc' | null) =>
    // JSON:API: `-createdAt` desc, `createdAt` asc, omit for default.
    updateUrl({
      sort: next === 'desc' ? '-createdAt' : next === 'asc' ? 'createdAt' : null,
      page: null,
    });
  const setPage = (next: number) => updateUrl({ page: next <= 1 ? null : next });

  // Click handlers for the pinnable cells. We pin by id only — the
  // id alone is unique enough to narrow the result set, and the
  // scope dropdown stays free for the admin to broaden it.
  const pinEntity = (_entityTable: string, entityId: string) => updateUrl({ entityId, page: null });
  const pinUser = (actorUserId: string) => updateUrl({ actorId: actorUserId, page: null });

  // Cooperative scope comes from the active-coop cookie (header
  // CoopSwitcher), not a per-page filter. Org-wide users with no
  // coop selected see all.
  const activeCoopId = useActiveCoop(selectActiveCoopId);

  const listParams = {
    q: urlQ || undefined,
    actions: actionFilter ? [actionFilter] : undefined,
    actorId: actorIdFilter || undefined,
    entityId: entityIdFilter || undefined,
    entityTables: scopeFilter ? [scopeFilter] : undefined,
    cooperativeIds: activeCoopId ? [activeCoopId] : undefined,
    statuses: statusFilter ? [statusFilter as AuditStatus] : undefined,
    // The BE validates `from`/`to` as full ISO datetimes; the picker
    // gives `yyyy-MM-dd`. Expand to day boundaries (end-of-day on `to`
    // so the whole end date is inclusive).
    from: dateFrom ? `${dateFrom}T00:00:00.000Z` : undefined,
    to: dateTo ? `${dateTo}T23:59:59.999Z` : undefined,
    page,
    pageSize: PAGE_SIZE,
    sort: sortDir === 'desc' ? '-createdAt' : sortDir === 'asc' ? 'createdAt' : undefined,
  };

  const { data, isLoading, isValidating, error } = useAuditLogList(listParams);
  // Stats are the full-feed headline counters (shown only when no filter
  // is active), so they use the default 30-day window regardless of the
  // list's date-range filter.
  const { data: stats } = useAuditLogStats();

  // Hide the stats card whenever any user-applied filter is active —
  // the stats reflect the full feed, not the filtered subset. `days`
  // is excluded because it has a non-empty default (30).
  const hasActiveFilter =
    urlQ.trim() !== '' ||
    actionFilter !== '' ||
    scopeFilter !== '' ||
    statusFilter !== '' ||
    entityIdFilter.trim() !== '' ||
    actorIdFilter.trim() !== '' ||
    dateFrom !== '' ||
    dateTo !== '';

  // initialLoading: first fetch (no prior data). Refetching keeps
  // existing rows visible under a dim overlay to avoid layout shift.
  const initialLoading = isLoading && !data;
  const refetching = isValidating && !!data;

  const items: ApiAuditLog[] = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);

  // Friendly label for the actor pin chip: look up the actor by id
  // in the currently-visible rows (name → email → truncated id).
  // The URL only carries the id so this is the cheapest way to show
  // something human-readable.
  const actorPinLabel = (() => {
    if (!actorIdFilter) return null;
    const hit = items.find((r) => r.actorUserId === actorIdFilter);
    return hit?.actorFullName || hit?.actorEmail || actorIdFilter.slice(0, 8);
  })();

  // Subtitle reflects the active scope/entity pin so the admin sees
  // WHY the result set is narrow. Priority: entityId pin (with or
  // without scope) > scope filter > default.
  const subtitle = (() => {
    if (entityIdFilter) {
      return scopeFilter
        ? intl.formatMessage(
            { id: 'auditLogs.subtitleEntityId' },
            { scope: scopeLabel(scopeFilter), entityId: entityIdFilter },
          )
        : intl.formatMessage({ id: 'auditLogs.subtitleId' }, { entityId: entityIdFilter });
    }
    if (scopeFilter) {
      return intl.formatMessage(
        { id: 'auditLogs.subtitleEntity' },
        { scope: scopeLabel(scopeFilter) },
      );
    }
    return t('auditLogs.subtitle');
  })();

  // Wipe every filter param in one render so we never flash through
  // intermediate URLs (e.g. `?action=create` after `?q=` is cleared).
  const resetFilters = () => {
    setSearchParams({}, { replace: true });
  };

  // Anything the Reset button would clear — including the deep-link
  // chips (entityId / actorId) and a non-default sort.
  const hasActiveFilters = Boolean(
    urlQ ||
      actionFilter ||
      scopeFilter ||
      statusFilter ||
      entityIdFilter ||
      actorIdFilter ||
      dateFrom ||
      dateTo ||
      sortRaw,
  );

  return (
    // `min-w-0` lets wide children (the table) shrink instead of
    // pushing the page past its viewport.
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground">{t('auditLogs.title')}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Button variant="outline" onClick={goBack}>
          <ArrowLeft className="size-4" />
          {t('common.back')}
        </Button>
      </div>

      {error ? <ErrorBanner message={t('auditLogs.errors.loadFailed')} /> : null}

      {!hasActiveFilter ? <AuditLogsSlimStats stats={stats} filteredCount={total} /> : null}

      {/* Pinned-filter chips (entityId, actorId) sit as removable badges
          above the search + filter row. They used to live INSIDE the
          search input with a useLayoutEffect that measured their width
          and shoved the input's left-padding accordingly — moved out so
          the search input can be the shared `ListSearch` primitive with
          no measurement glue. */}
      {entityIdFilter || actorIdFilter ? (
        <div className="flex flex-wrap items-center gap-2">
          {entityIdFilter ? (
            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[12px]">
              <span className="text-muted-foreground">{t('auditLogs.filters.entityIdLabel')}</span>
              <span className="font-mono text-foreground">{entityIdFilter}</span>
              <button
                type="button"
                onClick={() => updateUrl({ entityId: null, page: null })}
                className="ml-0.5 cursor-pointer text-muted-foreground hover:text-foreground"
                aria-label={t('auditLogs.filters.clearEntityId')}
              >
                <X className="size-3" />
              </button>
            </span>
          ) : null}
          {actorIdFilter ? (
            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[12px]">
              <span className="text-muted-foreground">{t('auditLogs.filters.actorLabel')}</span>
              <span className="font-medium text-foreground">{actorPinLabel}</span>
              <button
                type="button"
                onClick={() => updateUrl({ actorId: null, page: null })}
                className="ml-0.5 cursor-pointer text-muted-foreground hover:text-foreground"
                aria-label={t('auditLogs.filters.clearActor')}
              >
                <X className="size-3" />
              </button>
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Filter row — mirrors the farmer list: 1 col mobile, 2 tablet,
          6 wide; single-choice selects + an explicit date range. */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-2 xs:grid-cols-2 lg:grid-cols-6">
          <ListSearch
            className="col-span-1 lg:col-span-2"
            value={urlQ}
            onValueChange={(next) => updateUrl({ q: next || null, page: null })}
            placeholder={t('auditLogs.searchPlaceholder')}
          />
          <Select value={actionFilter || undefined} onValueChange={setActionFilter}>
            <SelectTrigger
              className="w-full"
              onClear={actionFilter ? () => setActionFilter('') : undefined}
            >
              <Activity className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('auditLogs.filters.allActions')} />
            </SelectTrigger>
            <SelectContent>
              {ACTION_OPTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={scopeFilter || undefined} onValueChange={setScopeFilter}>
            <SelectTrigger
              className="w-full"
              onClear={scopeFilter ? () => setScopeFilter('') : undefined}
            >
              <Globe className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('auditLogs.filters.allScopes')} />
            </SelectTrigger>
            <SelectContent>
              {SCOPE_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {scopeLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter || undefined} onValueChange={setStatusFilter}>
            <SelectTrigger
              className="w-full"
              onClear={statusFilter ? () => setStatusFilter('') : undefined}
            >
              <CircleDot className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('auditLogs.filters.allStatuses')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="success">{t('auditLogs.status.success')}</SelectItem>
              <SelectItem value="failed">{t('auditLogs.status.failed')}</SelectItem>
              <SelectItem value="warning">{t('auditLogs.status.warning')}</SelectItem>
            </SelectContent>
          </Select>
          <DateRangePicker
            value={{ from: parseIsoDate(dateFrom), to: parseIsoDate(dateTo) }}
            onChange={(r) =>
              updateUrl({
                dateFrom: r.from ? fmtIsoDate(r.from) : null,
                dateTo: r.to ? fmtIsoDate(r.to) : null,
                page: null,
              })
            }
            placeholder={t('auditLogs.filters.dateRangeAll')}
          />
        </div>
        {/* Only offer Reset when there's something to reset — every other
            list screen gates it the same way. */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="shrink-0 cursor-pointer font-medium text-muted-foreground text-sm hover:text-foreground"
          >
            {t('auditLogs.filters.reset')}
          </button>
        )}
      </div>

      {/* Table + pager wrapper — pinned under the AppHeader (`top-12`) and
          viewport-tall so the table scrolls (both axes) inside, the header
          freezes at its top, and the pager stays at the bottom (matches the
          farmers list). The scroll box + sticky header + sticky first column
          live inside AuditLogTable so it can fill this flex wrapper. */}
      <div className="sticky top-16 flex max-h-[calc(100vh-5rem)] flex-col gap-3">
        <AuditLogTable
          items={items}
          initialLoading={initialLoading}
          refetching={refetching}
          sortDir={sortDir}
          onSortChange={setSortDir}
          onPinEntity={pinEntity}
          onPinUser={pinUser}
        />

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <span className="text-[13px] text-muted-foreground">
            {intl.formatMessage(
              { id: 'common.pager.showing' },
              { from, to, total: total.toLocaleString() },
            )}
          </span>
          <DataPagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            previousLabel={t('auditLogs.pager.previous')}
            nextLabel={t('auditLogs.pager.next')}
          />
        </div>
      </div>
    </div>
  );
}
