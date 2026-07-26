/**
 * Mock CLMRS data — used until the BE endpoints (migration 0054 +
 * parser modules B/C/D) ship. Every row is deterministic so the UI
 * reviewer sees the same list on every reload. Drop this file once
 * `useClmrsFlags` / `useClmrsCases` hit the real API.
 *
 * Identity model — read this before touching the seeds:
 *
 *   Each observed CHILD (not observation) is the row. The natural
 *   identity is the 4-tuple
 *     (farmer_id, child_name_normalised, child_dob, child_sex)
 *   from which we derive a deterministic UUID v5, `childId`, using a
 *   fixed CLMRS namespace UUID. Same tuple → same UUID, always.
 *
 *   The BE will materialise `child_id` as a `GENERATED ALWAYS AS ...
 *   STORED` column via `uuid_generate_v5()`. The FE mock reproduces
 *   the same computation with the `uuid` npm package's `v5` so mock
 *   ids match what the BE will produce once wired.
 *
 *   Re-syncs of the same Kobo submission cannot duplicate a row: the
 *   parser inserts the 4-tuple, Postgres materialises the same UUID,
 *   `ON CONFLICT (child_id) DO UPDATE` upserts cleanly.
 */

import { v5 as uuidv5 } from 'uuid';

export type ClmrsFlagSource = 'household_visit' | 'farm_visit';
export type ClmrsCaseStatus = 'open' | 'closed';
export type ClmrsChildSex = 'M' | 'F';

/**
 * CLMRS namespace UUID — fixed constant hardcoded in both the
 * migration and this file so dev / stage / prod / mock all
 * materialise identical `child_id`s for the same tuple.
 */
export const CLMRS_NAMESPACE = 'ea1c6f92-6e5d-46d0-9c4c-4c3a1f5c9d10';

/**
 * Normalise a Kobo-captured child name into the form that seeds
 * `child_id`. Must match the BE parser's `normaliseChildName`
 * exactly, or the FE + BE will materialise different UUIDs.
 */
export function normaliseChildName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // keep [a-z0-9\s-]
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '-');
}

/** Derive the CLMRS child_id UUID v5 from the 4-tuple. */
export function computeChildId(
  farmerId: string,
  childNameNormalised: string,
  childDob: string,
  childSex: ClmrsChildSex,
): string {
  return uuidv5(`${farmerId}__${childNameNormalised}__${childDob}__${childSex}`, CLMRS_NAMESPACE);
}

/**
 * A flag row = one CHILD, not one observation. The PK is `childId`,
 * a deterministic UUID v5 derived from the 4-tuple. Re-syncs of
 * additional observations UPDATE this row in place; they never
 * insert a new one.
 */
export interface ClmrsFlag {
  childId: string;
  farmerId: string;
  farmerName: string;
  cooperativeCode: string;
  cooperativeName: string;
  childNameNormalised: string;
  childNameDisplay: string;
  childDob: string;
  childSex: ClmrsChildSex;
  source: ClmrsFlagSource;
  flaggedActivities: string[];
  hasCase: boolean;
  /** Provenance of the most recent observation. NOT part of identity. */
  lastKoboSubmissionId: string;
  lastChildIndex: number;
  lastObservedAt: string;
  createdAt: string;
}

export interface ClmrsCase {
  id: string;
  clmrsCode: string;
  childId: string;
  status: ClmrsCaseStatus;
  lastVisitDate: string | null;
  /** When staff should re-check the case. Captured whenever a case is
   *  opened / reopened; cleared to null when the case is closed. */
  followUpDate: string | null;
  createdAt: string;
  createdByName: string | null;
}

// ── Seed data ──────────────────────────────────────────────────

// Sample hazardous activities — real Kobo multi-select values.
const HAZ = {
  cutlass: 'Handling machete / cutlass',
  spraying: 'Spraying agrochemicals',
  lifting: 'Carrying heavy loads',
  climbing: 'Climbing tall trees',
  night: 'Working at night',
  fire: 'Handling fire / burning debris',
};

/**
 * Helper for seeding: given the identity fields + display data,
 * fills in `childId` + `childNameNormalised` so seeds stay concise.
 */
function seedFlag(input: {
  farmerId: string;
  farmerName: string;
  cooperativeCode: string;
  cooperativeName: string;
  childNameDisplay: string;
  childDob: string;
  childSex: ClmrsChildSex;
  source: ClmrsFlagSource;
  flaggedActivities: string[];
  hasCase: boolean;
  lastKoboSubmissionId: string;
  lastChildIndex: number;
  lastObservedAt: string;
  createdAt: string;
}): ClmrsFlag {
  const childNameNormalised = normaliseChildName(input.childNameDisplay);
  return {
    ...input,
    childNameNormalised,
    childId: computeChildId(input.farmerId, childNameNormalised, input.childDob, input.childSex),
  };
}

