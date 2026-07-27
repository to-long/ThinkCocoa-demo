/**
 * Notification detail page — matches Pencil `IxwXb`.
 *
 * Sections (top → bottom, all inside a 692px column):
 *   1. Title row             — "Notification detail" + Back button
 *   2. Notification card     — colored avatar w/ initials + actor row
 *                              (name · time · status badge) + summary
 *                              line w/ external-link to entity
 *   3. Changes card          — Field / Old Value / New Value table
 *   4. Event Information     — 3 rows × 2 cols (Action / Timestamp,
 *                              Entity Type / Entity ID + copy,
 *                              Status / Entity Link)
 *   5. User Information      — 3 rows × 2 cols (User Email / Name,
 *                              User Role / Session ID,
 *                              IP / User Agent)
 *
 * Top card mirrors the dropdown row shape — avatar tint hashed off
 * the actor name so the same person shows the same color across the
 * bell, the list, and this detail screen.
 */

import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import { useIntl } from 'react-intl';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { avatarTintForName } from '@/lib/brand-palette';
import { truncateMiddle } from '@/lib/truncate-middle';
import { type ApiAuditLogChange, type AuditStatus, useAuditLog } from '@/shared/api/audit-logs';
import { BackButton } from '@/shared/components/composed/back-button';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';

// Tone palette matches Pencil `JGnYl` (success): bg #dcfce7, text
// #16a34a → green-100 / green-600. Failed + warning kept on the
// same red / amber rails for consistency.
const STATUS_TONE: Record<AuditStatus, { bg: string; text: string }> = {
  success: { bg: 'bg-green-100', text: 'text-green-600' },
  failed: { bg: 'bg-red-100', text: 'text-red-600' },
  warning: { bg: 'bg-yellow-100', text: 'text-yellow-700' },
};

const SCOPE_LABELS: Record<string, string> = {
  farmers: 'Farmer',
  cooperatives: 'Cooperative',
  users: 'User',
  roles: 'Role',
  permissions: 'Permission',
  batches: 'Batch',
  parcels: 'Farm',
  inspections: 'Inspection',
  trainings: 'Training',
  eudr_assessments: 'EUDR',
  sync_jobs: 'Sync',
  report_runs: 'Report',
  audit_logs: 'Audit',
  system: 'System',
};

function scopeLabel(table: string): string {
  return SCOPE_LABELS[table] ?? table.charAt(0).toUpperCase() + table.slice(1);
}

