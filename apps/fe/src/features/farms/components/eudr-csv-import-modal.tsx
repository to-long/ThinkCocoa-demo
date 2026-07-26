import { AlertCircle, FileUp, Loader2 } from 'lucide-react';
import Papa from 'papaparse';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusTag } from '@/components/ui/status-tag';
import {
  type EudrCsvImportResponse,
  importEudrCsv,
  validateGeoJsonIds,
} from '@/shared/api/parcels';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type MappingState = {
  parcelId: string;
  assessedAt: string;
  assessedBy: string;
  notes: string;
  status: string;
  overlap: string;
  onLand: string;
  inCountry: string;
  deforestationRisk: string;
  protectedAreaRisk: string;
  eudrData: string;
  eudrExplanation: string;
};

// Normalize a header/field name for fuzzy matching: lowercase, strip every
// non-alphanumeric char so "Parcel ID", "parcel_id", "ParcelID" all collapse
// to "parcelid".
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Aliases per mapping field — used to pre-fill the "Match Headers" selects
// from the uploaded CSV's column names so the user doesn't map each by hand.
const FIELD_ALIASES: Record<keyof MappingState, string[]> = {
  parcelId: ['parcelid', 'parcel', 'plotid', 'plot', 'farmid'],
  assessedAt: ['assessedat', 'assessmentdate', 'dateofassessment', 'assessdate', 'date'],
  assessedBy: ['assessedby', 'assessor', 'personnel', 'assessedbywho'],
  notes: ['notes', 'note', 'comment', 'comments', 'remark', 'remarks'],
  status: ['status', 'eudrstatus', 'compliancestatus', 'compliance'],
  overlap: ['overlap'],
  onLand: ['onland'],
  inCountry: ['incountry'],
  deforestationRisk: ['deforestationrisk', 'deforestation'],
  protectedAreaRisk: ['protectedarearisk', 'protectedarea', 'protected'],
  eudrData: ['eudrdata'],
  eudrExplanation: ['eudrexplanation', 'explanation'],
};

// Best-guess header → field. Prefers an exact normalized match, then a
// contains match; each header is claimed at most once.
function autoMatchHeaders(headers: string[]): Partial<MappingState> {
  const used = new Set<string>();
  const out: Partial<MappingState> = {};
  for (const field of Object.keys(FIELD_ALIASES) as (keyof MappingState)[]) {
    const aliases = FIELD_ALIASES[field];
    const exact = headers.find((h) => !used.has(h) && aliases.includes(norm(h)));
    const match =
      exact ??
      headers.find(
        (h) => !used.has(h) && aliases.some((a) => norm(h).includes(a) || a.includes(norm(h))),
      );
    if (match) {
      out[field] = match;
      used.add(match);
    }
  }
  return out;
}

