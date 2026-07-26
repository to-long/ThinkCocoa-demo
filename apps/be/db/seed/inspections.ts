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
      deforestationRisk: eudrCompliant ? 'low' : eudrStatus === 'needs_review' ? 'medium' : 'high',
      protectedAreaRisk: eudrStatus === 'non_compliant' ? 'high' : 'low',
      // Always populated so the detail card never shows blank rows.
      // `none/yes` read green, `overlap/no` read red via the FE tone map.
      overlap: eudrCompliant ? 'none' : eudrStatus === 'needs_review' ? 'review' : 'overlap',
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

  // Reflect the latest outcome on the farmer's denormalised
  // certification_status so the list "RA Certified" stat lights up.
  // We spread the certified pool across a realistic sample mix:
  // ~67% currently RA-certified, ~18% expired, ~15% pending renewal;
  // uncertified farmers are mostly "unknown" with ~20% "pending"
  // (awaiting their first assessment). The bucket is a deterministic
  // hash of the farmer id so reseeds land on the same distribution.
  await db.execute(sql`
    UPDATE farmer.farmers f
       SET certification_status = CASE
             WHEN latest.certification_outcome IN ('certified','certified_with_ca')
               THEN CASE
                      WHEN ('x' || substr(md5(f.id::text), 1, 4))::bit(16)::int % 100 < 18 THEN 'expired'
                      WHEN ('x' || substr(md5(f.id::text), 1, 4))::bit(16)::int % 100 < 33 THEN 'pending'
                      ELSE 'rainforest_alliance'
                    END
             ELSE CASE
                    WHEN ('x' || substr(md5(f.id::text), 1, 4))::bit(16)::int % 100 < 20 THEN 'pending'
                    ELSE 'unknown'
                  END
           END
      FROM (
        SELECT DISTINCT ON (farmer_id) farmer_id, certification_outcome
          FROM inspection.inspections
         ORDER BY farmer_id, date_inspection DESC
      ) latest
     WHERE latest.farmer_id = f.id
  `);

  console.log(
    `    seeded ${total} inspections + ${eudrValues.length} EUDR assessments (1 per parcel); ${driftCount} snapshots diverge from master`,
  );
}
