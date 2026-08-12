/**
 * Demo seed: VSLA, society purchases, primary + secondary evacuation.
 *
 * Populates the operations/traceability tables with synthetic,
 * deterministic, idempotent data so the VSLA, Purchases, Primary
 * Evacuation and Secondary Evacuation pages are no longer empty.
 *
 * Depends on cooperatives (all four) + farmers/parcels (for purchases),
 * so it runs alongside the farmer CSV seed. Opt out with SEED_OPS=false.
 */

import { coopFarmerCodePrefix } from '@thinkcocoa/shared';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../src/db/client';
import { cooperatives } from '../../src/db/schema/iam';
import { farmers, parcels } from '../../src/db/schema/index';
import { primaryEvacLotPurchases, primaryEvacLots } from '../../src/db/schema/primary-evacuation';
import { cocoaPurchases } from '../../src/db/schema/purchase';
import {
  secondaryEvacLotPrimaries,
  secondaryEvacLots,
} from '../../src/db/schema/secondary-evacuation';
import { trainingAttendance, trainingSessions } from '../../src/db/schema/training';
import { vslaGroups, vslaMonthlyReports } from '../../src/db/schema/vsla';

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

const PORTS = ['North Port', 'South Port'];
const GROUP_WORDS = ['Nkosuo', 'Boafo', 'Adom', 'Nhyira', 'Odo', 'Biakoye', 'Gyidie', 'Ahoto'];

