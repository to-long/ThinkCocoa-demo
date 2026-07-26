/**
 * Create / Edit Farm dialog.
 *
 * Mirrors the Pencil designs `pIbgn` (Add Farm) + `44xJQ` (Edit Farm):
 *  - Field ID (text, required; immutable on edit)
 *  - Farm Name (text)
 *  - Farmer (select — populated from `useFarmersList`)
 *  - Crop (select — default Cocoa)
 *  - Planting Date (date input)
 *  - Tree Count (number)
 *  - Total Area (number, ha — placeholder "Auto from map" when blank)
 *  - Map Geometry: STUB UI (KML/GeoJSON parser deferred — see plan).
 *
 * Validation flows through the shared `createParcelSchema` /
 * `updateParcelSchema` via `zodResolver`, matching the farmers feature.
 */

import {
  type CreateParcelInput,
  createParcelSchema,
  type ParcelGeometry,
  parcelGeometrySchema,
  type UpdateParcelInput,
  updateParcelSchema,
} from '@thinkcocoa/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Check,
  ChevronsUpDown,
  CloudUpload,
  FileCheck2,
  MapPin,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type Resolver, useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { useDebounce } from 'use-debounce';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { type ApiParcel, useFarmersList } from '@/shared/api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateParcelInput | UpdateParcelInput) => Promise<void>;
  initialData?: ApiParcel | null;
}

/**
 * Pull a boundary Polygon / MultiPolygon out of an uploaded GeoJSON
 * blob. Accepts a raw geometry, a Feature, or a FeatureCollection —
 * for a collection we merge every polygon feature into one
 * MultiPolygon so a multi-ring export still lands as a single parcel
 * boundary. Returns a discriminated result so the caller can surface a
 * specific message instead of a generic "invalid file".
 */
type ParseResult =
  | { ok: true; geometry: ParcelGeometry; polygonCount: number }
  | { ok: false; errorKey: string };

// biome-ignore lint/suspicious/noExplicitAny: parsing dynamic user JSON
function geometriesFrom(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  if (node.type === 'FeatureCollection' && Array.isArray(node.features)) {
    return node.features.flatMap((f: unknown) => geometriesFrom(f));
  }
  if (node.type === 'Feature') return geometriesFrom(node.geometry);
  if (node.type === 'Polygon' || node.type === 'MultiPolygon') return [node];
  return [];
}

function parseGeoJson(text: string): ParseResult {
  // biome-ignore lint/suspicious/noExplicitAny: parsing dynamic user JSON
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, errorKey: 'farms.field.mapErrorInvalidJson' };
  }
  const geoms = geometriesFrom(json);
  if (geoms.length === 0) return { ok: false, errorKey: 'farms.field.mapErrorNoPolygon' };

  // Flatten to a single MultiPolygon (each Polygon = one member,
  // each MultiPolygon contributes its members).
  const members: number[][][][] = [];
  for (const g of geoms) {
    if (g.type === 'Polygon') members.push(g.coordinates);
    else for (const poly of g.coordinates) members.push(poly);
  }
  const geometry: ParcelGeometry =
    members.length === 1
      ? { type: 'Polygon', coordinates: members[0]! }
      : { type: 'MultiPolygon', coordinates: members };

  // Final shape validation against the shared schema (rejects rings
  // with < 4 points, positions with < 2 coords, etc.).
  const parsed = parcelGeometrySchema.safeParse(geometry);
  if (!parsed.success) return { ok: false, errorKey: 'farms.field.mapErrorNoPolygon' };
  return { ok: true, geometry: parsed.data, polygonCount: members.length };
}

type FormValues = CreateParcelInput;

const empty: FormValues = {
  id: '',
  farmerId: '',
  parcelName: null,
  cropType: 'cocoa',
  plantingDate: null,
  cocoaTreeCount: null,
  calculatedAreaHa: null,
};

function fromInitial(p: ApiParcel): FormValues {
  return {
    id: p.id,
    farmerId: p.farmerId,
    parcelName: p.parcelName ?? null,
    cropType: p.cropType ?? 'cocoa',
    plantingDate: p.plantingDate ?? null,
    cocoaTreeCount: p.cocoaTreeCount ?? null,
    calculatedAreaHa: p.calculatedAreaHa ?? null,
  };
}

