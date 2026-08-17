import { zodResolver } from '@hookform/resolvers/zod';
import {
  createUserFormSchema,
  isOrgWideRole,
  PASSWORD_POLICY_RULES,
  updateUserFormSchema,
} from '@thinkcocoa/shared';
import { Check, Eye, EyeOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, type Resolver, useForm } from 'react-hook-form';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useCooperativesList, useUser, useUserDialogCatalog } from '@/shared/api';
import {
  actionIcon,
  actionLabel,
  actionSort,
  resourceIcon,
  resourceLabel,
  resourceSort,
} from '../../lib/permission-icons';
import type { CreateUserPayload, RoleOption, UpdateUserPayload } from '../../types/users';
import { RolesPermissionsPicker } from './roles-permissions-picker';

interface UserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateUserPayload | UpdateUserPayload) => void | Promise<void>;
  initialData?: {
    id: string;
    name: string;
    email: string;
    /** Role names from the user list — used to match role IDs before detail fetch returns */
    roleNames?: string[];
  };
}

function roleNamesToRoleIds(names: string[] | undefined, options: RoleOption[]): string[] {
  if (!names?.length) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    const r = options.find((o) => o.name === n);
    if (r && !seen.has(r.id)) {
      seen.add(r.id);
      ids.push(r.id);
    }
  }
  return ids;
}

function permissionIdsForRoleIds(roleIds: string[], options: RoleOption[]): string[] {
  const out = new Set<string>();
  for (const id of roleIds) {
    const r = options.find((o) => o.id === id);
    if (r) for (const p of r.permissionIds) out.add(p);
  }
  return [...out];
}

type FormValues = {
  name: string;
  email: string;
  password: string;
  roleIds: string[];
  permissionIds: string[];
  cooperativeIds: string[];
  isAllCooperative: boolean;
};

