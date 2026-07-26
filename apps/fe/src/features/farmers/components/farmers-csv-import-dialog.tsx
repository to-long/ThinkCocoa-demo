/**
 * Bulk-import farmers + parcels from a CSV file.
 *
 * The upload maps 1:1 to the `Farmer Dataset 2025-2026` export shape
 * — same columns, same coop label conventions. BE (`csv-import.ts`)
 * upserts on ProducerID / Field ID, so re-uploading an edited file
 * over an existing dataset just refreshes the touched rows.
 *
 * The dialog has three visible states:
 *   1. Pre-upload: file picker + Import button.
 *   2. In-flight:  disabled button, "Importing…" copy.
 *   3. Result:     summary counts + collapsed list of skipped rows.
 *
 * Skipped rows are worth surfacing because they're the difference
 * between "6700 rows uploaded" and "6521 farmers created" — without
 * showing them the admin has no idea a coop label typo silently
 * dropped rows.
 */

import { AlertCircle, FileUp, Loader2, Upload } from 'lucide-react';
import { useState } from 'react';
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
import { StatusTag } from '@/components/ui/status-tag';
import { type CsvImportResponse, importFarmersCsv } from '@/shared/api/farmers';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FarmersCsvImportDialog({ open, onOpenChange }: Props) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `farmers.csvImport.${id}` }, values);

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CsvImportResponse | null>(null);

  function reset() {
    setFile(null);
    setBusy(false);
    setError(null);
    setResult(null);
  }

  async function handleImport() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await importFarmersCsv(file);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-3 text-sm">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                <div className="text-muted-foreground text-xs uppercase tracking-wide">
                  {t('summary.totalRows')}
                </div>
                <div className="font-semibold text-foreground text-lg">
                  {result.summary.totalRows}
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                <div className="text-muted-foreground text-xs uppercase tracking-wide">
                  {t('summary.farmers')}
                </div>
                <div className="font-semibold text-foreground text-lg">
                  {result.summary.farmersUpserted}
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                <div className="text-muted-foreground text-xs uppercase tracking-wide">
                  {t('summary.parcels')}
                </div>
                <div className="font-semibold text-foreground text-lg">
                  {result.summary.parcelsUpserted}
                </div>
              </div>
            </div>

            {result.unknownCoops.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-xs">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" />
                <div>
                  <div className="font-medium text-foreground">{t('unknownCoopsTitle')}</div>
                  <div className="mt-1 text-muted-foreground">{result.unknownCoops.join(', ')}</div>
                </div>
              </div>
            )}

            {result.summary.skipped.length > 0 && (
              <details className="rounded-md border border-border">
                <summary className="cursor-pointer px-3 py-2 text-sm">
                  {t('skippedRows', { n: result.summary.skipped.length })}
                </summary>
                <ul className="max-h-64 space-y-1 overflow-y-auto px-3 pb-3 text-xs">
                  {result.summary.skipped.slice(0, 100).map((s) => (
                    <li key={`${s.row}-${s.producerId ?? ''}`} className="text-muted-foreground">
                      <StatusTag tone="neutral">row {s.row}</StatusTag>{' '}
                      {s.producerId ? <span className="font-mono">{s.producerId}</span> : null} —{' '}
                      {s.reason}
                    </li>
                  ))}
                  {result.summary.skipped.length > 100 && (
                    <li className="text-muted-foreground italic">
                      {t('skippedTruncated', { n: result.summary.skipped.length - 100 })}
                    </li>
                  )}
                </ul>
              </details>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center hover:bg-muted/50">
              <FileUp className="size-8 text-muted-foreground" />
              <span className="text-sm text-foreground">{file ? file.name : t('pickFile')}</span>
              {file && (
                <span className="text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB
                </span>
              )}
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={busy}
              />
            </label>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <p className="text-muted-foreground text-xs">{t('formatHint')}</p>
          </div>
        )}

        <DialogFooter className="!flex-row justify-end">
          {result ? (
            <Button onClick={() => onOpenChange(false)}>{t('done')}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                {t('cancel')}
              </Button>
              <Button onClick={handleImport} disabled={!file || busy}>
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('importing')}
                  </>
                ) : (
                  <>
                    <Upload className="size-4" />
                    {t('import')}
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
