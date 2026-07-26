/**
 * DB row → API response projection.
 *
 * Two flavours:
 *   • `toInspectionListItem` — slim row for the list page (no raw_data,
 *     just the columns the table needs). Keeps payload off the wire.
 *   • `toInspectionDetail` — full row including raw_data and joined
 *     attachments. Used by GET /api/inspections/:id.
 */

import type { inspectionAttachments, inspections } from '../../db/schema/inspection';

type InspectionRow = typeof inspections.$inferSelect;
type AttachmentRow = typeof inspectionAttachments.$inferSelect;

export type EudrStatus = 'unknown' | 'compliant' | 'non_compliant' | 'needs_review';

function narrowEudrStatus(s: string | null): EudrStatus | null {
  if (s === 'compliant' || s === 'non_compliant' || s === 'needs_review' || s === 'unknown') {
    return s;
  }
  return null;
}

export type CorrectiveActionStatus = 'open' | 'reopen' | 'processing' | 'done';

/** One corrective action captured on an inspection: the follow-up text
 *  the farmer must complete, its target/deadline date, and its mutable
 *  workflow status. Sourced from the `inspection.corrective_actions`
 *  table (populated by the parser from `<prefix>FollowupAction` +
 *  `<prefix>ActionDate`). */
export interface InspectionFollowUp {
  /** corrective_actions.id (row PK). */
  id: string;
  /** Stable topic key — FE maps it to a localized label. */
  topic: string;
  action: string;
  actionDate: string | null;
  status: CorrectiveActionStatus;
  /** Closing note recorded when the action was marked done. */
  lastComment: string | null;
}

/** Parser-facing shape (no id/status yet) — what `parseFollowUps`
 *  extracts from raw Kobo before it's persisted. */
export interface ParsedFollowUp {
  topic: string;
  action: string;
  actionDate: string | null;
}

/** The 8 corrective-action topics on the internal-inspection form. */
export const FOLLOW_UP_TOPICS: { key: string; prefix: string }[] = [
  { key: 'spraying_calendar', prefix: 'FarmingPractices/CalenderSpraying' },
  { key: 'weeding', prefix: 'FarmingPractices/FarmWeeded' },
  { key: 'pruning', prefix: 'FarmingPractices/FarmPrun' },
  { key: 'pest_diseases', prefix: 'FarmingPractices/PestAndDiseases' },
  { key: 'soil_erosion', prefix: 'FarmingPractices/SoilErosion' },
  { key: 'child_labour', prefix: 'Social/ChildWork' },
  { key: 'forced_labour', prefix: 'Social/ForcedLobour' },
  { key: 'certification_docs', prefix: 'Traceability/CertificationDocs' },
];

/** Pull every populated follow-up action + its target date out of the
 *  raw Kobo submission. Topics with no action text are skipped. Used by
 *  the parser + backfill to seed `inspection.corrective_actions`. */
export function parseFollowUps(raw: Record<string, unknown>): ParsedFollowUp[] {
  const out: ParsedFollowUp[] = [];
  for (const { key, prefix } of FOLLOW_UP_TOPICS) {
    const action = raw[`${prefix}FollowupAction`];
    if (typeof action !== 'string' || !action.trim()) continue;
    const dateV = raw[`${prefix}ActionDate`];
    out.push({
      topic: key,
      action: action.trim(),
      actionDate: typeof dateV === 'string' && dateV.trim() ? dateV.trim() : null,
    });
  }
  return out;
}

export interface InspectionListItem {
  /** PK = Kobo `_id` (numeric, e.g. 757860568). */
  id: number;
  koboUuid: string;
  formVersion: string;
  cooperativeId: string | null;
  farmerId: string | null;
  parcelId: string | null;
  dateInspection: string;
  inspectorCode: string | null;
  eudrStatus: EudrStatus | null;
  complianceScore: number | null;
  complianceMax: number | null;
  compliancePct: number | null;
  /** Farmer's program year at the time of this inspection (1..5). */
  programYear: number | null;
  /** Derived audit outcome (see `apps/be/src/features/inspections/grading.ts`). */
  certificationOutcome: 'certified' | 'certified_with_ca' | 'not_certified' | 'disqualified' | null;
  submittedAt: string;
  syncedAt: string;
  /** Corrective actions + target dates parsed from the raw submission. */
  followUps: InspectionFollowUp[];
  // Joined display fields (filled by service when JOINing master tables)
  farmerName?: string | null;
  society?: string | null;
  parcelName?: string | null;
}

