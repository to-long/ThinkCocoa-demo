/**
 * Coaching validators + shared constants.
 *
 * Non-compliance taxonomy — the coaching Kobo form's Section P captures
 * "DESCRIBE THE NON-COMPLIANCE" as free text; the BE parser classifies it
 * into one of these fixed codes so the FE can render a stable label and
 * the list can group/filter by category. Keep this list in sync with the
 * Kobo `non_compliance_type` choice list.
 */

import { z } from 'zod';

export const NON_COMPLIANCE_TYPES = [
  'child_labour',
  'banned_chemicals',
  'no_ppe',
  'chem_storage_disposal',
  'no_buffer_zone',
  'deforestation',
  'waste_burning',
  'poor_farm_maintenance',
  'worker_rights',
  'missing_records',
  'side_selling',
  'other',
] as const;

export const nonComplianceTypeSchema = z.enum(NON_COMPLIANCE_TYPES);
export type NonComplianceType = z.infer<typeof nonComplianceTypeSchema>;

/** Human labels — the canonical wording from the Kobo choice list. */
export const NON_COMPLIANCE_TYPE_LABELS: Record<NonComplianceType, string> = {
  child_labour: 'Child labour observed',
  banned_chemicals: 'Use of banned / unapproved agrochemicals',
  no_ppe: 'Spraying without PPE',
  chem_storage_disposal: 'Improper chemical storage or container disposal',
  no_buffer_zone: 'No buffer zone near water body',
  deforestation: 'Deforestation / farming in protected area',
  waste_burning: 'Burning of waste on farm',
  poor_farm_maintenance: 'Poor farm maintenance (weeds, pruning, sanitation)',
  worker_rights: 'Worker rights violation (pay, conditions, forced labour)',
  missing_records: 'Missing or incomplete farm / sales records',
  side_selling: 'Side-selling outside the cooperative',
  other: 'Other (specify)',
};