export async function seedDemoOps(db: Db): Promise<void> {
  console.log('  demo-ops: seeding VSLA + purchases + evacuation...');

  const coops = await db
    .select({ id: cooperatives.id, code: cooperatives.code, name: cooperatives.name })
    .from(cooperatives);
  if (coops.length === 0) {
    console.log('    skip: no cooperatives found');
    return;
  }

  // Distinct farmer societies per coop — reused for VSLA groups so the
  // society filter is coherent across farmers / purchases / VSLA.
  const socRows = await db
    .selectDistinct({ cooperativeId: farmers.cooperativeId, society: farmers.society })
    .from(farmers)
    .orderBy(farmers.cooperativeId, farmers.society);
  const societiesByCoop = new Map<string, string[]>();
  for (const s of socRows) {
    if (!s.cooperativeId || !s.society) continue;
    const b = societiesByCoop.get(s.cooperativeId) ?? [];
    b.push(s.society);
    societiesByCoop.set(s.cooperativeId, b);
  }

  const rng = mulberry32(424242);
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const pick = <T>(a: T[]) => a[Math.floor(rng() * a.length)]!;
  const dateBack = (days: number) => new Date(Date.now() - days * 86_400_000);
  const dstr = (d: Date) => d.toISOString().slice(0, 10);

  // ── VSLA groups + monthly reports ─────────────────────────────
  let groupCount = 0;
  let reportCount = 0;
  for (const c of coops) {
    const prefix = coopFarmerCodePrefix(c.code);
    const coopSocieties = societiesByCoop.get(c.id) ?? [];
    const nGroups = int(10, 15);
    for (let g = 1; g <= nGroups; g++) {
      const naturalKey = `${c.code}-VG-${g}`;
      const society = coopSocieties.length > 0 ? pick(coopSocieties) : null;
      const nReports = 12; // 12 months of cycle data (trends chart)
      let savings = int(2000, 6000);
      const activeMembers = int(15, 30);
      let lastMonth = '';
      let lastActive = activeMembers;
      let lastSavings = savings;
      let lastLate = 0;
      let discrepancies = 0;

      const [grp] = await db
        .insert(vslaGroups)
        .values({
          naturalKey,
          groupNumber: `${prefix}-${String(g).padStart(3, '0')}`,
          groupName: `${pick(GROUP_WORDS)} Savings Group ${g}`,
          enumeratorId: `ENU-${int(100, 999)}`,
          enumeratorPrefix: prefix,
          cooperativeId: c.id,
          society,
          communityWorkerName: `Field Agent ${int(1, 12)}`,
          shareValue: String(int(2, 10)),
          interestFee: '10',
          reportCount: nReports,
        })
        .onConflictDoUpdate({
          target: vslaGroups.naturalKey,
          set: { society, reportCount: nReports, updatedAt: sql`now()` },
        })
        .returning({ id: vslaGroups.id });
      const groupId = grp!.id;
      groupCount++;

      for (let m = nReports; m >= 1; m--) {
        const month = dateBack(m * 30);
        const monthStr = dstr(new Date(month.getFullYear(), month.getMonth(), 1));
        savings += int(300, 900);
        const late = rng() < 0.25 ? int(1, 3) : 0;
        const hasDisc = rng() < 0.12;
        if (hasDisc) discrepancies++;
        const male = Math.round(activeMembers * (0.4 + rng() * 0.2));
        await db
          .insert(vslaMonthlyReports)
          .values({
            koboUuid: `demo-vsla-${naturalKey}-${m}`,
            koboId: stableId(`${naturalKey}-${m}`, 700_000_000),
            formVersion: 'demo-v1',
            groupId,
            cooperativeId: c.id,
            reportMonth: monthStr,
            activeMembersAtVisit: activeMembers,
            maleMembers: male,
            femaleMembers: activeMembers - male,
            membersAttendingMeeting: Math.round(activeMembers * (0.7 + rng() * 0.25)),
            totalMembersStartCycle: activeMembers + int(0, 3),
            numDropouts: int(0, 2),
            savingsCumulative: String(savings),
            savingsValueMonth: String(int(300, 900)),
            activeLoansCount: int(0, 8),
            activeLoansValue: String(int(0, 4000)),
            lateLoansCount: late,
            lateLoansUnpaidBalance: String(late * int(100, 400)),
            writeoffsValue: '0',
            cashLoanFund: String(int(500, 3000)),
            cashSocialFund: String(int(100, 800)),
            hasExternalLoans: rng() < 0.2,
            hasExternalSavings: rng() < 0.15,
            hasDiscrepancy: hasDisc,
            comments: hasDisc ? 'Register vs cash mismatch flagged for follow-up.' : null,
            submittedAt: month,
            submittedBy: 'demo-seed',
          })
          .onConflictDoUpdate({
            target: vslaMonthlyReports.koboUuid,
            set: { savingsCumulative: String(savings), updatedAt: sql`now()` },
          });
        reportCount++;
        lastMonth = monthStr;
        lastActive = activeMembers;
        lastSavings = savings;
        lastLate = late;
      }

      await db
        .update(vslaGroups)
        .set({
          latestReportMonth: lastMonth,
          latestActiveMembers: lastActive,
          latestSavingsCumulative: String(lastSavings),
          latestLateLoansCount: lastLate,
          latestHasDiscrepancy: discrepancies > 0,
          discrepancyCount: discrepancies,
        })
        .where(eq(vslaGroups.id, groupId));
    }
  }
  console.log(`    VSLA: ${groupCount} groups, ${reportCount} monthly reports`);

  // ── Society purchases (1–2 per sampled parcel) ────────────────
  const parcelRows = await db
    .select({
      id: parcels.id,
      farmerId: parcels.farmerId,
      cooperativeId: parcels.cooperativeId,
      society: farmers.society,
      clerkCard: farmers.nationalIdNumber,
      firstName: farmers.firstName,
      lastName: farmers.lastName,
    })
    .from(parcels)
    .leftJoin(farmers, eq(farmers.id, parcels.farmerId))
    // Deterministic order so the rng-gated purchase sampling below is
    // stable across re-seeds (keeps koboUuid set identical → idempotent).
    .orderBy(parcels.id);

  const purchaseVals: (typeof cocoaPurchases.$inferInsert)[] = [];
  for (const p of parcelRows) {
    if (!p.farmerId) continue;
    if (rng() < 0.35) continue; // only ~65% of parcels have purchases
    const n = int(1, 2);
    for (let k = 0; k < n; k++) {
      // Concentrate buying into the most recent complete main-crop
      // export season (cocoa main crop ≈ Oct–Mar). 110–300 days
      // back from "now" lands the whole batch in that window so the
      // seasonal reporting charts show a realistic main-crop peak
      // instead of volume dribbled flat across the year.
      const d = dateBack(int(110, 300));
      const yymmdd = dstr(d).replaceAll('-', '').slice(2);
      const weight = 50 + rng() * 900; // kg
      const price = 12; // USD/kg (demo)
      purchaseVals.push({
        koboUuid: `demo-pur-${p.id}-${k}`,
        koboId: stableId(`${p.id}-${k}`, 600_000_000),
        formVersion: 'demo-v1',
        purchaseId: `${p.id}-${yymmdd}`,
        cooperativeId: p.cooperativeId,
        farmerId: p.farmerId,
        parcelId: p.id,
        stationMarkNumber: `STN-${int(1, 40)}`,
        pcName: `Purchasing Clerk ${int(1, 20)}`,
        society: p.society,
        farmerCode: p.farmerId,
        farmerName: `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || null,
        purchasingClerkCardNumber: p.clerkCard,
        fieldId: p.id,
        purchaseDate: dstr(d),
        weightKg: weight.toFixed(3),
        amountReceived: (weight * price).toFixed(2),
        paymentType: pick(['cash', 'mobile_money', 'cheque']),
        submittedAt: d,
        submittedBy: 'demo-seed',
      });
    }
  }
  // Wipe demo purchases (and their evac links) from earlier seed runs
  // before re-inserting. Parcel/farmer counts have shifted across the
  // session, so past runs left orphaned purchase rows that onConflict
  // never touches — they polluted the season tail with stale
  // out-of-window dates. A full wipe + deterministic re-insert keeps the
  // main-crop window clean. lot_purchases (the only FK) goes first.
  await db.execute(sql`
    DELETE FROM primary_evacuation.lot_purchases
     WHERE purchase_id IN (
       SELECT id FROM purchase.cocoa_purchases WHERE kobo_uuid LIKE 'demo-pur-%'
     )
  `);
  await db.execute(sql`DELETE FROM purchase.cocoa_purchases WHERE kobo_uuid LIKE 'demo-pur-%'`);

  // purchases per coop (id + display code) for the traceability links.
  const purchasesByCoop = new Map<string, { id: string; purchaseId: string }[]>();
  let purTotal = 0;
  for (let i = 0; i < purchaseVals.length; i += 500) {
    const slice = purchaseVals.slice(i, i + 500);
    const rows = await db
      .insert(cocoaPurchases)
      .values(slice)
      .onConflictDoUpdate({
        target: cocoaPurchases.koboUuid,
        set: {
          weightKg: sql`excluded.weight_kg`,
          farmerName: sql`excluded.farmer_name`,
          purchaseDate: sql`excluded.purchase_date`,
          submittedAt: sql`excluded.submitted_at`,
          updatedAt: sql`now()`,
        },
      })
      .returning({
        id: cocoaPurchases.id,
        purchaseId: cocoaPurchases.purchaseId,
        cooperativeId: cocoaPurchases.cooperativeId,
      });
    for (const r of rows) {
      if (!r.cooperativeId) continue;
      const b = purchasesByCoop.get(r.cooperativeId) ?? [];
      b.push({ id: r.id, purchaseId: r.purchaseId });
      purchasesByCoop.set(r.cooperativeId, b);
    }
    purTotal += slice.length;
  }
  console.log(`    purchases: ${purTotal} society purchases`);

  // ── Primary evacuation lots (depot → district warehouse) ──────
  // Wipe demo primary lots from earlier runs first (lot counts vary
  // per run, leaving orphans with null society + stale dates). FK order:
  // secondary→primary links, then purchase links, then the lots.
  await db.execute(sql`
    DELETE FROM secondary_evacuation.lot_primaries
     WHERE primary_lot_id IN (
       SELECT id FROM primary_evacuation.lots WHERE kobo_uuid LIKE 'demo-pevac-%'
     )
  `);
  await db.execute(sql`
    DELETE FROM primary_evacuation.lot_purchases
     WHERE lot_id IN (
       SELECT id FROM primary_evacuation.lots WHERE kobo_uuid LIKE 'demo-pevac-%'
     )
  `);
  await db.execute(sql`DELETE FROM primary_evacuation.lots WHERE kobo_uuid LIKE 'demo-pevac-%'`);

  const primaryByCoop = new Map<string, { id: string; waybill: string }[]>();
  let primary = 0;
  let primaryLinks = 0;
  for (const c of coops) {
    const prefix = coopFarmerCodePrefix(c.code);
    const coopPurchases = purchasesByCoop.get(c.id) ?? [];
    const coopSocieties = societiesByCoop.get(c.id) ?? [];
    let purCursor = 0;
    const n = int(8, 12);
    for (let i = 1; i <= n; i++) {
      const d = dateBack(int(100, 280)); // primary evac follows in-season buying
      const bags = int(80, 300);
      const waybill = `PWB-${prefix}-${String(i).padStart(4, '0')}`;
      const [lot] = await db
        .insert(primaryEvacLots)
        .values({
          koboUuid: `demo-pevac-${c.code}-${i}`,
          koboId: stableId(`p-${c.code}-${i}`, 500_000_000),
          formVersion: 'demo-v1',
          primaryWaybillNumber: waybill,
          cooperativeId: c.id,
          stationMarkNumber: `STN-${int(1, 40)}`,
          pcName: `Purchasing Clerk ${int(1, 20)}`,
          society: coopSocieties.length > 0 ? pick(coopSocieties) : null,
          districtDepot: `${c.name.split(' ')[0]} Depot`,
          districtWarehouse: `${c.name.split(' ')[0]} District Warehouse`,
          evacuationDate: dstr(d),
          bagsReceived: bags,
          kgReceived: (bags * 64).toFixed(1),
          driverFirstName: pick(['James', 'Lucas', 'Omar', 'David']),
          driverLastName: pick(['Smith', 'Garcia', 'Khan', 'Silva']),
          truckRegistration: `TRK-${int(1000, 9999)}-${int(10, 24)}`,
          sealNumber: `SEAL-${int(100000, 999999)}`,
          submittedAt: d,
          submittedBy: 'demo-seed',
        })
        .onConflictDoUpdate({
          target: primaryEvacLots.koboUuid,
          set: {
            bagsReceived: bags,
            society: sql`excluded.society`,
            evacuationDate: sql`excluded.evacuation_date`,
            submittedAt: sql`excluded.submitted_at`,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: primaryEvacLots.id });
      const lotId = lot!.id;
      primary++;
      const b = primaryByCoop.get(c.id) ?? [];
      b.push({ id: lotId, waybill });
      primaryByCoop.set(c.id, b);

      // Link a slice of the coop's purchases into this lot (traceability
      // primary-lot → purchase → farmer/parcel).
      const take = Math.min(coopPurchases.length - purCursor, int(3, 10));
      const linkRows = coopPurchases.slice(purCursor, purCursor + take).map((p) => {
        // ~30% of the clerk-listed references don't resolve to a record
        // in the purchase master (timing lag / typo / unsynced) — FK left
        // null so the UI flags them "pending purchase-master resolution".
        const unmatched = rng() < 0.3;
        return {
          lotId,
          purchaseIdRaw: p.purchaseId,
          purchaseId: unmatched ? null : p.id,
        };
      });
      purCursor += take;
      if (linkRows.length > 0) {
        await db
          .insert(primaryEvacLotPurchases)
          .values(linkRows)
          .onConflictDoNothing({
            target: [primaryEvacLotPurchases.lotId, primaryEvacLotPurchases.purchaseIdRaw],
          });
        primaryLinks += linkRows.length;
      }
    }
  }
  console.log(`    primary evac: ${primary} lots, ${primaryLinks} purchase links`);

  // ── Secondary evacuation lots (depot → port) ──────────────────
  // Same orphan cleanup as primary lots: drop stale demo secondary lots
  // (and their primary-link rows) from prior runs before re-inserting.
  await db.execute(sql`
    DELETE FROM secondary_evacuation.lot_primaries
     WHERE secondary_lot_id IN (
       SELECT id FROM secondary_evacuation.lots WHERE kobo_uuid LIKE 'demo-sevac-%'
     )
  `);
  await db.execute(sql`DELETE FROM secondary_evacuation.lots WHERE kobo_uuid LIKE 'demo-sevac-%'`);

  let secondary = 0;
  let secondaryLinks = 0;
  for (const c of coops) {
    const prefix = coopFarmerCodePrefix(c.code);
    const coopPrimaries = primaryByCoop.get(c.id) ?? [];
    let primCursor = 0;
    const n = int(4, 6);
    for (let i = 1; i <= n; i++) {
      const d = dateBack(int(90, 260)); // secondary evac (depot → port) after primary
      const bags = int(200, 500);
      const ddsRoll = rng();
      const ddsStatus =
        ddsRoll < 0.5
          ? 'accepted'
          : ddsRoll < 0.75
            ? 'submitted'
            : ddsRoll < 0.9
              ? 'ready'
              : 'draft';
      const [lot] = await db
        .insert(secondaryEvacLots)
        .values({
          koboUuid: `demo-sevac-${c.code}-${i}`,
          koboId: stableId(`s-${c.code}-${i}`, 400_000_000),
          formVersion: 'demo-v1',
          secondaryWaybillNumber: `SWB-${prefix}-${String(i).padStart(4, '0')}`,
          cooperativeId: c.id,
          evacuationDate: dstr(d),
          district: `${c.name.split(' ')[0]} District`,
          depotOrigin: `${c.name.split(' ')[0]} District Warehouse`,
          beanGrade: pick(['Grade I', 'Grade II']),
          beanCategory: pick(['Main crop', 'Light crop']),
          sealNumber: `SEAL-${int(100000, 999999)}`,
          sourcingPartner: 'ThinkData Trading Ltd',
          bagsLoaded: bags,
          portDestination: pick(PORTS),
          driverFirstName: pick(['James', 'Lucas', 'Omar', 'David']),
          driverLastName: pick(['Smith', 'Garcia', 'Khan', 'Silva']),
          driverLicenceNumber: `DL-${int(100000, 999999)}`,
          truckRegistration: `TRK-${int(1000, 9999)}-${int(10, 24)}`,
          ddsStatus,
          ddsReference:
            ddsStatus === 'accepted' || ddsStatus === 'submitted'
              ? `DDS-${int(10000, 99999)}`
              : null,
          ddsSubmittedAt: ddsStatus === 'accepted' || ddsStatus === 'submitted' ? d : null,
          submittedAt: d,
          submittedBy: 'demo-seed',
        })
        .onConflictDoUpdate({
          target: secondaryEvacLots.koboUuid,
          set: {
            bagsLoaded: bags,
            evacuationDate: sql`excluded.evacuation_date`,
            submittedAt: sql`excluded.submitted_at`,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: secondaryEvacLots.id });
      const secLotId = lot!.id;
      secondary++;

      // Link a slice of the coop's primary lots into this secondary lot
      // (traceability secondary → primary → purchase).
      const take = Math.min(coopPrimaries.length - primCursor, int(2, 4));
      const linkRows = coopPrimaries.slice(primCursor, primCursor + take).map((p) => {
        // ~30% of the secondary form's primary-waybill references don't
        // resolve to a canonical primary lot (orphan) — FK left null so
        // the traceability drilldown flags them "not in DB".
        const orphan = rng() < 0.3;
        return {
          secondaryLotId: secLotId,
          primaryWaybillRaw: p.waybill,
          primaryLotId: orphan ? null : p.id,
        };
      });
      primCursor += take;
      if (linkRows.length > 0) {
        await db
          .insert(secondaryEvacLotPrimaries)
          .values(linkRows)
          .onConflictDoNothing({
            target: [
              secondaryEvacLotPrimaries.secondaryLotId,
              secondaryEvacLotPrimaries.primaryWaybillRaw,
            ],
          });
        secondaryLinks += linkRows.length;
      }
    }
  }
  console.log(`    secondary evac: ${secondary} lots, ${secondaryLinks} primary links`);

  // ── Training sessions + attendance ────────────────────────────
  const farmerRows = await db
    .select({
      id: farmers.id,
      firstName: farmers.firstName,
      lastName: farmers.lastName,
      cooperativeId: farmers.cooperativeId,
      sex: farmers.sex,
      society: farmers.society,
    })
    .from(farmers)
    .orderBy(farmers.id);
  const farmersByCoop = new Map<
    string,
    { id: string; name: string; sex: string | null; society: string | null }[]
  >();
  for (const f of farmerRows) {
    if (!f.cooperativeId) continue;
    const b = farmersByCoop.get(f.cooperativeId) ?? [];
    b.push({
      id: f.id,
      name: `${f.firstName} ${f.lastName}`.trim(),
      sex: f.sex,
      society: f.society,
    });
    farmersByCoop.set(f.cooperativeId, b);
  }
  const TOPICS = ['GAP', 'IPM', 'Child Labour', 'Agroforestry', 'Post-Harvest', 'Record Keeping'];
  const PROGRAMS = ['Rainforest Alliance', 'EUDR Readiness', 'Farmer Field School'];
  let sessions = 0;
  let attendanceRows = 0;
  for (const c of coops) {
    const coopFarmers = farmersByCoop.get(c.id) ?? [];
    const n = int(5, 8);
    for (let i = 1; i <= n; i++) {
      const d = dateBack(int(10, 300));
      const male = int(8, 25);
      const female = int(5, 20);
      const total = male + female;
      const consent = Math.round(total * (0.7 + rng() * 0.3));
      // Session window: start between 08:00–14:00, end = start + duration
      // so the detail tile's "start → end" agrees with the shown duration.
      const durationMinutes = int(60, 180);
      const startMin = int(8 * 60, 14 * 60);
      const hhmm = (m: number) =>
        `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const [sess] = await db
        .insert(trainingSessions)
        .values({
          koboUuid: `demo-train-${c.code}-${i}`,
          koboId: stableId(`t-${c.code}-${i}`, 300_000_000),
          formVersion: 'demo-v1',
          cooperativeId: c.id,
          trainingDate: dstr(d),
          startTime: hhmm(startMin),
          endTime: hhmm(startMin + durationMinutes),
          durationMinutes,
          program: pick(PROGRAMS),
          trainingType: pick(['Group training', 'Refresher', 'Onboarding']),
          trainingTopics: TOPICS.filter(() => rng() < 0.45),
          participantCategory: 'Farmers',
          society: coopFarmers.length ? pick(coopFarmers).society : null,
          venue: `${c.name.split(' ')[0]} Community Centre`,
          trainerName: `Trainer ${int(1, 15)}`,
          trainerPhone: `+1${int(10000000, 99999999)}`,
          numMale: male,
          numFemale: female,
          totalParticipants: total,
          consentCount: consent,
          consentRate: ((consent / total) * 100).toFixed(2),
          sessionObjectivesMet: rng() < 0.9,
          participantEngagement: pick(['low', 'medium', 'high']),
          submittedAt: d,
          submittedBy: 'demo-seed',
        })
        .onConflictDoUpdate({
          target: trainingSessions.koboUuid,
          set: {
            totalParticipants: total,
            startTime: sql`excluded.start_time`,
            endTime: sql`excluded.end_time`,
            durationMinutes: sql`excluded.duration_minutes`,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: trainingSessions.id });
      sessions++;
      const take = Math.min(coopFarmers.length, int(5, 15));
      const seen = new Set<string>();
      const attVals: (typeof trainingAttendance.$inferInsert)[] = [];
      for (let a = 0; a < take && coopFarmers.length > 0; a++) {
        const f = coopFarmers[int(0, coopFarmers.length - 1)]!;
        if (seen.has(f.id)) continue;
        seen.add(f.id);
        attVals.push({
          sessionId: sess!.id,
          farmerId: f.id,
          farmerCode: f.id,
          farmerName: f.name,
          gender: f.sex,
          cooperative: c.name,
          consent: rng() < 0.85,
        });
      }
      if (attVals.length > 0) {
        await db
          .insert(trainingAttendance)
          .values(attVals)
          .onConflictDoNothing({
            target: [trainingAttendance.sessionId, trainingAttendance.farmerCode],
          });
        attendanceRows += attVals.length;
      }
    }
  }
  console.log(`    training: ${sessions} sessions, ${attendanceRows} attendance rows`);

  // ── Parcel map geometry (boundary polygon + GPS point) ────────
  // Synthetic irregular farm-boundary polygons modelled on the shape +
  // size (~1–3 ha) of a real geotrace sample — generated from scratch,
  // NOT copied from any real farm boundary. Placed in a satellite-
  // verified forested patch of the Wassa Amenfi cocoa belt (~-2.70/6.15)
  // so plots render over farmland/forest rather than a town.
  const DEG = Math.PI / 180;
  let geoms = 0;
  for (const p of parcelRows) {
    const h = stableId(p.id, 0);
    // Deterministic plot centre inside a *forested* patch of the Wassa
    // Amenfi cocoa belt (verified on satellite: dense forest + farm
    // clearings, no town). Tight ~4.4 km cluster keeps every plot on
    // vegetation instead of scattering onto Asankrangwa town — plots are
    // viewed one at a time so the density doesn't matter visually.
    const cx = -2.72 + (h % 401) / 10000; // -2.7200 … -2.6800
    const cy = 6.13 + ((h >>> 9) % 401) / 10000; // 6.1300 … 6.1700
    const nv = 12 + (h % 6); // 12–17 vertices
    const baseR = 0.0008 + rng() * 0.001; // ~90–200 m radius
    const lngScale = 1 / Math.cos(cy * DEG); // keep it roughly circular on the ground
    const pts: string[] = [];
    for (let v = 0; v < nv; v++) {
      const ang = (2 * Math.PI * v) / nv;
      const r = baseR * (0.7 + rng() * 0.6); // jitter each vertex radius
      const lng = cx + r * Math.cos(ang) * lngScale;
      const lat = cy + r * Math.sin(ang);
      pts.push(`${lng.toFixed(6)} ${lat.toFixed(6)}`);
    }
    pts.push(pts[0]!); // close the ring
    const poly = `MULTIPOLYGON(((${pts.join(', ')})))`;
    await db.execute(sql`
      INSERT INTO gis.parcel_geometries (parcel_id, source_format, captured_at, geom, point_geom)
      VALUES (
        ${p.id}, 'demo', now(),
        ST_SetSRID(ST_GeomFromText(${poly}), 4326),
        ST_SetSRID(ST_MakePoint(${cx}, ${cy}), 4326)
      )
      ON CONFLICT (parcel_id) DO UPDATE SET
        geom = EXCLUDED.geom, point_geom = EXCLUDED.point_geom, captured_at = now()
    `);
    geoms++;
  }
  console.log(`    parcel geometries: ${geoms} (synthetic irregular polygons)`);

  // ── EUDR risk zones (red map overlays) ────────────────────────
  // Derived from the EUDR risk criteria: a deforestation patch beside
  // every medium/high deforestation-risk parcel, and a protected-area
  // block beside every high protected-area-risk parcel. Each zone is a
  // translated copy of the parcel boundary placed just off one edge so
  // it renders adjacent to the green plot. Stored once per parcel+type
  // (idempotent on `code`); compliant/low parcels get none.
  // Fully derived from current EUDR risk → rebuild from scratch so a
  // parcel that flipped to compliant doesn't keep a stale red zone.
  await db.execute(sql`DELETE FROM gis.risk_zones`);
  await db.execute(sql`
    INSERT INTO gis.risk_zones (code, risk_type, severity, name, source_parcel_id, geom)
    SELECT
      pg.parcel_id || ':deforestation',
      'deforestation',
      e.deforestation_risk,
      'Deforestation alert near ' || pg.parcel_id,
      pg.parcel_id,
      ST_Multi(ST_Translate(
        pg.geom,
        (ST_XMax(pg.geom) - ST_XMin(pg.geom)) * 1.05,
        (ST_YMax(pg.geom) - ST_YMin(pg.geom)) * 0.15
      ))
    FROM gis.parcel_geometries pg
    JOIN gis.eudr_status e ON e.parcel_id = pg.parcel_id
    WHERE pg.geom IS NOT NULL AND e.deforestation_risk IN ('medium', 'high')
    ON CONFLICT (code) DO UPDATE SET
      severity = EXCLUDED.severity, geom = EXCLUDED.geom, risk_type = EXCLUDED.risk_type,
      name = EXCLUDED.name, source_parcel_id = EXCLUDED.source_parcel_id, updated_at = now()
  `);
  await db.execute(sql`
    INSERT INTO gis.risk_zones (code, risk_type, severity, name, source_parcel_id, geom)
    SELECT
      pg.parcel_id || ':protected_area',
      'protected_area',
      'high',
      'Protected-area overlap near ' || pg.parcel_id,
      pg.parcel_id,
      ST_Multi(ST_Translate(
        pg.geom,
        (ST_XMax(pg.geom) - ST_XMin(pg.geom)) * 0.15,
        (ST_YMax(pg.geom) - ST_YMin(pg.geom)) * 1.05
      ))
    FROM gis.parcel_geometries pg
    JOIN gis.eudr_status e ON e.parcel_id = pg.parcel_id
    WHERE pg.geom IS NOT NULL AND e.protected_area_risk = 'high'
    ON CONFLICT (code) DO UPDATE SET
      severity = EXCLUDED.severity, geom = EXCLUDED.geom, risk_type = EXCLUDED.risk_type,
      name = EXCLUDED.name, source_parcel_id = EXCLUDED.source_parcel_id, updated_at = now()
  `);
  const [{ n: zoneCount } = { n: 0 }] = (
    await db.execute(sql`SELECT count(*)::int AS n FROM gis.risk_zones`)
  ).rows as { n: number }[];
  console.log(`    risk zones: ${zoneCount} EUDR risk overlays`);
}
