/**
 * Create / edit farmer dialog.
 *
 * Fields are grouped into related blocks, each a small section heading over
 * a two-column grid:
 *
 *   • Cooperative — read-only tenant banner (which coop this farmer joins)
 *   • Identity    — Farmer Code (own full-width row), First/Surname,
 *                   Other Names, Gender, Date of Birth, Registration Date
 *   • Contact & ID — Phone, ID Type, ID Number
 *   • Location    — District (read-only), Society
 *   • Certification — Certificate Status, Data Collection Consent
 *   • Household   — Household Size, Children Count
 *
 * Each field is extracted into a `f*` fragment above the return so the
 * blocks read as plain composition. Farmer Code spans both columns; the
 * rest pair up two-per-row.
 *
 * Farmers are always active — there is no `isActive` control here and no
 * other writer for the column, so it keeps its `true` DB default.
 *
 * Cooperative is NOT a form field: a farmer is always created into the
 * active tenant (the header coop switcher), read from `useActiveCoop`. The
 * Farmer Code field is pre-filled with that coop's prefix (`ABM-`) via the
 * shared `coopFarmerCodePrefix`, so the enumerator only types the serial.
 *
 * District is not an independent farmer field — it's derived from the
 * active cooperative's `districtName` and rendered as plain read-only text
 * (label + value), not a disabled input, so it never looks editable.
 *
 * Society is a single-select sourced from the farmer-stats `bySociety`
 * facet (scoped to the active coop), so enumerators pick an existing
 * society instead of free-typing inconsistent spellings.
 *
 * Certification ID (`producerId`) is intentionally not in this dialog —
 * Pencil shows only "Certificate Status". Admins who need to edit the RA
 * traceability code do it via the API / seed pipeline. The dialog still
 * preserves the existing value on edit (passes it through untouched).
 *
 * Form state is owned by `react-hook-form` with a `zod` resolver. The
 * schema switches between `createFarmerSchema` (strict — coop + names
 * required) and `updateFarmerSchema` (everything optional) so the same
 * dialog body covers both flows. Select primitives are bridged via
 * `Controller`'s render prop because they don't accept a raw ref.
 */

import { zodResolver } from '@hookform/resolvers/zod';
import {
  type CreateFarmerInput,
  coopFarmerCodePrefix,
  createFarmerSchema,
  type UpdateFarmerInput,
  updateFarmerSchema,
} from '@thinkcocoa/shared';
import { Award, type LucideIcon, MapPin, Phone, User, Users } from 'lucide-react';
import { type ReactNode, useEffect, useMemo } from 'react';
import { type Resolver, useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusTag } from '@/components/ui/status-tag';
import { formatSociety, sortSocieties } from '@/lib/society';
import type { ApiFarmer } from '@/shared/api';
import { useCooperativesList, useFarmerFullStats } from '@/shared/api';
import { selectActiveCoop, useActiveCoop } from '@/shared/store/useActiveCoop';

interface FarmerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateFarmerInput | UpdateFarmerInput) => void | Promise<void>;
  /** When provided, dialog is in edit mode. */
  initialData?: ApiFarmer;
}

// Only value actually present in the data (parser + CSV seed both write
// `'national_id'`; DB column is freeform text with no other values).
// Label comes from intl via `farmers.nationalIdType.national_id`.
// Radix Select forbids an empty-string item value, so "no society" uses a
// sentinel that the Controller maps back to `null` before the resolver.
const SOCIETY_NONE = '__none__';
const ID_TYPES = ['national_id'] as const;
const SEX_OPTIONS = ['male', 'female'] as const;
const CERT_OPTIONS = ['rainforest_alliance', 'unknown'] as const;

// `react-hook-form` needs a single concrete type for `useForm` even though
// the resolver swaps between create / update. CreateFarmerInput is a strict
// superset of the shape we care about (every field present), so we use it
// as the form-state type — at submit-time the resolver accepts the partial
// updates because the update schema makes everything optional.
type FarmerFormValues = CreateFarmerInput;

// Tri-state consent stored on the row as boolean | null. The Select widget
// can only emit strings, so we map "true"/"false"/"unknown" ↔ true/false/null
// via the Controller's render prop without touching form-state shape.
const consentToString = (v: boolean | null | undefined): string =>
  v === true ? 'true' : v === false ? 'false' : 'unknown';
const stringToConsent = (v: string): boolean | null =>
  v === 'true' ? true : v === 'false' ? false : null;

