/**
 * Permission-group create/edit dialog.
 *
 * Shares the same Zod schema (`createPermissionGroupFormSchema` in
 * `@thinkcocoa/shared`) + error codes with the BE `/api/permissions/groups`
 * endpoint. Client-side validation runs through react-hook-form's
 * `zodResolver`; server-side validation errors (from a submit that reaches
 * the BE) are mapped back onto the same form fields so each failure lands
 * exactly where the user entered it.
 */

import { zodResolver } from '@hookform/resolvers/zod';
import {
  type CreatePermissionGroupFormInput,
  createPermissionGroupFormSchema,
} from '@thinkcocoa/shared';
import { useEffect, useRef } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type TagItem, TagsInput } from '@/components/ui/tags-input';
import { ApiError } from '@/shared/api/fetcher';
import { useApiErrorMessage } from '@/shared/api/use-api-error-message';
import { actionSort } from '../../lib/permission-icons';
import type { PermissionAction } from '../../types/roles';

interface PermissionGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Thrown errors are caught by the dialog and mapped to form fields. */
  onSubmit: (name: string, actions: PermissionAction[]) => Promise<void>;
  initialData?: {
    name: string;
    actions: PermissionAction[];
  };
}

// Default actions auto-selected on a fresh permission group create.
// Order follows the canonical `ACTION_ORDER` in `permission-icons.tsx`
// (read → notification → create → update → delete → …) — same order
// the list page renders, so chips stay in the same place between
// create and view.
// Includes `notification` so every new resource ships with the
// notification eligibility action by default — admins can untick it
// if they really want a notification-less resource, but the common
// case (resource that admins watch) gets the action for free.
const DEFAULT_ACTIONS: PermissionAction[] = [
  { action: 'read' },
  { action: 'notification' },
  { action: 'create' },
  { action: 'update' },
  { action: 'delete' },
];

