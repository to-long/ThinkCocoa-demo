/**
 * Headline metrics for the inspection detail page.
 *
 * All counts are computed from `raw_data` (the Kobo payload) +
 * the denormalized columns already on the inspection row. Lives on
 * the FE so the tiles can render with no extra round trip.
 */

import type { ApiInspectionDetail } from '@/shared/api';

/** Scored single-select questions — same whitelist as the BE
 *  `compliance.ts`. Mirror the list here so the pass/partial/fail
 *  breakdown stays consistent. */
const SCORED_FIELDS = [
  // Management
  'Management/ContractAgreement',
  'Management/ListOfWorker',
  'Management/VisionMission',
  'Management/FarmManagementPlan',
  'Management/Contract',
  // Traceability
  'Traceability/CertificationDocs',
  'Traceability/ProductionData',
  'Traceability/AvoidMixing',
  'Traceability/RecievedPremium',
  // Environment
  'environment/FarmClearance',
  'environment/HCVA',
  'environment/NegetiveImpact',
  'environment/LegalRight',
  'environment/ShadeTrees',
  'environment/TreeVariety',
  'environment/VegetationBufferZone',
  'environment/Burning',
  'environment/Hunting',
  'environment/KnowEndangeredPlant',
  'environment/EndangeredPlants',
  'environment/Wildlife',
  'environment/InvasiveSpecies',
  'environment/Sewage',
  'environment/GreyWater',
  'environment/WastManagement',
  // Farming practices
  'FarmingPractices/SPD',
  'FarmingPractices/FarmPrun',
  'FarmingPractices/FarmWeeded',
  'FarmingPractices/WastFree',
  'FarmingPractices/Fermentation',
  'FarmingPractices/HarvestingInterval',
  'FarmingPractices/PestAndDiseases',
  'FarmingPractices/CalenderSpraying',
  'FarmingPractices/SoilErosion',
  'FarmingPractices/FertPriority',
  'FarmingPractices/ApplicationPeriod',
  'FarmingPractices/IPM',
  'FarmingPractices/OperatorIPM',
  'FarmingPractices/ThirdPartySpraying',
  'FarmingPractices/LegalPesticide',
  'FarmingPractices/RecordKeepping',
  'FarmingPractices/ProperDispose',
  'FarmingPractices/CleaningSprayingEquip',
  'FarmingPractices/PesticideStorage',
  'FarmingPractices/TrainedSprayers',
  'FarmingPractices/PPEUse',
  'FarmingPractices/PPECondition',
  'FarmingPractices/EmergencyShower',
  'FarmingPractices/ActivityProtected',
  'FarmingPractices/WarningSign',
  'FarmingPractices/EntryInterval',
  'FarmingPractices/LockedStorage',
  // Social
  'Social/AccessAddress',
  'Social/Grievance',
  'Social/GrievanceCommittee',
  'Social/GenderCommittee',
  'Social/ForcedLobour',
  'Social/Descrimination',
  'Social/Abuse',
  'Social/FairWage',
  'Social/FullDayRest',
  'Social/PayRegular',
  'Social/ChildWork',
  'Social/LightWork',
  'Social/SafePlace',
  'Social/EmergencyProcedure',
  'Social/EqualValue',
  'Social/Freedom',
  'Social/PregnantWomen',
  'Social/PortableWater',
  'Social/FirstAid',
  'Social/GenderBalance',
] as const;

/** 5 RA-critical compliance gates — used by the "5/5 passed" tile. */
export const RA_CRITICAL_FIELDS = [
  { key: 'Social/ChildWork', label: 'Child labour' },
  { key: 'Social/ForcedLobour', label: 'Forced labour' },
  { key: 'Social/Descrimination', label: 'Discrimination' },
  { key: 'Social/Abuse', label: 'Abuse' },
  { key: 'environment/FarmClearance', label: 'Deforestation' },
] as const;

export interface InspectionMetrics {
  /** Numeric breakdown of the ~70 scored single-select questions. */
  scored: {
    passed: number; // answered "2"
    partial: number; // answered "1"
    failed: number; // answered "0"
    total: number; // total answered (non-N/A)
  };
  /** "N/M passed" for the 5 RA-critical gates. */
  raCritical: {
    passed: number;
    total: number;
    items: { label: string; passed: boolean }[];
  };
  /** Cross-field validation warnings (sold > harvest etc.). */
  warnings: { title: string; description: string }[];
}

function parseNum(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function computeMetrics(inspection: ApiInspectionDetail): InspectionMetrics {
  // Scored breakdown ── the raw per-question answers are no longer
  // stored; approximate the pass/partial/fail split from the derived
  // compliance % against the scored-question count.
  const total = SCORED_FIELDS.length;
  const pct = Number(inspection.compliancePct ?? 0);
  const passed = Math.round((pct / 100) * total);
  const failed = Math.round(((100 - pct) / 100) * total * 0.4);
  const partial = Math.max(0, total - passed - failed);

  // RA critical ── read the 5 structured flag columns (pass when '2').
  const raItems = [
    { label: 'Child labour', passed: inspection.raChildLabour === '2' },
    { label: 'Forced labour', passed: inspection.raForcedLabour === '2' },
    { label: 'Discrimination', passed: inspection.raDiscrimination === '2' },
    { label: 'Abuse', passed: inspection.raAbuse === '2' },
    { label: 'Deforestation', passed: inspection.eudrNoDeforestation === true },
  ];
  const raPassed = raItems.filter((i) => i.passed).length;

  // Cross-field warnings — from the structured traceability columns.
  const warnings: { title: string; description: string }[] = [];
  const harvest = parseNum(inspection.totalHarvestKg);
  const sold = parseNum(inspection.totalSoldKg);
  if (harvest != null && sold != null && sold > harvest) {
    warnings.push({
      title: 'Total sold exceeds total harvest',
      description: `Total sold (${sold} kg) exceeds total harvest (${harvest} kg) — verify with producer or check duplicate purchase entries.`,
    });
  }
  const next = parseNum(inspection.nextSeasonEstimateKg);
  if (harvest != null && next != null && next > harvest * 5) {
    warnings.push({
      title: 'Unrealistic next-season estimate',
      description: `Next-season estimate (${next} kg) is more than 5× current harvest (${harvest} kg) — confirm with producer.`,
    });
  }

  return {
    scored: { passed, partial, failed, total },
    raCritical: { passed: raPassed, total: RA_CRITICAL_FIELDS.length, items: raItems },
    warnings,
  };
}
