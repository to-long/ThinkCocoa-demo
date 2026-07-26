/**
 * Bulk-edit dialog — applies `autoSyncEnabled` + `intervalMinutes` to
 * every row in a Module group at once (CLMRS / Traceability /
 * Operation / Compliance). Only the two group-level fields are
 * exposed; per-job settings (sourceUrl, fieldMapping) stay behind the
 * single-row dialog.
 *
 * Save fires N parallel `updateSyncSettings` calls; success toast
 * summarises the group name + row count so the admin knows the
 * change stuck.
 */

import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { StatusTag } from '@/components/ui/status-tag';
import { Switch } from '@/components/ui/switch';
import {
  type ApiSyncSettings,
  updateSyncSettings,
  useApiErrorToast,
  useApiSuccessToast,
} from '@/shared/api';
import {
  computeRunSlots,
  formatRunHour,
  START_HOUR_GHANA,
  START_HOUR_TZ_LABEL,
} from '../pages/admin-sync-page';

/** Same allowed set as the single-row dialog — keeps intervals in
 *  lockstep across per-row + group edits. */
const INTERVAL_CHOICES = [3, 6, 12, 24] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: { label: string; rows: ApiSyncSettings[] } | null;
  onSaved: () => void | Promise<void>;
}

export function GroupSyncSettingsDialog({ open, onOpenChange, group, onSaved }: Props) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const errorToast = useApiErrorToast();
  const successToast = useApiSuccessToast();

  const [autoSync, setAutoSync] = useState(false);
  const [intervalHours, setIntervalHours] = useState<number>(24);
  const [saving, setSaving] = useState(false);

  // Seed from the group's current state — auto-sync is checked when
  // every row is on; interval snaps to the most common current value
  // across the rows (falls back to 24h when the group is empty).
  useEffect(() => {
    if (!group || group.rows.length === 0) return;
    setAutoSync(group.rows.every((r) => r.autoSyncEnabled));
    const counts = new Map<number, number>();
    for (const r of group.rows) {
      const hours = Math.max(3, Math.ceil(r.intervalMinutes / 60));
      const snapped =
        INTERVAL_CHOICES.find((c) => hours <= c) ?? INTERVAL_CHOICES[INTERVAL_CHOICES.length - 1];
      counts.set(snapped, (counts.get(snapped) ?? 0) + 1);
    }
    let bestChoice: number = INTERVAL_CHOICES[INTERVAL_CHOICES.length - 1];
    let bestCount = -1;
    for (const [choice, n] of counts) {
      if (n > bestCount) {
        bestChoice = choice;
        bestCount = n;
      }
    }
    setIntervalHours(bestChoice);
  }, [group]);

  // Fixed 03:00 Ghana anchor — same as the single-row dialog + the
  // NextRun column so preview stays consistent across surfaces.
  const previewSlots = computeRunSlots(START_HOUR_GHANA, intervalHours);

  const onSave = async () => {
    if (!group) return;
    setSaving(true);
    try {
      await Promise.all(
        group.rows.map((r) =>
          updateSyncSettings(r.jobKey, {
            autoSyncEnabled: autoSync,
            intervalMinutes: intervalHours * 60,
          }),
        ),
      );
      await onSaved();
      successToast({
        id: 'admin.dataSync.toast.groupSaveOk',
        values: { label: group.label, n: group.rows.length },
      });
      onOpenChange(false);
    } catch (err) {
      errorToast(err);
    } finally {
      setSaving(false);
    }
  };

  if (!group) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{group.label}</DialogTitle>
          <DialogDescription>
            {intl.formatMessage(
              { id: 'admin.dataSync.groupEdit.description' },
              { n: group.rows.length },
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
            <Label htmlFor="autoSyncGroup" className="cursor-pointer">
              {t('admin.dataSync.field.autoSync')}
            </Label>
            <Switch id="autoSyncGroup" checked={autoSync} onCheckedChange={setAutoSync} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t('admin.dataSync.field.intervalHours')}</Label>
            <div
              role="tablist"
              aria-label={t('admin.dataSync.field.intervalHours')}
              className={`inline-flex w-fit rounded-md border border-input bg-background p-0.5 ${autoSync ? '' : 'pointer-events-none opacity-50'}`}
            >
              {INTERVAL_CHOICES.map((h) => (
                <button
                  key={h}
                  type="button"
                  role="tab"
                  aria-selected={intervalHours === h}
                  onClick={() => setIntervalHours(h)}
                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                    intervalHours === h
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {h}h
                </button>
              ))}
            </div>
            {autoSync && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] text-muted-foreground">
                  {t('admin.dataSync.field.intervalPreview')}
                </span>
                {previewSlots.map((h) => (
                  <StatusTag key={h} tone="info">
                    {formatRunHour(h)}
                  </StatusTag>
                ))}
                <span className="text-[10px] text-muted-foreground">({START_HOUR_TZ_LABEL})</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="!flex-row !pt-0 justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
