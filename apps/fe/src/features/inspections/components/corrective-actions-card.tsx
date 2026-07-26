/**
 * "Corrective actions & follow-up" card — the amber panel that lists
 * farm-management items an inspection flagged as not-yet-compliant, each
 * with the follow-up action the farmer must complete and its target date.
 *
 * Shared by the inspection-detail page (one inspection's follow-ups), the
 * coaching-detail page, and the farm/parcel-detail page (aggregated across
 * both sources). Renders nothing when there are no items.
 *
 * Each item carries a mutable `status` (open → processing → done, plus a
 * reopen path) backed by `inspection.corrective_actions`. Staff with
 * `inspection:update` drive the workflow:
 *   • Process — open/reopen → processing (immediate)
 *   • Done    — processing → done; prompts a closing `lastComment`
 *   • Reopen  — done → reopen; prompts a new follow-up `actionDate`
 * An overdue deadline (past `actionDate`, not done) renders red with a
 * "change date" link. All transitions PATCH then patch the local override
 * so the row flips instantly.
 */

import {
  Baby,
  Bug,
  CalendarClock,
  ClipboardList,
  Droplets,
  FileCheck,
  FileX,
  Flame,
  FlaskConical,
  HardHat,
  type LucideIcon,
  MessageSquare,
  Mountain,
  Scissors,
  ShoppingCart,
  Shovel,
  SprayCan,
  Sprout,
  TreePine,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StatusTag } from '@/components/ui/status-tag';
import { PermissionGate } from '@/features/auth';
import { cn } from '@/lib/utils';
import {
  type CorrectiveActionStatus,
  type InspectionFollowUp,
  updateCorrectiveAction,
  useApiErrorToast,
} from '@/shared/api';

/** Agriculture / topic icon for each corrective-action follow-up.
 *  Covers both the inspection topics and the coaching non-compliance
 *  taxonomy (the two sources that feed corrective_actions). */
const FOLLOW_UP_ICON: Record<string, LucideIcon> = {
  // Inspection topics
  spraying_calendar: SprayCan,
  weeding: Shovel,
  pruning: Scissors,
  pest_diseases: Bug,
  soil_erosion: Mountain,
  child_labour: Baby,
  forced_labour: HardHat,
  certification_docs: FileCheck,
  // Coaching non-compliance taxonomy
  banned_chemicals: SprayCan,
  no_ppe: HardHat,
  chem_storage_disposal: FlaskConical,
  no_buffer_zone: Droplets,
  deforestation: TreePine,
  waste_burning: Flame,
  poor_farm_maintenance: Sprout,
  worker_rights: Users,
  missing_records: FileX,
  side_selling: ShoppingCart,
  other: ClipboardList,
};

/** The next status when the transition button is pressed. */
const NEXT_STATUS: Record<CorrectiveActionStatus, CorrectiveActionStatus> = {
  open: 'processing',
  reopen: 'processing',
  processing: 'done',
  done: 'reopen',
};

/** StatusTag tone per status. */
const STATUS_TONE: Record<CorrectiveActionStatus, 'caution' | 'info' | 'success'> = {
  open: 'caution',
  reopen: 'caution',
  processing: 'info',
  done: 'success',
};

/** Button label i18n key for the transition the button performs. */
const ACTION_LABEL: Record<CorrectiveActionStatus, string> = {
  open: 'inspections.followUp.action.process',
  reopen: 'inspections.followUp.action.process',
  processing: 'inspections.followUp.action.done',
  done: 'inspections.followUp.action.reopen',
};

const todayIso = () => new Date().toISOString().slice(0, 10);

type PatchBody = {
  status?: CorrectiveActionStatus;
  actionDate?: string | null;
  lastComment?: string | null;
};

