/**
 * Demo seed: one coaching visit (carrying a CLMRS verdict) per farmer.
 *
 * Populates `coaching.coaching_visits` — the table behind the Coaching
 * list, the Coaching detail (scores, compliance flags, Section H
 * CLMRS) and the CLMRS register. Entirely synthetic, deterministic,
 * idempotent (upsert by kobo_uuid).
 *
 * Per cooperative: a random 10–30 farmers get an open `case`, another
 * band get `at_risk`, and the rest `no_risk`.
 *
 * Depends on farmers already being seeded (`SEED_FARMERS_FROM_CSV=true`).
 * Gated behind `SEED_CLMRS`.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../../src/db/client';
import { coachingVisits } from '../../src/db/schema/coaching';
import { farmers } from '../../src/db/schema/index';

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

function stableId(key: string, base: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return base + ((h >>> 0) % 1_000_000_000);
}

type Row = {
  id: string;
  cooperativeId: string | null;
  society: string | null;
  childrenCount: number | null;
};
type Risk = 'no_risk' | 'at_risk' | 'case';

// ── Synthetic Kobo-shaped coaching payload (demo only) ────────────
// Rebuilds the Section A–H form the coaching detail page renders, from
// the visit's structured values. Keyed off the farmer id so it's
// deterministic + independent of the outer risk-assignment RNG.
const CHEM = ['Ridomil Gold', 'Confidor', 'Actara', 'Kocide 101'];
const CHEM_TYPE = ['fungicide', 'insecticide'];
const UNITS = ['L', 'kg', 'ml'];
const FERT = ['NPK 15-15-15', 'Asaase Wura', 'Cocofeed', 'Sidalco'];
const FERT_TYPE = ['granular', 'foliar', 'organic'];
const WEED_METHOD = ['manual slashing', 'selective herbicide', 'ring weeding'];
const LEVELS = ['low', 'moderate', 'high'];
const PRUNE_TYPE = ['sanitation', 'structural', 'chupon removal'];
const QUALITY = ['good', 'fair', 'excellent'];
const HARVEST_PERIOD = ['main crop', 'light crop'];
const HARVEST_FREQ = ['weekly', 'fortnightly', 'monthly'];
const MATURITY = ['ripe pods only', 'mixed maturity', 'some over-ripe'];
const OTHER_TYPE = ['shade management', 'drainage clearing', 'nursery work', 'record keeping'];
const OTHER_MAT = ['machete', 'shade seedlings', 'record book', 'pruning saw'];

interface RawCounts {
  chem: number;
  fert: number;
  weed: number;
  prune: number;
  harvest: number;
  other: number;
}

function buildCoachingRaw(
  farmerId: string,
  society: string | null,
  risk: Risk,
  childrenCount: number,
  visitDate: string,
  counts: RawCounts,
): Record<string, unknown> {
  const r = mulberry32(stableId(farmerId, 12345));
  const rp = <T>(a: T[]): T => a[Math.floor(r() * a.length)] as T;
  const ri = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const back = (days: number) =>
    new Date(new Date(visitDate).getTime() - days * 86_400_000).toISOString().slice(0, 10);
  /** Compliance flag: emits the good value ~85% of the time. */
  const flag = (good: string, bad: string) => (r() < 0.85 ? good : bad);

  const raw: Record<string, unknown> = {
    // Section A — farm profile
    'sec_a/farm_name': `${(society ?? 'Cocoa').replace(/ Society$/, '')} plot`,
    'sec_a/farm_size_ha': (1 + r() * 3).toFixed(2),
    'sec_a/num_plots': String(ri(1, 3)),
    'sec_a/avg_tree_age': String(ri(5, 25)),
    // Kobo geopoint format: space-separated "lat lng alt acc".
    'sec_a/gps_plot': `${(6.13 + r() * 0.04).toFixed(5)} ${(-2.72 + r() * 0.04).toFixed(5)} 180 5`,
    // Compliance flags (J/K/L)
    'sec_k/gep_deforestation': flag('no', 'yes'),
    'sec_j/ipm_approved': flag('yes', 'no'),
    'sec_j/ipm_ppe': flag('yes', 'no'),
    'sec_j/ipm_storage': flag('yes', 'no'),
    'sec_k/gep_buffer_zone': flag('yes', 'no'),
    'sec_l/gsp_fair_pay': flag('yes', 'no'),
    'sec_l/gsp_forced_labour': flag('no', 'yes'),
    'sec_i/gap_practices': flag('yes', 'no'),
    // Section P — enumerator observation
    'sec_p/obs_farm_condition':
      risk === 'no_risk'
        ? 'Farm well maintained; healthy canopy and clean cocoa floor.'
        : 'Farm generally in order, a few maintenance gaps noted.',
    'sec_p/obs_non_compliance':
      risk === 'case'
        ? 'Child observed assisting during the visit — escalated as a CLMRS case.'
        : risk === 'at_risk'
          ? 'Household shows early risk indicators; follow-up scheduled.'
          : 'No non-compliance observed.',
    'sec_p/obs_advice_given':
      'Advised on shade management, correct PPE use, and keeping a farm record book.',
    // Section Q — summary + sign-off
    'sec_q/sum_good_practices': 'Timely weeding, approved agrochemicals, buffer zone respected.',
    'sec_q/sum_gaps':
      risk === 'no_risk' ? 'Minor pruning backlog.' : 'Child-labour awareness gaps.',
    'sec_q/sum_coaching_advice': 'Scheduled follow-up coaching and CLMRS sensitisation.',
    'sec_q/sum_coach_signoff': 'signed',
    'sec_q/sum_farmer_signoff': 'signed',
    // Section H — CLMRS assessment
    'sec_h_awareness/cl_heard': 'yes',
    'sec_h_awareness/cl_know_diff': flag('yes', 'no'),
    'sec_h_awareness/cl_know_light_age': flag('yes', 'no'),
    'sec_h_awareness/cl_know_legal_age': 'yes',
    'sec_h_awareness/cl_know_hazardous': flag('yes', 'no'),
    'sec_h_household/cl_children_in_hh': childrenCount > 0 ? 'yes' : 'no',
    'sec_h_household/cl_children_help': risk === 'no_risk' ? 'no' : 'yes',
    'sec_h_household/cl_miss_school': risk === 'case' ? 'yes' : 'no',
    'sec_h_household/cl_heavy_loads': risk === 'case' ? 'yes' : 'no',
    'sec_h_household/cl_spray_chemicals': risk === 'case' ? 'yes' : 'no',
    'sec_h_household/cl_sharp_tools': risk !== 'no_risk' ? 'yes' : 'no',
    'sec_h_household/cl_enrolled': risk === 'case' ? 'no' : 'yes',
    'sec_h_observation/cl_obs_child_working': risk === 'case' ? 'yes' : 'no',
    'sec_h_observation/cl_obs_risk_level': risk,
  };

  // Section B–G — activity repeat groups, sized to match the visit's
  // structured n_* counts so the detail's "N activities" tallies line up.
  raw.sec_b = Array.from({ length: counts.chem }, () => ({
    'sec_b/chem_app_date': back(ri(5, 90)),
    'sec_b/chem_product': rp(CHEM),
    'sec_b/chem_type': rp(CHEM_TYPE),
    'sec_b/chem_quantity': String(ri(1, 5)),
    'sec_b/chem_unit': rp(UNITS),
  }));
  raw.sec_c = Array.from({ length: counts.fert }, () => ({
    'sec_c/fert_app_date': back(ri(5, 90)),
    'sec_c/fert_product': rp(FERT),
    'sec_c/fert_type': rp(FERT_TYPE),
    'sec_c/fert_quantity': String(ri(1, 8)),
    'sec_c/fert_unit': 'kg',
  }));
  raw.sec_d = Array.from({ length: counts.weed }, () => ({
    'sec_d/weed_date': back(ri(5, 90)),
    'sec_d/weed_method': rp(WEED_METHOD),
    'sec_d/weed_pressure': rp(LEVELS),
  }));
  raw.sec_e = Array.from({ length: counts.prune }, () => ({
    'sec_e/prune_date': back(ri(5, 90)),
    'sec_e/prune_type': rp(PRUNE_TYPE),
    'sec_e/prune_quality': rp(QUALITY),
  }));
  raw.sec_f = Array.from({ length: counts.harvest }, () => ({
    'sec_f/harvest_period': rp(HARVEST_PERIOD),
    'sec_f/harvest_freq': rp(HARVEST_FREQ),
    'sec_f/harvest_maturity': rp(MATURITY),
  }));
  raw.sec_g = Array.from({ length: counts.other }, () => ({
    'sec_g/other_activity_date': back(ri(5, 90)),
    'sec_g/other_activity_type': rp(OTHER_TYPE),
    'sec_g/other_materials': rp(OTHER_MAT),
  }));

  return raw;
}