const emptyDefaults: FarmerFormValues = {
  cooperativeId: '',
  farmerCode: '',
  firstName: '',
  lastName: '',
  otherNames: null,
  sex: undefined,
  dateOfBirth: null,
  phoneNumber: null,
  nationalIdNumber: null,
  nationalIdType: null,
  society: null,
  dataCollectionConsent: null,
  certificationStatus: 'unknown',
  registrationDate: null,
  householdSize: null,
  childrenCount: null,
  producerId: null,
};

const fromInitial = (f: ApiFarmer): FarmerFormValues => ({
  cooperativeId: f.cooperativeId,
  farmerCode: f.farmerCode,
  firstName: f.firstName,
  lastName: f.lastName,
  otherNames: f.otherNames ?? null,
  sex: (SEX_OPTIONS as readonly string[]).includes(f.sex ?? '')
    ? (f.sex as FarmerFormValues['sex'])
    : undefined,
  dateOfBirth: f.dateOfBirth ?? null,
  phoneNumber: f.phoneNumber ?? null,
  nationalIdNumber: f.nationalIdNumber ?? null,
  nationalIdType: f.nationalIdType ?? null,
  society: f.society ?? null,
  dataCollectionConsent: f.dataCollectionConsent ?? null,
  certificationStatus: f.certificationStatus || 'unknown',
  registrationDate: f.registrationDate ?? null,
  householdSize: f.householdSize ?? null,
  childrenCount: f.childrenCount ?? null,
  producerId: f.producerId ?? null,
});

// Section heading — a StatusTag pill (same chip style as the role
// permission groups) so blocks read as labelled sections. One tone keeps
// them consistent rather than a rainbow.
function SectionHeading({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <StatusTag tone="lime">
      <Icon className="size-3 shrink-0" />
      {children}
    </StatusTag>
  );
}

