/**
 * Bulk farmer + parcel import from the 2025-2026 CSV shape.
 *
 * Wraps the same parse + upsert logic the `farmers-from-csv.ts` seed
 * script uses so the runtime endpoint and the seed stay in lock-step.
 * Given a UTF-8 CSV buffer, it produces two things:
 *
 *   1. Bulk upserts against `farmer.farmers` + `farmer.parcels` in
 *      chunks of 500 to stay under Postgres' bound-parameter ceiling.
 *   2. A per-run summary (rows read, farmers/parcels inserted vs
 *      updated, skipped-with-reason) suitable for surfacing to the
 *      admin who triggered the upload.
 *
 * The parser is intentionally forgiving: rows with unmappable coop
 * labels, missing ProducerID, or garbage DOB/sex are counted in
 * `skipped` and returned to the caller instead of failing the whole
 * batch. That keeps a single dirty row from blocking a 3k-row upload.
 *
 * Kept in ONE file because the shape is CSV-specific — the coop
 * label map, national-ID regex, and column names are all tied to the
 * `Farmer Dataset 2025-2026` export format. If a new upstream ships
 * a different schema, fork this rather than trying to generalise.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { cooperatives, farmers, parcels } from '../../db/schema/index';

// Same map + regexes the seed uses. Duplicated (not imported from
// seed) because seed lives in `apps/be/db/seed` which isn't on the
// runtime build path; extracting them requires a shared package or
// symlink. Keeping the copies in sync is the tradeoff.
// Keep in lock-step with the same map in `db/seed/farmers-from-csv.ts` —
// a label missing here aborts the whole upload with `unknown_coop`, which
// is how Ayekoo + Nhyira rows used to fail even though both coops are
// seeded.
const COOP_LABEL_TO_CODE: Record<string, string> = {
  Sankofa: 'SANKOFA',
  Nkabom: 'NKABOM',
  Adwuma: 'ADWUMA',
  Aboma: 'ABOMA',
  Ayekoo: 'AYEKOO',
  Nhyira: 'NHYIRA',
};

const NATIONAL_ID_RE = /^NID[\s-]?\d{6,}[\s-]\d$/i;

// ── CSV parsing ──────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  out.push(current);
  return out;
}

function parseCsv(raw: string): Array<Record<string, string>> {
  const normalized = raw.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]!).map((h) => h.trim());
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!);
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = (cells[j] ?? '').trim();
    });
    rows.push(row);
  }
  return rows;
}

// ── Value coercion ───────────────────────────────────────────────

function nullish(v: string | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  if (t === '' || /^(none|n\/a|not available|unknown|-)$/i.test(t)) return null;
  return t;
}

function titleCase(v: string | null): string | null {
  if (!v) return v;
  return v.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

function splitName(full: string | null): { firstName: string; lastName: string } | null {
  if (!full) return null;
  const parts = full
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  const firstName = titleCase(parts[0]!) ?? '';
  if (!firstName) return null;
  if (parts.length === 1) return { firstName, lastName: '-' };
  const lastName = titleCase(parts.slice(1).join(' ')) ?? '-';
  return { firstName, lastName: lastName || '-' };
}

function toSex(v: string | undefined): string | null {
  const t = nullish(v)?.toLowerCase();
  if (t === 'male' || t === 'female' || t === 'other') return t;
  return null;
}

function toDob(v: string | undefined): string | null {
  const t = nullish(v);
  if (!t) return null;
  const m = t.match(/^(\d{4})$/);
  if (!m) return null;
  const year = +m[1]!;
  if (year < 1900 || year > 2025) return null;
  return `${year}-01-01`;
}

function toPhone(v: string | undefined): string | null {
  return nullish(v);
}

function toCount(v: string | undefined): number | null {
  const t = nullish(v);
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 32767 || !Number.isInteger(n)) return null;
  return n;
}

function toBool(v: string | undefined): boolean | null {
  const t = nullish(v)?.toLowerCase();
  if (t === 'yes' || t === 'true' || t === 'y' || t === '1') return true;
  if (t === 'no' || t === 'false' || t === 'n' || t === '0') return false;
  return null;
}

function pickNationalId(row: Record<string, string>): string | null {
  for (const raw of [row.NationalId, row.PurchasingClerkCard]) {
    const t = nullish(raw);
    if (!t) continue;
    if (!NATIONAL_ID_RE.test(t)) continue;
    return t.replace(/\s+/g, '-').toUpperCase();
  }
  return null;
}

function toAreaHa(v: string | undefined): string | null {
  const t = nullish(v);
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(4);
}

// ── Insert shapes ────────────────────────────────────────────────

type FarmerInsert = typeof farmers.$inferInsert;
type ParcelInsert = typeof parcels.$inferInsert;

function toFarmerInsert(row: Record<string, string>, cooperativeId: string): FarmerInsert | null {
  const code = nullish(row.ProducerID);
  if (!code) return null;

  const name = splitName(nullish(row.Producer));
  if (!name) return null;

  const nationalIdCard = pickNationalId(row);

  return {
    id: code,
    cooperativeId,
    externalSource: 'farmer_dataset_2025_2026',
    producerId: code,
    firstName: name.firstName,
    lastName: name.lastName,
    sex: toSex(row.FarmerGender),
    dateOfBirth: toDob(row.DOBProducer),
    phoneNumber: toPhone(row.PhoneNumber),
    nationalIdNumber: nationalIdCard,
    nationalIdType: nationalIdCard ? 'national_id' : null,
    hhAssessed: toBool(row.HHAssessed),
    society: nullish(row.Society),
    householdSize: toCount(row.Hhsize),
    childrenCount: toCount(row.NumberChildren),
    certificationStatus: 'unknown',
    isActive: true,
  };
}

function toParcelInsert(
  row: Record<string, string>,
  cooperativeId: string,
  farmerId: string,
): ParcelInsert | null {
  const fieldId = nullish(row['Field ID']);
  if (!fieldId) return null;
  return {
    id: fieldId,
    cooperativeId,
    farmerId,
    parcelName: nullish(row.Field),
    calculatedAreaHa: toAreaHa(row['FIELD Size']),
    parcelStatus: 'active',
    cropType: 'cocoa',
  };
}

// ── Public API ───────────────────────────────────────────────────

export interface CsvImportSummary {
  totalRows: number;
  farmersUpserted: number;
  parcelsUpserted: number;
  skipped: Array<{ row: number; reason: string; coop?: string; producerId?: string }>;
}

export interface CsvImportResult {
  kind: 'ok' | 'no_rows' | 'unknown_coop';
  summary: CsvImportSummary;
  /** Missing coop labels the CSV referenced. Populated when kind =
   *  'unknown_coop' — the whole batch aborts if ANY row can't be
   *  mapped, so the admin can fix the CSV or seed the missing coop
   *  before retrying rather than getting a partial import. */
  unknownCoops?: string[];
}

