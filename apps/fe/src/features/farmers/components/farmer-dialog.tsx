/**
 * Create / edit farmer dialog.
 *
 * Field order follows the Pencil design (`ZW4py` create, `nxyaM` update);
 * the pairing is ours — see the note under the list:
 *
 *   1.  Farmer Code + Cooperative   ← coop moves to row 8 in edit mode
 *   2.  Start Date (create) + First Name
 *   3.  Last Name + Other Names
 *   4.  Gender + Date of Birth
 *   5.  ID Type + ID Number
 *   6.  Phone + District (read-only, derived from cooperative)
 *   7.  Society + Certificate Status
 *   8.  Data Collection Consent + Household Size
 *   9.  Children Count
 *
 * Nothing spans the full grid width — every field pairs up, which is what
 * keeps the dialog inside a laptop viewport instead of scrolling. Rows are
 * a consequence of that flow, not fixed slots.
 *
 * Farmers are always active — there is no `isActive` control here and no
 * other writer for the column, so it keeps its `true` DB default.
 *
 * Cooperative sits at the very top in the create dialog so admins pick it
 * *before* the farmer code (which must be unique within a coop); in edit
 * mode Cooperative + Start Date drop to just-above-certification because
 * those fields are rarely changed post-creation.
 *
 * District is not an independent farmer field — it's derived from the
 * selected cooperative's `districtName`. We render it as a disabled read-
 * only input so the shape matches the design without introducing a phantom
 * column on the domain model.
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

import {
  type CreateFarmerInput,
  createFarmerSchema,
  type UpdateFarmerInput,
  updateFarmerSchema,
} from '@thinkcocoa/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo } from 'react';
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
import type { ApiFarmer } from '@/shared/api';
import { useCooperativesList } from '@/shared/api';

interface FarmerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateFarmerInput | UpdateFarmerInput) => void | Promise<void>;
  /** When provided, dialog is in edit mode. */
  initialData?: ApiFarmer;
}

// Only value actually present in the data (parser + CSV seed both write
// `'ghana_card'`; DB column is freeform text with no other values).
// Label comes from intl via `farmers.nationalIdType.ghana_card`.
const ID_TYPES = ['ghana_card'] as const;
const SEX_OPTIONS = ['male', 'female', 'other', 'unknown'] as const;
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

