/**
 * Farmers — row mapper shared between list/detail/create/update/restore.
 *
 * Reshapes a farmer DB row + denormalised cooperative columns into the
 * wire shape. Coop columns are denormalised into the response so the
 * admin list doesn't need a client-side lookup.
 */

import type { z } from '@hono/zod-openapi';
import type { farmers } from '../../db/schema/farmer';
import type { CertificationOutcome } from '../inspections/grading';
import type { farmerCoreSchema } from './schemas';

/** Compact projection of a farmer's most-recent inspection, denormalised
 *  onto the farmer response so list/detail can render a "Latest cert"
 *  badge without a per-row join call from the FE. */
export interface LatestCertificationSnapshot {
  inspectionId: number;
  dateInspection: string;
  /** Raw compliance score (numerator) — max is 142 per the RA
   *  scoring sheet. Rendered on the farmer detail as `score / 142`. */
  complianceScore: number | null;
  compliancePct: number | null;
  programYear: number | null;
  outcome: CertificationOutcome | null;
}

/** Auditable farmer columns — drops auto / FK fields that aren't
 *  user-editable (id, createdAt, updatedAt, deletedBy). */
export function farmerAuditSnapshot(f: typeof farmers.$inferSelect) {
  return {
    cooperativeId: f.cooperativeId,
    farmerCode: f.id,
    firstName: f.firstName,
    lastName: f.lastName,
    otherNames: f.otherNames,
    sex: f.sex,
    dateOfBirth: f.dateOfBirth,
    phoneNumber: f.phoneNumber,
    nationalIdNumber: f.nationalIdNumber,
    nationalIdType: f.nationalIdType,
    hhAssessed: f.hhAssessed,
    society: f.society,
    dataCollectionConsent: f.dataCollectionConsent,
    certificationStatus: f.certificationStatus,
    // RA certificate (migration 0010) — the number/expiry a buyer asks
    // for, and what the renewals view sorts on.
    raCertificateNumber: f.raCertificateNumber ?? null,
    raAuditDate: f.raAuditDate ?? null,
    raExpiryDate: f.raExpiryDate ?? null,
    raCertifyingBody: f.raCertifyingBody ?? null,
    registrationDate: f.registrationDate,
    householdSize: f.householdSize,
    childrenCount: f.childrenCount,
    isActive: f.isActive,
    producerId: f.producerId,
  };
}

// Helper: reshape a farmer row + coop into the wire shape. Coop columns
// are denormalised into the response so the admin list doesn't need a
// client-side lookup.
export function toFarmerResponse(
  f: typeof farmers.$inferSelect,
  coopCode: string,
  coopName: string,
  districtName: string | null,
  latestCertification: LatestCertificationSnapshot | null = null,
  correctiveActions: number = 0,
): z.infer<typeof farmerCoreSchema> {
  return {
    id: f.id,
    cooperativeId: f.cooperativeId,
    cooperativeCode: coopCode,
    cooperativeName: coopName,
    districtName: districtName ?? null,
    farmerCode: f.id,
    externalSource: f.externalSource ?? null,
    producerId: f.producerId ?? null,
    hhAssessed: f.hhAssessed ?? null,
    firstName: f.firstName,
    lastName: f.lastName,
    otherNames: f.otherNames ?? null,
    sex: f.sex ?? null,
    dateOfBirth: f.dateOfBirth ?? null,
    phoneNumber: f.phoneNumber ?? null,
    nationalIdNumber: f.nationalIdNumber ?? null,
    nationalIdType: f.nationalIdType ?? null,
    society: f.society ?? null,
    dataCollectionConsent: f.dataCollectionConsent ?? null,
    certificationStatus: f.certificationStatus,
    // RA certificate (migration 0010) — the number/expiry a buyer asks
    // for, and what the renewals view sorts on.
    raCertificateNumber: f.raCertificateNumber ?? null,
    raAuditDate: f.raAuditDate ?? null,
    raExpiryDate: f.raExpiryDate ?? null,
    raCertifyingBody: f.raCertifyingBody ?? null,
    registrationDate: f.registrationDate ?? null,
    householdSize: f.householdSize ?? null,
    childrenCount: f.childrenCount ?? null,
    isActive: f.isActive,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    deletedAt: f.deletedAt?.toISOString() ?? null,
    latestCertification,
    shadeSurvivalPct: f.shadeSurvivalPct != null ? Number(f.shadeSurvivalPct) : null,
    correctiveActions,
  };
}
