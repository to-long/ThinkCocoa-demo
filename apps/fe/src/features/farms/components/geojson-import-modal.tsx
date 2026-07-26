import { AlertCircle, FileUp, Loader2 } from 'lucide-react';
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
import { ErrorBanner } from '@/components/ui/error-banner';
import { StatusTag } from '@/components/ui/status-tag';
import {
  type GeoJsonImportResponse,
  importGeoJson,
  validateGeoJsonIds,
} from '@/shared/api/parcels';

// Minimal shape of an uploaded GeoJSON FeatureCollection — only the bits
// this modal reads (feature properties, to auto-match the Parcel ID column).
type GeoJsonFeature = { properties?: Record<string, string | number | boolean | null> | null };
type GeoJsonData = { features?: GeoJsonFeature[] };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GeoJsonImportModal({ open, onOpenChange }: Props) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, React.ReactNode>) =>
    intl.formatMessage({ id: `farms.geoJsonImport.${id}` }, values);

  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<{ parcelId: string; capturedAt: string }>({
    parcelId: '',
    capturedAt: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeoJsonImportResponse | null>(null);
  const [geoJsonData, setGeoJsonData] = useState<GeoJsonData | null>(null);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  function reset() {
    setFile(null);
    setMapping({ parcelId: '', capturedAt: '' });
    setError(null);
    setResult(null);
    setGeoJsonData(null);
    setMatchCount(null);
    setIsValidating(false);
  }

  const handleFileChange = async (selectedFile: File | null) => {
    setFile(selectedFile);
    setError(null);
    setMapping({ parcelId: '', capturedAt: '' });
    if (!selectedFile) return;

    try {
      const text = await selectedFile.text();
      const data = JSON.parse(text);
      if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
        throw new Error('Invalid GeoJSON: Expected a FeatureCollection.');
      }
      if (data.features.length === 0) {
        throw new Error('GeoJSON contains no features.');
      }
      const firstFeature = data.features[0];
      if (!firstFeature.properties) {
        throw new Error('GeoJSON features have no properties to map.');
      }

      const keys = Object.keys(firstFeature.properties).filter(Boolean);
      const commonIdNames = [
        'parcel id',
        'field id',
        'filed id',
        'farm id',
        'id',
        'parcelid',
        'farmid',
        'code',
        'plot id',
        'plotid',
      ];

      let matchedKey = '';
      for (const key of keys) {
        const normalized = key.toLowerCase().replace(/_/g, ' ').trim();
        if (
          commonIdNames.includes(normalized) ||
          commonIdNames.includes(key.toLowerCase().trim())
        ) {
          matchedKey = key;
          break;
        }
      }

      if (!matchedKey) {
        throw new Error(
          'Could not automatically determine Parcel ID field from GeoJSON properties. Ensure your properties contain a recognized ID field (e.g. Parcel ID, Farm ID, ID).',
        );
      }

      setMapping({ parcelId: matchedKey, capturedAt: '' });
      setGeoJsonData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFile(null);
      setGeoJsonData(null);
    }
  };

  useEffect(() => {
    async function checkIds() {
      if (!mapping.parcelId || !geoJsonData?.features) {
        setMatchCount(null);
        return;
      }

      const ids = geoJsonData.features
        .map((f: GeoJsonFeature) => f.properties?.[mapping.parcelId]?.toString())
        .filter((id): id is string => Boolean(id));

      if (ids.length === 0) {
        setMatchCount(0);
        return;
      }

      setIsValidating(true);
      try {
        const { matchCount: count } = await validateGeoJsonIds(ids);
        setMatchCount(count);
      } catch (err) {
        // Silently fail or log, since we don't want to completely block the UI with an error popup just for validation
        console.error('Validation failed:', err);
        setMatchCount(null); // Fallback to allow import if validation fails
      } finally {
        setIsValidating(false);
      }
    }

    checkIds();
  }, [mapping.parcelId, geoJsonData]);

  async function handleUpload() {
    if (!file || !mapping.parcelId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await importGeoJson(file, mapping);
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
          <DialogTitle>
            {t('title', { defaultMessage: 'Import Farm Polygons (GeoJSON)' })}
          </DialogTitle>
          <DialogDescription>
            {t('description', {
              defaultMessage:
                'Upload a GeoJSON FeatureCollection and map the fields to update farm boundaries.',
            })}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                <div className="text-muted-foreground text-xs uppercase tracking-wide">
                  {t('summary.totalFeatures', { defaultMessage: 'Total Features' })}
                </div>
                <div className="font-semibold text-foreground text-lg">
                  {result.summary.totalFeatures}
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                <div className="text-muted-foreground text-xs uppercase tracking-wide">
                  {t('summary.upserted', { defaultMessage: 'Updated' })}
                </div>
                <div className="font-semibold text-foreground text-lg text-success">
                  {result.summary.upserted}
                </div>
              </div>
            </div>

            {result.summary.skipped.length > 0 && (
              <details className="rounded-md border border-border">
                <summary className="cursor-pointer px-3 py-2 text-sm">
                  {t('skippedFeatures', {
                    defaultMessage: 'Skipped {n} features',
                    n: result.summary.skipped.length,
                  })}
                </summary>
                <ul className="max-h-64 space-y-1 overflow-y-auto px-3 pb-3 text-xs">
                  {result.summary.skipped.slice(0, 100).map((s) => (
                    <li
                      key={`${s.parcelId ?? 'unmapped'}-${s.reason}`}
                      className="text-muted-foreground"
                    >
                      {s.parcelId ? (
                        <span className="font-mono">{s.parcelId}</span>
                      ) : (
                        <StatusTag tone="neutral">Unmapped</StatusTag>
                      )}{' '}
                      — {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center hover:bg-muted/50">
              <FileUp className="size-8 text-muted-foreground" />
              <span className="text-sm text-foreground">
                {file ? file.name : t('pickFile', { defaultMessage: 'Select a .geojson file' })}
              </span>
              {file && (
                <span className="text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB
                </span>
              )}
              <input
                type="file"
                accept=".geojson,application/geo+json,application/json"
                className="sr-only"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              />
            </label>

            {error && <ErrorBanner message={`Upload failed: ${error}`} />}
          </div>
        )}

        <DialogFooter className="mt-2">
          {result ? (
            <Button
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              {t('close', { defaultMessage: 'Close' })}
            </Button>
          ) : (
            <div className="flex w-full items-center justify-between">
              <div className="text-sm text-muted-foreground">
                {isValidating && (
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-3 animate-spin" /> Checking matches...
                  </span>
                )}
                {!isValidating && matchCount === 0 && (
                  <span className="text-destructive flex items-center gap-1">
                    <AlertCircle className="size-4" /> 0 matches found in database
                  </span>
                )}
                {!isValidating && matchCount !== null && matchCount > 0 && (
                  <span className="text-success">
                    {matchCount} {matchCount === 1 ? 'match' : 'matches'} found
                  </span>
                )}
              </div>
              {(!mapping.parcelId || matchCount === null || matchCount > 0 || isValidating) && (
                <Button
                  onClick={handleUpload}
                  disabled={!file || !mapping.parcelId || busy || isValidating || matchCount === 0}
                >
                  {(busy || isValidating) && <Loader2 className="mr-2 size-4 animate-spin" />}
                  {t('upload', { defaultMessage: 'Import Polygons' })}
                </Button>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