export const MOCK_FLAGS: ClmrsFlag[] = [
  seedFlag({
    farmerId: 'SNK-0001',
    farmerName: 'Kojo Ansah',
    cooperativeCode: 'SANKOFA',
    cooperativeName: 'Sankofa Cocoa',
    childNameDisplay: 'Abena Kusi',
    childDob: '2013-04-12',
    childSex: 'F',
    source: 'household_visit',
    flaggedActivities: [HAZ.cutlass, HAZ.lifting],
    hasCase: false,
    lastKoboSubmissionId: 'kobo-b-001',
    lastChildIndex: 0,
    lastObservedAt: '2026-06-24T10:12:00Z',
    createdAt: '2026-06-24T10:12:05Z',
  }),
  seedFlag({
    farmerId: 'SNK-0001',
    farmerName: 'Kojo Ansah',
    cooperativeCode: 'SANKOFA',
    cooperativeName: 'Sankofa Cocoa',
    childNameDisplay: 'Kwaku Kusi',
    childDob: '2015-09-30',
    childSex: 'M',
    source: 'household_visit',
    flaggedActivities: [HAZ.spraying],
    hasCase: false,
    lastKoboSubmissionId: 'kobo-b-001',
    lastChildIndex: 1,
    lastObservedAt: '2026-06-24T10:12:00Z',
    createdAt: '2026-06-24T10:12:05Z',
  }),
  seedFlag({
    farmerId: 'ADW-0003',
    farmerName: 'Yaw Opoku',
    cooperativeCode: 'ADWUMA',
    cooperativeName: 'Adwuma Cocoa Union',
    childNameDisplay: 'Yaw Darko',
    childDob: '2012-01-08',
    childSex: 'M',
    source: 'farm_visit',
    flaggedActivities: [HAZ.climbing, HAZ.lifting, HAZ.fire],
    hasCase: false,
    lastKoboSubmissionId: 'kobo-c-014',
    lastChildIndex: 0,
    lastObservedAt: '2026-06-25T09:30:00Z',
    createdAt: '2026-06-25T09:30:04Z',
  }),
  seedFlag({
    farmerId: 'ADW-0003',
    farmerName: 'Yaw Opoku',
    cooperativeCode: 'ADWUMA',
    cooperativeName: 'Adwuma Cocoa Union',
    childNameDisplay: 'Akosua Darko',
    childDob: '2014-05-19',
    childSex: 'F',
    source: 'farm_visit',
    flaggedActivities: [HAZ.cutlass],
    hasCase: false,
    lastKoboSubmissionId: 'kobo-c-014',
    lastChildIndex: 1,
    lastObservedAt: '2026-06-25T09:30:00Z',
    createdAt: '2026-06-25T09:30:04Z',
  }),
  seedFlag({
    farmerId: 'NKB-0001',
    farmerName: 'Kwabena Asare',
    cooperativeCode: 'NKABOM',
    cooperativeName: 'Nkabom Farmers',
    childNameDisplay: 'Kofi Antwi',
    childDob: '2011-11-02',
    childSex: 'M',
    source: 'household_visit',
    flaggedActivities: [HAZ.spraying, HAZ.night],
    hasCase: true,
    lastKoboSubmissionId: 'kobo-b-002',
    lastChildIndex: 0,
    lastObservedAt: '2026-06-20T14:00:00Z',
    createdAt: '2026-06-20T14:00:04Z',
  }),
  seedFlag({
    farmerId: 'ABM-0009',
    farmerName: 'Adjoa Nyarko',
    cooperativeCode: 'ABOMA',
    cooperativeName: 'Aboma Cocoa',
    childNameDisplay: 'Adjoa Bediako',
    childDob: '2013-08-14',
    childSex: 'F',
    source: 'household_visit',
    flaggedActivities: [HAZ.cutlass, HAZ.climbing],
    hasCase: false,
    lastKoboSubmissionId: 'kobo-b-003',
    lastChildIndex: 0,
    lastObservedAt: '2026-06-27T11:00:00Z',
    createdAt: '2026-06-27T11:00:04Z',
  }),
  // Historical flags matching the two seed cases (Efua Boahen + Kwabena Agyapong),
  // so the merged LEFT JOIN view has real rows for those cases.
  seedFlag({
    farmerId: 'ADW-0002',
    farmerName: 'Kwame Boadu',
    cooperativeCode: 'ADWUMA',
    cooperativeName: 'Adwuma Cocoa Union',
    childNameDisplay: 'Efua Boahen',
    childDob: '2012-03-15',
    childSex: 'F',
    source: 'farm_visit',
    flaggedActivities: [HAZ.lifting, HAZ.fire],
    hasCase: true,
    lastKoboSubmissionId: 'kobo-c-legacy-02',
    lastChildIndex: 0,
    lastObservedAt: '2026-05-09T09:00:00Z',
    createdAt: '2026-05-09T09:00:04Z',
  }),
  seedFlag({
    farmerId: 'SNK-0036',
    farmerName: 'Efua Amoah',
    cooperativeCode: 'SANKOFA',
    cooperativeName: 'Sankofa Cocoa',
    childNameDisplay: 'Kwabena Agyapong',
    childDob: '2010-07-22',
    childSex: 'M',
    source: 'household_visit',
    flaggedActivities: [HAZ.cutlass],
    hasCase: true,
    lastKoboSubmissionId: 'kobo-b-legacy-03',
    lastChildIndex: 0,
    lastObservedAt: '2025-11-07T10:00:00Z',
    createdAt: '2025-11-07T10:00:04Z',
  }),
];

