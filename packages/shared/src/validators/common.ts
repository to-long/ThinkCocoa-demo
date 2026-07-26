import { z } from 'zod';
import { V } from './validator-error-code';

// ── Field length caps ─────────────────────────────────────────────
// One central place. Caps picked to match what the DB columns allow
// (most are `text` so we're really protecting against UI overflow +
// accidental DoS on huge payloads, not column truncation).
export const FIELD_LIMITS = {
  email: 254, // RFC 5321 max
  password: 128, // bcrypt input cap; longer offers no security gain
  personName: 100, // first / last / chair name
  fullName: 200, // user.fullName
  shortText: 200, // village, section, producerId
  contactPhone: 32, // E.164 + grouping
  nationalId: 64,
  address: 500, // multi-line postal address
  description: 2000, // multi-line cooperative / role description
  url: 2048, // pragmatic browser URL cap
  code: 64, // resource codes (cooperative.code, farmer.farmerCode)
} as const;

// ── Character patterns for identifier-ish / contact fields ────────
// Person name allows letters, common diacritics (via \p{L}), spaces,
// hyphens, apostrophes — covers Ghanaian + French + most Latin-script
// names without inviting scripts/SQL/HTML chars.
// Person name allows letters, common diacritics (\p{L} + \p{M}),
// digits, spaces, hyphens, apostrophes, periods. Digits are
// permitted because real Ghanaian / French / Latin-script farmer
// records routinely contain them — household disambiguators
// ("Kofi 2", "John III"), generational suffixes, registration
// numbers carried into the legal name. The character set still
// excludes scripts / SQL / HTML metachars.
const PERSON_NAME_RE = /^[\p{L}\p{M}\p{N}'\-. ]+$/u;
// Phone: digits + space + plus + dash + parens. Lets users type
// "+233 30 277 4001" naturally. Strict enough to reject script/text.
const PHONE_RE = /^[+\d\s().-]+$/;
// National ID: alphanumeric + dash. Ghana's NIA card is alphanumeric.
const NATIONAL_ID_RE = /^[A-Za-z0-9-]+$/;
// Farmer code: business identifier — alphanumeric + dash + underscore.
// Looser than role code (which mandates lowercase) since farmer codes
// often come from external systems with mixed case.
const FARMER_CODE_RE = /^[A-Za-z0-9_-]+$/;
// Unicode "Other" category (Cc=control, Cf=format incl. RTL override
// + zero-width chars, Co=private use, Cn=unassigned). Banning these
// in person names + descriptions blocks invisible-char attacks like
// `John‮⁨` (right-to-left override → display reversed).
const CONTROL_CHARS_RE = /\p{C}/u;
// Email rejects any non-ASCII char in either local-part or domain
// to block homoglyph spoofing (`аdmin@x.com` with Cyrillic а != admin).
// biome-ignore lint/suspicious/noControlCharactersInRegex: block homoglyph spoofing
const EMAIL_ASCII_RE = /^[\x00-\x7F]+$/;

const hasNoControlChars = (s: string): boolean => !CONTROL_CHARS_RE.test(s);

export const emailSchema = z
  .string()
  .trim()
  // Reject homoglyph spoofing — every char must be ASCII. RFC allows
  // IDN domains via punycode; if the org ever needs them, accept the
  // punycode form (`xn--…`) which is already pure ASCII.
  .regex(EMAIL_ASCII_RE, V.EMAIL_NON_ASCII)
  .email(V.EMAIL_INVALID)
  .max(FIELD_LIMITS.email, V.EMAIL_TOO_LONG)
  .transform((s) => s.toLowerCase());

export const uuidSchema = z.string().uuid(V.UUID_INVALID);

/** Refine that rejects strings containing any Unicode "Other" code
 *  point (control chars, format chars including the RTL override
 *  `‮` and zero-width spaces, private-use, unassigned). Used by
 *  free-text schemas where invisible chars would silently distort the
 *  rendered value. */
export const noControlChars = <T extends z.ZodString>(s: T) =>
  s.refine(hasNoControlChars, { message: V.CONTROL_CHARS_FORBIDDEN });

/** Bounded non-negative integer with NaN guard. Zod's `z.number().int()`
 *  already rejects NaN, but `.refine` makes the contract obvious for
 *  call sites that pipe values through `.coerce`. */
export const boundedInt = (max: number) =>
  z
    .number()
    .int(V.NUMBER_REQUIRED)
    .refine((v) => !Number.isNaN(v), { message: V.NUMBER_REQUIRED })
    .min(0, V.INTEGER_NON_NEGATIVE)
    .max(max, V.NUMBER_TOO_LARGE);

/** ISO date string bounded to a sane historical / forward window. The
 *  default is "no future dates", overridable per call. Uses a
 *  string-comparison since `z.string().date()` enforces YYYY-MM-DD
 *  shape and lex order matches chronological order in that format. */
export const boundedDate = (opts: { min?: string; max?: string } = {}) => {
  const today = new Date().toISOString().slice(0, 10);
  const max = opts.max ?? today;
  const min = opts.min ?? '1900-01-01';
  return z
    .string()
    .date(V.DATE_INVALID)
    .refine((d) => d >= min && d <= max, { message: V.DATE_OUT_OF_RANGE });
};

/** Person name (first/last/chair). Restricts to letters + diacritics +
 *  spaces + hyphens + apostrophes — keeps script/HTML chars out of
 *  display surfaces without rejecting real Ghanaian / French names.
 *  The PERSON_NAME_RE positive set already excludes \\p{C}, but the
 *  explicit `noControlChars` refine surfaces a clearer error code
 *  ("invisible chars" vs "invalid char") when someone pastes an RTL
 *  override or a zero-width space into the field. */
export const personNameSchema = (requiredCode: keyof typeof V) =>
  noControlChars(
    z
      .string()
      .trim()
      .min(1, V[requiredCode])
      .max(FIELD_LIMITS.personName, V.TEXT_TOO_LONG)
      .regex(PERSON_NAME_RE, V.PERSON_NAME_INVALID),
  );

/** Optional phone number — digits, plus, parens, dashes, spaces only. */
export const phoneSchema = z
  .string()
  .trim()
  .max(FIELD_LIMITS.contactPhone, V.TEXT_TOO_LONG)
  .regex(PHONE_RE, V.PHONE_INVALID);

/** Optional national ID — alphanumeric + dash. */
export const nationalIdSchema = z
  .string()
  .trim()
  .max(FIELD_LIMITS.nationalId, V.TEXT_TOO_LONG)
  .regex(NATIONAL_ID_RE, V.NATIONAL_ID_INVALID);

/** Farmer business code — alphanumeric + dash + underscore. */
export const farmerCodeSchema = z
  .string()
  .trim()
  .min(1, V.FARMER_CODE_REQUIRED)
  .max(FIELD_LIMITS.code, V.TEXT_TOO_LONG)
  .regex(FARMER_CODE_RE, V.FARMER_CODE_PATTERN);

/** Multi-line description (cooperative / role). React text rendering
 *  escapes `<` `>` `&` already, so HTML/script content is rendered as
 *  literal text — no XSS path through this field. The control-char
 *  ban below blocks invisible chars from polluting display, and the
 *  cap blocks textarea overflow attacks. If this value EVER gets
 *  piped into a non-React surface (PDF / email / Markdown renderer),
 *  the consumer MUST sanitise — see `report:export` work. */
export const descriptionSchema = noControlChars(
  z.string().trim().max(FIELD_LIMITS.description, V.TEXT_TOO_LONG),
);

/** Postal address — multi-line, slightly tighter than description. */
export const addressSchema = noControlChars(
  z.string().trim().max(FIELD_LIMITS.address, V.ADDRESS_TOO_LONG),
);

// ── CSV export helper ─────────────────────────────────────────────
/**
 * Defang a value before writing into a CSV cell. Excel / LibreOffice
 * treat values that begin with `=`, `+`, `-`, `@`, TAB, or CR as
 * formulas — `name="=cmd|'/c calc'!A1"` would actually execute on
 * open. Prefixing with a single quote turns the cell into a literal.
 *
 * Use this on every cell of a user-supplied CSV export. NOT needed
 * for JSON / XLSX outputs (XLSX needs its own escape via the writer
 * library).
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) return `'${s}`;
  return s;
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

// ── Canonical string enums shared with DB CHECK constraints ──────────
export const USER_STATUSES = ['active', 'inactive', 'locked'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const ASSIGNMENT_SCOPES = ['district', 'all_districts'] as const;
export type AssignmentScope = (typeof ASSIGNMENT_SCOPES)[number];

/**
 * Role codes that operate cross-tenant (every cooperative). Used by the
 * BE user service to infer `assignmentScope` and by the FE user dialog
 * to auto-fill + lock the Scope picker so admins can't accidentally
 * scope a project leader to a single coop.
 */
export const ORG_WIDE_ROLE_CODES = ['system_admin', 'project_leader', 'buyer'] as const;
export type OrgWideRoleCode = (typeof ORG_WIDE_ROLE_CODES)[number];

export function isOrgWideRole(roleCode: string): boolean {
  return (ORG_WIDE_ROLE_CODES as readonly string[]).includes(roleCode);
}

export const SEX_VALUES = ['male', 'female', 'other', 'unknown'] as const;
export type Sex = (typeof SEX_VALUES)[number];
