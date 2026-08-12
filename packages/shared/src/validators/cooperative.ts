import { z } from 'zod';
import {
  addressSchema,
  descriptionSchema,
  emailSchema,
  FIELD_LIMITS,
  phoneSchema,
  uuidSchema,
} from './common';
import { V } from './validator-error-code';

/**
 * Cooperative codes are short stable identifiers used as natural keys
 * in the URL + display. Uppercase letters / digits / underscores only,
 * leading letter required. Same shape as our other resource codes.
 */
const CODE_RE = /^[A-Z][A-Z0-9_]*$/;

// Farmer-code prefix: 2–5 uppercase letters (e.g. `SNK`). Set once at
// creation, immutable after (farmer codes derived from it can't change).
const PREFIX_RE = /^[A-Z]{2,5}$/;

export const createCooperativeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, V.NAME_REQUIRED)
    .max(FIELD_LIMITS.code, V.TEXT_TOO_LONG)
    .regex(CODE_RE, V.COOPERATIVE_CODE_PATTERN),
  farmerCodePrefix: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(PREFIX_RE, V.COOPERATIVE_CODE_PATTERN)),
  name: z.string().trim().min(1, V.NAME_REQUIRED).max(FIELD_LIMITS.shortText, V.TEXT_TOO_LONG),
  description: descriptionSchema.optional().nullable(),
  districtCode: z.string().trim().max(FIELD_LIMITS.code, V.TEXT_TOO_LONG).optional().nullable(),
  districtName: z
    .string()
    .trim()
    .max(FIELD_LIMITS.shortText, V.TEXT_TOO_LONG)
    .optional()
    .nullable(),
  /** UUID of the user assigned as chair. Optional — a coop can exist
   *  without a chair (e.g. just-created, pending election). */
  chairUserId: uuidSchema.optional().nullable(),
  contactEmail: emailSchema.optional().nullable(),
  contactPhone: phoneSchema.optional().nullable(),
  address: addressSchema.optional().nullable(),
  isActive: z.boolean().optional(),
});

/**
 * Update mirrors create but every field is optional — admins typically
 * only patch one or two columns at a time. `code` stays editable so
 * admins can correct typos before any data references it (downstream
 * tables FK by `id`, not `code`, so renaming is safe).
 */
export const updateCooperativeSchema = createCooperativeSchema.partial();

/**
 * Sentinel the FE form uses for "no selection" in the chair / district
 * dropdowns. Exported so both the dialog and the schema agree on the
 * literal — the form's submit handler maps sentinel → null before
 * sending to the API.
 */
export const COOPERATIVE_FORM_NO_SELECTION = '__none__' as const;

const chairUserIdFormField = z.union([uuidSchema, z.literal(COOPERATIVE_FORM_NO_SELECTION)]);

const districtCodeFormField = z.union([
  z.string().trim().max(FIELD_LIMITS.code, V.TEXT_TOO_LONG),
  z.literal(COOPERATIVE_FORM_NO_SELECTION),
]);

/**
 * Form-mode schema used by the FE cooperative dialog. The dialog has
 * no input for `code` (auto-set on create), `contactEmail`,
 * `contactPhone` (separate flow) so they're omitted. `chairUserId` and
 * `districtCode` accept the UI "no selection" sentinel; the rest of
 * the rules (length, descriptionSchema, addressSchema) inherit from
 * `createCooperativeSchema`.
 *
 * Dialog imports this directly — never re-extends locally
 * (see `CLAUDE.md` → "Validators").
 */
export const cooperativeFormSchema = createCooperativeSchema
  .omit({
    code: true,
    contactEmail: true,
    contactPhone: true,
    chairUserId: true,
    districtCode: true,
  })
  .extend({
    chairUserId: chairUserIdFormField,
    districtCode: districtCodeFormField,
    // `isActive` is deliberately NOT re-declared here: cooperatives are
    // always created active, so the dialog has no control for it and the
    // column keeps its `true` DB default. It stays optional on
    // create/update so the detail page's activate/deactivate action can
    // still patch it.
  });

export type CreateCooperativeInput = z.infer<typeof createCooperativeSchema>;
export type UpdateCooperativeInput = z.infer<typeof updateCooperativeSchema>;
export type CooperativeFormInput = z.infer<typeof cooperativeFormSchema>;
