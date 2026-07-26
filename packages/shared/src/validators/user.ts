import { z } from 'zod';
import { MIN_PASSWORD_LENGTH } from '../constants/index';
import { ASSIGNMENT_SCOPES, emailSchema, FIELD_LIMITS, USER_STATUSES, uuidSchema } from './common';
import { V } from './validator-error-code';

const passwordCreate = z
  .string()
  .min(MIN_PASSWORD_LENGTH, V.PASSWORD_MIN_LENGTH)
  .max(FIELD_LIMITS.password, V.PASSWORD_MAX_LENGTH);

/**
 * Strong-password policy: 8+ chars, ≥1 uppercase, ≥1 digit OR special.
 * Lives here (not in the FE dialog) so the BE rejects weak passwords on
 * direct API hits and so the FE form schema = shared schema with no
 * `.refine()` extension at the call site. See `CLAUDE.md` →
 * "Validators".
 */
export const PASSWORD_POLICY_RULES = [
  { key: 'minLength', test: (p: string) => p.length >= 8 },
  { key: 'uppercase', test: (p: string) => /[A-Z]/.test(p) },
  {
    key: 'numberOrSpecial',
    test: (p: string) => /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(p),
  },
] as const;

export type PasswordPolicyRuleKey = (typeof PASSWORD_POLICY_RULES)[number]['key'];

const passwordCreateWithPolicy = passwordCreate.refine(
  (p) => PASSWORD_POLICY_RULES.every((r) => r.test(p)),
  V.PASSWORD_POLICY_FAILED,
);

/**
 * Scope coupling: a user must EITHER hold the org-wide flag
 * (`isAllCooperative: true`) OR have at least one cooperative
 * assignment. Enforced as a top-level `.superRefine` so both fields
 * remain independently optional in the API contract.
 */
const scopeRefine = (
  data: { isAllCooperative?: boolean; cooperativeIds?: string[] },
  ctx: z.RefinementCtx,
) => {
  if (data.isAllCooperative) return;
  if (!data.cooperativeIds || data.cooperativeIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: V.USER_SCOPE_REQUIRED,
      path: ['cooperativeIds'],
    });
  }
};

export const createUserSchema = z.object({
  email: emailSchema,
  password: passwordCreate,
  // User display name (full name as one string). Cap at fullName limit
  // (200) to allow longer formal names. Char restriction left loose
  // here vs farmer.firstName/lastName because user.name carries the
  // signed-in display value and admins occasionally include role
  // suffixes / parentheticals.
  name: z.string().trim().min(1, V.NAME_REQUIRED).max(FIELD_LIMITS.fullName, V.TEXT_TOO_LONG),
  status: z.enum(USER_STATUSES).optional(),
  defaultCooperativeId: uuidSchema.optional(),
  roleCodes: z.array(z.string()).optional(),
  cooperativeIds: z.array(uuidSchema).optional(),
  isAllCooperative: z.boolean().optional(),
});

// Email is intentionally NOT updatable here — use better-auth change-email flow.
export const updateUserSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, V.FULL_NAME_REQUIRED)
    .max(FIELD_LIMITS.fullName, V.TEXT_TOO_LONG)
    .optional(),
  image: z.string().url(V.URL_INVALID).max(FIELD_LIMITS.url, V.TEXT_TOO_LONG).nullable().optional(),
  status: z.enum(USER_STATUSES).optional(),
  defaultCooperativeId: uuidSchema.nullable().optional(),
  roleCodes: z.array(z.string()).optional(),
  cooperativeIds: z.array(uuidSchema).optional(),
  isAllCooperative: z.boolean().optional(),
});

export const setUserRolesSchema = z.object({
  roleCodes: z.array(z.string()),
});

/**
 * Form-mode variants used by the FE create/edit user dialog. They wrap
 * the API schemas with the dialog's UI-only state (`roleIds` /
 * `permissionIds` arrays the parent maps to `roleCodes` at submit) and
 * apply the password-policy + scope-coupling refinements that ALSO run
 * server-side (see `passwordCreateWithPolicy` / `scopeRefine` above).
 *
 * The dialog imports these directly — never re-extends them locally.
 */
const userDialogUiExtras = {
  roleIds: z.array(z.string()).default([]),
  permissionIds: z.array(z.string()).default([]),
  cooperativeIds: z.array(uuidSchema).default([]),
  isAllCooperative: z.boolean().default(false),
};

export const createUserFormSchema = createUserSchema
  .omit({ password: true, cooperativeIds: true, isAllCooperative: true })
  .extend({ password: passwordCreateWithPolicy, ...userDialogUiExtras })
  .superRefine(scopeRefine);

export const updateUserFormSchema = updateUserSchema
  .omit({ fullName: true, cooperativeIds: true, isAllCooperative: true })
  .extend({
    name: createUserSchema.shape.name,
    ...userDialogUiExtras,
  })
  .superRefine(scopeRefine);

export type CreateUserFormInput = z.infer<typeof createUserFormSchema>;
export type UpdateUserFormInput = z.infer<typeof updateUserFormSchema>;

export const assignCooperativeSchema = z.object({
  cooperativeId: uuidSchema,
  scope: z.enum(ASSIGNMENT_SCOPES),
  isPrimary: z.boolean().optional(),
});

export const listUsersQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  q: z.string().optional(),
  includeDeleted: z.string().optional(),
  /** Filter to users that hold this role code (e.g. `cooperative_chair`).
   *  Used by the cooperative dialog to populate the chair selector, and
   *  by the admin users page when the Role filter is active. */
  roleCode: z.string().optional(),
  /** UI status filter: `active` | `inactive` | `blocked` — matches
   *  `users.status`. The pseudo-value `deleted` targets tombstoned rows
   *  (implies `includeDeleted=true`). */
  status: z.enum(['active', 'inactive', 'blocked', 'deleted']).optional(),
  /** Access-scope filter used by the admin users page.
   *   - `all`  → org-wide users (`is_all_cooperative = true`)
   *   - `none` → users with no coop access (no assignments AND not org-wide)
   *   - `<UUID>` → users assigned to that coop (including org-wide, whose
   *               access subsumes any specific coop). */
  scope: z.string().optional(),
  /** JSON:API sort spec — `field` (asc) / `-field` (desc), comma-
   *  separated for multi-column. Supported fields:
   *    - name        (full_name)
   *    - last_login  (lastLoginAt)
   *  Unknown fields fall back to the BE default (newest createdAt). */
  sort: z.string().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type SetUserRolesInput = z.infer<typeof setUserRolesSchema>;
export type AssignCooperativeInput = z.infer<typeof assignCooperativeSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