export function toInspectionListItem(
  row: InspectionRow,
  enrich: {
    farmerName?: string | null;
    society?: string | null;
    parcelName?: string | null;
    followUps?: InspectionFollowUp[];
  } = {},
): InspectionListItem {
  return {
    id: row.id,
    koboUuid: row.koboUuid,
    formVersion: row.formVersion,
    cooperativeId: row.cooperativeId,
    farmerId: row.farmerId,
    parcelId: row.parcelId,
    dateInspection: row.dateInspection,
    inspectorCode: row.inspectorCode,
    eudrStatus: narrowEudrStatus(row.eudrStatus),
    complianceScore: row.complianceScore,
    complianceMax: row.complianceMax,
    compliancePct: row.compliancePct ? Number.parseFloat(row.compliancePct) : null,
    programYear: row.programYear ?? null,
    certificationOutcome:
      row.certificationOutcome === 'certified' ||
      row.certificationOutcome === 'certified_with_ca' ||
      row.certificationOutcome === 'not_certified' ||
      row.certificationOutcome === 'disqualified'
        ? row.certificationOutcome
        : null,
    submittedAt: row.submittedAt.toISOString(),
    syncedAt: row.syncedAt.toISOString(),
    followUps: enrich.followUps ?? [],
    farmerName: enrich.farmerName,
    society: enrich.society,
    parcelName: enrich.parcelName,
  };
}

export interface InspectionDetail extends InspectionListItem {
  // (no `koboId` — `id` IS the Kobo `_id` since migration 0024)
  eudrScore: number | null;
  eudrNoDeforestation: boolean | null;
  eudrNoForestConversion: boolean | null;
  eudrOutsideHcva: boolean | null;
  eudrLegalRights: boolean | null;
  eudrAssessedAt: string | null;
  // Structured detail (formerly raw_data).
  farmerDob: string | null;
  farmerGender: string | null;
  ghanaCard: string | null;
  cocobodCard: string | null;
  householdSize: number | null;
  childrenCount: number | null;
  clmrsAssessed: boolean | null;
  fieldSizeHa: string | null;
  yearEstablished: number | null;
  farmMapped: boolean | null;
  gpsLocation: string | null;
  permanentStaff: number | null;
  temporaryStaff: number | null;
  totalHarvestKg: string | null;
  totalSoldKg: string | null;
  nextSeasonEstimateKg: string | null;
  anotherLbc: boolean | null;
  anotherLbcReason: string | null;
  trainingTopics: string | null;
  raChildLabour: string | null;
  raForcedLabour: string | null;
  raDiscrimination: string | null;
  raAbuse: string | null;
  submittedBy: string | null;
  snapshotUrl: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: AttachmentResponse[];
}

export interface AttachmentResponse {
  id: string;
  koboUid: string;
  questionXpath: string;
  filename: string | null;
  mimetype: string | null;
  koboUrl: string | null;
  spacesUrl: string | null;
}

export function toInspectionDetail(
  row: InspectionRow,
  attachments: AttachmentRow[],
  enrich: {
    farmerName?: string | null;
    society?: string | null;
    parcelName?: string | null;
    followUps?: InspectionFollowUp[];
  } = {},
): InspectionDetail {
  return {
    ...toInspectionListItem(row, enrich),
    eudrScore: row.eudrScore,
    eudrNoDeforestation: row.eudrNoDeforestation,
    eudrNoForestConversion: row.eudrNoForestConversion,
    eudrOutsideHcva: row.eudrOutsideHcva,
    eudrLegalRights: row.eudrLegalRights,
    eudrAssessedAt: row.eudrAssessedAt?.toISOString() ?? null,
    farmerDob: row.farmerDob,
    farmerGender: row.farmerGender,
    ghanaCard: row.ghanaCard,
    cocobodCard: row.cocobodCard,
    householdSize: row.householdSize,
    childrenCount: row.childrenCount,
    clmrsAssessed: row.clmrsAssessed,
    fieldSizeHa: row.fieldSizeHa,
    yearEstablished: row.yearEstablished,
    farmMapped: row.farmMapped,
    gpsLocation: row.gpsLocation,
    permanentStaff: row.permanentStaff,
    temporaryStaff: row.temporaryStaff,
    totalHarvestKg: row.totalHarvestKg,
    totalSoldKg: row.totalSoldKg,
    nextSeasonEstimateKg: row.nextSeasonEstimateKg,
    anotherLbc: row.anotherLbc,
    anotherLbcReason: row.anotherLbcReason,
    trainingTopics: row.trainingTopics,
    raChildLabour: row.raChildLabour,
    raForcedLabour: row.raForcedLabour,
    raDiscrimination: row.raDiscrimination,
    raAbuse: row.raAbuse,
    submittedBy: row.submittedBy,
    snapshotUrl: row.snapshotUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    attachments: attachments.map((a) => ({
      id: a.id,
      koboUid: a.koboUid,
      questionXpath: a.questionXpath,
      filename: a.filename,
      mimetype: a.mimetype,
      koboUrl: a.koboUrl,
      spacesUrl: a.spacesUrl,
    })),
  };
}