export async function seedCoachingClmrs(db: Db): Promise<void> {
  console.log('  coaching-clmrs: seeding one coaching visit + CLMRS verdict per farmer...');

  const farmerRows: Row[] = await db
    .select({
      id: farmers.id,
      cooperativeId: farmers.cooperativeId,
      society: farmers.society,
      childrenCount: farmers.childrenCount,
    })
    .from(farmers);

  if (farmerRows.length === 0) {
    console.log('    skip: no farmers found — run farmer CSV seed first');
    return;
  }

  const byCoop = new Map<string, Row[]>();
  for (const f of farmerRows) {
    const key = f.cooperativeId ?? '__none__';
    const bucket = byCoop.get(key) ?? [];
    bucket.push(f);
    byCoop.set(key, bucket);
  }

  const rng = mulberry32(551903);
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const CHUNK = 500;
  const values: (typeof coachingVisits.$inferInsert)[] = [];
  const tally = { no_risk: 0, at_risk: 0, case: 0 };

  for (const [, group] of byCoop) {
    const order = group.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }

    const caseCount = Math.min(order.length, 10 + Math.floor(rng() * 21)); // 10–30
    const atRiskCount = Math.min(order.length - caseCount, 15 + Math.floor(rng() * 26)); // 15–40

    order.forEach((f, idx) => {
      const risk: Risk =
        idx < caseCount ? 'case' : idx < caseCount + atRiskCount ? 'at_risk' : 'no_risk';
      tally[risk]++;

      const daysAgo = 15 + Math.floor(rng() * 200);
      const date = new Date(Date.now() - daysAgo * 86_400_000);
      const dateStr = date.toISOString().slice(0, 10);

      const counts = {
        chem: int(0, 3),
        fert: int(0, 2),
        weed: int(0, 2),
        prune: int(0, 2),
        harvest: int(0, 2),
        other: int(0, 1),
      };

      values.push({
        koboUuid: `demo-cv-${f.id}`,
        koboId: stableId(f.id, 800_000_000),
        formVersion: 'demo-v3',
        cooperativeId: f.cooperativeId,
        farmerId: f.id,
        coachName: `Coach ${int(1, 20)}`,
        visitDate: dateStr,
        district: 'Demo District',
        society: f.society,
        clmrsRiskLevel: risk,
        clmrsCaseId: risk === 'case' ? `CLMRS-${f.id}` : null,
        childrenObservedWorking: risk === 'case',
        numChildrenInHousehold: f.childrenCount ?? 0,
        gapScore: int(50, 99),
        ipmScore: int(50, 99),
        gepScore: int(50, 99),
        gspScore: int(50, 99),
        overallScore: int(55, 98),
        gepNoDeforestation: rng() < 0.9,
        nChemicalApps: counts.chem,
        nFertilizerApps: counts.fert,
        nWeedingActs: counts.weed,
        nPruningActs: counts.prune,
        nHarvestActs: counts.harvest,
        nOtherActs: counts.other,
        followUpRequired: risk !== 'no_risk',
        followUpDate:
          risk !== 'no_risk'
            ? new Date(date.getTime() + 30 * 86_400_000).toISOString().slice(0, 10)
            : null,
        rawData: buildCoachingRaw(f.id, f.society, risk, f.childrenCount ?? 0, dateStr, counts),
        submittedAt: date,
        submittedBy: 'demo-seed',
      });
    });
  }

  let total = 0;
  for (let i = 0; i < values.length; i += CHUNK) {
    const slice = values.slice(i, i + CHUNK);
    await db
      .insert(coachingVisits)
      .values(slice)
      .onConflictDoUpdate({
        target: coachingVisits.koboUuid,
        set: {
          clmrsRiskLevel: sql`excluded.clmrs_risk_level`,
          clmrsCaseId: sql`excluded.clmrs_case_id`,
          overallScore: sql`excluded.overall_score`,
          followUpRequired: sql`excluded.follow_up_required`,
          followUpDate: sql`excluded.follow_up_date`,
          rawData: sql`excluded.raw_data`,
          updatedAt: sql`now()`,
        },
      });
    total += slice.length;
  }

  // Attach each visit to one of the farmer's parcels — the coaching form
  // records which plot was visited, and the list/detail render it. Picked
  // deterministically (lowest parcel id) so reseeds stay stable.
  await db.execute(sql`
    UPDATE coaching.coaching_visits v
       SET parcel_id = p.id
      FROM (
        SELECT DISTINCT ON (farmer_id) farmer_id, id
          FROM gis.parcels
         WHERE deleted_at IS NULL AND farmer_id IS NOT NULL
         ORDER BY farmer_id, id
      ) p
     WHERE p.farmer_id = v.farmer_id
       AND v.parcel_id IS DISTINCT FROM p.id
  `);
  const [{ n: withParcel } = { n: 0 }] = (
    await db.execute(sql`SELECT count(parcel_id)::int AS n FROM coaching.coaching_visits`)
  ).rows as { n: number }[];

  // ── CLMRS remediation cases (corrective actions from coaching) ──
  // Every child-labour CASE gets a remediation action; ~18 stay OPEN
  // (deterministic by id order) and the rest are marked done, so the
  // dashboard shows a realistic 15–20 open remediation caseload plus a
  // history of closed ones. Rebuilt each run (coaching-source only).
  await db.execute(sql`DELETE FROM inspection.corrective_actions WHERE source = 'coaching'`);
  await db.execute(sql`
    INSERT INTO inspection.corrective_actions
      (source, coaching_visit_id, farmer_id, parcel_id, cooperative_id, date_inspection, topic, action, action_date, status, last_comment)
    SELECT
      'coaching', v.id, v.farmer_id,
      (SELECT p.id FROM gis.parcels p WHERE p.farmer_id = v.farmer_id AND p.deleted_at IS NULL LIMIT 1),
      v.cooperative_id, v.visit_date,
      'child_labour',
      'Remediation plan: enrol child in school, remove from hazardous tasks, monthly household monitoring.',
      (v.visit_date + INTERVAL '45 days')::date,
      CASE WHEN row_number() OVER (ORDER BY v.id) <= 18 THEN 'open' ELSE 'done' END,
      CASE WHEN row_number() OVER (ORDER BY v.id) <= 18 THEN NULL ELSE 'Child enrolled; household re-assessed as low risk.' END
    FROM coaching.coaching_visits v
    WHERE v.clmrs_risk_level = 'case'
    ON CONFLICT (coaching_visit_id, topic) WHERE coaching_visit_id IS NOT NULL DO NOTHING
  `);
  const [{ n: openCount } = { n: 0 }] = (
    await db.execute(
      sql`SELECT count(*)::int AS n FROM inspection.corrective_actions WHERE source='coaching' AND status <> 'done'`,
    )
  ).rows as { n: number }[];

  // Internal-inspection corrective actions — one per flagged RA topic.
  // Each coop is topped up to a deterministic 20–40 total (net of the
  // coaching rows already inserted above, floored at 10 so inspection
  // is always represented). Inspections with a real finding are ranked
  // first; clean ones backfill to reach the target. Rebuilt each run.
  await db.execute(sql`DELETE FROM inspection.corrective_actions WHERE source = 'inspection'`);
  await db.execute(sql`
    INSERT INTO inspection.corrective_actions
      (source, inspection_id, farmer_id, parcel_id, cooperative_id, date_inspection, topic, action, action_date, status, last_comment)
    SELECT
      'inspection', c.inspection_id, c.farmer_id, c.parcel_id, c.cooperative_id, c.date_inspection,
      c.topic,
      'Corrective action required for ' || replace(c.topic, '_', ' ') || ' — verify remediation at next audit.',
      (c.date_inspection + INTERVAL '30 days')::date,
      CASE (c.rn % 5)
        WHEN 0 THEN 'open'
        WHEN 1 THEN 'processing'
        WHEN 2 THEN 'reopen'
        ELSE 'done'
      END,
      CASE WHEN (c.rn % 5) >= 3 THEN 'Verified corrected on follow-up inspection.' ELSE NULL END
    FROM (
      SELECT
        i.id AS inspection_id, i.farmer_id, i.parcel_id, i.cooperative_id, i.date_inspection,
        (ARRAY['missing_records','no_ppe','chem_storage_disposal','child_labour','deforestation','no_buffer_zone','waste_burning','poor_farm_maintenance'])[
          1 + (row_number() OVER (
            PARTITION BY i.cooperative_id
            ORDER BY
              CASE i.certification_outcome
                WHEN 'disqualified' THEN 0 WHEN 'not_certified' THEN 1 WHEN 'certified_with_ca' THEN 2 ELSE 3
              END, i.id
          )::int % 8)
        ] AS topic,
        row_number() OVER (
          PARTITION BY i.cooperative_id
          ORDER BY
            CASE i.certification_outcome
              WHEN 'disqualified' THEN 0 WHEN 'not_certified' THEN 1 WHEN 'certified_with_ca' THEN 2 ELSE 3
            END, i.id
        ) AS rn,
        GREATEST(
          (20 + (('x' || substr(md5(i.cooperative_id::text), 1, 4))::bit(16)::int % 21))
            - COALESCE((
                SELECT count(*) FROM inspection.corrective_actions ca
                 WHERE ca.source = 'coaching' AND ca.cooperative_id = i.cooperative_id
              ), 0),
          10
        ) AS target
      FROM inspection.inspections i
      WHERE i.parcel_id IS NOT NULL
    ) c
    WHERE c.rn <= c.target
    ON CONFLICT (inspection_id, topic) DO NOTHING
  `);
  const caPerCoop = (
    await db.execute(sql`
      SELECT count(*)::int AS n
        FROM inspection.corrective_actions
       GROUP BY cooperative_id
    `)
  ).rows as { n: number }[];
  const totalCa = caPerCoop.reduce((s, r) => s + r.n, 0);
  const minCa = caPerCoop.length ? Math.min(...caPerCoop.map((r) => r.n)) : 0;
  const maxCa = caPerCoop.length ? Math.max(...caPerCoop.map((r) => r.n)) : 0;

  console.log(
    `    seeded ${total} coaching visits (${withParcel} linked to a parcel) — CLMRS: ${tally.no_risk} no_risk, ${tally.at_risk} at_risk, ${tally.case} case`,
  );
  console.log(`    CLMRS remediation: ${openCount} open cases`);
  console.log(
    `    corrective actions: ${totalCa} total across ${caPerCoop.length} coops (${minCa}–${maxCa} per coop)`,
  );
}