export function UserDialog({ open, onOpenChange, onSubmit, initialData }: UserDialogProps) {
  const intl = useIntl();

  const isEdit = !!initialData;

  // Catalogs fetch lazily on first open; SWR caches so subsequent opens
  // hit memory (no spinner, picker renders empty briefly, then fills in).
  const { data: catalog } = useUserDialogCatalog(open);

  const roles = useMemo<RoleOption[]>(() => {
    if (!catalog) return [];
    const permIdByCode = new Map(catalog.permissions.map((p) => [p.code, p.id]));
    return catalog.roleDetails.map((r) => ({
      id: r.code,
      name: r.name,
      description: r.description ?? '',
      permissionIds: (r.permissions ?? [])
        .map((c) => permIdByCode.get(c))
        .filter((x): x is string => Boolean(x)),
    }));
  }, [catalog]);

  const permissionGroups = useMemo(() => {
    if (!catalog) return [];
    return (
      catalog.permissionGroups
        .map((g) => ({
          key: g.resource,
          label: resourceLabel(intl, g.resource),
          icon: resourceIcon(g.resource),
          // CRUD-first action order, matching the Permissions list.
          items: [...g.actions]
            .sort((a, b) => actionSort(a.action, b.action))
            .map((a) => ({
              id: a.id,
              label: actionLabel(intl, a.action),
              icon: actionIcon(a.action),
            })),
        }))
        // Same icons + order as the sidebar menu / Permissions list.
        .sort((a, b) => resourceSort(a.key, b.key))
    );
  }, [catalog, intl]);

  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const rolesRef = useRef(roles);
  rolesRef.current = roles;

  const resolver = zodResolver(
    isEdit ? updateUserFormSchema : createUserFormSchema,
  ) as unknown as Resolver<FormValues>;
  const form = useForm<FormValues>({
    resolver,
    defaultValues: {
      name: '',
      email: '',
      password: '',
      roleIds: [],
      permissionIds: [],
      cooperativeIds: [],
      isAllCooperative: false,
    },
    mode: 'onSubmit',
  });

  const passwordValue = form.watch('password') ?? '';

  // When editing, pull the up-to-date role codes from /api/users/:id. The SWR
  // cache dedupes across dialog opens.
  const editingId = isEdit && open ? initialData!.id : null;
  const { data: detail, isLoading: detailLoading } = useUser(editingId);
  const detailReady = !isEdit || (!detailLoading && !!detail);

  useEffect(() => {
    if (!open) {
      form.reset({
        name: '',
        email: '',
        password: '',
        roleIds: [],
        permissionIds: [],
        cooperativeIds: [],
        isAllCooperative: false,
      });
      setShowPassword(false);
      return;
    }

    if (!initialData) return;

    // Initial optimistic selection based on role names from the list row.
    const catalogRoles = rolesRef.current;
    const optimisticRoleIds = roleNamesToRoleIds(initialData.roleNames, catalogRoles);
    const optimisticPermIds = permissionIdsForRoleIds(optimisticRoleIds, catalogRoles);
    form.reset({
      name: initialData.name,
      email: initialData.email,
      password: '',
      roleIds: optimisticRoleIds,
      permissionIds: optimisticPermIds,
      // Coop assignments + flag only land via the detail fetch below
      // — list rows don't carry them.
      cooperativeIds: [],
      isAllCooperative: false,
    });
  }, [open, initialData, form.reset]);

  // When the real detail arrives, sync selections. Depends on `catalog`
  // so that if the catalog races in AFTER the detail fetch resolves, we
  // re-derive permission IDs and the Permissions tab populates correctly
  // on the second render. Without `catalog` in the deps, an
  // out-of-order resolution left the picker stuck at empty.
  useEffect(() => {
    if (!open || !isEdit || !detail) return;
    // `detail.roles` is a list of role codes (matches the `id` used by
    // the list view where id === code). Seed the value directly.
    form.setValue('roleIds', detail.roles, { shouldDirty: false });
    // Prefer `detail.permissions` — the BE already computed the effective
    // union across this user's roles. Fall back to rebuilding from role
    // codes only if the detail response somehow lacks it. Either way,
    // `permissionIdByCode` (from catalog) is needed to map codes → picker IDs.
    if (!catalog) return;
    const permIdByCode = new Map(catalog.permissions.map((p) => [p.code, p.id]));
    const sourceCodes =
      detail.permissions && detail.permissions.length > 0
        ? detail.permissions
        : permissionIdsForRoleIds(detail.roles, roles);
    const pids = sourceCodes
      .map((c) => permIdByCode.get(c) ?? c) // legacy shape already carries IDs
      .filter((x): x is string => Boolean(x));
    form.setValue('permissionIds', pids, { shouldDirty: false });
    form.setValue(
      'cooperativeIds',
      detail.cooperativeAssignments.map((a) => a.cooperativeId),
      { shouldDirty: false },
    );
    form.setValue('isAllCooperative', detail.isAllCooperative, {
      shouldDirty: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEdit, detail, catalog, roles, form.setValue]);

  // Coop catalog for the Scope select. Lazy until dialog opens.
  const { data: allCoops } = useCooperativesList(open);

  // Org-wide role auto-link: flip the dedicated `isAllCooperative`
  // flag based on whether the user holds an admin role. The
  // explicit `cooperativeIds` list is NEVER touched here — the two
  // dimensions are independent so a manual coop pick survives a
  // role flip-flop.
  const watchedRoleIds = form.watch('roleIds') ?? [];
  const hasOrgWideRole = useMemo(
    () => watchedRoleIds.some((code) => isOrgWideRole(code)),
    [watchedRoleIds],
  );
  useEffect(() => {
    if (!open) return;
    const current = form.getValues('isAllCooperative');
    if (current !== hasOrgWideRole) {
      form.setValue('isAllCooperative', hasOrgWideRole, { shouldDirty: true });
    }
  }, [open, hasOrgWideRole, form]);

  const handleValid = async (values: FormValues) => {
    setIsLoading(true);
    try {
      if (isEdit) {
        const payload: UpdateUserPayload = {
          name: values.name.trim(),
          roleIds: values.roleIds ?? [],
          permissionIds: values.permissionIds ?? [],
          cooperativeIds: values.cooperativeIds ?? [],
          isAllCooperative: values.isAllCooperative,
        };
        await onSubmit(payload);
      } else {
        const payload: CreateUserPayload = {
          email: (values.email ?? '').trim(),
          name: values.name.trim(),
          password: values.password ?? '',
          roleIds: values.roleIds ?? [],
          permissionIds: values.permissionIds ?? [],
          cooperativeIds: values.cooperativeIds ?? [],
          isAllCooperative: values.isAllCooperative,
        };
        await onSubmit(payload);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Translate an error key. Supports two patterns:
  //   1. SCREAMING_SNAKE_CASE codes from shared validators
  //      (`EMAIL_TOO_LONG`, `PASSWORD_MIN_LENGTH`, …) → look up
  //      `validator.<CODE>`. This is what shared schemas like
  //      emailSchema / passwordSchema emit.
  //   2. Dotted intl keys (`users.userDialog.validation.passwordPolicy`)
  //      passed by this dialog's local refines → look up directly.
  // Falls back to the raw string if neither matches.
  const VALIDATOR_CODE_RE = /^[A-Z][A-Z0-9_]*$/;
  const tr = (msg?: string) => {
    if (!msg) return undefined;
    const id = VALIDATOR_CODE_RE.test(msg) ? `validator.${msg}` : msg;
    return intl.formatMessage({ id, defaultMessage: msg });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <h3 className="font-semibold text-lg">
            {isEdit
              ? intl.formatMessage({ id: 'users.userDialog.editTitle' })
              : intl.formatMessage({ id: 'users.userDialog.createTitle' })}
          </h3>
          <p className="text-muted-foreground text-sm">
            {isEdit
              ? intl.formatMessage({
                  id: 'users.userDialog.editDescription',
                })
              : intl.formatMessage({
                  id: 'users.userDialog.createDescription',
                })}
          </p>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleValid)} className="flex flex-col">
            <DialogBody className="max-h-[60svh] flex-none">
              <div className="flex flex-col gap-3">
                {/* Email — editable in create mode, read-only in edit
                    mode (better-auth owns the email, swapping it
                    invalidates sessions and is a separate flow). */}
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>
                        {intl.formatMessage({ id: 'users.userDialog.email' })}
                        <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ''}
                          type="email"
                          disabled={isEdit}
                          placeholder={intl.formatMessage({
                            id: 'users.userDialog.emailPlaceholder',
                          })}
                        />
                      </FormControl>
                      {fieldState.error && (
                        <p className="text-destructive text-xs">{tr(fieldState.error.message)}</p>
                      )}
                    </FormItem>
                  )}
                />

                {/* Name (single field — matches BE `name` shape). Char
                    restriction is intentionally loose so admins can
                    include role suffixes / honorifics; max 200 chars
                    enforced by shared `createUserSchema`. */}
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>
                        {intl.formatMessage({
                          id: 'users.userDialog.name',
                        })}
                        <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={intl.formatMessage({
                            id: 'users.userDialog.namePlaceholder',
                          })}
                        />
                      </FormControl>
                      {fieldState.error && (
                        <p className="text-destructive text-xs">{tr(fieldState.error.message)}</p>
                      )}
                    </FormItem>
                  )}
                />

                {/* Password — create only */}
                {!isEdit && (
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field, fieldState }) => (
                      <FormItem>
                        <FormLabel>
                          {intl.formatMessage({
                            id: 'users.userDialog.password',
                          })}
                          <span className="text-destructive">*</span>
                        </FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              {...field}
                              value={field.value ?? ''}
                              type={showPassword ? 'text' : 'password'}
                              placeholder={intl.formatMessage({
                                id: 'users.userDialog.passwordPlaceholder',
                              })}
                              className="pr-10"
                            />
                            <button
                              type="button"
                              className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                              onClick={() => setShowPassword((prev) => !prev)}
                              tabIndex={-1}
                            >
                              {showPassword ? (
                                <EyeOff className="size-4" />
                              ) : (
                                <Eye className="size-4" />
                              )}
                            </button>
                          </div>
                        </FormControl>
                        {fieldState.error && (
                          <p className="text-destructive text-xs">{tr(fieldState.error.message)}</p>
                        )}
                        <div className="flex flex-col gap-1.5 pt-1">
                          <span className="text-muted-foreground text-xs font-medium">
                            {intl.formatMessage({
                              id: 'users.userDialog.passwordPolicy.title',
                            })}
                          </span>
                          {PASSWORD_POLICY_RULES.map((rule) => {
                            const passed = rule.test(passwordValue);
                            return (
                              <div key={rule.key} className="flex items-center gap-2">
                                <Check
                                  className={`size-3.5 ${passed ? 'text-green-500' : 'text-muted-foreground/40'}`}
                                />
                                <span
                                  className={`text-xs ${passed ? 'text-muted-foreground' : 'text-muted-foreground/60'}`}
                                >
                                  {intl.formatMessage({
                                    id: `users.userDialog.passwordPolicy.${rule.key}`,
                                  })}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </FormItem>
                    )}
                  />
                )}

                {/* Scope — which cooperatives this user can access. UI swaps
                    on the `isAllCooperative` flag; the two values stay
                    independent so a manual coop pick survives a role flip. */}
                <FormField
                  control={form.control}
                  name="cooperativeIds"
                  render={({ field }) => {
                    const isAll = form.watch('isAllCooperative');
                    const ids = field.value ?? [];
                    const current = ids[0] ?? '';
                    return (
                      <FormItem>
                        <FormLabel>
                          {intl.formatMessage({
                            id: 'users.userDialog.scope.title',
                          })}
                          <span className="text-destructive">*</span>
                        </FormLabel>
                        {isAll ? (
                          <div
                            data-slot="scope-all"
                            className="flex h-9 w-full items-center rounded-md bg-muted px-3 text-sm text-muted-foreground"
                          >
                            {intl.formatMessage({
                              id: 'users.userDialog.scope.allOption',
                            })}
                          </div>
                        ) : (
                          <FormControl>
                            <Select
                              value={current}
                              onValueChange={(next) => field.onChange(next ? [next] : [])}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue
                                  placeholder={intl.formatMessage({
                                    id: 'users.userDialog.scope.placeholder',
                                  })}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {(allCoops ?? []).map((c) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    {c.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                        )}
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />

                <Controller
                  control={form.control}
                  name="roleIds"
                  render={({ field: roleField }) => (
                    <Controller
                      control={form.control}
                      name="permissionIds"
                      render={({ field: permField }) => {
                        const selectedRoles = new Set(roleField.value ?? []);
                        const selectedPermissions = new Set(permField.value ?? []);
                        const toggleRole = (roleId: string) => {
                          const next = new Set(selectedRoles);
                          if (next.has(roleId)) next.delete(roleId);
                          else next.add(roleId);
                          roleField.onChange([...next]);
                        };
                        const onPermissionsChange = (next: Set<string>) => {
                          permField.onChange([...next]);
                        };
                        return (
                          <div
                            className={cn(
                              'transition-opacity duration-150',
                              isEdit && !detailReady && 'pointer-events-none opacity-60',
                            )}
                          >
                            <RolesPermissionsPicker
                              key={`${open}-${isEdit && initialData ? initialData.id : 'create'}`}
                              roles={roles}
                              permissionGroups={permissionGroups}
                              selectedRoles={selectedRoles}
                              onToggleRole={toggleRole}
                              selectedPermissions={selectedPermissions}
                              onPermissionsChange={onPermissionsChange}
                              roleSyncLocked={isEdit && !detailReady}
                            />
                          </div>
                        );
                      }}
                    />
                  )}
                />
              </div>
            </DialogBody>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {intl.formatMessage({ id: 'users.userDialog.cancel' })}
              </Button>
              <Button
                type="submit"
                disabled={isLoading || (isEdit && !detailReady)}
                title={
                  isEdit && !detailReady
                    ? intl.formatMessage({
                        id: 'users.userDialog.detailLoadingHint',
                      })
                    : undefined
                }
              >
                {isLoading
                  ? intl.formatMessage({ id: 'users.userDialog.submitting' })
                  : isEdit
                    ? intl.formatMessage({
                        id: 'users.userDialog.editSubmit',
                      })
                    : intl.formatMessage({
                        id: 'users.userDialog.createSubmit',
                      })}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