export function CorrectiveActionsCard({
  items,
  className,
}: {
  items: InspectionFollowUp[];
  className?: string;
}) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  // Topic labels come from a fixed vocabulary, but fall back to a
  // humanised slug so an unmapped topic never surfaces the raw i18n key.
  const topicLabel = (topic: string) =>
    intl.formatMessage({
      id: `inspections.followUp.topic.${topic}`,
      defaultMessage: topic.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    });
  const errorToast = useApiErrorToast();

  // Optimistic overrides keyed by corrective-action id — applied on top
  // of the fetched item so the UI flips instantly before revalidation.
  const [overrides, setOverrides] = useState<Record<string, PatchBody>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  // Inline "change date" editor for an overdue deadline.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Inline prompt shown before a Done (comment) / Reopen (date) transition.
  const [prompt, setPrompt] = useState<{ id: string; kind: 'done' | 'reopen' } | null>(null);
  const [draft, setDraft] = useState('');

  if (items.length === 0) return null;

  const patch = async (id: string, body: PatchBody) => {
    setBusyId(id);
    const prev = overrides[id];
    setOverrides((o) => ({ ...o, [id]: { ...o[id], ...body } }));
    try {
      const updated = await updateCorrectiveAction(id, body);
      setOverrides((o) => ({
        ...o,
        [id]: {
          status: updated.status,
          actionDate: updated.actionDate,
          lastComment: updated.lastComment,
        },
      }));
    } catch (err) {
      setOverrides((o) => ({ ...o, [id]: prev ?? {} }));
      errorToast(err);
    } finally {
      setBusyId(null);
    }
  };

  // Transition button: Process is immediate; Done/Reopen open an inline
  // prompt (closing comment / new follow-up date) first.
  const startTransition = (f: InspectionFollowUp) => {
    const next = NEXT_STATUS[f.status];
    if (next === 'done') {
      setDraft('');
      setPrompt({ id: f.id, kind: 'done' });
    } else if (next === 'reopen') {
      setDraft(f.actionDate && f.actionDate >= todayIso() ? f.actionDate : todayIso());
      setPrompt({ id: f.id, kind: 'reopen' });
    } else {
      void patch(f.id, { status: next });
    }
  };

  const submitPrompt = () => {
    if (!prompt) return;
    const { id, kind } = prompt;
    if (kind === 'done') {
      void patch(id, { status: 'done', lastComment: draft.trim() || null });
    } else {
      if (!draft) return;
      void patch(id, { status: 'reopen', actionDate: draft });
    }
    setPrompt(null);
    setDraft('');
  };

  return (
    <Card
      className={cn(
        'gap-2.5 border-amber-200 bg-amber-50/40 py-4 dark:border-amber-900/50 dark:bg-amber-950/20',
        className,
      )}
    >
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-amber-900 text-base dark:text-amber-100">
          <TriangleAlert className="size-4 text-amber-600 dark:text-amber-400" />
          {t('inspections.detail.followUpsTitle')}
          <span className="font-normal text-amber-700 text-sm dark:text-amber-300">
            ({items.length})
          </span>
        </CardTitle>
        <CardDescription>{t('inspections.detail.followUpsDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <ul className="flex flex-col gap-2">
          {items.map((raw) => {
            const f = { ...raw, ...overrides[raw.id] };
            const Icon = FOLLOW_UP_ICON[f.topic] ?? ClipboardList;
            const overdue = f.status !== 'done' && !!f.actionDate && f.actionDate < todayIso();
            const busy = busyId === f.id;
            const promptOpen = prompt?.id === f.id;
            return (
              <li
                key={f.id}
                className="flex flex-col gap-1 rounded-md border border-amber-200 bg-card p-3 dark:border-amber-900/40"
              >
                {/* Row 1 — title + source, then description */}
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-foreground text-sm">
                      <Icon className="size-4 text-muted-foreground" />
                      {topicLabel(f.topic)}
                    </span>
                    {f.source && (
                      <StatusTag tone="neutral">
                        {t(`inspections.followUp.source.${f.source}`)}
                      </StatusTag>
                    )}
                  </div>
                  <p className="text-muted-foreground text-sm">{f.action}</p>
                </div>

                {/* Row 2 — two columns: follow-up date · action status */}
                <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-6">
                  {/* Col A — follow-up date */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      {t('inspections.followUp.dateLabel')}
                    </span>
                    {f.actionDate ? (
                      <span className="inline-flex flex-wrap items-center gap-2 text-xs">
                        <StatusTag tone={overdue ? 'danger' : 'caution'}>
                          <CalendarClock className="size-3" />
                          {f.actionDate}
                        </StatusTag>
                        {overdue && (
                          <PermissionGate codes={['inspection:update']}>
                            {editingId === f.id ? (
                              <Input
                                type="date"
                                defaultValue={f.actionDate ?? undefined}
                                disabled={busy}
                                autoFocus
                                className="h-6 w-[9.5rem] py-0 text-xs"
                                onBlur={() => setEditingId(null)}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v && v !== f.actionDate) {
                                    setEditingId(null);
                                    void patch(f.id, { actionDate: v });
                                  }
                                }}
                              />
                            ) : (
                              <button
                                type="button"
                                className="inline-flex h-6 items-center text-red-700 text-xs underline underline-offset-2 hover:text-red-900"
                                onClick={() => setEditingId(f.id)}
                              >
                                {t('inspections.followUp.overdueChange')}
                              </button>
                            )}
                          </PermissionGate>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </div>

                  {/* Col B — action status + transition + resolution note */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      {t('inspections.followUp.statusColLabel')}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusTag tone={STATUS_TONE[f.status]}>
                        {t(`inspections.followUp.status.${f.status}`)}
                      </StatusTag>
                      {!promptOpen && (
                        <PermissionGate codes={['inspection:update']}>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            className="h-7"
                            onClick={() => startTransition(f)}
                          >
                            {t(ACTION_LABEL[f.status])}
                          </Button>
                        </PermissionGate>
                      )}
                    </div>
                    {/* Closing note shown once the action is resolved. */}
                    {f.status === 'done' && f.lastComment && (
                      <p className="inline-flex items-start gap-1.5 text-emerald-700 text-xs">
                        <MessageSquare className="mt-0.5 size-3 shrink-0" />
                        <span>
                          <span className="font-medium">
                            {t('inspections.followUp.lastComment')}:
                          </span>{' '}
                          {f.lastComment}
                        </span>
                      </p>
                    )}
                  </div>
                </div>

                {/* Inline prompt: closing comment (Done) or new date (Reopen). */}
                {promptOpen && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 rounded-md bg-muted/60 p-2">
                    {prompt?.kind === 'done' ? (
                      <Input
                        type="text"
                        value={draft}
                        autoFocus
                        disabled={busy}
                        placeholder={t('inspections.followUp.commentPlaceholder')}
                        className="h-7 min-w-0 flex-1 text-xs"
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') submitPrompt();
                          if (e.key === 'Escape') setPrompt(null);
                        }}
                      />
                    ) : (
                      <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
                        {t('inspections.followUp.newDate')}
                        <Input
                          type="date"
                          value={draft}
                          autoFocus
                          disabled={busy}
                          className="h-7 w-[9.5rem] text-xs"
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') submitPrompt();
                            if (e.key === 'Escape') setPrompt(null);
                          }}
                        />
                      </span>
                    )}
                    <div className="ml-auto flex items-center gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        disabled={busy}
                        onClick={() => {
                          setPrompt(null);
                          setDraft('');
                        }}
                      >
                        {t('inspections.followUp.cancel')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7"
                        disabled={busy || (prompt?.kind === 'reopen' && !draft)}
                        onClick={submitPrompt}
                      >
                        {t(ACTION_LABEL[f.status])}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