export function EudrCsvImportModal({ open, onOpenChange }: Props) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, React.ReactNode>) =>
    intl.formatMessage({ id: `farms.eudrImport.${id}` }, values);

  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState({
    parcelId: '',
    assessedAt: '',
    assessedBy: '',
    notes: '',
    status: '',
    overlap: '',
    onLand: '',
    inCountry: '',
    deforestationRisk: '',
    protectedAreaRisk: '',
    eudrData: '',
    eudrExplanation: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EudrCsvImportResponse | null>(null);
  const [csvData, setCsvData] = useState<Record<string, string>[]>([]);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  // "Map Headers" starts collapsed; auto-opens only when a required field
  // couldn't be auto-matched (missing/mis-named column) so the user can fix it.
  const [mapHeadersOpen, setMapHeadersOpen] = useState(false);

  function reset() {
    setFile(null);
    setHeaders([]);
    setMapping({
      parcelId: '',
      assessedAt: '',
      assessedBy: '',
      notes: '',
      status: '',
      overlap: '',
      onLand: '',
      inCountry: '',
      deforestationRisk: '',
      protectedAreaRisk: '',
      eudrData: '',
      eudrExplanation: '',
    });
    setError(null);
    setResult(null);
    setCsvData([]);
    setMatchCount(null);
    setIsValidating(false);
    setMapHeadersOpen(false);
  }

  const handleFileChange = (selectedFile: File | null) => {
    setFile(selectedFile);
    setError(null);
    setHeaders([]);
    setCsvData([]);
    if (!selectedFile) return;

    // Use papaparse to read the file and extract headers and data
    Papa.parse(selectedFile, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.meta.fields && results.meta.fields.length > 0) {
          const fields = results.meta.fields.filter(Boolean) as string[];
          setHeaders(fields);
          setCsvData(results.data as Record<string, string>[]);
          // Pre-fill the mapping from the CSV's column names…
          const auto = autoMatchHeaders(fields);
          setMapping((prev) => ({ ...prev, ...auto }));
          // …and only expand "Map Headers" if a REQUIRED field is still
          // unmatched (column not found / mis-named). All matched → stay collapsed.
          const requiredKeys: (keyof MappingState)[] = [
            'parcelId',
            'assessedAt',
            'assessedBy',
            'notes',
            'status',
          ];
          setMapHeadersOpen(requiredKeys.some((k) => !auto[k]));
        } else {
          setError('Could not extract headers from the CSV file.');
          setFile(null);
          setCsvData([]);
        }
      },
      error: (err) => {
        setError(`CSV parse error: ${err.message}`);
        setFile(null);
        setCsvData([]);
      },
    });
  };

  useEffect(() => {
    async function checkIds() {
      if (!mapping.parcelId || csvData.length === 0) {
        setMatchCount(null);
        return;
      }

      const ids = csvData.map((row) => row[mapping.parcelId]?.toString()).filter(Boolean);

      if (ids.length === 0) {
        setMatchCount(0);
        return;
      }

      setIsValidating(true);
      try {
        const { matchCount: count } = await validateGeoJsonIds(ids);
        setMatchCount(count);
      } catch (err) {
        console.error('Validation failed:', err);
        setMatchCount(null);
      } finally {
        setIsValidating(false);
      }
    }

    checkIds();
  }, [mapping.parcelId, csvData]);

  async function handleUpload() {
    if (!file || !mapping.parcelId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await importEudrCsv(file, mapping);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const mapFields = [
    { key: 'parcelId', label: 'Parcel ID', required: true },
    { key: 'assessedAt', label: 'Date of assessment', required: true },
    { key: 'assessedBy', label: 'Personnel who run assessment', required: true },
    { key: 'notes', label: 'Notes on farm', required: true },
    { key: 'status', label: 'EUDR status of farm', required: true },
    { key: 'overlap', label: 'Overlap', required: false },
    { key: 'onLand', label: 'On Land', required: false },
    { key: 'inCountry', label: 'In Country', required: false },
    { key: 'deforestationRisk', label: 'Deforestation Risk', required: false },
    { key: 'protectedAreaRisk', label: 'Protected Area Risk', required: false },
    { key: 'eudrData', label: 'EUDR Data', required: false },
    { key: 'eudrExplanation', label: 'EUDR Explanation', required: false },
  ] as const;

  const isReady =
    mapping.parcelId && mapping.assessedAt && mapping.assessedBy && mapping.notes && mapping.status;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('title', { defaultMessage: 'Import EUDR Data (CSV)' })}</DialogTitle>
          <DialogDescription>
            {t('description', {
              defaultMessage:
                'Upload a CSV file containing Rainforest Alliance EUDR statuses and map the column headers to the database fields.',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-2">
          {result ? (
            <div className="flex flex-col gap-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                  <div className="text-muted-foreground text-xs uppercase tracking-wide">
                    {t('summary.totalRows', { defaultMessage: 'Total Rows' })}
                  </div>
                  <div className="font-semibold text-foreground text-lg">
                    {result.summary.totalRows}
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
                    {t('skippedRows', {
                      defaultMessage: 'Skipped {n} rows',
                      n: result.summary.skipped.length,
                    })}
                  </summary>
                  <ul className="max-h-64 space-y-1 overflow-y-auto px-3 pb-3 text-xs">
                    {result.summary.skipped.slice(0, 100).map((s) => (
                      <li key={`${s.row}-${s.parcelId ?? ''}`} className="text-muted-foreground">
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
                  {file ? file.name : t('pickFile', { defaultMessage: 'Select a .csv file' })}
                </span>
                {file && (
                  <span className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </span>
                )}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                />
              </label>

              {headers.length > 0 && (
                <details
                  className="group rounded-md border border-border mt-2"
                  open={mapHeadersOpen}
                  onToggle={(e) => setMapHeadersOpen(e.currentTarget.open)}
                >
                  <summary className="cursor-pointer bg-muted/30 px-4 py-3 text-sm font-medium hover:bg-muted/50">
                    {t('mappingTitle', { defaultMessage: 'Match Headers' })}
                  </summary>
                  <div className="grid grid-cols-2 gap-4 items-center p-4 border-t border-border">
                    {mapFields.map((field) => (
                      <div key={field.key} className="contents">
                        <div className="text-sm text-muted-foreground">
                          {field.label}
                          {!field.required && ' (optional)'}
                        </div>
                        <Select
                          value={mapping[field.key as keyof typeof mapping] || '__none__'}
                          onValueChange={(v) =>
                            setMapping({ ...mapping, [field.key]: v === '__none__' ? '' : v })
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select column" />
                          </SelectTrigger>
                          <SelectContent>
                            {!field.required && (
                              <SelectItem value="__none__">-- Skip --</SelectItem>
                            )}
                            {headers.map((h) => (
                              <SelectItem key={h} value={h}>
                                {h}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {error && <ErrorBanner message={`Upload failed: ${error}`} />}
            </div>
          )}
        </div>

        <DialogFooter className="mt-4 shrink-0">
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
              {(!isReady || matchCount === null || matchCount > 0 || isValidating) && (
                <Button
                  onClick={handleUpload}
                  disabled={!file || !isReady || busy || isValidating || matchCount === 0}
                >
                  {(busy || isValidating) && <Loader2 className="mr-2 size-4 animate-spin" />}
                  {t('upload', { defaultMessage: 'Import Data' })}
                </Button>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