// Pull the entity's display name (no code) from its snapshot. The
// code is rendered separately as a `#GH2024`-style suffix to match
// the Pencil header layout.
function entityName(entityTable: string, entity: Record<string, unknown> | null): string | null {
  if (!entity) return null;
  if (entityTable === 'farmers' && entity.firstName && entity.lastName) {
    return `${entity.firstName} ${entity.lastName}`;
  }
  if (entityTable === 'parcels' && entity.parcelCode) {
    return String(entity.parcelCode);
  }
  if (entityTable === 'batches' && entity.purchaseCode) {
    return String(entity.purchaseCode);
  }
  for (const v of Object.values(entity)) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

// Map an audit `entityTable` to the FE detail route for that record.
// Returns `null` for tables without a detail page (roles, permissions,
// system, etc.). Mirrors the same map in the list page — keep both in
// sync with the route table in `apps/fe/src/index.tsx`.
const ENTITY_DETAIL_ROUTES: Record<string, (id: string) => string> = {
  farmers: (id) => `/farmers/${id}`,
  users: (id) => `/admin/users/${id}`,
  cooperatives: (id) => `/admin/cooperatives/${id}`,
};

function entityDetailHref(table: string, id: string | null): string | null {
  if (!id) return null;
  const builder = ENTITY_DETAIL_ROUTES[table];
  return builder ? builder(id) : null;
}

// Avatar tint + initials helpers live in `@/lib/brand-palette` —
// shared with the notification dropdown so the same actor renders the
// same colour across surfaces.
function actorInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // "Jan 15, 2024 14:23:45 UTC"
  const date = d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const time = d.toLocaleString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
  });
  return `${date} ${time} UTC`;
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function AuditLogDetailPageContent() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { auditLogId } = useParams<{ auditLogId: string }>();
  const t = (k: string) => intl.formatMessage({ id: k });

  const { data, isLoading, error } = useAuditLog(auditLogId);

  // Back button: route to /notifications with the current row's
  // entityId pre-pinned, so the admin lands on "all activity for THIS
  // object" instead of an unfiltered list. They came here to inspect
  // one event on this entity — surfacing the entity's other events on
  // the way back is the natural next step.
  //
  // entityId only — not entityTable. The id alone is unique enough to
  // narrow the list, and skipping the scope filter keeps the URL
  // clean and matches the table click-to-pin behaviour.
  //
  // Plain history(-1) so the user returns to wherever they came from
  // (filtered list, bell dropdown, …) with their state intact. Used
  // by the title-row arrow and the error-state fallback button.
  const goBack = () => navigate(-1);

  useBreadcrumb([
    { label: t('auditLogs.title'), href: '/notifications' },
    { label: t('auditLogs.detail.title') },
  ]);

  if (isLoading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorBanner message={t('auditLogs.errors.loadDetailFailed')} />
        <Button variant="outline" onClick={goBack}>
          <ArrowLeft className="size-4" />
          {t('common.back')}
        </Button>
      </div>
    );
  }

  const actorName = data.actorFullName ?? data.actorEmail ?? 'System';
  const tint = avatarTintForName(actorName);

  // Header line — segments so each piece picks its own typography:
  // action (lowercase) · EntityType (Title Case) · entity name.
  // Matches the Pencil sample "update Farmer Mensah John".
  const entitySnapshot = (data.metadata?.entity ?? null) as Record<string, unknown> | null;
  const headerName = entityName(data.entityTable, entitySnapshot);
  // Action card field below reuses the same wording.
  const eventTypeLabel = `${data.action} ${scopeLabel(data.entityTable)}`;
  const entityHref = entityDetailHref(data.entityTable, data.entityId);

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Title row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <BackButton alwaysHistory />
            <h1 className="text-2xl font-semibold text-foreground">
              {t('auditLogs.detail.title')}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">{t('auditLogs.detail.subtitle')}</p>
        </div>
      </div>

      {/* Content cards */}
      <div className="flex flex-col gap-4">
        {/* Notification card — Pencil `FbhNc`. Avatar 28×28 with
            white initials; content stacked: actor row (name · time
            · status) + summary line ({action} {EntityType}
            {entityName} - #{code}) + external-link icon. */}
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
            style={{ backgroundColor: tint }}
          >
            {actorInitials(actorName)}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[13px] font-semibold text-foreground">{actorName}</span>
              <span className="text-[12px] text-muted-foreground">·</span>
              <span className="text-[13px] text-muted-foreground">
                {relativeTime(data.createdAt)}
              </span>
              <span className="text-[12px] text-muted-foreground">·</span>
              <StatusBadge status={data.status} />
            </div>
            <div className="flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
              <span>
                <span className="lowercase">{data.action}</span> {scopeLabel(data.entityTable)}
                {headerName ? ` ${headerName}` : ''}
              </span>
              <span className="text-[12px] text-muted-foreground">·</span>
              {entityHref ? (
                <Link
                  to={entityHref}
                  className="inline-flex items-center text-muted-foreground transition-colors hover:text-foreground"
                  title={data.entityId ?? undefined}
                >
                  <ExternalLink className="size-4" />
                </Link>
              ) : (
                <ExternalLink className="size-4 opacity-40" />
              )}
            </div>
          </div>
        </div>

        {/* Changes card */}
        <SectionCard title={t('auditLogs.detail.changes.title')}>
          <ChangesTable changes={data.changes} t={t} />
        </SectionCard>

        {/* Event + User info sit side-by-side on desktop only; stacked
            (single column) on mobile + tablet so the fields aren't
            cramped. `items-start` so a taller card doesn't stretch the
            shorter one. */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {/* Event Information card */}
          <SectionCard title={t('auditLogs.detail.eventInfo.title')}>
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label={t('auditLogs.detail.fields.action')} value={eventTypeLabel} />
              <Field
                label={t('auditLogs.detail.fields.timestamp')}
                value={formatUtc(data.createdAt)}
              />
              <Field
                label={t('auditLogs.detail.fields.entityType')}
                value={scopeLabel(data.entityTable)}
              />
              <Field
                label={t('auditLogs.detail.fields.entityId')}
                value={data.entityId ? <CopyableTruncated value={data.entityId} /> : '—'}
                mono
              />
              <Field
                label={t('auditLogs.detail.fields.status')}
                value={<StatusBadge status={data.status} />}
              />
              <Field
                label={t('auditLogs.detail.fields.entityLink')}
                value={(() => {
                  if (!data.entityId) return '—';
                  const trunc = truncateMiddle(data.entityId, 10, 4);
                  const label =
                    entityHref !== null
                      ? entityHref.replace(data.entityId, trunc)
                      : `/${data.entityTable}/${trunc}`;
                  return entityHref ? (
                    <Link to={entityHref} className=" hover:underline" title={data.entityId}>
                      {label}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground" title={data.entityId}>
                      {label}
                    </span>
                  );
                })()}
                mono
              />
            </div>
          </SectionCard>

          {/* User Information card */}
          <SectionCard title={t('auditLogs.detail.userInfo.title')}>
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field
                label={t('auditLogs.detail.fields.userEmail')}
                value={data.actorEmail ?? '—'}
              />
              <Field
                label={t('auditLogs.detail.fields.userName')}
                value={data.actorFullName ?? '—'}
              />
              {/* User role isn't stored on the audit row today — render
                "—" as a placeholder so the layout matches the design;
                wire to a real value when the role snapshot is added. */}
              <Field label={t('auditLogs.detail.fields.userRole')} value="—" muted />
              <Field
                label={t('auditLogs.detail.fields.sessionId')}
                value={data.sessionId ? <CopyableTruncated value={data.sessionId} /> : '—'}
                mono
              />
              <Field label={t('auditLogs.detail.fields.ip')} value={data.ipAddress ?? '—'} mono />
              <Field
                label={t('auditLogs.detail.fields.userAgent')}
                value={data.userAgent ? <CopyableTruncated value={data.userAgent} /> : '—'}
              />
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-[16px] font-semibold text-foreground">{title}</h2>
      </div>
      <div className="px-4 pb-4">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  muted,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span
        className={`text-[14px] ${mono ? 'font-mono' : ''} ${
          muted ? 'text-muted-foreground' : 'text-foreground font-medium'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/** Render a long technical id (entity id / user agent / session id)
 *  as `xxxx…yyyy` with a copy button alongside. Hovering the
 *  truncated value reveals the full string via the native `title`
 *  tooltip. */
function CopyableTruncated({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span title={value}>{truncateMiddle(value, 4, 4)}</span>
      <CopyButton value={value} />
    </span>
  );
}

function StatusBadge({ status }: { status: AuditStatus | null }) {
  const intl = useIntl();
  if (!status) {
    return <span className="text-muted-foreground text-[13px]">—</span>;
  }
  const tone = STATUS_TONE[status];
  // Pencil `JGnYl`: padding 2/8, cornerRadius 10 (≈ rounded-full at
  // this height), text 11/600.
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${tone.bg} ${tone.text}`}
    >
      {intl.formatMessage({ id: `auditLogs.status.${status}` })}
    </span>
  );
}

function ChangesTable({ changes, t }: { changes: ApiAuditLogChange[]; t: (k: string) => string }) {
  if (changes.length === 0) {
    return (
      <p className="py-4 text-center text-[13px] text-muted-foreground">
        {t('auditLogs.detail.changes.empty')}
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="grid grid-cols-3 items-center gap-2 bg-muted px-3 py-2 text-[12px] font-semibold text-muted-foreground">
        <span>{t('auditLogs.detail.changes.field')}</span>
        <span>{t('auditLogs.detail.changes.oldValue')}</span>
        <span>{t('auditLogs.detail.changes.newValue')}</span>
      </div>
      {changes.map((ch, idx) => (
        <div
          key={ch.id}
          className={`grid grid-cols-3 items-center gap-2 px-3 py-2.5 text-[13px] ${
            idx < changes.length - 1 ? 'border-b border-border' : ''
          }`}
        >
          <span className="font-mono font-medium text-foreground">{ch.fieldName}</span>
          <span className="text-red-600 break-all">{stringifyValue(ch.oldValue)}</span>
          <span className="text-emerald-700 break-all">{stringifyValue(ch.newValue)}</span>
        </div>
      ))}
    </div>
  );
}
