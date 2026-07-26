/**
 * Seed `farmer.farmers` from the 2025-2026 dataset
 * (`fixtures/farmers/farmer-dataset-2025-2026.csv`). One row per
 * field — we dedupe by `ProducerID` and take the first row's values
 * for the farmer record. Field/parcel rows are not ingested here;
 * that's the geo-import feature's job once we have GeoJSON/KML.
 *
 * Behaviour:
 *   - Opt-in via `SEED_FARMERS_FROM_CSV=true`. ~3.5k unique farmers
 *     across 4 coops, ~15 s of inserts on a warm DB; off by default
 *     so a fresh `bun db:migrate` stays snappy.
 *   - Idempotent: upserts on `(cooperative_id, farmer_code)`.
 *     Re-running updates mutable fields but preserves `id`,
 *     `created_at`, and soft-delete columns.
 *   - First-win on per-farmer values when the same `ProducerID`
 *     appears in multiple rows (one per field).
 *
 * Column mapping (CSV → schema):
 *   Coop                   → cooperative_id (via code map below)
 *   Society                → society
 *   Producer               → first_name + last_name (first token / rest)
 *   ProducerID             → id + producer_id
 *   DOBProducer            → date_of_birth (year only → YYYY-01-01)
 *   FarmerGender           → sex (lowercased)
 *   GhCard OR CocoBodCard  → national_id_number + national_id_type='ghana_card'
 *                            (both columns hold Ghana cards; CSV is
 *                            inconsistent which one is populated per
 *                            row — see `pickGhanaCard` below)
 *   PhoneNumber            → phone_number (raw — no normalisation)
 *   Hhsize                 → household_size
 *   NumberChildren         → children_count
 *   HHAssessed             → hh_assessed (Yes/No → bool; blank → null)
 *
 * Parcel pass (one row per CSV row with a `Field ID`):
 *   Coop                   → cooperative_id
 *   ProducerID             → farmer_id
 *   Field ID               → id (PK, post-0022)
 *   Field                  → parcel_name
 *   FIELD Size             → calculated_area_ha (assumed hectares;
 *                            Kobo Form 5a captures acres, but this
 *                            CSV's `FIELD Size` is already metric)
 *   (geometry left NULL — CSV has no lat/lng)
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../src/db/client';
import { cooperatives, farmers, parcels } from '../../src/db/schema/index';

// ── Fixture ───────────────────────────────────────────────────
const FIXTURES_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'farmers');
const CSV_FILE = 'farmer-dataset-2025-2026.csv';

// Map the human-readable `Coop` label in the CSV to the canonical
// cooperative code in `iam.cooperatives`. Trimmed before lookup so
// "Nkabom " (with stray trailing space) still resolves.
const COOP_LABEL_TO_CODE: Record<string, string> = {
  Sankofa: 'SANKOFA',
  Nkabom: 'NKABOM',
  Adwuma: 'ADWUMA',
  Aboma: 'ABOMA',
  Ayekoo: 'AYEKOO',
  Nhyira: 'NHYIRA',
};

// ── CSV parsing ───────────────────────────────────────────────
// Minimal RFC-4180-ish parser: `,` delimiter, `"` quote, `""` escape.
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

function parseCsv(path: string): Array<Record<string, string>> {
  const raw = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const lines = raw.split('\n').filter((l) => l.length > 0);
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

// ── Value coercion ────────────────────────────────────────────
const nullish = (v: string | undefined): string | null => {
  if (v == null) return null;
  const t = v.trim();
  if (t === '' || /^(none|n\/a|not available|unknown|-)$/i.test(t)) return null;
  return t;
};

const titleCase = (v: string | null): string | null => {
  if (!v) return v;
  return v.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
};

/** Split a full-name string into (first, last). One-token names get
 *  `lastName = '-'` so the NOT NULL constraint holds. */
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

/** Schema constrains `sex` to a fixed set. Normalise + fall back. */
function toSex(v: string | undefined): string | null {
  const t = nullish(v)?.toLowerCase();
  if (t === 'male' || t === 'female' || t === 'other') return t;
  return null;
}

/** DOB in this dataset is just a 4-digit year. Convert to a date
 *  ('YYYY-01-01'); a non-year value (timestamp, blank, garbage) → null. */