export function FarmerDialog({ open, onOpenChange, onSubmit, initialData }: FarmerDialogProps) {
  const intl = useIntl();
  const isEdit = !!initialData;

  const { data: cooperatives } = useCooperativesList(open);
  // Farmers are always created into the CURRENT tenant (header coop
  // switcher), so we drive the coop from the active-coop store instead of
  // showing a picker. `useCooperativesList` stays only to resolve the
  // coop's district for the read-only District display.
  const activeCoop = useActiveCoop(selectActiveCoop);

  // Society options — reuse the farmer stats facet (`bySociety`), already
  // scoped to the active coop by the `active-coop-id` cookie, so the
  // dropdown offers exactly the societies that exist in this tenant.
  const { data: fullStats } = useFarmerFullStats();
  const societyOptions = useMemo(
    () => sortSocieties((fullStats?.bySociety ?? []).map((r) => r.society).filter(Boolean)),
    [fullStats],
  );

  // Cast: the ternary picks between two zod schemas whose inferred shapes
  // differ on optionality (update makes everything optional). TS can't see
  // either as an exact `FarmerFormValues` resolver, so we widen via Resolver.
  const resolver = (isEdit
    ? zodResolver(updateFarmerSchema)
    : zodResolver(createFarmerSchema)) as unknown as Resolver<FarmerFormValues>;

  const form = useForm<FarmerFormValues>({
    resolver,
    defaultValues: emptyDefaults,
  });

  const t = (k: string) => intl.formatMessage({ id: k });

  // Reset / seed on open. Edit: hydrate from the row. Create: blank, but
  // bind the active coop and pre-fill its farmer-code prefix (`SNK-`) inside
  // the SAME reset so a later effect can't clobber the value (react-hook-form
  // reset + setValue across two effects races).
  useEffect(() => {
    if (!open) return;
    if (initialData) {
      form.reset(fromInitial(initialData));
    } else {
      // Bind the active coop; the farmer-code prefix is filled by the effect
      // below once it resolves (it can lag the coops list).
      form.reset({ ...emptyDefaults, cooperativeId: activeCoop?.cooperativeId ?? '' });
    }
  }, [open, initialData, form, activeCoop]);

  // Coop + district labels read off the bound cooperative (create: active
  // coop; edit: the farmer's own coop, both live in `cooperativeId`).
  const cooperativeId = form.watch('cooperativeId');

  // District is derived from the active cooperative — shown read-only.
  const selectedCoop = useMemo(
    () => cooperatives?.find((c) => c.id === cooperativeId),
    [cooperatives, cooperativeId],
  );
  const districtDisplay = selectedCoop?.districtName ?? '';

  // Fixed, non-editable farmer-code prefix (`SNK-`). Prefer the coop's stored
  // `farmerCodePrefix` (set at coop creation); fall back to the derived map
  // for legacy coops without one. The create input shows it as a locked
  // leading addon so the user types only the serial.
  const coopPrefix =
    selectedCoop?.farmerCodePrefix ??
    (activeCoop ? coopFarmerCodePrefix(activeCoop.cooperativeCode) : '');
  const codePrefix = coopPrefix ? `${coopPrefix}-` : '';

  // Prefill the farmer code with the prefix on create, once it resolves.
  // Guard: only fill while the field is empty or still a bare prefix, so a
  // serial the user already typed is never clobbered.
  useEffect(() => {
    if (isEdit || !open || !codePrefix) return;
    const cur = form.getValues('farmerCode') ?? '';
    if ((cur === '' || /^[A-Z]{2,5}-$/.test(cur)) && cur !== codePrefix) {
      form.setValue('farmerCode', codePrefix);
    }
  }, [isEdit, open, codePrefix, form]);

  // Date bounds mirror the shared `boundedDate` validator (min 1900-01-01,
  // max today, UTC) so the native date picker DISABLES out-of-range days up
  // front instead of accepting them and then failing validation.
  const TODAY_STR = new Date().toISOString().slice(0, 10);
  const MIN_DATE = '1900-01-01';

  const handleSubmit = form.handleSubmit(async (values) => {
    // Trim string fields that the BE expects normalised. Empty -> null/
    // undefined preserves the schema's distinction between "absent" and
    // "explicitly cleared" (nullable text columns).
    const trimOrNull = (v: string | null | undefined) => {
      if (v == null) return null;
      const s = v.trim();
      return s === '' ? null : s;
    };

    const payload: CreateFarmerInput & UpdateFarmerInput = {
      cooperativeId: values.cooperativeId,
      farmerCode: values.farmerCode.trim(),
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      otherNames: trimOrNull(values.otherNames),
      sex: values.sex,
      dateOfBirth: trimOrNull(values.dateOfBirth),
      phoneNumber: trimOrNull(values.phoneNumber),
      nationalIdNumber: trimOrNull(values.nationalIdNumber),
      nationalIdType: trimOrNull(values.nationalIdType),
      society: trimOrNull(values.society),
      dataCollectionConsent: values.dataCollectionConsent ?? null,
      certificationStatus: values.certificationStatus || undefined,
      registrationDate: trimOrNull(values.registrationDate),
      householdSize: values.householdSize ?? undefined,
      childrenCount: values.childrenCount ?? undefined,
      producerId: trimOrNull(values.producerId),
    };

    await onSubmit(payload);
    onOpenChange(false);
  });

  const isSubmitting = form.formState.isSubmitting;

  // ── Field fragments (grouped into related blocks in the return) ────────

  // Cooperative + District are both read-only, derived from the active coop.
  // Same label+text format, grouped together in the Location section — the
  // farmer inherits the active coop, it's not an editable picker.
  const coopLabel = (
    <div className="flex flex-col gap-2">
      <Label className="text-muted-foreground">{t('farmers.field.cooperative')}</Label>
      <p className="flex h-9 items-center text-sm">
        {selectedCoop?.name ?? activeCoop?.cooperativeName ?? (
          <span className="text-muted-foreground">{t('farmers.stats.noData')}</span>
        )}
      </p>
    </div>
  );

  // Farmer code sits on its own full-width row (col-span-2 in the return).
  // In edit mode it's the immutable PK — disabled so the UI doesn't lie.
  const fCode = (
    <FormField
      control={form.control}
      name="farmerCode"
      render={({ field }) => (
        <FormItem>
          <div className="flex flex-col gap-0.5">
            <FormLabel>{t('farmers.field.farmerCode')}</FormLabel>
            <span className="text-[12px] text-muted-foreground">
              {t('farmers.field.farmerCodeHint')}
            </span>
          </div>
          <FormControl>
            {isEdit ? (
              // Edit: the code is the immutable PK — disabled so the UI
              // doesn't imply it can change (changing it would orphan FKs).
              <Input
                {...field}
                value={field.value ?? ''}
                disabled
                readOnly
                className="disabled:cursor-not-allowed disabled:bg-muted/50 disabled:opacity-100"
              />
            ) : (
              // Create: the coop prefix (`SNK-`) is a locked leading addon;
              // the input holds ONLY the serial, so the prefix can't be
              // edited or deleted. Full value stays `${prefix}${serial}`.
              <div className="flex">
                <span className="inline-flex select-none items-center rounded-l-md border border-input border-r-0 bg-muted px-3 text-muted-foreground text-sm">
                  {codePrefix}
                </span>
                <Input
                  value={
                    field.value?.startsWith(codePrefix)
                      ? field.value.slice(codePrefix.length)
                      : (field.value ?? '')
                  }
                  onChange={(e) => field.onChange(`${codePrefix}${e.target.value}`)}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  name={field.name}
                  placeholder="0001"
                  className="rounded-l-none"
                />
              </div>
            )}
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const fStartDate = (
    <FormField
      control={form.control}
      name="registrationDate"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('farmers.field.registrationDate')}</FormLabel>
          <FormControl>
            <Input
              type="date"
              min={MIN_DATE}
              max={TODAY_STR}
              value={field.value ?? ''}
              onChange={(e) => field.onChange(e.target.value || null)}
              onBlur={field.onBlur}
              ref={field.ref}
              name={field.name}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const fFirstName = (
    <FormField
      control={form.control}
      name="firstName"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('farmers.field.firstName')}</FormLabel>
          <FormControl>
            <Input {...field} value={field.value ?? ''} placeholder="Enter first name" />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const fLastName = (
    <FormField
      control={form.control}
      name="lastName"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('farmers.field.lastName')}</FormLabel>
          <FormControl>
            <Input {...field} value={field.value ?? ''} placeholder="Enter last name" />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const fOtherNames = (
    <FormField
      control={form.control}
      name="otherNames"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('farmers.field.otherNames')}</FormLabel>
          <FormControl>
            <Input
              value={field.value ?? ''}
              onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
              onBlur={field.onBlur}
              ref={field.ref}
              name={field.name}
              placeholder="Enter other names"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const fSex = (
    <FormField
      control={form.control}
      name="sex"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('farmers.field.gender')}</FormLabel>
          <FormControl>
            <Select
              value={field.value || undefined}
              onValueChange={(v) => field.onChange(v ? (v as FarmerFormValues['sex']) : undefined)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select gender" />
              </SelectTrigger>
              <SelectContent>
                {SEX_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const fDob = (
    <FormField
      control={form.control}
      name="dateOfBirth"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('farmers.field.dateOfBirth')}</FormLabel>
          <FormControl>
            <Input
              type="date"
              min={MIN_DATE}
              max={TODAY_STR}
              value={field.value ?? ''}
              onChange={(e) => field.onChange(e.target.value || null)}
              onBlur={field.onBlur}
              ref={field.ref}
              name={field.name}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const fIdType = (
    <FormField
      control={form.control}
      name="nationalIdType"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('farmers.field.idType')}</FormLabel>
          <FormControl>
            <Select
              value={field.value || undefined}
              onValueChange={(v) => field.onChange(v || null)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select ID type" />
              </SelectTrigger>
              <SelectContent>
                {ID_TYPES.map((idt) => (
                  <SelectItem key={idt} value={idt}>
                    {t(`farmers.nationalIdType.${idt}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const fIdNumber = (
    <FormField
      control={form.control}
      name="nationalIdNumber"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('farmers.field.idNumber')}</FormLabel>
          <FormControl>
            <Input
              value={field.value ?? ''}
              onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
              onBlur={field.onBlur}
              ref={field.ref}
              name={field.name}
              placeholder="Enter ID number"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const fPhone = (
    <FormField
      control={form.control}
      name="phoneNumber"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('farmers.field.phone')}</FormLabel>
          <FormControl>
            <Input
              value={field.value ?? ''}
              onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
              onBlur={field.onBlur}
              ref={field.ref}
              name={field.name}
              placeholder="e.g. 0241234567"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  // District is derived from the active cooperative, not a farmer column —
  // plain read-only text (label + value), never a disabled input.
  const districtLabel = (
    <div className="flex flex-col gap-2">
      <Label className="text-muted-foreground">{t('farmers.table.district')}</Label>
      <p className="flex h-9 items-center text-sm">
        {districtDisplay || (
          <span className="text-muted-foreground">{t('farmers.stats.noData')}</span>
        )}
      </p>
    </div>
  );

  const fSociety = (
    <FormField
      control={form.control}
      name="society"
      render={({ field }) => {
        // Include the current value even if it isn't in the coop facet
        // (editing a farmer whose society has no other members) so it shows.
        const options =
          field.value && !societyOptions.includes(field.value)
            ? sortSocieties([...societyOptions, field.value])
            : societyOptions;
        return (
          <FormItem>
            <FormLabel>{t('farmers.field.society')}</FormLabel>
            <FormControl>
              <Select
                value={field.value || undefined}
                onValueChange={(v) => field.onChange(v === SOCIETY_NONE ? null : v || null)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('farmers.field.societyPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SOCIETY_NONE}>{t('farmers.field.societyNone')}</SelectItem>
                  {options.map((s) => (
                    <SelectItem key={s} value={s}>
                      {formatSociety(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormControl>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );

  const fCert = (
    <FormField
      control={form.control}
      name="certificationStatus"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('farmers.field.certificationStatus')}</FormLabel>
          <FormControl>
            <Select
              value={field.value || 'unknown'}
              onValueChange={(v) => field.onChange(v ?? 'unknown')}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {CERT_OPTIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`farmers.certification.${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const fConsent = (
    <FormField
      control={form.control}
      name="dataCollectionConsent"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('farmers.field.dataCollectionConsent')}</FormLabel>
          <FormControl>
            <Select
              value={consentToString(field.value)}
              onValueChange={(v) => field.onChange(stringToConsent(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select consent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">{t('farmers.consent.yes')}</SelectItem>
                <SelectItem value="false">{t('farmers.consent.no')}</SelectItem>
                <SelectItem value="unknown">{t('farmers.consent.unknown')}</SelectItem>
              </SelectContent>
            </Select>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const fHousehold = (
    <FormField
      control={form.control}
      name="householdSize"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('farmers.field.householdSize')}</FormLabel>
          <FormControl>
            <Input
              type="number"
              min={0}
              value={field.value ?? ''}
              onChange={(e) => {
                const raw = e.target.value;
                field.onChange(raw === '' ? null : Number(raw));
              }}
              onBlur={field.onBlur}
              ref={field.ref}
              name={field.name}
              placeholder="e.g. 5"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const fChildren = (
    <FormField
      control={form.control}
      name="childrenCount"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('farmers.field.childrenCount')}</FormLabel>
          <FormControl>
            <Input
              type="number"
              min={0}
              value={field.value ?? ''}
              onChange={(e) => {
                const raw = e.target.value;
                field.onChange(raw === '' ? null : Number(raw));
              }}
              onBlur={field.onBlur}
              ref={field.ref}
              name={field.name}
              placeholder="e.g. 3"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Fixed 480px matches the Pencil artboard; avoids the default
          sm:max-w-2xl (672px) which was too wide for a two-col form. */}
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <h3 className="font-semibold text-lg">
            {t(isEdit ? 'farmers.dialog.editTitle' : 'farmers.dialog.createTitle')}
          </h3>
          <p className="text-muted-foreground text-sm">
            {t(isEdit ? 'farmers.dialog.editDescription' : 'farmers.dialog.createDescription')}
          </p>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={handleSubmit} className="flex flex-col">
            {/* `pt-4` was redundant with DialogContent's `gap-4`,
                stacking ~32 px of dead space above the first field;
                drop it. Inner grid tightened from `gap-4` → `gap-3`
                so rows sit closer without losing the two-column
                rhythm. */}
            <DialogBody>
              <div className="flex flex-col gap-4">
                <section className="flex flex-col gap-2">
                  <SectionHeading icon={User}>{t('farmers.section.identity')}</SectionHeading>
                  <div className="grid grid-cols-2 items-start gap-x-3 gap-y-2">
                    <div className="col-span-2">{fCode}</div>
                    {fFirstName}
                    {fLastName}
                    {fOtherNames}
                    {fSex}
                    {fDob}
                    {fStartDate}
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <SectionHeading icon={Phone}>{t('farmers.section.contact')}</SectionHeading>
                  <div className="grid grid-cols-2 items-start gap-x-3 gap-y-2">
                    {fPhone}
                    {fIdType}
                    {fIdNumber}
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <SectionHeading icon={MapPin}>{t('farmers.section.location')}</SectionHeading>
                  <div className="grid grid-cols-2 items-start gap-x-3 gap-y-2">
                    {coopLabel}
                    {districtLabel}
                    {fSociety}
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <SectionHeading icon={Award}>{t('farmers.section.certification')}</SectionHeading>
                  <div className="grid grid-cols-2 items-start gap-x-3 gap-y-2">
                    {fCert}
                    {fConsent}
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <SectionHeading icon={Users}>{t('farmers.section.household')}</SectionHeading>
                  <div className="grid grid-cols-2 items-start gap-x-3 gap-y-2">
                    {fHousehold}
                    {fChildren}
                  </div>
                </section>
              </div>
            </DialogBody>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                {t('farmers.dialog.cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? t('farmers.dialog.submitting')
                  : t(isEdit ? 'farmers.dialog.editSubmit' : 'farmers.dialog.createSubmit')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
