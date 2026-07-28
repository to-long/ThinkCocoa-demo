/**
 * Create / edit cooperative dialog — matches Pencil `xMuvH` (Add) and
 * `sraqp` (Update). Single-column form with five fields:
 *
 *   1. Cooperative Name    (text input)
 *   2. District             (select — known Ghana cocoa districts)
 *   3. Coop Chair           (select — users with the cooperative_chair role)
 *   4. Description          (text input, optional)
 *   5. Address              (text input, optional)
 *
 * Plus an `Active` checkbox below the fields.
 *
 * Notable simplifications vs the previous version:
 *   • `code` is no longer user-input — derived from name on create
 *     and held constant on edit (BE doesn't allow code edits anyway).
 *   • `district_code` + `district_name` collapse into one dropdown:
 *     the option carries both, both get sent.
 *   • `contact_email` / `contact_phone` removed from the dialog. BE
 *     still accepts them on PATCH; we just don't expose them here.
 *     Existing values survive an edit because we don't pass those
 *     keys in the payload (PATCH does field-level merge).
 */

import { zodResolver } from '@hookform/resolvers/zod';
import {
  COOPERATIVE_FORM_NO_SELECTION,
  type CooperativeFormInput,
  type CreateCooperativeInput,
  cooperativeFormSchema,
  type UpdateCooperativeInput,
} from '@thinkcocoa/shared';
import { getApiUsers } from '@thinkcocoa/shared/think-cocoa-client';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { ErrorBanner } from '@/components/ui/error-banner';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { type ApiCooperative, useApiErrorMessage } from '@/shared/api';
import { unwrap } from '@/shared/api/fetcher';

interface CooperativeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateCooperativeInput | UpdateCooperativeInput) => Promise<void>;
  /** When provided the dialog is in edit mode. */
  initialData?: ApiCooperative;
}

// UI sentinels for "no selection" — defined in shared so the form
// schema can accept them without loosening rules locally. Per
// `CLAUDE.md` → "Validators".
const NO_CHAIR = COOPERATIVE_FORM_NO_SELECTION;
const NO_DISTRICT = COOPERATIVE_FORM_NO_SELECTION;

/**
 * Curated set of Ghana cocoa districts the dialog offers in the
 * District dropdown. Keyed by `code` so we can store both the
 * (code, name) pair the BE expects from a single selection.
 *
 * Edit mode tolerates legacy / out-of-list values: if the loaded
 * cooperative has a districtCode that's not in this set, the option
 * is appended dynamically so the user doesn't lose the existing tag.
 */
const DISTRICTS: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'WZ-01', name: 'Western Zone' },
  { code: 'CZ-02', name: 'Central Zone' },
  { code: 'EZ-03', name: 'Eastern Zone' },
  { code: 'SZ-04', name: 'Southern Zone' },
];

const EMPTY_FORM: CooperativeFormInput = {
  name: '',
  description: '',
  districtCode: NO_DISTRICT,
  districtName: null,
  chairUserId: NO_CHAIR,
  address: '',
};

interface ChairCandidate {
  id: string;
  name: string;
  email: string;
}

function useChairCandidates(enabled: boolean) {
  return useSWR<ChairCandidate[]>(
    enabled ? ['/api/users', { roleCode: 'cooperative_chair' }] : null,
    async () => {
      const res = await getApiUsers({
        query: { roleCode: 'cooperative_chair', pageSize: '100' },
      });
      const data = unwrap(res) as {
        items: { id: string; fullName: string; email: string }[];
      };
      return data.items.map((u) => ({
        id: u.id,
        name: u.fullName,
        email: u.email,
      }));
    },
    { revalidateOnFocus: false },
  );
}

/** Convert a user-typed cooperative name to a backend-acceptable code.
 *  BE regex requires `^[A-Z][A-Z0-9_]*$` so we uppercase, replace any
 *  whitespace with `_`, drop everything else. */
function deriveCode(name: string): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_]/g, '');
  // Code must start with a letter — if the slug accidentally starts
  // with a digit / underscore, prefix `C_` so the regex passes.
  return /^[A-Z]/.test(slug) ? slug : slug ? `C_${slug}` : '';
}