function toDob(v: string | undefined): string | null {
  const t = nullish(v);
  if (!t) return null;
  const m = t.match(/^(\d{4})$/);
  if (!m) return null;
  const year = +m[1]!;
  if (year < 1900 || year > 2025) return null;
  return `${year}-01-01`;
}

/** Phone is raw text in the CSV (sometimes a leading +, sometimes
 *  just a 9-digit local number). Keep raw — let any downstream
 *  feature normalise. Empty / placeholder → null. */
const toPhone = (v: string | undefined): string | null => nullish(v);

/** Non-negative smallint in schema. Reject obvious junk. */
function toCount(v: string | undefined): number | null {
  const t = nullish(v);
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 32767 || !Number.isInteger(n)) return null;
  return n;
}

/** Tri-state Yes/No/blank → boolean | null. The CSV `HHAssessed`
 *  column is mostly blank in the 2025-2026 dataset; we map blanks
 *  to null ("not yet asked") rather than false. */
function toBool(v: string | undefined): boolean | null {
  const t = nullish(v)?.toLowerCase();
  if (t === 'yes' || t === 'true' || t === 'y' || t === '1') return true;
  if (t === 'no' || t === 'false' || t === 'n' || t === '0') return false;
  return null;
}

/** Pick a Ghana Card ID from either CSV source column. The dataset
 *  is inconsistent — some rows put the ID in `GhCard`, others
 *  puts it in `CocoBodCard` (mis-labelled but same shape). A handful
 *  of rows leak gender into `GhCard` ("MALE"); we filter those out
 *  by requiring the GHA-/GHA<space> prefix. Returns the value
 *  normalised to `GHA-<digits>-<check>` (spaces → hyphens). */
const GHANA_CARD_RE = /^GHA[\s-]?\d{6,}[\s-]\d$/i;
function pickGhanaCard(row: Record<string, string>): string | null {
  for (const raw of [row.GhCard, row.CocoBodCard]) {
    const t = nullish(raw);
    if (!t) continue;
    if (!GHANA_CARD_RE.test(t)) continue;
    // Normalise the legacy `GHA 718972750-0` variant to `GHA-718972750-0`.
    return t.replace(/\s+/g, '-').toUpperCase();
  }
  return null;
}

/** Parse "1.2" / "3.36" → number, or null if not a positive area. */
function toAreaHa(v: string | undefined): string | null {
  const t = nullish(v);
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Drizzle's numeric() column round-trips through string; pass through
  // the trimmed CSV value so we don't lose precision on the trailing
  // zero ("3.30" → 3.3 would otherwise display as "3.3").
  return n.toFixed(4);
}

// ── Deterministic per-parcel attribute synthesis ─────────────
// The 2025-2026 CSV only carries Field ID / name / size, so the
// agronomic attributes shown on the Farm detail page (variety, tree
// count, spacing, ownership, nearby feature, planting date) are
// generated here — deterministically keyed off the Field ID so every
// re-seed produces the identical value and the demo looks complete.
function hashSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rngFor(key: string): () => number {
  let a = hashSeed(key);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COCOA_VARIETIES = ['hybrid', 'hybrid', 'hybrid', 'amazon', 'amelonado', 'other'] as const;
const TREE_SPACINGS = ['3m x 3m', '3m x 2.5m', '2.5m x 2.5m', '3.5m x 3m'] as const;
const LAND_OWNERSHIP = ['owned', 'owned', 'family', 'family', 'sharecropped', 'leased'] as const;
const NEARBY_FEATURES = ['road', 'river', 'hamlet', 'forest_reserve', 'other'] as const;

/** Synthesize the agronomic attributes for one parcel from its Field
 *  ID + area, so the Farm detail page has no empty rows. */
function parcelExtras(
  fieldId: string,
  areaHa: string | null,
): Pick<
  ParcelInsert,
  | 'plantingDate'
  | 'cocoaVariety'
  | 'treeSpacing'
  | 'cocoaTreeCount'
  | 'landOwnershipType'
  | 'nearbyFeatureType'
  | 'willingToRehabilitate'
  | 'shadeSurvivalPct'
> {
  const rng = rngFor(fieldId);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)] as T;
  // Planting year 1998–2020, mid-month for a clean date.
  const year = 1998 + Math.floor(rng() * 23);
  const month = 1 + Math.floor(rng() * 12);
  const plantingDate = `${year}-${String(month).padStart(2, '0')}-15`;
  // ~1000–1300 trees/ha (3×3 spacing ≈ 1111/ha) scaled by area, with
  // noise. Falls back to a plain range when area is unknown.
  const area = areaHa ? Number(areaHa) : null;
  const density = 1000 + Math.floor(rng() * 300);
  const cocoaTreeCount =
    area && area > 0
      ? Math.max(120, Math.round(area * density))
      : 300 + Math.floor(rng() * 1200);
  return {
    plantingDate,
    cocoaVariety: pick(COCOA_VARIETIES),
    treeSpacing: pick(TREE_SPACINGS),
    cocoaTreeCount,
    landOwnershipType: pick(LAND_OWNERSHIP),
    nearbyFeatureType: pick(NEARBY_FEATURES),
    willingToRehabilitate: rng() < 0.7,
    // Shade-tree survival — 55–95%, the band the Farm detail tile +
    // list "Shade survival" column read from.
    shadeSurvivalPct: (55 + rng() * 40).toFixed(2),
  };
}