/**
 * Parse the CSV buffer and upsert its farmers + parcels.
 *
 * Strategy:
 *   - Two-pass upsert (farmers first, then parcels) so parcels' FK
 *     to farmers is satisfied when the CSV introduces a brand-new
 *     farmer whose parcel row appears in the same file.
 *   - Dedupe by `ProducerID` (farmer) and `Field ID` (parcel) —
 *     first-win, matching the seed's semantics.
 *   - Row-level errors are collected in `skipped[]` instead of
 *     aborting; the caller decides how to surface them.
 */
export async function importFarmersCsv(db: Db, csvBuffer: Buffer): Promise<CsvImportResult> {
  const text = csvBuffer.toString('utf8');
  const rows = parseCsv(text);
  const summary: CsvImportSummary = {
    totalRows: rows.length,
    farmersUpserted: 0,
    parcelsUpserted: 0,
    skipped: [],
  };

  if (rows.length === 0) {
    return { kind: 'no_rows', summary };
  }

  const coopRows = await db.select().from(cooperatives);
  const coopByCode = new Map(coopRows.map((c) => [c.code, c.id]));

  const seenFarmers = new Set<string>();
  const seenParcels = new Set<string>();
  const farmerInserts: FarmerInsert[] = [];
  const parcelInserts: ParcelInsert[] = [];
  const unknownCoops = new Set<string>();

  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx]!;
    // CSV row number in 1-indexed sheet coords (header = row 1).
    const rowNum = idx + 2;
    const rawCoop = (r.Coop ?? '').trim();
    const code = COOP_LABEL_TO_CODE[rawCoop];
    if (!code) {
      unknownCoops.add(rawCoop || '<empty>');
      summary.skipped.push({
        row: rowNum,
        reason: `Unknown coop label "${rawCoop}"`,
        coop: rawCoop,
        producerId: r.ProducerID,
      });
      continue;
    }
    const coopId = coopByCode.get(code);
    if (!coopId) {
      unknownCoops.add(code);
      summary.skipped.push({
        row: rowNum,
        reason: `Coop code "${code}" not in iam.cooperatives`,
        coop: rawCoop,
        producerId: r.ProducerID,
      });
      continue;
    }

    const farmerInsert = toFarmerInsert(r, coopId);
    if (!farmerInsert) {
      summary.skipped.push({
        row: rowNum,
        reason: 'Missing or unparseable ProducerID / Producer name',
        coop: rawCoop,
        producerId: r.ProducerID,
      });
      continue;
    }
    if (!seenFarmers.has(farmerInsert.id!)) {
      seenFarmers.add(farmerInsert.id!);
      farmerInserts.push(farmerInsert);
    }

    const parcelInsert = toParcelInsert(r, coopId, farmerInsert.id!);
    if (parcelInsert && !seenParcels.has(parcelInsert.id!)) {
      seenParcels.add(parcelInsert.id!);
      parcelInserts.push(parcelInsert);
    }
  }

  // Fail fast if the CSV names coops the DB doesn't know about —
  // partial import in this state would silently drop whole
  // cooperatives worth of rows. Better to error, let the admin fix
  // the label or seed the coop, and retry.
  if (unknownCoops.size > 0 && farmerInserts.length === 0) {
    return {
      kind: 'unknown_coop',
      summary,
      unknownCoops: [...unknownCoops],
    };
  }

  const CHUNK = 500;

  // Pass 1: farmers
  for (let i = 0; i < farmerInserts.length; i += CHUNK) {
    const slice = farmerInserts.slice(i, i + CHUNK);
    await db
      .insert(farmers)
      .values(slice)
      .onConflictDoUpdate({
        target: farmers.id,
        set: {
          firstName: sql`excluded.first_name`,
          lastName: sql`excluded.last_name`,
          sex: sql`excluded.sex`,
          dateOfBirth: sql`excluded.date_of_birth`,
          phoneNumber: sql`excluded.phone_number`,
          nationalIdNumber: sql`excluded.national_id_number`,
          nationalIdType: sql`excluded.national_id_type`,
          hhAssessed: sql`excluded.hh_assessed`,
          society: sql`excluded.society`,
          householdSize: sql`excluded.household_size`,
          childrenCount: sql`excluded.children_count`,
          certificationStatus: sql`excluded.certification_status`,
          isActive: sql`excluded.is_active`,
          producerId: sql`excluded.producer_id`,
          externalSource: sql`excluded.external_source`,
          updatedAt: sql`now()`,
        },
      });
  }
  summary.farmersUpserted = farmerInserts.length;

  // Pass 2: parcels
  for (let i = 0; i < parcelInserts.length; i += CHUNK) {
    const slice = parcelInserts.slice(i, i + CHUNK);
    await db
      .insert(parcels)
      .values(slice)
      .onConflictDoUpdate({
        target: parcels.id,
        set: {
          farmerId: sql`excluded.farmer_id`,
          cooperativeId: sql`excluded.cooperative_id`,
          parcelName: sql`excluded.parcel_name`,
          calculatedAreaHa: sql`excluded.calculated_area_ha`,
          cropType: sql`excluded.crop_type`,
          updatedAt: sql`now()`,
        },
      });
  }
  summary.parcelsUpserted = parcelInserts.length;

  return { kind: 'ok', summary, unknownCoops: [...unknownCoops] };
}