export function FarmerDialog({ open, onOpenChange, onSubmit, initialData }: FarmerDialogProps) {
  const intl = useIntl();
  const isEdit = !!initialData;

  const { data: cooperatives } = useCooperativesList(open);

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

  // Reset / seed form on open transitions. Editing: hydrate all fields;
  // create: leave empty but default cooperative to the first one (most
  // admins only have one anyway).
  useEffect(() => {
    if (!open) return;
    if (initialData) {
      form.reset(fromInitial(initialData));
    } else {
      form.reset(emptyDefaults);
    }
  }, [open, initialData, form]);

  // Default cooperative when creating: first one in the SWR payload.
  // Subscribed via watch so we only patch once a cooperative actually shows
  // up in the list; otherwise an empty default would clobber a manual pick.
  const cooperativeId = form.watch('cooperativeId');
  useEffect(() => {
    if (isEdit || !open) return;
    if (!cooperativeId && cooperatives && cooperatives.length > 0) {
      form.setValue('cooperativeId', cooperatives[0]!.id);
    }
  }, [isEdit, open, cooperativeId, cooperatives, form]);

  // District is derived from the currently-selected cooperative. The field
  // renders as disabled so users can see the value without editing it.
  const selectedCoop = useMemo(
    () => cooperatives?.find((c) => c.id === cooperativeId),
    [cooperatives, cooperativeId],
  );
  const districtDisplay = selectedCoop?.districtName ?? '';

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

  // ── Row fragments (extracted so create/edit can reorder without dup) ──

  const cooperativeAndStartDateRow = (
    <>
      <FormField
        control={form.control}
        name="cooperativeId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('farmers.field.cooperative')}</FormLabel>
            <FormControl>
              <Select
                value={field.value || undefined}
                onValueChange={(v) => field.onChange(v ?? '')}
                disabled={isEdit}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('farmers.filters.allCooperatives')} />
                </SelectTrigger>
                <SelectContent>
                  {(cooperatives ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="registrationDate"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('farmers.field.registrationDate')}</FormLabel>
            <FormControl>
              <Input
                type="date"
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
    </>
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
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            {/* `pt-4` was redundant with DialogContent's `gap-4`,
                stacking ~32 px of dead space above the first field;
                drop it. Inner grid tightened from `gap-4` → `gap-3`
                so rows sit closer without losing the two-column
                rhythm. */}
            <DialogBody>
              {/* `items-start` (= align-items: flex-start) on the
                  grid keeps each cell at its NATURAL height instead
                  of stretching to the row's tallest cell. When one
                  field shows a validation error and the adjacent
                  field doesn't, both inputs stay pinned to their
                  cell's top baseline — no perceived misalignment.
                  The row itself still grows to fit the tallest cell;
                  shorter cells just don't get extra whitespace
                  below their input. */}
              <div className="grid grid-cols-2 items-start gap-x-3 gap-y-2">
                {/* Row 1 — Farmer Code + Cooperative. Hint sits *under the
                    label* (gap-0.5), not under the input, to match Pencil. */}
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
                        {/* In edit mode, ID is the PK and immutable —
                            changing it would orphan every FK ref
                            (parcels, inspections, …). The BE
                            updateFarmer service ignores `farmerCode`
                            in the input shape, but disable the input
                            here too so the UI doesn't lie. */}
                        <Input
                          {...field}
                          value={field.value ?? ''}
                          placeholder="Enter farmer code"
                          disabled={isEdit}
                          readOnly={isEdit}
                          className={
                            isEdit
                              ? 'disabled:cursor-not-allowed disabled:opacity-100 disabled:bg-muted/50'
                              : undefined
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Row 2 — Cooperative + Start Date (create only). Hidden in
                    edit mode; same row appears again right before the
                    certification row so the edit flow matches Pencil's
                    `nxyaM` design. */}
                {!isEdit && cooperativeAndStartDateRow}

                {/* Row 3 — First + Last name */}
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('farmers.field.firstName')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ''}
                          placeholder="Enter first name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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

                {/* Row 4 — Other Names (pairs with whatever precedes it) */}
                <FormField
                  control={form.control}
                  name="otherNames"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('farmers.field.otherNames')}</FormLabel>
                      <FormControl>
                        <Input
                          value={field.value ?? ''}
                          onChange={(e) =>
                            field.onChange(e.target.value === '' ? null : e.target.value)
                          }
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

                {/* Row 5 — Gender + DOB */}
                <FormField
                  control={form.control}
                  name="sex"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('farmers.field.gender')}</FormLabel>
                      <FormControl>
                        <Select
                          value={field.value || undefined}
                          onValueChange={(v) =>
                            field.onChange(v ? (v as FarmerFormValues['sex']) : undefined)
                          }
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
                <FormField
                  control={form.control}
                  name="dateOfBirth"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('farmers.field.dateOfBirth')}</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
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

                {/* Row 6 — ID Type + ID Number */}
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
                <FormField
                  control={form.control}
                  name="nationalIdNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('farmers.field.idNumber')}</FormLabel>
                      <FormControl>
                        <Input
                          value={field.value ?? ''}
                          onChange={(e) =>
                            field.onChange(e.target.value === '' ? null : e.target.value)
                          }
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

                {/* Row 7 — Phone + Village */}
                <FormField
                  control={form.control}
                  name="phoneNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('farmers.field.phone')}</FormLabel>
                      <FormControl>
                        <Input
                          value={field.value ?? ''}
                          onChange={(e) =>
                            field.onChange(e.target.value === '' ? null : e.target.value)
                          }
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
                {/* Row 8 — District (read-only, derived) + Society. The
                    district is a property of the cooperative — we expose it
                    here so the form matches Pencil but mark it disabled so
                    users know it isn't an editable farmer column. */}
                <div className="flex flex-col gap-2">
                  <Label>{t('farmers.table.district')}</Label>
                  <Input
                    value={districtDisplay}
                    placeholder={t('farmers.stats.noData')}
                    disabled
                    readOnly
                  />
                </div>
                <FormField
                  control={form.control}
                  name="society"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('farmers.field.society')}</FormLabel>
                      <FormControl>
                        <Input
                          value={field.value ?? ''}
                          onChange={(e) =>
                            field.onChange(e.target.value === '' ? null : e.target.value)
                          }
                          onBlur={field.onBlur}
                          ref={field.ref}
                          name={field.name}
                          placeholder="Enter society"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Row 8.5 (edit only) — Cooperative + Start Date. Placed
                    just above Certificate Status to mirror `nxyaM`. */}
                {isEdit && cooperativeAndStartDateRow}

                {/* Row 9 — Certificate Status + Data Collection Consent */}
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

                {/* Row 10 — Household Size + Children Number. Number inputs
                    coerce empty → null so we don't fail the integer
                    validator with NaN; the schema also allows null. */}
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
