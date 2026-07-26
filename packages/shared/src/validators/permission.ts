import { z } from 'zod';
import { FIELD_LIMITS } from './common';
import { V } from './validator-error-code';

// A permission code is always `<resource>:<action>`.
// `RESOURCE_RE` is what's stored in the DB (canonical: lowercase +
// underscores, no spaces). `RESOURCE_RE_FORM` is the looser input-side
// variant — it also accepts MixedCase and internal spaces, so users
// can type `"Farm Plan"` naturally. The dialog lowercases + replaces
// whitespace runs with `_` just before submit, converting the form
// value to the canonical code. BE-facing schemas (`createPermissions
// Schema`, `createPermissionGroupsSchema`) still require `RESOURCE_RE`
// so a direct BE call can't sneak a space through.
// Actions stay strict lowercase to avoid duplicate permissions
// (`Read` vs `read`). Leading digit is forbidden everywhere.
const RESOURCE_RE = /^[A-Za-z_][A-Za-z_0-9]*$/;
const RESOURCE_RE_FORM = /^[A-Za-z_][A-Za-z_0-9 ]*$/;
const ACTION_RE = /^[a-z_][a-z_0-9]*$/;

export const permissionCodeSchema = z
  .string()
  .min(1, V.PERMISSION_CODE_REQUIRED)
  .regex(/^[a-z_][a-z_0-9]*:[a-z_][a-z_0-9]*$/, V.PERMISSION_CODE_PATTERN);

export const createPermissionSchema = z.object({
  code: permissionCodeSchema,
  name: z.string().min(1, V.NAME_REQUIRED),
  description: z.string().optional(),
});

export const updatePermissionSchema = z.object({
  name: z.string().min(1, V.NAME_REQUIRED).optional(),
  description: z.string().nullable().optional(),
});

/**
 * Batch create permissions grouped by resource.
 *
 * Payload shape:
 *   { farm_plan: ["read","create","update"], report: ["read","export"] }
 *
 * BE reassembles each entry into `resource:action` codes and inserts them
 * idempotently. Empty map / empty actions arrays are rejected; every key
 * and action must match the snake_case pattern.
 *
 * Why `superRefine` instead of a typed record key:
 *   Zod's `z.record(z.string().regex(...), ...)` reports key failures with
 *   its built-in `invalid_key` code and overrides our `.message()`. To emit
 *   `PERMISSION_GROUP_RESOURCE_PATTERN` consistently we accept any string
 *   key and validate it ourselves, attaching a custom issue at the bad key's
 *   path.
 */
export const createPermissionGroupsSchema = z
  .record(
    z.string(),
    z
      .array(z.string().regex(ACTION_RE, V.PERMISSION_GROUP_ACTION_PATTERN))
      .min(1, V.PERMISSION_GROUP_ACTIONS_EMPTY),
  )
  .superRefine((obj, ctx) => {
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: V.PERMISSION_GROUP_EMPTY,
        path: [],
      });
      return;
    }
    for (const key of keys) {
      if (key.length > FIELD_LIMITS.code) {
        ctx.addIssue({
          code: 'custom',
          message: V.TEXT_TOO_LONG,
          path: [key],
        });
        continue;
      }
      if (!RESOURCE_RE.test(key)) {
        ctx.addIssue({
          code: 'custom',
          message: V.PERMISSION_GROUP_RESOURCE_PATTERN,
          path: [key],
        });
      }
    }
  });

/**
 * Form-shape variant of `createPermissionGroupsSchema`.
 *
 * Mirrors the same regexes + error codes but uses a flat `{ name, actions }`
 * shape so react-hook-form + zodResolver can attach errors to the form
 * fields directly. The FE converts this into the grouped record payload
 * `{ [name]: actions }` at submit time, so BE + FE share identical
 * validation rules without sharing state shape.
 *
 * `actions[i].id` is present in edit mode (existing permission) and absent
 * for newly-added rows.
 */
export const createPermissionGroupFormSchema = z.object({
  // `.trim()` strips leading / trailing spaces before the regex check.
  // `RESOURCE_RE_FORM` permits internal spaces so a multi-word input
  // like "Farm Plan" validates at form time; the FE dialog's
  // `handleValid` then lowercases and replaces whitespace runs with
  // `_` before the BE call, so the stored code stays snake_case.
  name: z
    .string()
    .trim()
    .min(1, V.PERMISSION_GROUP_RESOURCE_PATTERN)
    // Cap matches FIELD_LIMITS.code (64) — same identifier budget the
    // BE enforces on resources. Without this, the dialog accepts a
    // 5000-char "Farm Plan" and only fails server-side at INSERT time.
    .max(FIELD_LIMITS.code, V.TEXT_TOO_LONG)
    .regex(RESOURCE_RE_FORM, V.PERMISSION_GROUP_RESOURCE_PATTERN),
  actions: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        action: z
          .string()
          .min(1, V.PERMISSION_GROUP_ACTION_PATTERN)
          .max(FIELD_LIMITS.code, V.TEXT_TOO_LONG)
          .regex(ACTION_RE, V.PERMISSION_GROUP_ACTION_PATTERN),
      }),
    )
    .min(1, V.PERMISSION_GROUP_ACTIONS_EMPTY),
});

export type CreatePermissionInput = z.infer<typeof createPermissionSchema>;
export type UpdatePermissionInput = z.infer<typeof updatePermissionSchema>;
export type CreatePermissionGroupsInput = z.infer<typeof createPermissionGroupsSchema>;
export type CreatePermissionGroupFormInput = z.infer<typeof createPermissionGroupFormSchema>;
