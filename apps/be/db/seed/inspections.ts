/**
 * Demo seed: one internal inspection per parcel.
 *
 * Populates `inspection.inspections` with entirely synthetic audit
 * data (RA compliance score + derived certification outcome, EUDR
 * verdict) so the Inspections list, farmer RA-certification columns,
 * certification dashboard and EUDR compliance widgets have data in the
 * demo. Deterministic (fixed PRNG seed) and idempotent (upsert by id).
 *
 * Depends on farmers + parcels already being seeded
 * (`SEED_FARMERS_FROM_CSV=true`). Gated behind `SEED_INSPECTIONS`.
 */

import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../src/db/client';
import { eudrStatus as eudrStatusTable } from '../../src/db/schema/gis';
import { farmers, parcels } from '../../src/db/schema/index';
import { inspections } from '../../src/db/schema/inspection';
import { gradeInspection } from '../../src/features/inspections/grading';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable numeric id derived from the parcel id (FNV-1a) so re-runs
 *  map the same parcel → same inspection PK, keeping the upsert (and
 *  the unique kobo_uuid) collision-free. */
function stableId(key: string, base: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return base + ((h >>> 0) % 1_000_000_000);
}

const COMPLIANCE_MAX = 142;

export async function seedInspections(db: Db): Promise<void> {
  console.log('  inspections: seeding one internal inspection per parcel...');

  const parcelRows = await db
    .select({
      id: parcels.id,
      farmerId: parcels.farmerId,
      cooperativeId: parcels.cooperativeId,
      // Master values the inspection snapshot is compared against on the
      // detail page. Most inspections mirror them; ~30% deliberately
      // diverge so the "Compare" affordance has something to show.
      parcelAreaHa: parcels.calculatedAreaHa,
      parcelPlantingDate: parcels.plantingDate,
      farmerDob: farmers.dateOfBirth,
      farmerSex: farmers.sex,
      farmerNationalId: farmers.nationalIdNumber,
      farmerHousehold: farmers.householdSize,
      farmerChildren: farmers.childrenCount,
    })
    .from(parcels)
    .leftJoin(farmers, eq(farmers.id, parcels.farmerId))
    // Deterministic order so the seeded RNG maps to the same parcel every
    // run — a given parcel keeps its EUDR verdict / compliance across
    // reseeds (and thus its risk zones stay stable).
    .orderBy(parcels.id);

  if (parcelRows.length === 0) {
    console.log('    skip: no parcels found — run farmer CSV seed first');
    return;
  }

  const rng = mulberry32(778201);
  /**
   * Weighted draw from `{value: probability}`. Weights are expected to
   * sum to 1; the last key catches any rounding remainder so a 0.999 total
   * can never fall through and return undefined.
   */
  const pick = (weights: Record<string, number>): string => {
    const entries = Object.entries(weights);
    let roll = rng();
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll <= 0) return value;
    }
    return entries[entries.length - 1]![0];
  };
  let driftCount = 0;
  const CHUNK = 500;
  const values: (typeof inspections.$inferInsert)[] = [];
  const eudrValues: (typeof eudrStatusTable.$inferInsert)[] = [];

  for (const p of parcelRows) {
    if (!p.farmerId) continue;

    // Compliance: skew toward the passing end so the demo looks healthy.
    const pct = Math.round((45 + rng() * 53) * 100) / 100; // 45.00 – 98.00
    const complianceScore = Math.round((pct / 100) * COMPLIANCE_MAX);
    const programYear = 1 + Math.floor(rng() * 3); // 1–3
    const outcome = gradeInspection(pct, programYear);

    // EUDR verdict — mostly compliant, a slice flagged for the map demo.
    const eudrRoll = rng();
    const eudrStatus =
      eudrRoll < 0.75 ? 'compliant' : eudrRoll < 0.9 ? 'needs_review' : 'non_compliant';
    const eudrCompliant = eudrStatus === 'compliant';

    // Inspection date within the last ~10 months.
    const daysAgo = 20 + Math.floor(rng() * 280);
    const date = new Date(Date.now() - daysAgo * 86_400_000);
    const dateStr = date.toISOString().slice(0, 10);

    const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
    const ghDigits = Array.from({ length: 9 }, () => int(0, 9)).join('');
    const harvest = int(200, 2000);
    const sold = Math.round(harvest * (0.6 + rng() * 0.35));
    // RA-critical flag: mostly compliant ('2'), a slice partial/fail.
    const raFlag = () => (rng() < 0.82 ? '2' : rng() < 0.6 ? '1' : '0');
    const TOPICS = ['GAP', 'IPM', 'PostHarvest', 'ChildLabour', 'Agroforestry', 'RecordKeeping'];

    // ~30% of inspections carry a snapshot that disagrees with the
    // current master row — the inspector found different facts, or the
    // office edited the record afterwards. That's what lights up the
    // "Compare" button + diff badge on the detail page. The other 70%
    // mirror the master exactly so the demo shows a realistic mix
    // instead of every card screaming "3 differences".
    const drift = rng() < 0.3;
    if (drift) driftCount++;
    const masterYear = p.parcelPlantingDate
      ? Number(String(p.parcelPlantingDate).slice(0, 4))
      : null;
    const masterArea = p.parcelAreaHa != null ? Number(p.parcelAreaHa) : null;
    // Non-drift rows mirror the master EXACTLY, nulls included — inventing
    // a value where the master has none would read as a diff and push the
    // real diff rate well past the intended 30% (e.g. only ~60% of farmers
    // carry a Ghana Card).
    const snapshot = drift
      ? {
          // Full ISO date, not a bare year — the master column is DATE, so
          // a year-only snapshot could never be applied to it.
          farmerDob: `${int(1960, 2000)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
          farmerGender: p.farmerSex === 'male' ? 'female' : 'male',
          ghanaCard: `GHA-${ghDigits}-${int(0, 9)}`,
          householdSize: int(1, 10),
          childrenCount: int(0, 6),
          // Field size drifts by a plausible re-measurement margin.
          fieldSizeHa: (
            (masterArea ?? 0.5 + rng() * 4.5) *
            (1 + (rng() < 0.5 ? -0.18 : 0.22))
          ).toFixed(4),
          yearEstablished: (masterYear ?? int(1990, 2020)) - int(1, 4),
        }
      : {
          farmerDob: p.farmerDob,
          farmerGender: p.farmerSex,
          ghanaCard: p.farmerNationalId,
          householdSize: p.farmerHousehold,
          childrenCount: p.farmerChildren,
          fieldSizeHa: masterArea != null ? masterArea.toFixed(4) : null,
          yearEstablished: masterYear,
        };

    const id = stableId(p.id, 900_000_000);
    values.push({
      id,
      koboUuid: `demo-insp-${p.id}`,
      formVersion: 'demo-v2',
      cooperativeId: p.cooperativeId,
      farmerId: p.farmerId,
      parcelId: p.id,
      dateInspection: dateStr,
      inspectorCode: `INS-${1 + Math.floor(rng() * 12)}`,
      eudrStatus,
      eudrScore: eudrCompliant ? 4 : eudrStatus === 'needs_review' ? 2 : 0,
      eudrNoDeforestation: eudrCompliant,
      eudrNoForestConversion: eudrCompliant,
      eudrOutsideHcva: eudrStatus !== 'non_compliant',
      eudrLegalRights: true,
      eudrAssessedAt: date,
      complianceScore,
      complianceMax: COMPLIANCE_MAX,
      compliancePct: pct.toFixed(2),
      programYear,
      certificationOutcome: outcome,
      // Structured detail (formerly raw_data). Snapshot = what the
      // inspector recorded, so it MIRRORS the master row unless this
      // inspection was picked to diverge (see `drift` above).
      farmerDob: snapshot.farmerDob,
      farmerGender: snapshot.farmerGender,
      ghanaCard: snapshot.ghanaCard,
      cocobodCard: `CB-${int(100000, 999999)}`,
      householdSize: snapshot.householdSize,
      childrenCount: snapshot.childrenCount,
      clmrsAssessed: rng() < 0.7,
      fieldSizeHa: snapshot.fieldSizeHa,
      yearEstablished: snapshot.yearEstablished,
      farmMapped: rng() < 0.85,
      gpsLocation: `${(5 + rng()).toFixed(5)} ${(-2 - rng()).toFixed(5)}`,
      permanentStaff: int(0, 5),
      temporaryStaff: int(0, 10),
      totalHarvestKg: harvest.toFixed(2),
      totalSoldKg: sold.toFixed(2),
      nextSeasonEstimateKg: Math.round(harvest * (0.9 + rng() * 0.3)).toFixed(2),
      anotherLbc: rng() < 0.15,
      anotherLbcReason: rng() < 0.15 ? 'Higher farmgate price offered' : null,
      trainingTopics: TOPICS.filter(() => rng() < 0.5).join(' ') || 'GAP',
      raChildLabour: raFlag(),
      raForcedLabour: raFlag(),
      raDiscrimination: raFlag(),
      raAbuse: raFlag(),
      submittedAt: date,
      submittedBy: 'demo-seed',
    });

    // Per-parcel EUDR assessment (drives the EUDR compliance dashboard
    // + the map colour coding). Mirrors the inspection's EUDR verdict.
    eudrValues.push({
      parcelId: p.id,
      status: eudrStatus,
      assessedAt: date,
      assessedBy: 'EUDR Analyst',
      baselineDataset: 'JRC Global Forest Cover 2020 (demo)',
      // The three verdicts are DRAWN, not derived, from the headline
      // status. Deriving them made all three move as one triplet — every
      // non-compliant plot was high/high/overlap and nothing was ever
      // "protected area: medium" — so the three list filters returned
      // identical rows and two of them looked broken. They still
      // correlate with the status (that is real: a plot flagged
      // non-compliant usually IS the one sitting on a reserve boundary),
      // just not perfectly.
      deforestationRisk: pick(
        eudrCompliant
          ? { low: 0.88, medium: 0.12 }
          : eudrStatus === 'needs_review'
            ? { low: 0.25, medium: 0.55, high: 0.2 }
            : { medium: 0.2, high: 0.8 },
      ),
      protectedAreaRisk: pick(
        eudrCompliant
          ? { low: 0.92, medium: 0.08 }
          : eudrStatus === 'needs_review'
            ? { low: 0.6, medium: 0.32, high: 0.08 }
            : { low: 0.25, medium: 0.3, high: 0.45 },
      ),
      // Always populated so the detail card never shows blank rows.
      // `none/yes` read green, `overlap/no` read red via the FE tone map.
      overlap: pick(
        eudrCompliant
          ? { none: 0.9, review: 0.1 }
          : eudrStatus === 'needs_review'
            ? { none: 0.2, review: 0.65, overlap: 0.15 }
            : { review: 0.25, overlap: 0.75 },
      ),
      onLand: 'yes',
      inCountry: 'yes',
      eudrExplanation: eudrCompliant
        ? 'Plot verified deforestation-free against the 2020 forest baseline; no protected-area or on-land conflicts.'
        : eudrStatus === 'needs_review'
          ? 'Partial forest-cover signal near the plot boundary — flagged for manual review before certification.'
          : 'Deforestation detected within the plot after the 2020 cut-off date; remediation required before sourcing.',
    });
  }

  let total = 0;
  for (let i = 0; i < values.length; i += CHUNK) {
    const slice = values.slice(i, i + CHUNK);
    await db
      .insert(inspections)
      .values(slice)
      .onConflictDoUpdate({
        target: inspections.id,
        set: {
          compliancePct: sql`excluded.compliance_pct`,
          complianceScore: sql`excluded.compliance_score`,
          certificationOutcome: sql`excluded.certification_outcome`,
          eudrStatus: sql`excluded.eudr_status`,
          programYear: sql`excluded.program_year`,
          // Snapshot fields must refresh too, otherwise a reseed keeps the
          // old random values and the compare diffs never change.
          farmerDob: sql`excluded.farmer_dob`,
          farmerGender: sql`excluded.farmer_gender`,
          ghanaCard: sql`excluded.ghana_card`,
          householdSize: sql`excluded.household_size`,
          childrenCount: sql`excluded.children_count`,
          fieldSizeHa: sql`excluded.field_size_ha`,
          yearEstablished: sql`excluded.year_established`,
          updatedAt: sql`now()`,
        },
      });
    total += slice.length;
  }

  // Per-parcel EUDR assessment rows (unique on parcel_id).
  for (let i = 0; i < eudrValues.length; i += CHUNK) {
    const slice = eudrValues.slice(i, i + CHUNK);
    await db
      .insert(eudrStatusTable)
      .values(slice)
      .onConflictDoUpdate({
        target: eudrStatusTable.parcelId,
        set: {
          status: sql`excluded.status`,
          assessedAt: sql`excluded.assessed_at`,
          assessedBy: sql`excluded.assessed_by`,
          baselineDataset: sql`excluded.baseline_dataset`,
          deforestationRisk: sql`excluded.deforestation_risk`,
          protectedAreaRisk: sql`excluded.protected_area_risk`,
          overlap: sql`excluded.overlap`,
          onLand: sql`excluded.on_land`,
          inCountry: sql`excluded.in_country`,
          eudrExplanation: sql`excluded.eudr_explanation`,
          updatedAt: sql`now()`,
        },
      });
  }

  // The farmer's RA certificate — presence, number, audit date, expiry —
  // and the denormalised `certification_status` that must agree with it:
  // a farmer marked `expired` whose certificate runs to next year is
  // worse than no data at all.
  //
  // Fixed proportions, because the demo has to show every state:
  //   10% hold no certificate at all
  //   of the 90% that do — 50% valid, 30% expiring inside the 90-day
  //   renewals window, 20% already lapsed
  // i.e. 10 / 45 / 27 / 18 of the whole book.
  //
  // The percentile is `row_number / count`, not `hash % 100` and not
  // NTILE. Two lessons paid for here: farmer ids are structured
  // (ABM-0001, ABM-0002…) so their md5s do not spread evenly across 100
  // buckets — modulo delivered 17/32/51 against a 20/30/50 target — and
  // NTILE hands its remainder to the FIRST tiles, so with 686 rows the
  // last 18 tiles held 16.3% instead of 18%. A rank over the row count
  // divides evenly wherever the boundaries fall, and stays deterministic
  // across reseeds.
  //
  // Deliberately NOT keyed off the latest inspection outcome any more:
  // inspection dates are relative to "now", so which inspection is latest
  // shifts between reseeds and the split wandered with it.
  //
  // Audit date is always 12 months before expiry — an RA certificate runs
  // a year from its audit, so the two cannot be drawn independently.
  await db.execute(sql`
    WITH ranked AS (
      SELECT f.id,
             ('x' || substr(md5(f.id::text), 5, 4))::bit(16)::int AS h2,
             CEIL(
               ROW_NUMBER() OVER (ORDER BY md5(f.id::text)) * 100.0 / COUNT(*) OVER ()
             )::int AS pct
        FROM farmer.farmers f
       WHERE f.deleted_at IS NULL
    ), dated AS (
      SELECT id, h2,
             CASE
               WHEN pct <= 10 THEN                         -- 10%: no certificate
                 CASE WHEN pct <= 4 THEN 'pending' ELSE 'unknown' END
               WHEN pct <= 55 THEN 'rainforest_alliance'   -- 45%: valid
               WHEN pct <= 82 THEN 'rainforest_alliance'   -- 27%: renewal due
               ELSE 'expired'                              -- 18%: lapsed
             END AS status,
             CASE
               WHEN pct <= 10 THEN NULL
               WHEN pct <= 55 THEN CURRENT_DATE + (120 + h2 % 400)
               WHEN pct <= 82 THEN CURRENT_DATE + (5 + h2 % 85)
               ELSE CURRENT_DATE - (10 + h2 % 320)
             END AS expiry
        FROM ranked
    )
    UPDATE farmer.farmers f
       SET certification_status = d.status,
           ra_expiry_date        = d.expiry,
           ra_audit_date         = CASE WHEN d.expiry IS NOT NULL THEN d.expiry - 365 END,
           ra_certificate_number = CASE WHEN d.expiry IS NOT NULL
                                        THEN 'RA-' || (100000 + d.h2 % 900000) END,
           ra_certifying_body    = CASE WHEN d.expiry IS NOT NULL
                                        THEN (ARRAY['Control Union','SGS','Bureau Veritas','Africert'])[1 + d.h2 % 4] END
      FROM dated d
     WHERE d.id = f.id
  `);

  console.log(
    `    seeded ${total} inspections + ${eudrValues.length} EUDR assessments (1 per parcel); ${driftCount} snapshots diverge from master`,
  );
}
