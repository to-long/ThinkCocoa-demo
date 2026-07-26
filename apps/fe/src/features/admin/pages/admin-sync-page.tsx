/**
 * Admin → Data Sync page.
 *
 * Lists all Kobo sync jobs (one row per `integration.sync_settings`
 * record) with last-run status badges, an Auto Sync toggle, a Run
 * Now button, and an Edit dialog for sourceUrl / interval / field
 * mapping.
 *
 * Permissions:
 *   - sync:read   → list + open dialog
 *   - sync:update → save edit + toggle auto-sync
 *   - sync:create → click "Run Now"
 *   - sync:reset  → "Reset demo data" (wipe + re-seed; system_admin only)
 */

import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  FastForward,
  Loader2,
  Pencil,
  Play,
  RotateCcw,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useSWRConfig } from 'swr';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { StatusTag } from '@/components/ui/status-tag';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PermissionGate } from '@/features/auth';
import {
  type ApiSyncSettings,
  resetDemoData,
  runSyncJob,
  SYNC_SETTINGS_LIST_KEY,
  type SyncRunStatus,
  updateSyncSettings,
  useApiErrorToast,
  useApiSuccessToast,
  useSyncSettingsList,
} from '@/shared/api';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { GroupSyncSettingsDialog } from '../components/group-sync-settings-dialog';
import { SyncSettingsDialog } from '../components/sync-settings-dialog';

