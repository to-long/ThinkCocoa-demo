/**
 * Audit log table — the 7-column view used by /notifications:
 *   Timestamp (sticky) · User · User Action · Entity · Changes ·
 *   Status · row Actions.
 *
 * Helpers (`entityDisplayName`, `entityDetailHref`, tone palettes,
 * `previewValue`) are co-located here so a future caller can drop
 * the table in elsewhere without dragging the helpers along too.
 *
 * Most callers will pass every prop, but `sortDir`/`onSortChange`
 * and `onPinEntity`/`onPinUser` are optional so a future read-only
 * embed (e.g. a record detail page card) can render the same table
 * without sort controls or clickable cells.
 */

import { ArrowUp, ExternalLink, Eye, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { Link, useNavigate } from 'react-router-dom';
import { ColumnSorter } from '@/components/ui/column-sorter';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { truncateMiddle } from '@/lib/truncate-middle';
import type { ApiAuditLog, ApiAuditLogChangePreviewEntry, AuditStatus } from '@/shared/api';
import { RefCell } from '@/shared/components/composed/entity-ref-cell';
import { StackedDateTime } from '@/shared/components/composed/stacked-date-time';

/* -------------------------------------------------------------------------- */
/* Helpers — also exported for callers that want to render an entity name
/* or status badge outside the table (e.g. breadcrumb, page title).
/* -------------------------------------------------------------------------- */

const SCOPE_LABELS: Record<string, string> = {
  farmers: 'Farmer',
  users: 'User',
  cooperatives: 'Cooperative',
  parcels: 'Parcel',
  batches: 'Batch',
  inspections: 'Inspection',
  trainings: 'Training',
  eudr_assessments: 'EUDR Assessment',
  roles: 'Role',
  permissions: 'Permission',
  sync_jobs: 'Sync Job',
  sync_settings: 'Sync Settings',
  report_runs: 'Report',
};

// Map an audit `entityTable` → FE detail route. `null` for tables
// without a detail page. Keep in sync with `apps/fe/src/index.tsx`.
const ENTITY_DETAIL_ROUTES: Record<string, (id: string) => string> = {
  farmers: (id) => `/farmers/${id}`,
  users: (id) => `/admin/users/${id}`,
  cooperatives: (id) => `/admin/cooperatives/${id}`,
};

export function entityDetailHref(table: string, id: string | null): string | null {
  if (!id) return null;
  const builder = ENTITY_DETAIL_ROUTES[table];
  return builder ? builder(id) : null;
}

export function scopeLabel(table: string): string {
  if (SCOPE_LABELS[table]) return SCOPE_LABELS[table]!;
  return table.charAt(0).toUpperCase() + table.slice(1);
}

/**
 * Derive a friendly display name from the row's `metadata.entity`
 * snapshot so the table can show "Farmer Kofi Asare" instead of a
 * raw UUID. Falls back to the scope label when the snapshot is
 * missing or has no usable field.
 */
export function entityDisplayName(row: ApiAuditLog): string {
  const ent = (row.metadata?.entity ?? null) as Record<string, unknown> | null;
  const str = (k: string): string => (ent && typeof ent[k] === 'string' ? (ent[k] as string) : '');
  const fallback = scopeLabel(row.entityTable);
  switch (row.entityTable) {
    case 'farmers': {
      const full = `${str('firstName')} ${str('lastName')}`.trim();
      return full || str('farmerCode') || fallback;
    }
    case 'users':
      return str('fullName') || str('email') || fallback;
    case 'cooperatives':
      return str('name') || str('code') || fallback;
    case 'batches':
      return str('batchCode') || str('code') || fallback;
    case 'parcels':
      return str('parcelCode') || str('code') || fallback;
    case 'inspections':
      return str('code') || str('title') || fallback;
    case 'trainings':
      return str('title') || str('code') || fallback;
    case 'eudr_assessments':
      return str('parcelCode') || fallback;
    case 'roles':
    case 'permissions':
      return str('code') || str('name') || fallback;
    case 'sync_jobs':
    case 'sync_settings':
      return str('label') || str('koboFormId') || str('formId') || fallback;
    case 'report_runs':
      return str('name') || str('reportCode') || fallback;
    default:
      return fallback;
  }
}

const ACTION_TONES: Record<string, { bg: string; text: string }> = {
  create: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  update: { bg: 'bg-violet-100', text: 'text-violet-700' },
  delete: { bg: 'bg-red-100', text: 'text-red-700' },
  'soft-delete': { bg: 'bg-red-50', text: 'text-red-600' },
  restore: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  login: { bg: 'bg-slate-100', text: 'text-slate-700' },
  logout: { bg: 'bg-slate-100', text: 'text-slate-700' },
  get: { bg: 'bg-slate-100', text: 'text-slate-700' },
  run: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  import: { bg: 'bg-purple-100', text: 'text-purple-700' },
  export: { bg: 'bg-amber-100', text: 'text-amber-700' },
  sync_started: { bg: 'bg-blue-100', text: 'text-blue-700' },
  sync_completed: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  sync_failed: { bg: 'bg-red-100', text: 'text-red-700' },
};

export function actionTone(action: string) {
  return ACTION_TONES[action] ?? { bg: 'bg-muted', text: 'text-foreground' };
}

const STATUS_TONES: Record<AuditStatus, { bg: string; text: string }> = {
  success: { bg: 'bg-green-100', text: 'text-green-700' },
  failed: { bg: 'bg-red-50', text: 'text-red-600' },
  warning: { bg: 'bg-yellow-50', text: 'text-yellow-700' },
};

export function statusTone(status: AuditStatus | null) {
  if (!status) return { bg: 'bg-muted', text: 'text-muted-foreground' };
  return STATUS_TONES[status];
}

const PREVIEW_MAX_CHARS = 30;
export function previewValue(v: unknown): string {
  const cap = (s: string) =>
    s.length > PREVIEW_MAX_CHARS ? `${s.slice(0, PREVIEW_MAX_CHARS)}...` : s;
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return cap(v);
  if (typeof v === 'number' || typeof v === 'boolean') return cap(String(v));
  try {
    return cap(JSON.stringify(v));
  } catch {
    return '[unserializable]';
  }
}

/* -------------------------------------------------------------------------- */
/* AuditLogTable                                                              */
/* -------------------------------------------------------------------------- */

interface Props {
  items: ApiAuditLog[];
  initialLoading: boolean;
  refetching: boolean;
  /** Optional sort wiring. When omitted the timestamp header renders
   *  plain text without the sort widget — useful for read-only embeds
   *  that don't need URL-backed sort. `null` = unsorted (BE default),
   *  'asc' / 'desc' = explicit user pick. */
  sortDir?: 'asc' | 'desc' | null;
  onSortChange?: (dir: 'asc' | 'desc' | null) => void;
  /** When the calling page renders zero rows we still want a friendly
   *  message; callers may override with a context-specific empty
   *  state. Falls back to the shared `auditLogs.empty` key. */
  emptyMessage?: ReactNode;
  /** Optional filter handler for the entity cell. When provided the
   *  cell grows an arrow button that emits the row's (entityTable,
   *  entityId); /notifications pins that to the URL filter. Read-only
   *  embeds omit it and the entity id links to the audit detail. */
  onPinEntity?: (entityTable: string, entityId: string) => void;
  /** Optional handler for clicking on the actor (User) cell. When
   *  provided AND the row has an `actorUserId`, the User cell becomes
   *  a button that pins the actor to the URL filter — same shape as
   *  onPinEntity above. Anonymous / system rows (no actorUserId) stay
   *  plain. */
  onPinUser?: (actorUserId: string) => void;
}

/**
 * The only thing in a cell that applies a filter.
 *
 * The whole actor / entity cell used to be a button, so reading an email
 * meant hovering a link and a stray click re-filtered the page. The text is
 * inert now; this sits at the right edge and is the single explicit
 * "narrow to this" affordance.
 */
function ApplyFilterButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            // The row navigates to the audit detail — filtering must not
            // also open it.
            e.stopPropagation();
            onClick();
          }}
          // No `title`: it would double up with the tooltip, one styled
          // and one the browser's, on a ~1s delay apart.
          aria-label={label}
          className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
        >
          <ArrowUp className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Change lines rendered inline before collapsing into "+N more". */
