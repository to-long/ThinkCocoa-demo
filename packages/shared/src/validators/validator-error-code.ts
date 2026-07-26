/**
 * Validator error codes — shared between FE and BE.
 *
 * A validator failure produces an error *code* (stable identifier) rather
 * than a human-readable message. The BE returns `{ code, path, params }` to
 * the FE, and the FE maps the code to a localized message at runtime
 * (typically via react-intl).
 *
 * Why codes and not dot-paths / raw i18n keys?
 *   - Decouples API contract from FE translation file structure. The FE can
 *     reorganize its locale files without breaking the API contract.
 *   - Makes it obvious in BE logs / audit that something is a *code* and not
 *     a sentence fragment.
 *   - Supports non-intl consumers (mobile app, CLI, tests) that want to
 *     branch on the code directly.
 *
 * The BE writes issue.message = <code> when building Zod schemas; the
 * validation hook picks that up and emits it as `issues[].code`.
 *
 * Adding a new code requires:
 *   1. Append to ValidatorErrorCode below.
 *   2. Use it in the relevant Zod schema's `.message(V.XYZ)`.
 *   3. Add a matching entry in each FE locale file.
 */

export const ValidatorErrorCode = {
  // ── Generic primitives ────────────────────────────────────
  REQUIRED: 'REQUIRED',
  UUID_INVALID: 'UUID_INVALID',
  URL_INVALID: 'URL_INVALID',
  DATE_INVALID: 'DATE_INVALID',
  INTEGER_NON_NEGATIVE: 'INTEGER_NON_NEGATIVE',
  MAX_LENGTH: 'MAX_LENGTH',
  TEXT_TOO_LONG: 'TEXT_TOO_LONG',
  NUMBER_REQUIRED: 'NUMBER_REQUIRED',
  NUMBER_TOO_LARGE: 'NUMBER_TOO_LARGE',
  DATE_OUT_OF_RANGE: 'DATE_OUT_OF_RANGE',
  CONTROL_CHARS_FORBIDDEN: 'CONTROL_CHARS_FORBIDDEN',
  EMAIL_NON_ASCII: 'EMAIL_NON_ASCII',

  // ── Email / password ──────────────────────────────────────
  EMAIL_INVALID: 'EMAIL_INVALID',
  EMAIL_REQUIRED: 'EMAIL_REQUIRED',
  EMAIL_TOO_LONG: 'EMAIL_TOO_LONG',
  PASSWORD_REQUIRED: 'PASSWORD_REQUIRED',
  PASSWORD_MIN_LENGTH: 'PASSWORD_MIN_LENGTH',
  PASSWORD_MAX_LENGTH: 'PASSWORD_MAX_LENGTH',
  PASSWORD_MISMATCH: 'PASSWORD_MISMATCH',
  PASSWORD_CONFIRM_REQUIRED: 'PASSWORD_CONFIRM_REQUIRED',
  PASSWORD_CURRENT_REQUIRED: 'PASSWORD_CURRENT_REQUIRED',
  PASSWORD_POLICY_FAILED: 'PASSWORD_POLICY_FAILED',
  USER_SCOPE_REQUIRED: 'USER_SCOPE_REQUIRED',

  // ── Name / profile ────────────────────────────────────────
  NAME_REQUIRED: 'NAME_REQUIRED',
  FIRST_NAME_REQUIRED: 'FIRST_NAME_REQUIRED',
  LAST_NAME_REQUIRED: 'LAST_NAME_REQUIRED',
  FULL_NAME_REQUIRED: 'FULL_NAME_REQUIRED',
  PERSON_NAME_INVALID: 'PERSON_NAME_INVALID',

  // ── Contact ───────────────────────────────────────────────
  PHONE_INVALID: 'PHONE_INVALID',
  NATIONAL_ID_INVALID: 'NATIONAL_ID_INVALID',
  ADDRESS_TOO_LONG: 'ADDRESS_TOO_LONG',

  // ── IAM code patterns ─────────────────────────────────────
  PERMISSION_CODE_REQUIRED: 'PERMISSION_CODE_REQUIRED',
  PERMISSION_CODE_PATTERN: 'PERMISSION_CODE_PATTERN',
  PERMISSION_GROUP_EMPTY: 'PERMISSION_GROUP_EMPTY',
  PERMISSION_GROUP_RESOURCE_PATTERN: 'PERMISSION_GROUP_RESOURCE_PATTERN',
  PERMISSION_GROUP_ACTIONS_EMPTY: 'PERMISSION_GROUP_ACTIONS_EMPTY',
  PERMISSION_GROUP_ACTION_PATTERN: 'PERMISSION_GROUP_ACTION_PATTERN',
  ROLE_CODE_REQUIRED: 'ROLE_CODE_REQUIRED',
  ROLE_CODE_PATTERN: 'ROLE_CODE_PATTERN',

  // ── Farmer ────────────────────────────────────────────────
  FARMER_CODE_REQUIRED: 'FARMER_CODE_REQUIRED',
  FARMER_CODE_PATTERN: 'FARMER_CODE_PATTERN',

  // ── Parcel / Farm field ───────────────────────────────────
  PARCEL_FARMER_REQUIRED: 'PARCEL_FARMER_REQUIRED',
  PARCEL_AREA_INVALID: 'PARCEL_AREA_INVALID',
  PARCEL_GEOMETRY_INVALID: 'PARCEL_GEOMETRY_INVALID',

  // ── Cooperative ───────────────────────────────────────────
  COOPERATIVE_CODE_PATTERN: 'COOPERATIVE_CODE_PATTERN',
} as const;

export type ValidatorErrorCode = (typeof ValidatorErrorCode)[keyof typeof ValidatorErrorCode];

/**
 * Short alias for use in Zod schemas:
 *   z.string().min(1, V.NAME_REQUIRED)
 */
export const V = ValidatorErrorCode;

/**
 * Shape the BE returns on validation failure.
 * FE: map `issues[*].code` → localized message at runtime.
 * `params` carries placeholders (e.g. { min: 8 } for PASSWORD_MIN_LENGTH).
 */
export interface ValidationErrorBody {
  error: 'validation_failed';
  issues: Array<{
    path: string;
    code: ValidatorErrorCode | string;
    params?: Record<string, string | number>;
  }>;
}
