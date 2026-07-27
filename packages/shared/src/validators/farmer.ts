import { z } from 'zod';
import {
  boundedDate,
  boundedInt,
  FIELD_LIMITS,
  farmerCodeSchema,
  nationalIdSchema,
  personNameSchema,
  phoneSchema,
  SEX_VALUES,
  uuidSchema,
} from './common';
import { V } from './validator-error-code';

const optionalShortText = z.string().trim().max(FIELD_LIMITS.shortText, V.TEXT_TOO_LONG);

/**
 * Base shape shared by create + update. Everything beyond the
 * NOT-NULL columns stays optional so a "quick create" can skip detail
 * fields and an edit can PATCH a single property at a time.
 *
 * Numeric + date fields use `boundedInt` / `boundedDate` from common
 * to reject out-of-range inputs that would otherwise produce
 * nonsensical data: 1850-born farmers, 999-person households, etc.
 */
const farmerBase = z.object({
  otherNames: optionalShortText.optional().nullable(),
  sex: z.enum(SEX_VALUES).optional().nullable(),
  // DOB: born within the last ~125 years; not in the future.
  dateOfBirth: boundedDate({ min: '1900-01-01' }).optional().nullable(),
  phoneNumber: phoneSchema.optional().nullable(),
  nationalIdNumber: nationalIdSchema.optional().nullable(),
  nationalIdType: optionalShortText.optional().nullable(),
  society: optionalShortText.optional().nullable(),
  dataCollectionConsent: z.boolean().optional().nullable(),
  certificationStatus: optionalShortText.optional(),
  // Registration: any date up to today (no future enrolments).
  registrationDate: boundedDate().optional().nullable(),
  // 100 covers extended households comfortably; rejects 999999.
  householdSize: boundedInt(100).optional().nullable(),
  // 50 caps reasonably; rejects integer-overflow attempts.
  childrenCount: boundedInt(50).optional().nullable(),
  // CLMRS (Child Labour Monitoring & Remediation System) assessed
  // by an inspector. Kobo sends 'yes'/'no'; the inspection
  // apply-changes flow normalises to boolean before write.
  hhAssessed: z.boolean().optional().nullable(),
  isActive: z.boolean().optional(),
  producerId: optionalShortText.optional().nullable(),
});

/** Full create payload — everything on the NOT-NULL path must be present. */
export const createFarmerSchema = farmerBase.extend({
  cooperativeId: uuidSchema,
  farmerCode: farmerCodeSchema,
  firstName: personNameSchema('FIRST_NAME_REQUIRED'),
  lastName: personNameSchema('LAST_NAME_REQUIRED'),
});

/** Update = every field optional. Nullable columns also accept `null` so
 *  the admin can explicitly clear a value from the edit form. */
export const updateFarmerSchema = farmerBase.extend({
  cooperativeId: uuidSchema.optional(),
  farmerCode: farmerCodeSchema.optional(),
  firstName: personNameSchema('FIRST_NAME_REQUIRED').optional(),
  lastName: personNameSchema('LAST_NAME_REQUIRED').optional(),
});

/** List query — pagination + filters + sort. All optional.
 *
 *  `sort` follows the JSON:API convention — `field` (asc) or `-field`
 *  (desc), comma-separated for multi-column. Supported fields:
 *    - name           (last_name, first_name)
 *    - farmer_code
 *    - registration_date
 *  Unknown fields fall back to the BE's default (newest createdAt). */
export const listFarmersQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  q: z.string().optional(),
  cooperativeCode: z.string().optional(),
  society: z.string().optional(),
  certificationStatus: z.string().optional(),
  /** RA certificate validity band — `valid` | `expiring` (inside 90 days)
   *  | `expired` | `none`. Separate from `certificationStatus` because a
   *  buyer's question is "what renews this quarter?", which the status
   *  word cannot answer. */
  certExpiry: z.string().optional(),
  isActive: z.enum(['true', 'false']).optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
  sort: z.string().optional(),
});

/** Legacy name kept for existing imports — alias to createFarmerSchema. */
export const farmerSchema = createFarmerSchema;

export type CreateFarmerInput = z.infer<typeof createFarmerSchema>;
export type UpdateFarmerInput = z.infer<typeof updateFarmerSchema>;
export type ListFarmersQuery = z.infer<typeof listFarmersQuerySchema>;
export type FarmerInput = CreateFarmerInput;