// Build the cases seed AFTER MOCK_FLAGS so we can derive childId
// via a straight lookup — every seed case must have a matching flag.
function findSeedFlagByDisplay(name: string): ClmrsFlag {
  const found = MOCK_FLAGS.find((f) => f.childNameDisplay === name);
  if (!found) throw new Error(`seed flag not found for ${name}`);
  return found;
}

export const MOCK_CASES: ClmrsCase[] = [
  {
    id: 'case-01',
    clmrsCode: 'CLMRS-2026-001',
    childId: findSeedFlagByDisplay('Kofi Antwi').childId,
    status: 'open',
    lastVisitDate: '2026-06-30',
    followUpDate: '2026-08-15',
    createdAt: '2026-06-22T14:30:00Z',
    createdByName: 'Field Officer — Nkabom Farmers',
  },
  {
    id: 'case-02',
    clmrsCode: 'CLMRS-2026-002',
    childId: findSeedFlagByDisplay('Efua Boahen').childId,
    status: 'open',
    lastVisitDate: '2026-06-15',
    followUpDate: '2026-07-30',
    createdAt: '2026-05-10T09:00:00Z',
    createdByName: 'IMS Manager — Adwuma Cocoa Union',
  },
  {
    id: 'case-03',
    clmrsCode: 'CLMRS-2025-047',
    childId: findSeedFlagByDisplay('Kwabena Agyapong').childId,
    status: 'closed',
    lastVisitDate: '2026-04-12',
    followUpDate: null,
    createdAt: '2025-11-08T10:00:00Z',
    createdByName: 'Field Officer — Sankofa Cocoa',
  },
];

// ── Query helpers ──────────────────────────────────────────────

/**
 * Unified CLMRS view — every child (flag) with its case joined in
 * when one has been opened. Mirrors the BE `LEFT JOIN clmrs.flags →
 * clmrs.cases ON flags.child_id = cases.child_id`.
 */
export interface ClmrsRecord {
  flag: ClmrsFlag;
  case: ClmrsCase | null;
}

function findCaseForChild(childId: string): ClmrsCase | null {
  return MOCK_CASES.find((c) => c.childId === childId) ?? null;
}

/** Universal record lookup by child_id (the URL param). */
export function findRecordByChildId(childId: string): ClmrsRecord | undefined {
  const flag = MOCK_FLAGS.find((f) => f.childId === childId);
  if (!flag) return undefined;
  return { flag, case: findCaseForChild(childId) };
}

/** One row per child; case fields joined when one has been opened. */
export function listRecords(): ClmrsRecord[] {
  return MOCK_FLAGS.map((flag) => ({
    flag,
    case: findCaseForChild(flag.childId),
  }));
}

export function listPendingFlags(): ClmrsFlag[] {
  return MOCK_FLAGS.filter((f) => !f.hasCase);
}

export function listAllFlags(): ClmrsFlag[] {
  return MOCK_FLAGS.slice();
}

export function findFlagByChildId(childId: string): ClmrsFlag | undefined {
  return MOCK_FLAGS.find((f) => f.childId === childId);
}

export function listCases(): ClmrsCase[] {
  return MOCK_CASES.slice();
}

export function findCase(id: string): ClmrsCase | undefined {
  return MOCK_CASES.find((c) => c.id === id);
}

/**
 * Worst-status a farmer sits at across all their CLMRS records.
 * Precedence: open > pending > closed > none. Used by the farmer list
 * column + farmer detail card so a farmer with 1 open case beats
 * another with 5 pending flags in the sort order.
 */
export type ClmrsFarmerStatus = 'none' | 'pending' | 'open' | 'closed';

