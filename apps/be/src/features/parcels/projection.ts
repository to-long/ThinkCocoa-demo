/**
 * Parcels — row mapper shared between list/detail/create/update/restore.
 *
 * Reshapes a parcel DB row + denormalised cooperative + farmer columns
 * into the wire shape. Coop + farmer are denormalised so the admin
 * list doesn't need a client-side lookup.
 */

import type { z } from '@hono/zod-openapi';
import type { parcels } from '../../db/schema/gis';
import type { parcelCoreSchema } from './schemas';

/** Auditable parcel columns — drops auto / FK fields that aren't
 *  user-editable (id since immutable, createdAt, updatedAt, deletedBy). */
export function parcelAuditSnapshot(p: typeof parcels.$inferSelect) {
  return {
    cooperativeId: p.cooperativeId,
    farmerId: p.farmerId,
    parcelName: p.parcelName,
    parcelStatus: p.parcelStatus,
    cropType: p.cropType,
    cocoaVariety: p.cocoaVariety,
    treeSpacing: p.treeSpacing,
    plantingDate: p.plantingDate,
    cocoaTreeCount: p.cocoaTreeCount,
    calculatedAreaHa: p.calculatedAreaHa,
    nearbyFeatureType: p.nearbyFeatureType,
    willingToRehabilitate: p.willingToRehabilitate,
    landOwnershipType: p.landOwnershipType,
  };
}

export function toParcelResponse(
  p: typeof parcels.$inferSelect,
  coopCode: string,
  coopName: string,
  districtName: string | null,
  farmerFirstName: string,
  farmerLastName: string,
  eudrStatus: string | null,
  shadeTreeCount: number = 0,
  correctiveActions: number = 0,
  geojson?: string | null,
  eudr?: {
    overlap: string | null;
    onLand: string | null;
    inCountry: string | null;
    deforestationRisk: string | null;
    protectedAreaRisk: string | null;
    data: string | null;
    explanation: string | null;
    assessedAt: Date | null;
    assessedBy: string | null;
    notes: string | null;
  } | null,
  riskZones?: unknown,
  /** List rows carry only these three verdicts; the detail endpoint
   *  passes the whole `eudr` block and we read them from there. */
  verdicts?: {
    deforestationRisk: string | null;
    protectedAreaRisk: string | null;
    overlap: string | null;
  },
): z.infer<typeof parcelCoreSchema> {
  return {
    id: p.id,
    cooperativeId: p.cooperativeId,
    cooperativeCode: coopCode,
    cooperativeName: coopName,
    districtName: districtName ?? null,
    farmerId: p.farmerId,
    farmerFullName: `${farmerFirstName} ${farmerLastName}`.trim(),
    parcelName: p.parcelName ?? null,
    parcelStatus: p.parcelStatus,
    cropType: p.cropType ?? null,
    cocoaVariety: p.cocoaVariety ?? null,
    treeSpacing: p.treeSpacing ?? null,
    plantingDate: p.plantingDate ?? null,
    cocoaTreeCount: p.cocoaTreeCount ?? null,
    calculatedAreaHa: p.calculatedAreaHa != null ? Number(p.calculatedAreaHa) : null,
    nearbyFeatureType: p.nearbyFeatureType ?? null,
    willingToRehabilitate: p.willingToRehabilitate ?? null,
    landOwnershipType: p.landOwnershipType ?? null,
    eudrStatus: eudrStatus ?? null,
    deforestationRisk: verdicts?.deforestationRisk ?? eudr?.deforestationRisk ?? null,
    protectedAreaRisk: verdicts?.protectedAreaRisk ?? eudr?.protectedAreaRisk ?? null,
    overlap: verdicts?.overlap ?? eudr?.overlap ?? null,
    eudr: eudr
      ? {
          overlap: eudr.overlap ?? null,
          onLand: eudr.onLand ?? null,
          inCountry: eudr.inCountry ?? null,
          deforestationRisk: eudr.deforestationRisk ?? null,
          protectedAreaRisk: eudr.protectedAreaRisk ?? null,
          data: eudr.data ?? null,
          explanation: eudr.explanation ?? null,
          assessedAt: eudr.assessedAt ? eudr.assessedAt.toISOString() : null,
          assessedBy: eudr.assessedBy ?? null,
          notes: eudr.notes ?? null,
        }
      : null,
    shadeSurvivalPct: p.shadeSurvivalPct != null ? Number(p.shadeSurvivalPct) : null,
    shadeTreeCount,
    correctiveActions,
    geojson: geojson ? JSON.parse(geojson) : null,
    riskZones: riskZones ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    deletedAt: p.deletedAt?.toISOString() ?? null,
  };
}