export function FarmDialog({ open, onOpenChange, onSubmit, initialData }: Props) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const isEdit = !!initialData;

  const resolver = (isEdit
    ? zodResolver(updateParcelSchema)
    : zodResolver(createParcelSchema)) as unknown as Resolver<FormValues>;

  const form = useForm<FormValues>({ resolver, defaultValues: empty });

  // Map-upload state lives outside the form (it's a parsed geometry
  // object, not a text field) and is folded into the payload on submit.
  const [geometry, setGeometry] = useState<ParcelGeometry | null>(null);
  const [geoFileName, setGeoFileName] = useState<string | null>(null);
  const [geoPolygonCount, setGeoPolygonCount] = useState(0);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (initialData) form.reset(fromInitial(initialData));
    else form.reset(empty);
    setGeometry(null);
    setGeoFileName(null);
    setGeoPolygonCount(0);
    setGeoError(null);
    setDragOver(false);
  }, [open, initialData, form]);

  const handleFile = async (file: File | null | undefined) => {
    if (!file) return;
    setGeoError(null);
    const res = parseGeoJson(await file.text());
    if (!res.ok) {
      setGeometry(null);
      setGeoFileName(null);
      setGeoPolygonCount(0);
      setGeoError(res.errorKey);
      return;
    }
    setGeometry(res.geometry);
    setGeoFileName(file.name);
    setGeoPolygonCount(res.polygonCount);
  };

  const clearGeometry = () => {
    setGeometry(null);
    setGeoFileName(null);
    setGeoPolygonCount(0);
    setGeoError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = form.handleSubmit(async (values) => {
    const trimOrNull = (v: string | null | undefined) => {
      if (v == null) return null;
      const s = v.trim();
      return s === '' ? null : s;
    };
    const payload: CreateParcelInput & UpdateParcelInput = {
      id: values.id.trim(),
      farmerId: values.farmerId,
      parcelName: trimOrNull(values.parcelName),
      cropType: values.cropType ?? 'cocoa',
      plantingDate: trimOrNull(values.plantingDate),
      cocoaTreeCount: values.cocoaTreeCount ?? null,
      calculatedAreaHa: values.calculatedAreaHa ?? null,
      // Only send the boundary when a file was parsed this session —
      // omitting it leaves any existing geometry untouched on edit.
      ...(geometry ? { geometry } : {}),
    };
    await onSubmit(payload);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <h2 className="text-lg font-semibold">
            {isEdit ? t('farms.dialog.editTitle') : t('farms.dialog.createTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isEdit ? t('farms.dialog.editDescription') : t('farms.dialog.createDescription')}
          </p>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
            {/* Scrollable field body — keeps the footer (Cancel / Save)
                pinned + reachable when the form outgrows the dialog on
                short viewports. */}
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-0.5">
            {/* Field ID */}
            <FormField
              control={form.control}
              name="id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('farms.field.fieldId')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. AK001WP009"
                      {...field}
                      disabled={isEdit}
                      title={isEdit ? t('farms.field.fieldIdHint') : undefined}
                      className={isEdit ? 'bg-muted text-foreground' : undefined}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Farm Name */}
            <FormField
              control={form.control}
              name="parcelName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('farms.field.farmName')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Mensah Farm A"
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(e.target.value === '' ? null : e.target.value)
                      }
                      onBlur={field.onBlur}
                      ref={field.ref}
                      name={field.name}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Farmer — searchable combobox. Full-width trigger
                (default shadcn SelectTrigger has w-fit which made the
                empty state collapse to a tiny pill). Search is
                server-side via `?q=` so the dropdown stays fast on
                coops with 1000+ farmers. */}
            <FormField
              control={form.control}
              name="farmerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('farms.field.farmer')}</FormLabel>
                  <FormControl>
                    <FarmerCombobox
                      value={field.value}
                      onChange={field.onChange}
                      initialLabel={initialData?.farmerFullName}
                      enabled={open}
                      placeholder={t('farms.field.selectFarmer')}
                      searchPlaceholder={t('farms.field.searchFarmer')}
                      emptyLabel={t('farms.field.noFarmerFound')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Crop + Planting Date */}
            <div className="grid grid-cols-2 gap-4">
              {/* Crop — locked to Cocoa for now. Cooperative scope
                  is cocoa-only; coffee/other are placeholders the
                  product roadmap will revisit. Render as a disabled
                  read-only input so it visually matches the other
                  fields but can't be changed. */}
              <FormField
                control={form.control}
                name="cropType"
                render={() => (
                  <FormItem>
                    <FormLabel>{t('farms.field.crop')}</FormLabel>
                    <FormControl>
                      <Input
                        value={t('farms.crop.cocoa')}
                        disabled
                        readOnly
                        className="bg-muted text-foreground"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="plantingDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('farms.field.plantingDate')}</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value === '' ? null : e.target.value)
                        }
                        onBlur={field.onBlur}
                        ref={field.ref}
                        name={field.name}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Tree Count + Total Area */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="cocoaTreeCount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('farms.field.treeCount')}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        placeholder="e.g. 650"
                        value={field.value ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          field.onChange(v === '' ? null : Number(v));
                        }}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        name={field.name}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="calculatedAreaHa"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('farms.field.totalArea')}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        placeholder={t('farms.field.areaPlaceholder')}
                        value={field.value ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          field.onChange(v === '' ? null : Number(v));
                        }}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        name={field.name}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Map Geometry — GeoJSON boundary upload */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t('farms.field.mapGeometry')}</span>
                {geometry && (
                  <button
                    type="button"
                    onClick={clearGeometry}
                    className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
                  >
                    <X className="size-3" />
                    {t('farms.field.mapClear')}
                  </button>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".geojson,.json,application/geo+json,application/json"
                className="hidden"
                onChange={(e) => {
                  void handleFile(e.target.files?.[0]);
                }}
              />

              {geometry ? (
                <div className="flex flex-col gap-1 rounded-md border border-green-300 border-dashed bg-green-50/40 px-4 py-6 text-center dark:bg-green-950/20">
                  <FileCheck2 className="mx-auto h-6 w-6 text-green-600" />
                  <div className="truncate font-medium text-foreground text-sm">{geoFileName}</div>
                  <div className="text-muted-foreground text-xs">
                    {intl.formatMessage(
                      { id: 'farms.field.mapPolygonCount' },
                      { count: geoPolygonCount },
                    )}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    void handleFile(e.dataTransfer.files?.[0]);
                  }}
                  className={cn(
                    'flex w-full flex-col gap-1 rounded-md border border-dashed px-4 py-6 text-center transition-colors',
                    geoError
                      ? 'border-destructive/50 bg-destructive/5'
                      : dragOver
                        ? 'border-ring bg-accent/50'
                        : 'border-border bg-muted/30 hover:bg-muted/50',
                  )}
                >
                  {geoError ? (
                    <TriangleAlert className="mx-auto h-6 w-6 text-destructive" />
                  ) : (
                    <CloudUpload className="mx-auto h-6 w-6 text-muted-foreground" />
                  )}
                  <div className="font-medium text-foreground text-sm">
                    {t('farms.field.mapUploadHint')}
                  </div>
                  <div
                    className={cn(
                      'text-xs',
                      geoError ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {geoError ? t(geoError) : t('farms.field.mapUploadSub')}
                  </div>
                </button>
              )}

              {isEdit && !geometry && initialData?.calculatedAreaHa != null && (
                <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                  <MapPin className="size-3 text-green-600" />
                  {intl.formatMessage(
                    { id: 'farms.field.mapExisting' },
                    { area: initialData.calculatedAreaHa },
                  )}
                </div>
              )}
            </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={form.formState.isSubmitting}
              >
                {t('farms.dialog.cancel')}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting
                  ? t('farms.dialog.submitting')
                  : isEdit
                    ? t('farms.dialog.editSubmit')
                    : t('farms.dialog.createSubmit')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Searchable farmer dropdown. Popover + debounced server-side `?q=`
 * search against `/api/farmers`. Selected farmer's display name is
 * cached so the trigger can still render the label after navigating
 * away from a search result that no longer matches.
 */
interface FarmerComboboxProps {
  value: string;
  onChange: (id: string) => void;
  initialLabel?: string | null;
  enabled: boolean;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
}

function FarmerCombobox({
  value,
  onChange,
  initialLabel,
  enabled,
  placeholder,
  searchPlaceholder,
  emptyLabel,
}: FarmerComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebounce(search, 300);
  const [cachedLabel, setCachedLabel] = useState<string | null>(initialLabel ?? null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Imperative focus on open instead of `autoFocus` (which Biome's
  // a11y/noAutofocus rule rejects — autoFocus can disorient keyboard
  // and screen-reader users when it triggers off the natural
  // navigation order).
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Keep cachedLabel in sync when the parent swaps initialData
  // (e.g. opening Edit on a different parcel).
  useEffect(() => {
    setCachedLabel(initialLabel ?? null);
  }, [initialLabel]);

  // Reset search when the dialog closes so the next open starts clean.
  useEffect(() => {
    if (!enabled) setSearch('');
  }, [enabled]);

  const { data: farmersResp, isLoading } = useFarmersList(
    enabled && open ? { pageSize: 50, q: debouncedSearch || undefined } : {},
  );
  const farmers = farmersResp?.items ?? [];

  // Try to find the selected farmer in the current page (covers both
  // server-rendered initial label AND the case where the user just
  // picked someone). Fall back to the cached label.
  const selected = farmers.find((f) => f.id === value);
  const buttonLabel = selected
    ? `${selected.firstName} ${selected.lastName}`
    : value
      ? (cachedLabel ?? value)
      : '';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'flex h-9 w-full select-none items-center justify-between gap-1.5 whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            !buttonLabel && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{buttonLabel || placeholder}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        {/* Search box — feeds into `?q=` server-side. */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground placeholder:opacity-100"
          />
        </div>
        {/* When the popover sits inside a Radix Dialog, the dialog's
            `react-remove-scroll` lock intercepts wheel events on
            anything outside DialogContent — and the popover is
            portaled to document.body, so it gets caught. Stopping the
            wheel here lets the local list scroll normally.
            overscroll-contain prevents the body from jumping when the
            list bottoms out. */}
        <div
          className="max-h-64 overflow-y-auto overscroll-contain py-1"
          onWheel={(e) => e.stopPropagation()}
        >
          {isLoading ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">…</div>
          ) : farmers.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyLabel}</div>
          ) : (
            farmers.map((f) => {
              const label = `${f.firstName} ${f.lastName}`;
              const isSelected = f.id === value;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    onChange(f.id);
                    setCachedLabel(label);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent',
                    isSelected && 'bg-accent/60',
                  )}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{label}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">{f.id}</span>
                  </div>
                  {isSelected && <Check className="size-4 shrink-0 text-foreground" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