// ── Insert shapes ─────────────────────────────────────────────
type FarmerInsert = typeof farmers.$inferInsert;
type ParcelInsert = typeof parcels.$inferInsert;

function toFarmerInsert(row: Record<string, string>, cooperativeId: string): FarmerInsert | null {
  const code = nullish(row.ProducerID);
  if (!code) return null;

  const name = splitName(nullish(row.Producer));
  if (!name) return null;

  const ghanaCard = pickGhanaCard(row);

  return {
    // `id` IS the ProducerID. No auto-gen UUID anymore (see migration
    // 0019). `producerId` keeps the same value for Kobo-sync matching.
    id: code,
    cooperativeId,
    externalSource: 'farmer_dataset_2025_2026',
    producerId: code,
    firstName: name.firstName,
    lastName: name.lastName,
    sex: toSex(row.FarmerGender),
    dateOfBirth: toDob(row.DOBProducer),
    phoneNumber: toPhone(row.PhoneNumber),
    nationalIdNumber: ghanaCard,
    nationalIdType: ghanaCard ? 'ghana_card' : null,
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
  const areaHa = toAreaHa(row['FIELD Size']);
  return {
    // `id` IS the source-system Field ID (e.g. "AS-AK001F1"). No
    // auto-gen UUID anymore (see migration 0022). URLs / FK refs
    // all hang off this human-readable code now.
    id: fieldId,
    cooperativeId,
    farmerId,
    parcelName: nullish(row.Field),
    calculatedAreaHa: areaHa,
    parcelStatus: 'active',
    cropType: 'cocoa',
    // Agronomic attributes synthesized deterministically (the CSV
    // carries none) so the Farm detail page renders complete.
    ...parcelExtras(fieldId, areaHa),
    // geometry stays NULL — the 2025-2026 CSV doesn't carry lat/lng,
    // so we don't populate `gis.parcel_geometries`. A later
    // geo-import job will fill that in from a separate GeoJSON/KML
    // export and join on `parcels.id`.
  };
}

// ── Orchestrator ──────────────────────────────────────────────
export async function seedFarmersFromCsv(db: Db): Promise<void> {
  console.log(`  farmers: seeding from ${CSV_FILE}...`);

  const path = join(FIXTURES_DIR, CSV_FILE);
  if (!existsSync(path)) {
    console.log(`    skip: ${CSV_FILE} not found at ${path}`);
    return;
  }

  const coopRows = await db.select().from(cooperatives);
  const coopByCode = new Map(coopRows.map((c) => [c.code, c.id]));

  const rows = parseCsv(path);
  console.log(`    parsed ${rows.length} rows from CSV`);

  // Two passes over the CSV:
  //   1. Farmer rows — dedupe by ProducerID (the new PK), first-win
  //      on per-farmer columns. The CSV has N rows per farmer (one
  //      per field) so many rows collapse.
  //   2. Parcel rows — keep every row with a non-blank Field ID;
  //      one parcel per row. References the farmer inserted above.
  //
  // We bucket by coop code so the per-coop log line shows the same
  // totals the existing dashboards have come to expect.
  const seenFarmers = new Set<string>();
  const farmerBuckets = new Map<string, FarmerInsert[]>();
  const parcelBuckets = new Map<string, ParcelInsert[]>();
  const seenParcels = new Set<string>();
  const skippedNoCoop = new Map<string, number>();

  for (const r of rows) {
    const rawCoop = (r.Coop ?? '').trim();
    const code = COOP_LABEL_TO_CODE[rawCoop];
    if (!code) {
      skippedNoCoop.set(rawCoop || '<empty>', (skippedNoCoop.get(rawCoop || '<empty>') ?? 0) + 1);
      continue;
    }
    const coopId = coopByCode.get(code);
    if (!coopId) {
      skippedNoCoop.set(code, (skippedNoCoop.get(code) ?? 0) + 1);
      continue;
    }

    // ── Farmer (dedupe by ProducerID = id, globally unique) ────
    const farmerInsert = toFarmerInsert(r, coopId);
    if (farmerInsert && !seenFarmers.has(farmerInsert.id!)) {
      seenFarmers.add(farmerInsert.id!);
      const bucket = farmerBuckets.get(code) ?? [];
      bucket.push(farmerInsert);
      farmerBuckets.set(code, bucket);
    }

    // ── Parcel (one per row, dedupe by Field ID) ───────────────
    if (farmerInsert) {
      const parcelInsert = toParcelInsert(r, coopId, farmerInsert.id!);
      if (parcelInsert && !seenParcels.has(parcelInsert.id!)) {
        seenParcels.add(parcelInsert.id!);
        const bucket = parcelBuckets.get(code) ?? [];
        bucket.push(parcelInsert);
        parcelBuckets.set(code, bucket);
      }
    }
  }

  if (skippedNoCoop.size > 0) {
    for (const [label, n] of skippedNoCoop) {
      console.log(`    ⚠ skipped ${n} rows with unmappable coop "${label}"`);
    }
  }

  // Bulk upsert in chunks of 500 to stay under PG's ~65k bound
  // parameter ceiling per INSERT.
  const CHUNK = 500;

  // ── Pass 1: farmers ────────────────────────────────────────────
  let totalFarmers = 0;
  for (const [code, values] of farmerBuckets) {
    for (let i = 0; i < values.length; i += CHUNK) {
      const slice = values.slice(i, i + CHUNK);
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
    totalFarmers += values.length;
    console.log(`    ${code}: ${values.length} farmers`);
  }

  // ── Pass 2: parcels (must follow farmers so the FK resolves) ───
  let totalParcels = 0;
  for (const [code, values] of parcelBuckets) {
    for (let i = 0; i < values.length; i += CHUNK) {
      const slice = values.slice(i, i + CHUNK);
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
            plantingDate: sql`excluded.planting_date`,
            cocoaVariety: sql`excluded.cocoa_variety`,
            treeSpacing: sql`excluded.tree_spacing`,
            cocoaTreeCount: sql`excluded.cocoa_tree_count`,
            landOwnershipType: sql`excluded.land_ownership_type`,
            nearbyFeatureType: sql`excluded.nearby_feature_type`,
            willingToRehabilitate: sql`excluded.willing_to_rehabilitate`,
            shadeSurvivalPct: sql`excluded.shade_survival_pct`,
            updatedAt: sql`now()`,
          },
        });
    }
    totalParcels += values.length;
    console.log(`    ${code}: ${values.length} parcels`);
  }

  // Final per-coop tally — farmers + parcels side by side.
  const tally = await db
    .select({
      code: cooperatives.code,
      farmerCount: sql<number>`CAST(count(DISTINCT ${farmers.id}) AS INT)`,
      parcelCount: sql<number>`CAST(count(DISTINCT ${parcels.id}) AS INT)`,
    })
    .from(cooperatives)
    .leftJoin(farmers, eq(farmers.cooperativeId, cooperatives.id))
    .leftJoin(parcels, eq(parcels.cooperativeId, cooperatives.id))
    .groupBy(cooperatives.code)
    .orderBy(cooperatives.code);

  console.log(`    total: ${totalFarmers} farmers + ${totalParcels} parcels upserted from CSV`);
  for (const t of tally) {
    console.log(
      `      ${t.code}: ${Number(t.farmerCount)} farmers, ${Number(t.parcelCount)} parcels`,
    );
  }
}
