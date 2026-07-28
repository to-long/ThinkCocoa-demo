import { zodResolver } from '@hookform/resolvers/zod';
import { createRoleFormSchema, updateRoleFormSchema } from '@thinkcocoa/shared';
import { useEffect, useMemo, useRef } from 'react';
import { Controller, type Resolver, useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
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
import type { PermissionGroup } from '@/components/ui/permission-list';
import { PermissionList } from '@/components/ui/permission-list';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useRoleDialogCatalog } from '@/shared/api';
import {
  actionIcon,
  actionSort,
  formatResourceLabel,
  resourceIcon,
  resourceSort,
} from '../../lib/permission-icons';

// Both modes use the SHARED form schemas — never extended locally
// (see CLAUDE.md → "Validators"). Permissions sit on top of the
// update form even though the BE PATCHes them via `setRolePermissions`
// separately — bundling here lets one zodResolver run cover the whole
// dialog.
const createSchema = createRoleFormSchema;
const updateSchema = updateRoleFormSchema;

type CreateInput = z.infer<typeof createSchema>;
type UpdateInput = z.infer<typeof updateSchema>;
type FormValues = CreateInput & Partial<UpdateInput>;

const createDefaults: FormValues = {
  code: '',
  name: '',
  description: '',
  permissionCodes: [],
};

// Lower-case + collapse non-[a-z0-9_] runs to underscores. Mirrors the
// BE regex `^[a-z_][a-z0-9_]*$` — digits are allowed but never as the
// first character, so any leading digit run is stripped along with
// other separator runs.
function deriveCode(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^[_0-9]+|_+$/g, '');
}

interface RoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (role: {
    code?: string;
    name: string;
    description: string;
    permissions: string[];
  }) => void | Promise<void>;
  /** When provided, dialog is in edit mode */
  initialData?: {
    /** Immutable on update — shown read-only so admins can still see
     *  the canonical code. The BE update schema doesn't accept it. */
    code: string;
    name: string;
    description: string;
    permissions: string[];
  };
}

