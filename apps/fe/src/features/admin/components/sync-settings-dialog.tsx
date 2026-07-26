/**
 * Dialog to edit a single `integration.sync_settings` row.
 *
 * Fields exposed: sourceUrl, intervalMinutes, autoSyncEnabled,
 * fieldMapping (JSON textarea). `label` and `jobKey` are immutable
 * — `jobKey` is the PK + URL slug, `label` is set at migration time
 * and edits would desync with shared/intl labels.
 *
 * Validation:
 *   - sourceUrl: zod url() via the shared `updateSyncSettingsBody`.
 *   - interval: shown in HOURS in the UI (default 24h, 1..24 range)
 *     but persisted to BE in `intervalMinutes` (×60). Rounded up to
 *     the nearest hour on display so a manually-edited row still
 *     renders cleanly.
 *   - fieldMapping: free-form JSON; we parse on submit and surface
 *     a parse error in the form rather than failing silently.
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
import { Input } from '@/components/ui/input';
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

/** Fixed interval choices — 24h clock evenly divides at 3/6/12/24h.
 *  Anything narrower than 3h burns Kobo API quota without benefit;
 *  anything wider than 24h is functionally "run once a day". */
const INTERVAL_CHOICES = [3, 6, 12, 24] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: ApiSyncSettings | null;
  onSaved: () => void | Promise<void>;
}

export function SyncSettingsDialog({ open, onOpenChange, row, onSaved }: Props) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const errorToast = useApiErrorToast();
  const successToast = useApiSuccessToast();

  const [sourceUrl, setSourceUrl] = useState('');
  // Stored in hours for the UI; converted to minutes (×60) on save.
  // Constrained to INTERVAL_CHOICES (6/8/12/24h) via tab picker below.
  const [intervalHours, setIntervalHours] = useState<number>(24);
  const [autoSync, setAutoSync] = useState(false);
  const [mappingText, setMappingText] = useState('{}');
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset form when a different row opens.
  useEffect(() => {
    if (!row) return;
    setSourceUrl(row.sourceUrl);
    // Snap the stored value to the nearest allowed choice so legacy
    // rows (e.g. 90min or 4h) still land on a valid tab. Rounded up so
    // the picker never lands below the 3h floor.
    const hours = Math.max(3, Math.ceil(row.intervalMinutes / 60));
    const snapped =
      INTERVAL_CHOICES.find((c) => hours <= c) ?? INTERVAL_CHOICES[INTERVAL_CHOICES.length - 1];
    setIntervalHours(snapped);
    setAutoSync(row.autoSyncEnabled);
    setMappingText(JSON.stringify(row.fieldMapping ?? {}, null, 2));
    setMappingError(null);
  }, [row]);

  // Schedule anchored to a fixed hour (03:00 Accra) — see
  // START_HOUR_GHANA. Editing intervalHours updates the preview.
  const previewSlots = computeRunSlots(START_HOUR_GHANA, intervalHours);

  const onSave = async () => {
    if (!row) return;
    // Parse mapping JSON locally so the user sees the error before
    // the BE rejects the request (BE also validates via zod).
    let mapping: Record<string, unknown>;
    try {
      const parsed = JSON.parse(mappingText) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Mapping must be a JSON object.');
      }
      mapping = parsed as Record<string, unknown>;
    } catch (err) {
      setMappingError(err instanceof Error ? err.message : String(err));
      return;
    }
    setMappingError(null);
    setSaving(true);
    try {
      await updateSyncSettings(row.jobKey, {
        sourceUrl,
        intervalMinutes: intervalHours * 60,
        autoSyncEnabled: autoSync,
        fieldMapping: mapping,
      });
      await onSaved();
      successToast({
        id: 'admin.dataSync.toast.saveOk',
        values: { label: row.label },
      });
      onOpenChange(false);
    } catch (err) {
      errorToast(err);
    } finally {
      setSaving(false);
    }
  };

  if (!row) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{row.label}</DialogTitle>
          <DialogDescription>
            <span className="font-mono text-[11px]">{row.jobKey}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Source URL */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sourceUrl">{t('admin.dataSync.field.sourceUrl')}</Label>
            <Input
              id="sourceUrl"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              className="font-mono text-xs"
              placeholder="https://kf.kobotoolbox.org/assets/.../submissions/?format=json"
            />
          </div>

          {/* Auto sync toggle */}
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
            <Label htmlFor="autoSync" className="cursor-pointer">
              {t('admin.dataSync.field.autoSync')}
            </Label>
            <Switch id="autoSync" checked={autoSync} onCheckedChange={setAutoSync} />
          </div>

          {/* Interval picker — tabs (6/8/12/24h). The 24h choice is a
              once-a-day schedule; anything below 6h burns Kobo quota
              without changing which submissions land. */}
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

          {/* Field mapping JSON */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="fieldMapping">{t('admin.dataSync.field.fieldMapping')}</Label>
              <span className="text-[11px] text-muted-foreground">
                {t('admin.dataSync.field.fieldMappingHint')}
              </span>
            </div>
            <textarea
              id="fieldMapping"
              value={mappingText}
              onChange={(e) => setMappingText(e.target.value)}
              spellCheck={false}
              className="h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            {mappingError ? <p className="text-xs text-destructive">{mappingError}</p> : null}
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