export function AdminSyncPage() {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const errorToast = useApiErrorToast();
  const successToast = useApiSuccessToast();
  const { mutate } = useSWRConfig();

  useBreadcrumb([{ label: intl.formatMessage({ id: 'navigation.adminSync' }) }]);

  const { data, isLoading } = useSyncSettingsList();
  // Modules A (Community Profile) and E (Awareness Sessions) are seeded
  // by migration 0025 for completeness but never got a parser — the
  // platform intentionally does not ingest them. Hide them here rather
  // than adding a BE column, since the intent is UI-only and rolling a
  // new migration for a hardcoded filter would be over-engineered.
  const HIDDEN_JOB_KEYS = new Set([
    'clmrs_module_a_community',
    'clmrs_module_e_awareness',
    // Yield Estimation form is seeded but not yet consumed by any
    // parser or dashboard. Hide until it's actually wired.
    'yield_estimation',
  ]);
  const items = (data?.items ?? []).filter((r) => !HIDDEN_JOB_KEYS.has(r.jobKey));

  // jobKey of the row currently in-flight (Run Now / toggle) — used
  // to disable buttons + show the spinner. Two separate sets so a
  // toggle and a run can be in-flight on different rows simultaneously
  // without stealing each other's spinner.
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ApiSyncSettings | null>(null);
  // Row the admin has just clicked "Run from start" on — waiting for
  // confirmation before we clear the incremental watermark and fire a
  // full re-fetch. Null when the confirmation dialog is closed.
  const [restartTarget, setRestartTarget] = useState<ApiSyncSettings | null>(null);
  // Group-level equivalent: bulk restart-from-start for every job in
  // the group. Held as {label, rows} so the confirm dialog can name
  // the group and the confirm handler has the row list to run through.
  const [groupRestartTarget, setGroupRestartTarget] = useState<{
    label: string;
    rows: ApiSyncSettings[];
  } | null>(null);
  // "Delete unsynced data" toggle shared by both restart dialogs. When
  // on, the run-from-start prunes rows whose Kobo `_id` is gone from the
  // live dataset (CSV-imported / hand-created farmers are never touched).
  // Resets to false whenever a restart dialog closes.
  const [deleteUnsync, setDeleteUnsync] = useState(false);
  // Which group rows are expanded (child job rows visible under the
  // parent row). Groups collapse by default so the list starts
  // scannable rather than dumping every job on load.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };
  // Group being edited via the bulk dialog — applies auto-sync +
  // interval changes to every job in the group at once.
  const [editingGroup, setEditingGroup] = useState<{
    label: string;
    rows: ApiSyncSettings[];
  } | null>(null);

  // "Reset demo data" — confirmation open + request in flight.
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const refresh = () => mutate(SYNC_SETTINGS_LIST_KEY);

  // Global-busy flag: any run in-flight OR any auto-sync toggle
  // mutating server-side. When true, every actionable control on the
  // page is disabled so the admin can't stack concurrent hits (bulk
  // "Run all" fires jobs sequentially; letting per-row clicks slip in
  // between would break that sequencing + hammer Kobo).
  const globalBusy = running.size > 0 || toggling.size > 0;

  const onToggleAutoSync = async (row: ApiSyncSettings, next: boolean) => {
    setToggling((s) => new Set(s).add(row.jobKey));
    try {
      await updateSyncSettings(row.jobKey, { autoSyncEnabled: next });
      await refresh();
      successToast({
        id: next ? 'admin.dataSync.toast.autoSyncEnabled' : 'admin.dataSync.toast.autoSyncDisabled',
        values: { label: row.label },
      });
    } catch (err) {
      errorToast(err);
    } finally {
      setToggling((s) => {
        const out = new Set(s);
        out.delete(row.jobKey);
        return out;
      });
    }
  };

  const onRunNow = async (row: ApiSyncSettings, fromStart = false, deleteUnsync = false) => {
    setRunning((s) => new Set(s).add(row.jobKey));
    try {
      const res = await runSyncJob(row.jobKey, { fromStart, deleteUnsync });
      await refresh();
      // Invalidate any cache that may now be stale because of the
      // sync. Inspection list/detail in particular: when an inspector
      // submits a new field-visit, the admin viewing /inspections in
      // another tab should see the row appear without manual refresh.
      // Audit-logs invalidated so the bell + /notifications surface
      // the new `sync_completed` row immediately even on browsers
      // where the SSE channel is suppressed (e.g. private mode).
      mutate(
        (key) =>
          Array.isArray(key) &&
          typeof key[0] === 'string' &&
          (key[0] === '/api/inspections' || key[0] === '/api/audit-logs'),
        undefined,
        { revalidate: true },
      );
      // Show what *actually* changed at the projected layer (the
      // inspections table the admin cares about), not just the raw
      // ingest count. `upsertedRaw` is 0 on no-op re-runs even when
      // there's data in the table — reading `upsertedInspection`
      // tells the truth.
      const ins = res.summary.upsertedInspection;
      const insertedCount = (ins?.inserted ?? 0) + (ins?.updated ?? 0);
      successToast({
        id: res.summary.unchanged
          ? 'admin.dataSync.toast.runUnchanged'
          : 'admin.dataSync.toast.runOk',
        values: {
          label: row.label,
          fetched: res.summary.fetched,
          upserted: insertedCount || res.summary.upsertedRaw,
        },
      });
    } catch (err) {
      errorToast(err);
    } finally {
      setRunning((s) => {
        const out = new Set(s);
        out.delete(row.jobKey);
        return out;
      });
    }
  };

  const onReset = async () => {
    setResetting(true);
    try {
      const res = await resetDemoData();
      // The reset rewrites every operational table, so no cached list,
      // detail or stats payload survives it — drop the whole SWR cache
      // rather than trying to enumerate keys.
      await mutate(() => true, undefined, { revalidate: true });
      successToast({
        id: 'admin.dataSync.toast.resetOk',
        values: {
          farmers: res.counts.farmers,
          parcels: res.counts.parcels,
          seconds: (res.durationMs / 1000).toFixed(1),
        },
      });
      setResetOpen(false);
    } catch (err) {
      errorToast(err);
    } finally {
      setResetting(false);
    }
  };

  const onToggleGroup = async (rows: ApiSyncSettings[], next: boolean) => {
    // Fire the mutations in parallel — each row's optimistic Switch
    // enters its own `toggling` slot so the icons animate together.
    await Promise.allSettled(rows.map((r) => onToggleAutoSync(r, next)));
  };

  const onRunGroup = async (rows: ApiSyncSettings[], fromStart = false, deleteUnsync = false) => {
    // Sequential — running every Kobo pull in parallel would hammer
    // both the Kobo API and our own DB inserts. One at a time is the
    // conservative default; admin can still trigger single rows in
    // parallel from the per-row Run buttons if they want to.
    for (const r of rows) {
      // eslint-disable-next-line no-await-in-loop
      await onRunNow(r, fromStart, deleteUnsync);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">{t('admin.dataSync.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('admin.dataSync.subtitle')}</p>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-20 w-[320px] bg-card">
                {t('admin.dataSync.col.form')}
              </TableHead>
              <TableHead className="w-[160px]">{t('admin.dataSync.col.lastRun')}</TableHead>
              <TableHead className="w-[160px]">{t('admin.dataSync.col.runAt')}</TableHead>
              <TableHead className="w-[110px]">{t('admin.dataSync.col.autoSync')}</TableHead>
              <TableHead className="w-[170px] text-right">
                {t('admin.dataSync.col.actions')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  {t('common.loading')}
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  {t('admin.dataSync.empty')}
                </TableCell>
              </TableRow>
            ) : (
              // Nested table: each module is a parent row that expands
              // to reveal its child job rows. Parent row carries the
              // group-level controls (Run all / Run all from start /
              // Edit group + bulk Auto sync); child rows carry the
              // per-job controls (Run / Run from start / Edit + per-job
              // Auto sync).
              groupSyncRows(items).flatMap(({ label: gLabel, rows }) => {
                const isExpanded = expandedGroups.has(gLabel);
                const allOn = rows.every((r) => r.autoSyncEnabled);
                const anyRunningInGroup = rows.some((r) => running.has(r.jobKey));
                // Group Last run = the row that ran most recently
                // (whether via Run all, per-job Run, or the scheduler).
                // Group Next run = the fastest cadence among enabled
                // rows so the badge reflects the earliest upcoming slot.
                const mostRecent = rows.reduce<ApiSyncSettings | null>((acc, r) => {
                  if (!r.lastRunAt) return acc;
                  if (!acc?.lastRunAt) return r;
                  return r.lastRunAt > acc.lastRunAt ? r : acc;
                }, null);
                const autoRows = rows.filter((r) => r.autoSyncEnabled);
                const groupIntervalMinutes = autoRows.length
                  ? Math.min(...autoRows.map((r) => r.intervalMinutes))
                  : 0;
                const parent = (
                  <TableRow
                    key={`group:${gLabel}`}
                    className="cursor-pointer bg-muted text-sm font-medium hover:bg-muted/80"
                    onClick={() => toggleGroup(gLabel)}
                  >
                    <TableCell className="sticky left-0 z-20 w-[320px] border-b border-border bg-muted">
                      <div className="flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="font-semibold text-foreground">{gLabel}</span>
                        <span className="rounded-full bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                          {rows.length}
                        </span>
                        {/* Collapsed groups hide their child rows, so list
                            the module abbreviations here for a quick scan;
                            hidden once expanded (full names then show). */}
                        {!isExpanded && (
                          <span
                            className="min-w-0 truncate text-[11px] font-normal text-muted-foreground"
                            title={rows.map(moduleAbbr).join(', ')}
                          >
                            {rows.map(moduleAbbr).join(' · ')}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <LastRunBadge
                        at={mostRecent?.lastRunAt ?? null}
                        status={mostRecent?.lastRunStatus ?? null}
                        neverLabel={t('admin.dataSync.lastRun.never')}
                      />
                    </TableCell>
                    <TableCell>
                      <NextRunBadge
                        lastRunAt={null}
                        intervalMinutes={groupIntervalMinutes || 24 * 60}
                        autoSyncEnabled={autoRows.length > 0}
                        offLabel={t('admin.dataSync.runAt.off')}
                        pendingLabel={t('admin.dataSync.runAt.pending')}
                      />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={allOn}
                        disabled={globalBusy}
                        onCheckedChange={(v) => onToggleGroup(rows, v)}
                        aria-label={`Toggle auto sync for group ${gLabel}`}
                      />
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          aria-label={t('admin.dataSync.group.runAll')}
                          title={t('admin.dataSync.group.runAll')}
                          disabled={globalBusy}
                          onClick={() => onRunGroup(rows)}
                          className="inline-flex size-8 items-center justify-center rounded-md border border-green-300 bg-green-50 text-green-700 shadow-xs transition-colors hover:bg-green-100 disabled:pointer-events-none disabled:opacity-50"
                        >
                          {anyRunningInGroup ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Play className="size-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          aria-label={t('admin.dataSync.group.runAllFromStart')}
                          title={t('admin.dataSync.group.runAllFromStart')}
                          disabled={globalBusy}
                          onClick={() => setGroupRestartTarget({ label: gLabel, rows })}
                          className="inline-flex size-8 items-center justify-center rounded-md border border-red-300 bg-red-50 text-red-700 shadow-xs transition-colors hover:bg-red-100 disabled:pointer-events-none disabled:opacity-50"
                        >
                          <FastForward className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={t('admin.dataSync.group.edit')}
                          title={t('admin.dataSync.group.edit')}
                          disabled={globalBusy}
                          onClick={() => setEditingGroup({ label: gLabel, rows })}
                          className="inline-flex size-8 items-center justify-center rounded-md border border-input bg-background text-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );

                if (!isExpanded) return [parent];

                const childRows = rows.map((row) => (
                  <TableRow key={row.jobKey} className="text-sm">
                    <TableCell className="sticky left-0 z-20 w-[320px] border-b border-border bg-card">
                      {/* `TableCell` is `whitespace-nowrap` by default, which
                          made the description run under the next column on a
                          narrow viewport (the cell is sticky, so it painted
                          over "Last run"). Wrap inside the fixed 320px column
                          instead. */}
                      <div className="flex flex-col gap-0.5 pl-6">
                        <span className="font-medium text-foreground">{row.label}</span>
                        {row.description && (
                          <span className="whitespace-normal text-[12px] leading-snug text-muted-foreground">
                            {row.description}
                          </span>
                        )}
                        <span className="font-mono text-[11px] text-muted-foreground/70">
                          <SourceUrlCell url={row.sourceUrl} />
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <LastRunBadge
                        at={row.lastRunAt}
                        status={row.lastRunStatus}
                        neverLabel={t('admin.dataSync.lastRun.never')}
                      />
                    </TableCell>
                    <TableCell>
                      <NextRunBadge
                        lastRunAt={row.lastRunAt}
                        intervalMinutes={row.intervalMinutes}
                        autoSyncEnabled={row.autoSyncEnabled}
                        offLabel={t('admin.dataSync.runAt.off')}
                        pendingLabel={t('admin.dataSync.runAt.pending')}
                      />
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={row.autoSyncEnabled}
                        disabled={globalBusy}
                        onCheckedChange={(v) => onToggleAutoSync(row, v)}
                        aria-label={`Toggle auto sync for ${row.label}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          aria-label={t('admin.dataSync.action.run')}
                          title={t('admin.dataSync.action.run')}
                          disabled={globalBusy}
                          onClick={() => onRunNow(row)}
                          className="inline-flex size-8 items-center justify-center rounded-md border border-green-300 bg-green-50 text-green-700 shadow-xs transition-colors hover:bg-green-100 disabled:pointer-events-none disabled:opacity-50"
                        >
                          {running.has(row.jobKey) ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Play className="size-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          aria-label={t('admin.dataSync.action.runFromStart')}
                          title={t('admin.dataSync.action.runFromStart')}
                          disabled={globalBusy}
                          onClick={() => setRestartTarget(row)}
                          className="inline-flex size-8 items-center justify-center rounded-md border border-red-300 bg-red-50 text-red-700 shadow-xs transition-colors hover:bg-red-100 disabled:pointer-events-none disabled:opacity-50"
                        >
                          <FastForward className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={t('admin.dataSync.action.edit')}
                          title={t('admin.dataSync.action.edit')}
                          disabled={globalBusy}
                          onClick={() => setEditing(row)}
                          className="inline-flex size-8 items-center justify-center rounded-md border border-input bg-background text-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ));
                return [parent, ...childRows];
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Danger zone — sits BELOW the table so a destructive action can't
          be hit while reaching for the header, and has room to explain
          itself instead of relying on the confirm dialog to do it.
          Vanishes entirely without `sync:reset`. */}
      <PermissionGate codes={['sync:reset']}>
        <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50/50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-red-900/60 dark:bg-red-950/20">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="flex items-center gap-2 font-semibold text-foreground text-sm">
              <TriangleAlert className="size-4 shrink-0 text-red-600 dark:text-red-400" />
              {t('admin.dataSync.reset.card.title')}
            </h2>
            <p className="text-muted-foreground text-xs leading-relaxed">
              {t('admin.dataSync.reset.card.description')}
            </p>
          </div>
          <Button
            // `self-start` so the stacked (narrow) layout doesn't stretch
            // a destructive button across the full card width; `sm:self-auto`
            // hands alignment back to the row layout's `items-center`.
            className="shrink-0 self-start border border-red-300 bg-red-50 text-red-700 hover:border-red-400 hover:bg-red-100 sm:self-auto"
            disabled={globalBusy || resetting}
            onClick={() => setResetOpen(true)}
          >
            {resetting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            {resetting ? t('admin.dataSync.reset.running') : t('admin.dataSync.reset.button')}
          </Button>
        </div>
      </PermissionGate>

      <SyncSettingsDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        row={editing}
        onSaved={refresh}
      />

      <GroupSyncSettingsDialog
        open={editingGroup !== null}
        onOpenChange={(open) => {
          if (!open) setEditingGroup(null);
        }}
        group={editingGroup}
        onSaved={refresh}
      />

      <Dialog
        open={resetOpen}
        onOpenChange={(open) => {
          // Can't dismiss mid-reset — the request keeps running and the
          // page would look idle while every table is being rebuilt.
          if (!open && !resetting) setResetOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader className="border-b-0">
            <h3 className="flex items-center gap-2 font-semibold text-lg">
              <TriangleAlert className="size-4 text-red-600" />
              {t('admin.dataSync.reset.dialog.title')}
            </h3>
            <p className="text-muted-foreground text-sm">
              {t('admin.dataSync.reset.dialog.description')}
            </p>
          </DialogHeader>
          <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">{t('admin.dataSync.reset.dialog.keeps')}</span>
            <span className="font-medium text-red-700 dark:text-red-400">
              {t('admin.dataSync.reset.dialog.irreversible')}
            </span>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)} disabled={resetting}>
              {t('admin.dataSync.reset.dialog.cancel')}
            </Button>
            <Button
              className="border border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
              onClick={onReset}
              disabled={resetting}
            >
              {resetting && <Loader2 className="size-4 animate-spin" />}
              {resetting
                ? t('admin.dataSync.reset.running')
                : t('admin.dataSync.reset.dialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={groupRestartTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setGroupRestartTarget(null);
            setDeleteUnsync(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader className="border-b-0">
            <h3 className="font-semibold text-lg">
              {t('admin.dataSync.groupRestartDialog.title')}
            </h3>
            <p className="text-muted-foreground text-sm">
              {intl.formatMessage(
                { id: 'admin.dataSync.groupRestartDialog.description' },
                {
                  label: groupRestartTarget?.label ?? '',
                  n: groupRestartTarget?.rows.length ?? 0,
                },
              )}
            </p>
          </DialogHeader>
          <DeleteUnsyncToggle checked={deleteUnsync} onCheckedChange={setDeleteUnsync} t={t} />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setGroupRestartTarget(null);
                setDeleteUnsync(false);
              }}
              disabled={globalBusy}
            >
              {t('admin.dataSync.restartDialog.cancel')}
            </Button>
            <Button
              className="border border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
              onClick={async () => {
                if (!groupRestartTarget) return;
                const target = groupRestartTarget;
                const prune = deleteUnsync;
                setGroupRestartTarget(null);
                setDeleteUnsync(false);
                await onRunGroup(target.rows, true, prune);
              }}
              disabled={globalBusy}
            >
              {t('admin.dataSync.restartDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={restartTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRestartTarget(null);
            setDeleteUnsync(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader className="border-b-0">
            <h3 className="font-semibold text-lg">{t('admin.dataSync.restartDialog.title')}</h3>
            <p className="text-muted-foreground text-sm">
              {intl.formatMessage(
                { id: 'admin.dataSync.restartDialog.description' },
                { label: restartTarget?.label ?? '' },
              )}
            </p>
          </DialogHeader>
          <DeleteUnsyncToggle checked={deleteUnsync} onCheckedChange={setDeleteUnsync} t={t} />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRestartTarget(null);
                setDeleteUnsync(false);
              }}
              disabled={restartTarget ? running.has(restartTarget.jobKey) : false}
            >
              {t('admin.dataSync.restartDialog.cancel')}
            </Button>
            <Button
              className="border border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
              onClick={async () => {
                if (!restartTarget) return;
                const target = restartTarget;
                const prune = deleteUnsync;
                setRestartTarget(null);
                setDeleteUnsync(false);
                await onRunNow(target, true, prune);
              }}
              disabled={restartTarget ? running.has(restartTarget.jobKey) : false}
            >
              {t('admin.dataSync.restartDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Shared "Delete unsynced data" toggle for the restart dialogs. Off by
 * default — when on, the run-from-start prunes rows whose Kobo `_id` is
 * gone from the live dataset (CSV-imported / hand-created rows are kept).
 */
function DeleteUnsyncToggle({
  checked,
  onCheckedChange,
  t,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  t: (id: string) => string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium text-foreground text-sm">
          {t('admin.dataSync.deleteUnsync.label')}
        </span>
        <span className="text-muted-foreground text-xs">
          {t('admin.dataSync.deleteUnsync.hint')}
        </span>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={t('admin.dataSync.deleteUnsync.label')}
      />
    </div>
  );
}

/**
 * Bucket sync-settings rows into 4 domain groups by jobKey prefix.
 * Kept as a pure function so the page-content component only has to
 * render — no branching on jobKey in JSX. Order of the returned array
 * IS the visual order on screen (CLMRS first because it's the highest-
 * risk compliance surface; Compliance-inspection last because it's the
 * heaviest job and admins usually run it separately).
 */
function groupSyncRows(rows: ApiSyncSettings[]): Array<{
  key: string;
  label: string;
  rows: ApiSyncSettings[];
}> {
  const clmrs: ApiSyncSettings[] = [];
  const trace: ApiSyncSettings[] = [];
  const operation: ApiSyncSettings[] = [];
  const compliance: ApiSyncSettings[] = [];
  const other: ApiSyncSettings[] = [];

  for (const r of rows) {
    const k = r.jobKey;
    if (k.startsWith('clmrs_')) clmrs.push(r);
    else if (
      k.startsWith('primary_evacuation') ||
      k.startsWith('secondary_evacuation') ||
      k === 'cocoa_purchases_society'
    )
      trace.push(r);
    else if (
      k === 'farmer_registration' ||
      k === 'farmer_coaching' ||
      k === 'farmer_training_attendance' ||
      k === 'vsla_form' ||
      k === 'yield_estimation'
    )
      operation.push(r);
    else if (k === 'shade_trees' || k === 'internal_inspection' || k.startsWith('kobo_inspection'))
      compliance.push(r);
    else other.push(r);
  }

  // Order = visual order on screen. Compliance (RA inspection + shade)
  // and traceability move to the top because they drive certification
  // deadlines; CLMRS is heavy per-child data that admins usually
  // configure once and forget, so it sits at the bottom.
  const out: Array<{ key: string; label: string; rows: ApiSyncSettings[] }> = [];
  if (trace.length) out.push({ key: 'traceability', label: 'Traceability', rows: trace });
  if (operation.length) out.push({ key: 'operation', label: 'Operation', rows: operation });
  if (compliance.length) out.push({ key: 'compliance', label: 'Compliance', rows: compliance });
  if (clmrs.length) out.push({ key: 'clmrs', label: 'CLMRS', rows: clmrs });
  if (other.length) out.push({ key: 'other', label: 'Other', rows: other });
  return out;
}

/**
 * Short module label shown on a collapsed group row (the child rows are
 * hidden, so this gives a quick scan of what the group contains). Keyed
 * off jobKey — falls back to the full `label` for anything unmapped
 * (e.g. CLMRS modules, which already have short labels). Expanding the
 * group reveals the full `row.label` per child, so this stays terse.
 */
function moduleAbbr(row: ApiSyncSettings): string {
  const k = row.jobKey;
  if (k.startsWith('primary_evacuation')) return '1st evac';
  if (k.startsWith('secondary_evacuation')) return '2nd evac';
  if (k === 'cocoa_purchases_society') return 'Purchases';
  if (k === 'farmer_registration') return 'Registration';
  if (k === 'farmer_coaching') return 'Coaching';
  if (k === 'farmer_training_attendance') return 'Training';
  if (k === 'vsla_form') return 'VSLA';
  if (k === 'yield_estimation') return 'Yield';
  if (k === 'shade_trees') return 'Shade';
  if (k === 'internal_inspection') return 'Internal insp.';
  if (k.startsWith('kobo_inspection')) return 'RA inspection';
  // CLMRS modules already sit under a "CLMRS" group header — drop the
  // redundant "CLMRS " prefix so it reads "B – Household · C – …".
  if (k.startsWith('clmrs_')) return row.label.replace(/^CLMRS\s+/i, '');
  return row.label;
}

/** Abbreviate a Kobo URL for display: `.../v2/assets/<assetId>/...`.
 *  Drops the host + query, keeps the API-version path segment so the
 *  admin can distinguish `/api/v1` from `/api/v2` endpoints at a
 *  glance. Full URL still goes on `title` + the copy-button payload. */
function shortenKoboUrl(url: string): string {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/(v\d+)\/assets\/([^/]+)/);
    return m ? `.../${m[1]}/assets/${m[2]}/...` : url;
  } catch {
    return url;
  }
}

/** Source URL cell — renders the abbreviated form + a copy button that
 *  stamps the full URL onto the clipboard, with a 1.5s ✓ flash to
 *  confirm. */
function SourceUrlCell({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail under non-secure contexts; ignore.
    }
  };
  return (
    <div className="flex items-center gap-1.5">
      <span title={url}>{shortenKoboUrl(url)}</span>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy full URL"
        title="Copy full URL"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

function LastRunBadge({
  at,
  status,
  neverLabel,
}: {
  at: string | null;
  status: SyncRunStatus | null;
  neverLabel: string;
}) {
  if (!at || !status) {
    return <span className="text-xs text-muted-foreground">{neverLabel}</span>;
  }
  const date = new Date(at);
  const label = date.toLocaleString();
  if (status === 'success') {
    return (
      <span title={label} className="inline-flex">
        <StatusTag tone="success">
          <CheckCircle2 className="size-3" />
          {formatHHmm(date)}
        </StatusTag>
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span title={label} className="inline-flex">
        <StatusTag tone="danger">
          <XCircle className="size-3" />
          {formatHHmm(date)}
        </StatusTag>
      </span>
    );
  }
  return (
    <span title={label} className="inline-flex">
      <StatusTag tone="caution">
        <Loader2 className="size-3 animate-spin" />
        running
      </StatusTag>
    </span>
  );
}

/**
 * Fixed schedule anchor — every sync job's cycle starts at 03:00
 * Accra time (Ghana is on GMT / UTC+0 year-round). Anchoring the
 * schedule this way makes the "runs at" preview deterministic
 * regardless of when a job last completed.
 */
export const START_HOUR_GHANA = 3;
export const START_HOUR_TZ_LABEL = 'Ghana time';

/**
 * Compute the times-of-day at which the job will run over a 24h cycle,
 * given an interval in hours and a start hour (0-23). Interval must
 * divide 24 for slots to be periodic within a day; if it doesn't,
 * `24/interval` is rounded down and slots are computed as start + i*h.
 * All slot hours are wrapped mod 24 so intervals ≥ 24 collapse to one.
 */
export function computeRunSlots(startHour: number, intervalHours: number): number[] {
  const interval = Math.max(1, Math.min(24, Math.floor(intervalHours)));
  const start = ((Math.floor(startHour) % 24) + 24) % 24;
  const n = Math.max(1, Math.floor(24 / interval));
  const slots: number[] = [];
  for (let i = 0; i < n; i++) {
    slots.push((start + i * interval) % 24);
  }
  return slots.sort((a, b) => a - b);
}

/** Format hour (0-23) as `"03:00" / "15:00"` — 24h clock so the
 *  reader doesn't have to translate am/pm to a schedule slot. */
export function formatRunHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

/** Next-run badge — projects daily run slots as small time-of-day tags.
 *  Start hour is derived from `lastRunAt` (the current schedule anchor)
 *  or defaults to 0 when the job has never run. */
function NextRunBadge({
  lastRunAt,
  intervalMinutes,
  autoSyncEnabled,
  offLabel,
  pendingLabel,
}: {
  lastRunAt: string | null;
  intervalMinutes: number;
  autoSyncEnabled: boolean;
  offLabel: string;
  pendingLabel: string;
}) {
  if (!autoSyncEnabled) {
    return <span className="text-muted-foreground text-xs">{offLabel}</span>;
  }
  const intervalHours = Math.max(1, Math.round(intervalMinutes / 60));
  const slots = computeRunSlots(START_HOUR_GHANA, intervalHours);
  if (slots.length === 0) {
    return <StatusTag tone="caution">{pendingLabel}</StatusTag>;
  }
  // Ghana is GMT/UTC+0 year-round, so `getUTCHours()` = local hour
  // in Accra. Pick the earliest slot that hasn't fired today; if all
  // slots are behind us, tomorrow's first slot is the answer.
  const nowHour = new Date().getUTCHours();
  const nextSlot = slots.find((h) => h > nowHour) ?? slots[0]!;
  // `lastRunAt` intentionally unused — schedule anchor is fixed.
  void lastRunAt;
  return (
    <span title={START_HOUR_TZ_LABEL} className="inline-flex">
      <StatusTag tone="info">{formatRunHour(nextSlot)}</StatusTag>
    </span>
  );
}

/** Format a timestamp as `HH:MM` in 24h Ghana time (UTC+0). If the
 *  run happened before today, prefix the date so admins can still
 *  distinguish yesterday's 22:00 from today's 22:00. Hover shows the
 *  full locale timestamp. */
function formatHHmm(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const now = new Date();
  const sameDay =
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate();
  if (sameDay) return `${hh}:${mm}`;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mon = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mon} ${hh}:${mm}`;
}