export function RoleDialog({ open, onOpenChange, onSubmit, initialData }: RoleDialogProps) {
  const intl = useIntl();

  const isEdit = !!initialData;

  // Catalog fetches lazily on first open; cached across opens (SWR).
  // No loading UI — picker renders empty groups briefly, then fills in.
  const { data: permissions } = useRoleDialogCatalog(open);
  const permissionGroups = useMemo<PermissionGroup[]>(() => {
    // Group permissions by the `resource` prefix of their `resource:action`
    // code. The `id` is the permission CODE (not the UUID) so submit sends
    // codes straight to the SetRolePermissions endpoint.
    const byResource = new Map<
      string,
      { id: string; action: string; label: string; icon: ReturnType<typeof actionIcon> }[]
    >();
    for (const p of permissions ?? []) {
      const [resource = 'other', action = p.code] = p.code.split(':');
      const bucket = byResource.get(resource) ?? [];
      bucket.push({ id: p.code, action, label: p.name || action, icon: actionIcon(action) });
      byResource.set(resource, bucket);
    }
    return (
      Array.from(byResource.entries())
        .map(([key, items]) => ({
          key,
          label: formatResourceLabel(key),
          icon: resourceIcon(key),
          // Actions in CRUD-first order (create → read → update → delete
          // → rest), matching the Permissions list + sidebar.
          items: [...items].sort((a, b) => actionSort(a.action, b.action)),
        }))
        // Same icons + order as the sidebar menu / Permissions list.
        .sort((a, b) => resourceSort(a.key, b.key))
    );
  }, [permissions]);

  // Pick the schema that matches the operation: create requires `code`
  // (the BE rejects bodies without it), update never accepts it.
  // Casting through `unknown` because the two zod inputs have slightly
  // different shapes — RHF only needs ONE FormValues at a time and the
  // resolver enforces the right one at runtime.
  const resolver = (isEdit
    ? zodResolver(updateSchema)
    : zodResolver(createSchema)) as unknown as Resolver<FormValues>;

  const form = useForm<FormValues>({
    resolver,
    defaultValues: createDefaults,
    mode: 'onSubmit',
  });

  // Track whether the user has manually touched the code field. While
  // untouched, derive code from the name automatically — same UX as a
  // slug field on a CMS. Once they edit the code by hand, stop
  // overwriting it.
  const codeManuallyEditedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      form.reset(createDefaults);
      codeManuallyEditedRef.current = false;
    } else if (initialData) {
      form.reset({
        // Code field is read-only in edit mode UI but still part of
        // form state — `updateRoleFormSchema` validates it via
        // `roleCodeSchema` (min(1) + regex), so leaving it blank
        // would fail submit silently. Seed with the existing code so
        // validation passes; the submit handler still strips it
        // before PATCH because the BE update schema doesn't accept
        // it.
        code: initialData.code,
        name: initialData.name,
        description: initialData.description,
        permissionCodes: initialData.permissions,
      });
      // Edit mode never auto-derives — block the effect below.
      codeManuallyEditedRef.current = true;
    }
  }, [open, initialData, form]);

  const watchedName = form.watch('name');
  useEffect(() => {
    if (isEdit) return;
    if (codeManuallyEditedRef.current) return;
    form.setValue('code', deriveCode(watchedName ?? ''), {
      shouldValidate: false,
      shouldDirty: false,
    });
  }, [watchedName, isEdit, form]);

  const handleSubmit = form.handleSubmit(async (values) => {
    await onSubmit({
      code: isEdit ? undefined : values.code,
      name: values.name.trim(),
      description: (values.description ?? '').trim(),
      permissions: values.permissionCodes ?? [],
    });
  });

  const isSubmitting = form.formState.isSubmitting;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle className="text-lg">
            {isEdit
              ? intl.formatMessage({ id: 'roles.createDialog.editTitle' })
              : intl.formatMessage({ id: 'roles.createDialog.title' })}
          </SheetTitle>
          <SheetDescription>
            {isEdit
              ? intl.formatMessage({
                  id: 'roles.createDialog.editDescription',
                })
              : intl.formatMessage({ id: 'roles.createDialog.description' })}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            {/* No top padding on the scroll container: `position: sticky`
                sticks below the container's top padding, which would leave
                a gap where earlier rows peek above the stuck group header.
                The first field gets its breathing room from the inner
                wrapper's `pt-6` instead (that padding scrolls, so it
                doesn't shift the sticky offset). */}
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              <div className="flex flex-col gap-5 pt-6">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{intl.formatMessage({ id: 'roles.createDialog.name' })}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ''}
                          placeholder={intl.formatMessage({
                            id: 'roles.createDialog.namePlaceholder',
                          })}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Code field — editable on create (auto-derives from
                    name until the user hand-edits it), read-only on
                    update (BE update schema doesn't accept code; it's
                    an immutable identity like a username, but admins
                    still want to SEE it). */}
                {isEdit ? (
                  <FormItem>
                    <FormLabel>
                      {intl.formatMessage({
                        id: 'roles.createDialog.code',
                      })}
                    </FormLabel>
                    <Input
                      value={initialData?.code ?? ''}
                      disabled
                      readOnly
                      className="font-mono"
                    />
                  </FormItem>
                ) : (
                  <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {intl.formatMessage({
                            id: 'roles.createDialog.code',
                          })}
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value ?? ''}
                            onChange={(e) => {
                              codeManuallyEditedRef.current = true;
                              field.onChange(e);
                            }}
                            placeholder={intl.formatMessage({
                              id: 'roles.createDialog.codePlaceholder',
                            })}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {intl.formatMessage({
                          id: 'roles.createDialog.roleDescription',
                        })}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ''}
                          placeholder={intl.formatMessage({
                            id: 'roles.createDialog.descriptionPlaceholder',
                          })}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Separator />

                <div className="flex flex-col gap-2">
                  <Label>
                    {intl.formatMessage({
                      id: 'roles.createDialog.permissionsTitle',
                    })}
                  </Label>
                  <Controller
                    control={form.control}
                    name="permissionCodes"
                    render={({ field }) => (
                      <PermissionList
                        groups={permissionGroups}
                        value={new Set(field.value ?? [])}
                        onChange={(set) => field.onChange([...set])}
                        selectAllLabel={intl.formatMessage({
                          id: 'roles.createDialog.selectAll',
                        })}
                        deselectAllLabel={intl.formatMessage({
                          id: 'roles.createDialog.deselectAll',
                        })}
                      />
                    )}
                  />
                </div>
              </div>
            </div>

            <SheetFooter className="flex-row justify-end gap-2 border-t px-6 py-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {intl.formatMessage({ id: 'roles.createDialog.cancel' })}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? intl.formatMessage({ id: 'roles.createDialog.submitting' })
                  : isEdit
                    ? intl.formatMessage({
                        id: 'roles.createDialog.editSubmit',
                      })
                    : intl.formatMessage({ id: 'roles.createDialog.submit' })}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