/** Deterministic per-farmer CLMRS status fallback. The CLMRS module
 *  has no backend yet, so for farmers without an explicit MOCK_FLAGS
 *  entry we derive a stable status from the farmer id hash — mostly
 *  `none`, a minority flagged — so the list column is populated for
 *  every farmer instead of only the handful of hand-authored flags. */
function hashStatus(farmerId: string): ClmrsFarmerStatus {
  let h = 2166136261;
  for (let i = 0; i < farmerId.length; i++) {
    h ^= farmerId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const bucket = (h >>> 0) % 100;
  if (bucket < 62) return 'none';
  if (bucket < 80) return 'pending';
  if (bucket < 92) return 'open';
  return 'closed';
}

export function getFarmerClmrsStatus(farmerId: string): ClmrsFarmerStatus {
  const records = listRecords().filter((r) => r.flag.farmerId === farmerId);
  if (records.length === 0) return hashStatus(farmerId);
  let hasPending = false;
  let hasOpen = false;
  let hasClosed = false;
  for (const r of records) {
    if (!r.case) hasPending = true;
    else if (r.case.status === 'open') hasOpen = true;
    else if (r.case.status === 'closed') hasClosed = true;
  }
  if (hasOpen) return 'open';
  if (hasPending) return 'pending';
  if (hasClosed) return 'closed';
  return 'none';
}

/** All CLMRS records for one farmer, newest-first. */
export function listRecordsForFarmer(farmerId: string): ClmrsRecord[] {
  return listRecords()
    .filter((r) => r.flag.farmerId === farmerId)
    .sort((a, b) => (a.flag.createdAt < b.flag.createdAt ? 1 : -1));
}

export interface ClmrsStatsMock {
  pendingFlags: number;
  openCases: number;
  closedCases: number;
  /** Distinct farmers appearing anywhere in the CLMRS register. */
  relatedFarmers: number;
}

/**
 * Stats for the CLMRS strip. Pass the active cooperative code so the
 * counts match the (coop-scoped) list the user sees — without it the
 * card totals count every cooperative and diverge from the table.
 */
export function getStats(scopeCode?: string | null): ClmrsStatsMock {
  const code = scopeCode?.toUpperCase() ?? null;
  const flags = code
    ? MOCK_FLAGS.filter((f) => f.cooperativeCode.toUpperCase() === code)
    : MOCK_FLAGS;
  const childIds = new Set(flags.map((f) => f.childId));
  const cases = MOCK_CASES.filter((c) => childIds.has(c.childId));
  return {
    pendingFlags: flags.filter((f) => !f.hasCase).length,
    openCases: cases.filter((c) => c.status === 'open').length,
    closedCases: cases.filter((c) => c.status === 'closed').length,
    relatedFarmers: new Set(flags.map((f) => f.farmerId)).size,
  };
}

/**
 * Auto-mint the next `CLMRS-YYYY-NNN` code for the current year.
 * Scans existing MOCK_CASES for max sequence in this year and adds 1.
 * BE will do the same server-side (transactional select-max + insert).
 */
export function nextClmrsCode(): string {
  const year = new Date().getFullYear();
  const prefix = `CLMRS-${year}-`;
  let maxSeq = 0;
  for (const c of MOCK_CASES) {
    if (!c.clmrsCode.startsWith(prefix)) continue;
    const tail = c.clmrsCode.slice(prefix.length);
    const n = Number.parseInt(tail, 10);
    if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
  }
  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
}

/**
 * Mock case creation. Not persistent (page refresh resets), but flips
 * the flag's `hasCase` in-memory so the pending queue reacts and the
 * new case appears in the register during the same session.
 *
 * `clmrsCode` is auto-minted here (not user input) — see nextClmrsCode.
 */
export function createMockCase(
  childId: string,
  followUpDate: string | null = null,
): ClmrsCase | null {
  const flag = findFlagByChildId(childId);
  if (!flag) return null;
  const clmrsCode = nextClmrsCode();
  const newCase: ClmrsCase = {
    id: `case-${clmrsCode}`,
    clmrsCode,
    childId,
    status: 'open',
    lastVisitDate: null,
    followUpDate,
    createdAt: new Date().toISOString(),
    createdByName: 'You',
  };
  MOCK_CASES.unshift(newCase);
  flag.hasCase = true;
  return newCase;
}

/**
 * Flip a case's status. Opening / reopening captures the next
 * follow-up (recheck) date; closing clears it since there's nothing
 * left to re-check.
 */
export function setMockCaseStatus(
  id: string,
  status: ClmrsCaseStatus,
  followUpDate: string | null = null,
): ClmrsCase | null {
  const c = findCase(id);
  if (!c) return null;
  c.status = status;
  c.followUpDate = status === 'open' ? followUpDate : null;
  return c;
}