export function PermissionGroupDialog({
  open,
  onOpenChange,
  onSubmit,
  initialData,
}: PermissionGroupDialogProps) {
  const intl = useIntl();
  const getErrorMessage = useApiErrorMessage();
  const isEdit = !!initialData;

  const form = useForm<CreatePermissionGroupFormInput>({
    resolver: zodResolver(createPermissionGroupFormSchema),
    mode: 'onSubmit',
    defaultValues: { name: '', actions: DEFAULT_ACTIONS },
  });

  const { fields, append, replace } = useFieldArray({
    control: form.control,
    name: 'actions',
  });

  // Reset form whenever the dialog is opened / initialData changes.
  // Keeping the map lets the caller still delete the original permission
  // row by id when an existing action is removed during edit.
  const originalById = useRef<Map<string, PermissionAction>>(new Map());
  useEffect(() => {
    if (open && initialData) {
      originalById.current = new Map(initialData.actions.map((a) => [a.action, a]));
      // Sort by canonical action order so the edit dialog presents the
      // same chip layout as the list page — admins don't see chips
      // jump around between view and edit.
      const ordered = [...initialData.actions].sort((a, b) => actionSort(a.action, b.action));
      form.reset({ name: initialData.name, actions: ordered });
    } else if (!open) {
      originalById.current = new Map();
      form.reset({ name: '', actions: DEFAULT_ACTIONS });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialData, form.reset]);

  // TagsInput integration — convert to/from the RHF-managed actions array.
  // Render sorted so newly-added tags slot in their canonical position
  // (e.g. typing `sync` lands AFTER delete, not at the end).
  const tagItems: TagItem[] = [...fields]
    .sort((a, b) => actionSort(a.action, b.action))
    .map((f) =>
      f.id && originalById.current.get(f.action)?.id
        ? { uuid: originalById.current.get(f.action)!.id!, value: f.action }
        : f.action,
    );

  const handleTagsChange = (next: TagItem[]) => {
    const newActions: PermissionAction[] = next.map((t) => {
      const value = typeof t === 'string' ? t : t.value;
      const original = originalById.current.get(value);
      return original ?? { action: value };
    });
    // Keep RHF state in canonical order so a subsequent re-open or
    // submit preserves the visible order.
    newActions.sort((a, b) => actionSort(a.action, b.action));
    replace(newActions);
  };

  const handleDraftCommit = (labels: string[]) => {
    for (const l of labels) append({ action: l });
  };

  /**
   * Maps an ApiError's `{ issues: [{ path, code, params }] }` payload onto
   * RHF form errors. The BE's path encodes the submitted resource key, e.g.
   * payload `{ my_group: ["foo"] }` with a bad action emits path
   * `"my_group.0"`. We translate those back to the form-shape paths
   * (`name`, `actions.0.action`, etc.) so react-intl messages render next
   * to the offending field.
   */
  function applyServerValidation(err: ApiError, submittedName: string): boolean {
    const issues = err.validation?.issues;
    if (!issues || issues.length === 0) return false;

    for (const issue of issues) {
      const id = `validator.${issue.code}`;
      const message = intl.formatMessage({ id, defaultMessage: id }, issue.params);

      if (issue.path === '' || issue.code === 'PERMISSION_GROUP_EMPTY') {
        form.setError('root.server', { type: 'server', message });
        continue;
      }
      if (issue.path === submittedName) {
        if (issue.code === 'PERMISSION_GROUP_RESOURCE_PATTERN') {
          form.setError('name', { type: 'server', message });
        } else if (issue.code === 'PERMISSION_GROUP_ACTIONS_EMPTY') {
          form.setError('actions', { type: 'server', message });
        } else {
          form.setError('root.server', { type: 'server', message });
        }
        continue;
      }
      // Action-level issues arrive as `<resource>.<index>`.
      const prefix = `${submittedName}.`;
      if (issue.path.startsWith(prefix)) {
        const idx = Number(issue.path.slice(prefix.length));
        if (Number.isInteger(idx)) {
          form.setError(`actions.${idx}.action`, {
            type: 'server',
            message,
          });
          continue;
        }
      }
      form.setError('root.server', { type: 'server', message });
    }
    return true;
  }

  const handleValid = async (data: CreatePermissionGroupFormInput) => {
    form.clearErrors('root.server');
    // Final normalization to the canonical resource code:
    //   1. `.trim()` — kill leading/trailing whitespace (zod already
    //      does this, idempotent here for safety).
    //   2. `.toLowerCase()` — the DB stores codes lowercase-only.
    //   3. `.replace(/\s+/g, "_")` — collapse any internal whitespace
    //      runs into a single underscore, turning user-typed "Farm
    //      Plan" into "farm_plan" before it hits the BE's strict
    //      `RESOURCE_RE` validator.
    const name = data.name.trim().toLowerCase().replace(/\s+/g, '_');
    const dedupedActions = data.actions.filter(
      (a, i, arr) => arr.findIndex((x) => x.action === a.action) === i,
    );
    try {
      await onSubmit(name, dedupedActions);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && applyServerValidation(err, name)) return;
      form.setError('root.server', {
        type: 'server',
        message: getErrorMessage(err),
      });
    }
  };

  const actionsError = form.formState.errors.actions?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <h3 className="font-semibold text-lg">
            {isEdit
              ? intl.formatMessage({ id: 'permissions.addDialog.editTitle' })
              : intl.formatMessage({ id: 'permissions.addDialog.title' })}
          </h3>
          <p className="text-muted-foreground text-sm">
            {isEdit
              ? intl.formatMessage({
                  id: 'permissions.addDialog.editDescription',
                })
              : intl.formatMessage({
                  id: 'permissions.addDialog.description',
                })}
          </p>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(handleValid)} className="flex min-h-0 flex-1 flex-col">
          <DialogBody>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label>
                  {intl.formatMessage({
                    id: 'permissions.addDialog.groupName',
                  })}
                </Label>
                <Input
                  {...form.register('name')}
                  placeholder={intl.formatMessage({
                    id: 'permissions.addDialog.groupNamePlaceholder',
                  })}
                  aria-invalid={!!form.formState.errors.name}
                />
                {form.formState.errors.name?.message && (
                  <p className="text-destructive text-xs">
                    {intl.formatMessage({
                      id: `validator.${form.formState.errors.name.message}`,
                      defaultMessage: form.formState.errors.name.message,
                    })}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label>
                  {intl.formatMessage({
                    id: 'permissions.addDialog.accessControl',
                  })}
                </Label>
                <TagsInput
                  value={tagItems}
                  onValueChange={handleTagsChange}
                  onDraftCommit={handleDraftCommit}
                  placeholder={intl.formatMessage({
                    id: 'permissions.addDialog.accessControlPlaceholder',
                  })}
                />
                {actionsError && (
                  <p className="text-destructive text-xs">
                    {intl.formatMessage({
                      id: `validator.${actionsError}`,
                      defaultMessage: actionsError,
                    })}
                  </p>
                )}
                {/* Render per-row errors (e.g. invalid action pattern). */}
                {form.formState.errors.actions?.map?.((e, i) =>
                  e?.action?.message ? (
                    <p key={i} className="text-destructive text-xs">
                      {fields[i]?.action}:{' '}
                      {intl.formatMessage({
                        id: `validator.${e.action.message}`,
                        defaultMessage: e.action.message,
                      })}
                    </p>
                  ) : null,
                )}
              </div>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={form.formState.isSubmitting}
            >
              {intl.formatMessage({ id: 'permissions.addDialog.cancel' })}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {isEdit
                ? intl.formatMessage({
                    id: 'permissions.addDialog.editSubmit',
                  })
                : intl.formatMessage({ id: 'permissions.addDialog.submit' })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