const MAX_CHANGE_LINES = 2;

export function AuditLogTable({
  items,
  initialLoading,
  refetching,
  sortDir,
  onSortChange,
  emptyMessage,
  onPinEntity,
  onPinUser,
}: Props) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const navigate = useNavigate();

  return (
    <Table
      className="transition-opacity duration-150"
      style={{ opacity: refetching ? 0.85 : 1 }}
      // Scroll box: fills the sticky wrapper (`min-h-0 flex-1`) and owns
      // both-axis scroll, so the sticky header (top-0) and sticky first
      // column both anchor to it.
      containerClassName="relative min-h-0 w-full max-w-full flex-1 overflow-auto border-y border-border bg-card"
    >
      <TableHeader className="sticky top-0 z-20 [&_th]:bg-muted">
        <TableRow className="bg-muted">
          {/* Timestamp leads: an audit feed is read chronologically, and
              it is the column that stays pinned while the row scrolls. */}
          <TableHead className="sticky left-0 z-20 w-[160px] bg-muted p-0">
            {onSortChange && sortDir !== undefined ? (
              <ColumnSorter
                value={sortDir}
                onChange={onSortChange}
                label={t('auditLogs.table.timestamp')}
              />
            ) : (
              <span className="block px-4 py-2 font-medium text-muted-foreground">
                {t('auditLogs.table.timestamp')}
              </span>
            )}
          </TableHead>
          <TableHead className="w-[240px]">{t('auditLogs.table.user')}</TableHead>
          <TableHead className="w-[110px]">{t('auditLogs.table.userActions')}</TableHead>
          <TableHead className="w-[220px]">{t('auditLogs.table.scope')}</TableHead>
          <TableHead className="w-[260px]">{t('auditLogs.table.changes')}</TableHead>
          <TableHead className="w-[90px]">{t('auditLogs.table.status')}</TableHead>
          <TableHead className="w-[60px] text-right">{t('auditLogs.table.actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {initialLoading ? (
          <TableRow>
            <TableCell colSpan={7} className="h-32 text-center">
              <div className="inline-flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t('auditLogs.loading')}
              </div>
            </TableCell>
          </TableRow>
        ) : items.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
              {emptyMessage ?? t('auditLogs.empty')}
            </TableCell>
          </TableRow>
        ) : (
          items.map((row) => {
            const aTone = actionTone(row.action);
            const sTone = statusTone(row.status);
            const entityName = entityDisplayName(row);
            return (
              <TableRow key={row.id} className="group/row hover:bg-muted">
                <TableCell
                  className="sticky left-0 z-10 cursor-pointer whitespace-nowrap bg-card transition-colors group-hover/row:bg-muted hover:underline"
                  onClick={() => navigate(`/notifications/${row.id}`)}
                  title={t('auditLogs.actions.view')}
                >
                  <StackedDateTime value={row.createdAt} />
                </TableCell>
                <TableCell className="text-[13px]">
                  {row.actorFullName || row.actorEmail || row.ipAddress ? (
                    // Text inert; filtering is the arrow only.
                    <RefCell
                      name={row.actorFullName ?? '—'}
                      code={row.actorEmail}
                      action={
                        onPinUser && row.actorUserId ? (
                          <ApplyFilterButton
                            onClick={() => onPinUser(row.actorUserId!)}
                            label={t('auditLogs.actions.applyFilter')}
                          />
                        ) : null
                      }
                    />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <RefCell
                    name={
                      <span
                        className={`inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${aTone.bg} ${aTone.text}`}
                      >
                        {row.action}
                      </span>
                    }
                    code={row.ipAddress}
                  />
                </TableCell>
                <TableCell className="text-[13px]">
                  {/* Entity name over id. When onPinEntity is provided
                      (notifications page) both are inert and the arrow
                      pins this entity to the URL filter; otherwise the id
                      links to the audit detail. */}
                  <RefCell
                    name={entityName}
                    code={
                      row.entityId ? (
                        onPinEntity ? (
                          truncateMiddle(row.entityId, 10, 4)
                        ) : (
                          <Link
                            to={`/notifications/${row.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex min-w-0 items-center gap-1 hover:text-foreground hover:underline"
                            title={entityDetailHref(row.entityTable, row.entityId) ?? row.entityId}
                          >
                            <span className="truncate">{truncateMiddle(row.entityId, 10, 4)}</span>
                            <ExternalLink className="size-3 shrink-0" />
                          </Link>
                        )
                      ) : null
                    }
                    action={
                      onPinEntity && row.entityId ? (
                        <ApplyFilterButton
                          onClick={() => onPinEntity(row.entityTable, row.entityId!)}
                          label={t('auditLogs.actions.applyFilter')}
                        />
                      ) : null
                    }
                  />
                </TableCell>
                <TableCell className="text-[12px]">
                  {(() => {
                    const all = row.changesPreview?.preview ?? [];
                    if (all.length === 0) return <span className="text-muted-foreground">—</span>;
                    // Two lines is the row height every other column already
                    // occupies (name over email, action over IP). A third
                    // line would make audit rows taller than the rest of the
                    // app's tables for no extra signal — the overflow link
                    // rides the second line instead of adding one.
                    const visible = all.slice(0, MAX_CHANGE_LINES);
                    const hidden = (row.changesPreview?.total ?? 0) - visible.length;
                    // gap-1 (4px) + leading-tight — the same line spacing
                    // `RefCell` uses, so every stacked cell in the row
                    // lines up.
                    return (
                      <div className="flex min-w-0 flex-col gap-1 leading-tight">
                        {visible.map((ch: ApiAuditLogChangePreviewEntry, i) => {
                          const oldStr = previewValue(ch.oldValue);
                          const newStr = previewValue(ch.newValue);
                          const isLast = i === visible.length - 1;
                          return (
                            <div
                              key={ch.fieldName}
                              className="flex min-w-0 items-center gap-1"
                              title={`${ch.fieldName}: ${oldStr} → ${newStr}`}
                            >
                              <span className="shrink-0 font-medium text-foreground">
                                {ch.fieldName}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-mono">
                                <span className="text-red-600 dark:text-red-400">{oldStr}</span>
                                <span className="px-1 text-muted-foreground">→</span>
                                <span className="text-emerald-600 dark:text-emerald-400">
                                  {newStr}
                                </span>
                              </span>
                              {isLast && hidden > 0 ? (
                                <Link
                                  to={`/notifications/${row.id}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                                >
                                  {intl.formatMessage(
                                    { id: 'auditLogs.table.changesMore' },
                                    { n: hidden },
                                  )}
                                </Link>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </TableCell>
                <TableCell>
                  {row.status ? (
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize ${sTone.bg} ${sTone.text}`}
                    >
                      {t(`auditLogs.status.${row.status}`)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/notifications/${row.id}`);
                    }}
                    className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                    aria-label={t('auditLogs.actions.view')}
                  >
                    <Eye className="size-4" />
                  </button>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