export function CooperativeDialog({
  open,
  onOpenChange,
  onSubmit,
  initialData,
}: CooperativeDialogProps) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const getErrorMessage = useApiErrorMessage();
  const isEdit = !!initialData;

  const [error, setError] = useState<string | null>(null);

  const form = useForm<CooperativeFormInput>({
    resolver: zodResolver(cooperativeFormSchema),
    defaultValues: EMPTY_FORM,
  });

  const { data: chairs } = useChairCandidates(open);

  // Reset / hydrate on open transitions.
  useEffect(() => {
    if (!open) {
      setError(null);
      return;
    }
    if (initialData) {
      form.reset({
        name: initialData.name,
        description: initialData.description ?? '',
        districtCode: initialData.districtCode ?? NO_DISTRICT,
        districtName: initialData.districtName ?? null,
        chairUserId: initialData.chairUserId ?? NO_CHAIR,
        address: initialData.address ?? '',
      });
    } else {
      form.reset(EMPTY_FORM);
    }
    setError(null);
  }, [open, initialData, form]);

  /** District options = curated set + (in edit mode) any legacy value
   *  the loaded cooperative still references, so existing data isn't
   *  silently lost when the user opens the dialog. */
  const districtOptions = useMemo(() => {
    const out = [...DISTRICTS];
    if (initialData?.districtCode && !DISTRICTS.some((d) => d.code === initialData.districtCode)) {
      out.push({
        code: initialData.districtCode,
        name: initialData.districtName ?? initialData.districtCode,
      });
    }
    return out;
  }, [initialData]);

  const handleValid = async (data: CooperativeFormInput) => {
    setError(null);

    const district =
      data.districtCode === NO_DISTRICT
        ? null
        : (districtOptions.find((d) => d.code === data.districtCode) ?? null);

    // PATCH does field-level merge on the BE — we deliberately omit
    // `contactEmail` / `contactPhone` so existing values survive an
    // edit. On create those fields stay null until an admin populates
    // them via the detail page (out of scope for this dialog).
    const payload: CreateCooperativeInput & UpdateCooperativeInput = {
      // Edit mode: code is read-only on the BE — pass the existing
      // value so PATCH validation is happy. Create: derive from name.
      code: isEdit ? initialData!.code : deriveCode(data.name),
      name: data.name.trim(),
      description: data.description?.trim() || null,
      districtCode: district?.code ?? null,
      districtName: district?.name ?? null,
      chairUserId: data.chairUserId === NO_CHAIR ? null : data.chairUserId,
      address: data.address?.trim() || null,
    };

    try {
      await onSubmit(payload);
      onOpenChange(false);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const isSubmitting = form.formState.isSubmitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <h3 className="font-semibold text-lg">
            {t(isEdit ? 'cooperatives.dialog.editTitle' : 'cooperatives.dialog.createTitle')}
          </h3>
          <p className="text-muted-foreground text-sm">
            {t(
              isEdit
                ? 'cooperatives.dialog.editDescription'
                : 'cooperatives.dialog.createDescription',
            )}
          </p>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleValid)} className="flex min-h-0 flex-1 flex-col">
            <DialogBody className="pt-4">
              <div className="flex flex-col gap-4">
                {error && <ErrorBanner message={error} />}

                {/* 1. Cooperative Name */}
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('cooperatives.field.name')}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder={t('cooperatives.field.namePlaceholder')} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* 2. District */}
                <FormField
                  control={form.control}
                  name="districtCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('cooperatives.field.district')}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue
                              placeholder={t('cooperatives.field.districtPlaceholder')}
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {districtOptions.map((d) => (
                            <SelectItem key={d.code} value={d.code}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* 3. Coop Chair */}
                <FormField
                  control={form.control}
                  name="chairUserId"
                  render={({ field }) => {
                    // Trigger shows ONLY the name — Radix's default
                    // SelectValue mirrors the SelectItem's full children
                    // (name + email span), which overflowed the trigger
                    // and pushed the start of the name out of view.
                    // Email still appears in the dropdown options where
                    // there's room for it.
                    const selected = (chairs ?? []).find((u) => u.id === field.value);
                    return (
                      <FormItem>
                        <FormLabel>{t('cooperatives.field.chair')}</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder={t('cooperatives.field.chairPlaceholder')}>
                                <span className="block truncate">
                                  {field.value === NO_CHAIR || !selected
                                    ? t('cooperatives.field.chairNone')
                                    : selected.name}
                                </span>
                              </SelectValue>
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={NO_CHAIR}>
                              {t('cooperatives.field.chairNone')}
                            </SelectItem>
                            {(chairs ?? []).map((u) => (
                              <SelectItem key={u.id} value={u.id}>
                                <span className="flex min-w-0 items-baseline gap-1">
                                  <span className="truncate">{u.name}</span>
                                  <span className="shrink-0 text-muted-foreground text-[11px]">
                                    ({u.email})
                                  </span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />

                {/* 4. Description — multi-line: cooperative profiles
                     often run a paragraph (history, focus areas). */}
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('cooperatives.field.description')}</FormLabel>
                      <FormControl>
                        <textarea
                          {...field}
                          value={field.value ?? ''}
                          rows={3}
                          placeholder={t('cooperatives.field.descriptionPlaceholder')}
                          className="flex min-h-[72px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* 5. Address — multi-line: full street + district +
                     region addresses don't fit in one row. */}
                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('cooperatives.field.address')}</FormLabel>
                      <FormControl>
                        <textarea
                          {...field}
                          value={field.value ?? ''}
                          rows={2}
                          placeholder={t('cooperatives.field.addressPlaceholder')}
                          className="flex min-h-[56px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
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
                {t('cooperatives.dialog.cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? t('cooperatives.dialog.submitting')
                  : t(
                      isEdit
                        ? 'cooperatives.dialog.editSubmit'
                        : 'cooperatives.dialog.createSubmit',
                    )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
