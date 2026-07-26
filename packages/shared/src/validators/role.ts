import { z } from 'zod';
import { descriptionSchema, FIELD_LIMITS } from './common';
import { V } from './validator-error-code';

export const roleCodeSchema = z
  .string()
  .trim()
  .min(1, V.ROLE_CODE_REQUIRED)
  .max(FIELD_LIMITS.code, V.TEXT_TOO_LONG)
  // Must start with a letter or underscore (digits forbidden as the
  // first character so codes are identifier-safe), then any mix of
  // lowercase letters, digits, and underscores. e.g. `field_officer`,
  // `role_v2`, `auditor_2026`.
  .regex(/^[a-z_][a-z0-9_]*$/, V.ROLE_CODE_PATTERN);

const roleDisplayName = z
  .string()
  .trim()
  .min(1, V.NAME_REQUIRED)
  .max(FIELD_LIMITS.shortText, V.TEXT_TOO_LONG);

export const createRoleSchema = z.object({
  code: roleCodeSchema,
  name: roleDisplayName,
  description: descriptionSchema.optional(),
  permissionCodes: z.array(z.string()).optional(),
});

export const updateRoleSchema = z.object({
  name: roleDisplayName.optional(),
  description: descriptionSchema.nullable().optional(),
});

export const setRolePermissionsSchema = z.object({
  permissionCodes: z.array(z.string()),
});

/**
 * Form-mode schemas used by the FE role dialog. The shared API
 * `createRoleSchema` already exposes `permissionCodes` (optional);
 * `updateRoleSchema` doesn't, since permissions are PATCHed via a
 * separate `setRolePermissionsSchema` endpoint server-side. The form
 * still needs the field so the picker is part of one zod-validated
 * payload — `updateRoleFormSchema` exposes it with a `.default([])`
 * for RHF convenience.
 *
 * Dialog imports these directly — never re-extends locally
 * (see `CLAUDE.md` → "Validators").
 */
export const createRoleFormSchema = createRoleSchema.extend({
  permissionCodes: z.array(z.string()).default([]),
});

// Edit form keeps the `code` field visible (read-only display in
// most UIs but still part of form state) and validates it with the
// SAME `roleCodeSchema` rules — so a future change that lets admins
// edit the code on update never silently relaxes the format check.
// The dialog's submit handler strips `code` before PATCHing because
// the API `updateRoleSchema` rejects it.
export const updateRoleFormSchema = updateRoleSchema.extend({
  code: roleCodeSchema,
  permissionCodes: z.array(z.string()).default([]),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type CreateRoleFormInput = z.infer<typeof createRoleFormSchema>;
export type UpdateRoleFormInput = z.infer<typeof updateRoleFormSchema>;
export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsSchema>;
