/**
 * Cooperatives — shared SELECT projection + row mapper.
 *
 * Detail responses include lightweight aggregate counts (`farmerCount`,
 * `parcelCount`, …) so the cooperative-detail page doesn't need to fan
 * out to per-resource endpoints. The list endpoint joins the same counts
 * so the list page can render columns like "total farmers" / "total
 * parcels" without N+1 fetches.
 *
 * Kept separate from `service.ts` so a future consumer (export job,
 * background reporting) can reuse the row shape without dragging in
 * route dependencies.
 */

import { sql as dsql } from 'drizzle-orm';
import { cooperatives, users } from '../../db/schema/iam';

// Drizzle's `aliasedTable` would be cleaner but we only need it once;
// inline `users` join is fine. Lifted into a small builder so the list
// + detail handlers use identical projection.
export const SELECT_FIELDS = {
  id: cooperatives.id,
  code: cooperatives.code,
  farmerCodePrefix: cooperatives.farmerCodePrefix,
  name: cooperatives.name,
  description: cooperatives.description,
  districtCode: cooperatives.districtCode,
  districtName: cooperatives.districtName,
  chairUserId: cooperatives.chairUserId,
  chairFullName: users.name,
  chairEmail: users.email,
  contactEmail: cooperatives.contactEmail,
  contactPhone: cooperatives.contactPhone,
  address: cooperatives.address,
  isActive: cooperatives.isActive,
  createdAt: cooperatives.createdAt,
  updatedAt: cooperatives.updatedAt,
  deletedAt: cooperatives.deletedAt,
  // Subquery counts — keeps everything in one DB round-trip per request.
  // The duplication of `cooperative_id = ${cooperatives.id}` joins is
  // the trade-off for using correlated subqueries; the alternative
  // (one CTE then multiple LEFT JOINs) is harder to read for the same
  // performance profile at this scale.
  farmerCount: dsql<number>`CAST((
    SELECT count(*) FROM farmer.farmers f
    WHERE f.cooperative_id = ${cooperatives.id} AND f.deleted_at IS NULL
  ) AS INT)`,
  // Farmers whose most-recent internal inspection outcome is
  // `certified` or `certified_with_ca` (both are "RA-certified" states
  // per the 2026 scoring spec — Certified with CA = certified with
  // corrective actions). DISTINCT ON collapses each farmer's history
  // to their latest inspection.
  certifiedFarmerCount: dsql<number>`CAST((
    SELECT count(*) FROM (
      SELECT DISTINCT ON (i.farmer_id) i.farmer_id, i.certification_outcome
      FROM inspection.inspections i
      INNER JOIN farmer.farmers f ON f.id = i.farmer_id
      WHERE f.cooperative_id = ${cooperatives.id}
        AND f.deleted_at IS NULL
        AND i.farmer_id IS NOT NULL
      ORDER BY i.farmer_id, i.date_inspection DESC
    ) latest
    WHERE latest.certification_outcome IN ('certified', 'certified_with_ca')
  ) AS INT)`,
  consentingFarmerCount: dsql<number>`CAST((
    SELECT count(*) FROM farmer.farmers f
    WHERE f.cooperative_id = ${cooperatives.id}
      AND f.deleted_at IS NULL
      AND f.data_collection_consent = true
  ) AS INT)`,
  parcelCount: dsql<number>`CAST((
    SELECT count(*) FROM gis.parcels p
    INNER JOIN farmer.farmers f ON f.id = p.farmer_id
    WHERE f.cooperative_id = ${cooperatives.id} AND p.deleted_at IS NULL
  ) AS INT)`,
  fieldCount: dsql<number>`CAST((
    SELECT count(*) FROM gis.parcels p
    INNER JOIN farmer.farmers f ON f.id = p.farmer_id
    WHERE f.cooperative_id = ${cooperatives.id}
      AND p.deleted_at IS NULL
      AND p.calculated_area_ha IS NOT NULL
  ) AS INT)`,
  // numeric → string preserves precision (4 decimal places) without
  // forcing a JS double cast.
  totalAreaHa: dsql<string | null>`(
    SELECT COALESCE(SUM(p.calculated_area_ha), 0)::text FROM gis.parcels p
    INNER JOIN farmer.farmers f ON f.id = p.farmer_id
    WHERE f.cooperative_id = ${cooperatives.id} AND p.deleted_at IS NULL
  )`,
  // Users with access to this coop = explicit assignment rows for live
  // (non-deleted) users PLUS every org-wide admin (their grant comes
  // from `users.is_all_cooperative` and applies to every coop). UNION
  // de-dupes the case where an admin happens to also have an explicit
  // row. Mirrors the merge logic in `listCooperativeMembers`.
  userCount: dsql<number>`CAST((
    SELECT count(DISTINCT user_id) FROM (
      SELECT uca.user_id FROM iam.user_cooperative_assignments uca
       INNER JOIN iam.users u ON u.id = uca.user_id
       WHERE uca.cooperative_id = ${cooperatives.id} AND u.deleted_at IS NULL
      UNION
      SELECT u.id FROM iam.users u
       WHERE u.is_all_cooperative = true AND u.deleted_at IS NULL
    ) members
  ) AS INT)`,
};

export type Row = {
  id: string;
  code: string;
  farmerCodePrefix: string | null;
  name: string;
  description: string | null;
  districtCode: string | null;
  districtName: string | null;
  chairUserId: string | null;
  chairFullName: string | null;
  chairEmail: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  farmerCount: number;
  certifiedFarmerCount: number;
  consentingFarmerCount: number;
  parcelCount: number;
  fieldCount: number;
  totalAreaHa: string | null;
  userCount: number;
};

export function toCooperativeResponse(r: Row) {
  return {
    id: r.id,
    code: r.code,
    farmerCodePrefix: r.farmerCodePrefix ?? null,
    name: r.name,
    description: r.description ?? null,
    districtCode: r.districtCode ?? null,
    districtName: r.districtName ?? null,
    chairUserId: r.chairUserId ?? null,
    chairFullName: r.chairFullName ?? null,
    chairEmail: r.chairEmail ?? null,
    contactEmail: r.contactEmail ?? null,
    contactPhone: r.contactPhone ?? null,
    address: r.address ?? null,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString() ?? null,
    farmerCount: Number(r.farmerCount),
    certifiedFarmerCount: Number(r.certifiedFarmerCount),
    consentingFarmerCount: Number(r.consentingFarmerCount),
    parcelCount: Number(r.parcelCount),
    fieldCount: Number(r.fieldCount),
    totalAreaHa: r.totalAreaHa,
    userCount: Number(r.userCount),
  };
}
