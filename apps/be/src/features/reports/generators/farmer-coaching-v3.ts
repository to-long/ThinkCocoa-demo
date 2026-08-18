/**
 * Generator for `farmer_coaching_v3` — denormalized export of
 * `coaching.coaching_visits` joined to farmers + cooperative, filtered
 * by season (cocoa year Oct→Sep) and an optional society.
 *
 * XLSX path clones the curated template at
 * `apps/be/reports/KuanaData_Farmer_Coaching_Report_v3.xlsx` so all
 * styling, merged header rows, frozen panes, and the row-2 summary
 * formulas (`COUNTA(A5:A1004)`, `COUNTIF(S5:S1004,"Yes")`, …) are
 * preserved exactly. Data is written cell-by-cell from row 5 onward —
 * the row-5 spec annotations in the template are first cleared.
 *
 * CSV path keeps the prior flat layout (header + rows) — no template
 * cloning, just `csv-stringify`.
 */

import { stringify as stringifyCsv } from 'csv-stringify/sync';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { db } from '../../../db/client';
import { coachingVisits } from '../../../db/schema/coaching';
import { farmers } from '../../../db/schema/farmer';
import { cooperatives } from '../../../db/schema/iam';
import { correctiveActions } from '../../../db/schema/inspection';
import { seasonToDateRange, seasonToSlug } from '../lib/season';
import { countWhere, ratioOr, setFormula } from '../lib/summary-cells';
import { readReportTemplate } from '../lib/templates';

export type CoachingReportFormat = 'excel' | 'csv';

export interface CoachingReportParams {
  cooperativeId: string;
  season: string;
  /** Optional `coaching_visits.society` filter — when null, all societies are included. */
  societyId: string | null;
  outputFormat: CoachingReportFormat;
}

export interface GeneratedReport {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_MIME = 'text/csv; charset=utf-8';

const TEMPLATE_SHEET_NAME = 'Coaching Report';
/** Row index where the spec-annotation row sits in the template — data
 *  overwrites starting at this row and the formulas in row 2
 *  (`A5:A1004`, `S5:S1004`) are scoped to read from here. */
const DATA_START_ROW = 5;
/** Max data rows the template's summary formulas reference. */
const DATA_END_ROW = 1004;

interface Row {
  visitDate: string;
  coachName: string | null;
  cooperativeName: string | null;
  society: string | null;
  district: string | null;
  farmerCode: string | null;
  farmerName: string | null;
  fieldId: string | null;
  gapWeeded: string | null;
  gapPruning: string | null;
  gapShadeTrees: string | null;
  ipmApproved: string | null;
  ipmPpe: string | null;
  gepDeforestation: string | null;
  gspFairPay: string | null;
  gspForcedLabour: string | null;
  traceFarmRecords: string | null;
  trainReceived: string | null;
  clmrsRiskLevel: string | null;
  childrenObservedWorking: boolean | null;
  nonComplianceObserved: string | null;
  coachingAdvice: string | null;
  gapsIdentified: string | null;
  followUpRequired: boolean;
  followUpDate: string | null;
  coachSignoff: string | null;
  farmerSignoff: string | null;
  // ── Corrective-action workflow (source 'coaching', joined by
  //    coaching_visit_id). Null when the visit produced no coded
  //    non-compliance. `caActionDate` is the live (reschedulable)
  //    deadline; it supersedes the Kobo `followUpDate` snapshot. ──
  caStatus: string | null;
  caActionDate: string | null;
  caLastComment: string | null;
  /** Visit sequence number per farmer, computed in-process. */
  visitSeq: number;
}

/** Read a value out of the Kobo `raw_data` JSONB. Returns the string
 *  representation or null. */
function pickRaw(raw: unknown, ...keys: string[]): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    return String(v);
  }
  return null;
}

/** Human-friendly verdict from a raw form value: `"yes"|"no"|"partly"`. */
function verdict(v: string | null): string | null {
  if (!v) return null;
  const t = v.toLowerCase();
  if (t === 'yes') return 'Yes';
  if (t === 'no') return 'No';
  if (t === 'partly') return 'Partly';
  return v;
}

/** "Yes" if either of two raw flags says yes, "No" if both say no, else
 *  "Partly". Used by the IPM / GSP / records-and-training columns that
 *  consolidate two underlying form fields. */
function combineYesNo(a: string | null, b: string | null): string | null {
  const ta = a?.toLowerCase() ?? null;
  const tb = b?.toLowerCase() ?? null;
  if (ta == null && tb == null) return null;
  if (ta === 'yes' && tb === 'yes') return 'Yes';
  if ((ta === 'no' && tb !== 'yes') || (tb === 'no' && ta !== 'yes')) return 'No';
  return 'Partly';
}

async function fetchRows(params: CoachingReportParams): Promise<Row[]> {
  const { from, to } = seasonToDateRange(params.season);

  const conds = [
    eq(coachingVisits.cooperativeId, params.cooperativeId),
    gte(coachingVisits.visitDate, from),
    lte(coachingVisits.visitDate, to),
  ];
  if (params.societyId) {
    conds.push(eq(coachingVisits.society, params.societyId));
  }

  const rows = await db
    .select({
      visitDate: coachingVisits.visitDate,
      coachName: coachingVisits.coachName,
      cooperativeName: cooperatives.name,
      society: coachingVisits.society,
      district: coachingVisits.district,
      farmerCode: coachingVisits.farmerId,
      farmerFirstName: farmers.firstName,
      farmerLastName: farmers.lastName,
      parcelId: coachingVisits.parcelId,
      clmrsRiskLevel: coachingVisits.clmrsRiskLevel,
      childrenObservedWorking: coachingVisits.childrenObservedWorking,
      followUpRequired: coachingVisits.followUpRequired,
      followUpDate: coachingVisits.followUpDate,
      caStatus: correctiveActions.status,
      caActionDate: correctiveActions.actionDate,
      caLastComment: correctiveActions.lastComment,
    })
    .from(coachingVisits)
    .leftJoin(farmers, eq(farmers.id, coachingVisits.farmerId))
    .leftJoin(cooperatives, eq(cooperatives.id, coachingVisits.cooperativeId))
    // The coaching parser keeps at most one corrective action per visit
    // (one classified non-compliance topic; stale topics are deleted), so
    // this join is 1:0..1 and can't fan out rows.
    .leftJoin(
      correctiveActions,
      and(
        eq(correctiveActions.coachingVisitId, coachingVisits.id),
        eq(correctiveActions.source, 'coaching'),
      ),
    )
    .where(and(...conds))
    .orderBy(asc(coachingVisits.visitDate));

  // Compute visit sequence per farmer (matches the template's `ROW_NUMBER()
  // OVER (PARTITION BY farmer_code ORDER BY visit_date ASC)` spec).
  const perFarmer = new Map<string, number>();

  return rows.map((r) => {
    const code = r.farmerCode ?? '__no_farmer__';
    const next = (perFarmer.get(code) ?? 0) + 1;
    perFarmer.set(code, next);

    const raw: Record<string, unknown> = {};
    return {
      visitDate: r.visitDate,
      coachName: r.coachName,
      cooperativeName: r.cooperativeName,
      society: r.society,
      district: r.district,
      farmerCode: r.farmerCode,
      farmerName:
        r.farmerFirstName || r.farmerLastName
          ? [r.farmerFirstName, r.farmerLastName].filter(Boolean).join(' ')
          : null,
      fieldId:
        r.parcelId ?? pickRaw(raw, 'sec_a/field_id', 'sec_a/farm_name', 'field_id', 'farm_name'),
      gapWeeded: verdict(pickRaw(raw, 'sec_i/gap_weeded')),
      gapPruning: verdict(pickRaw(raw, 'sec_i/gap_pruning')),
      gapShadeTrees: verdict(pickRaw(raw, 'sec_i/gap_shade_trees')),
      ipmApproved: verdict(pickRaw(raw, 'sec_j/ipm_approved')),
      ipmPpe: verdict(pickRaw(raw, 'sec_j/ipm_ppe')),
      gepDeforestation: verdict(pickRaw(raw, 'sec_k/gep_deforestation')),
      gspFairPay: verdict(pickRaw(raw, 'sec_l/gsp_fair_pay')),
      gspForcedLabour: verdict(pickRaw(raw, 'sec_l/gsp_forced_labour')),
      traceFarmRecords: verdict(pickRaw(raw, 'sec_m/trace_farm_records')),
      trainReceived: verdict(pickRaw(raw, 'sec_n/train_received')),
      clmrsRiskLevel: r.clmrsRiskLevel,
      childrenObservedWorking: r.childrenObservedWorking,
      // Kobo keys are `sec_p/obs_*` and `sec_q/sum_*` in the live form —
      // older aliases kept as fallbacks for legacy form versions.
      nonComplianceObserved: verdict(
        pickRaw(
          raw,
          'sec_p/obs_non_compliance',
          'sec_p/non_compliance_observed',
          'sec_p/sec_p_nc/non_compliance_observed',
        ),
      ),
      coachingAdvice: pickRaw(raw, 'sec_q/sum_coaching_advice', 'sec_p/coaching_advice'),
      gapsIdentified: pickRaw(raw, 'sec_q/sum_gaps', 'sec_p/gaps_identified'),
      followUpRequired: r.followUpRequired,
      followUpDate: r.followUpDate,
      coachSignoff: pickRaw(raw, 'sec_q/sum_coach_signoff', 'sec_q/coach_signoff'),
      farmerSignoff: pickRaw(raw, 'sec_q/sum_farmer_signoff', 'sec_q/farmer_signoff'),
      caStatus: r.caStatus,
      caActionDate: r.caActionDate,
      caLastComment: r.caLastComment,
      visitSeq: next,
    };
  });
}

/** Compute the human "Records & Training" verdict that the template's
 *  column O expects (combines two flags). */
function recordsAndTraining(row: Row): string | null {
  return combineYesNo(row.traceFarmRecords, row.trainReceived);
}

/** Column L combines `ipm_approved` + `ipm_ppe`. */
function chemicalsAndPpe(row: Row): string | null {
  return combineYesNo(row.ipmApproved, row.ipmPpe);
}

/** Column N combines `gsp_fair_pay` + `gsp_forced_labour`. Note:
 *  forced labour=yes is BAD, so invert before combining. */
function workersOk(row: Row): string | null {
  const fairPay = row.gspFairPay;
  const noForcedLabour =
    row.gspForcedLabour == null
      ? null
      : row.gspForcedLabour === 'No'
        ? 'Yes'
        : row.gspForcedLabour === 'Yes'
          ? 'No'
          : row.gspForcedLabour;
  return combineYesNo(fairPay, noForcedLabour);
}

/** Column M: template phrases the question positively ("No
 *  Deforestation?") but the underlying raw field `gep_deforestation` is
 *  "Yes=deforestation observed=RISK". Invert so the template column
 *  reads correctly. */
function noDeforestation(row: Row): string | null {
  if (row.gepDeforestation == null) return null;
  if (row.gepDeforestation === 'Yes') return 'No';
  if (row.gepDeforestation === 'No') return 'Yes';
  return row.gepDeforestation;
}

function signoffCombined(row: Row): string | null {
  const parts = [row.coachSignoff, row.farmerSignoff].filter(Boolean);
  return parts.length ? parts.join(' / ') : null;
}

const CA_STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  reopen: 'Reopened',
  processing: 'In progress',
  done: 'Done',
};

/** One-line summary of the coaching-sourced corrective action's live
 *  workflow state — status, its (reschedulable) deadline, and the last
 *  comment. Null when the visit produced no corrective action. */
function caSummary(row: Row): string | null {
  if (!row.caStatus) return null;
  const bits = [`Corrective action: ${CA_STATUS_LABEL[row.caStatus] ?? row.caStatus}`];
  if (row.caActionDate) bits.push(`due ${row.caActionDate}`);
  if (row.caLastComment) bits.push(row.caLastComment);
  return bits.join(' · ');
}

function adviceAndGaps(row: Row): string | null {
  const parts: string[] = [];
  if (row.coachingAdvice) parts.push(row.coachingAdvice);
  if (row.gapsIdentified) parts.push(`Gaps: ${row.gapsIdentified}`);
  const ca = caSummary(row);
  if (ca) parts.push(ca);
  return parts.length ? parts.join('\n\n') : null;
}

/** Follow-up deadline shown in the report: prefer the live corrective-
 *  action date (which staff can reschedule), fall back to the Kobo
 *  snapshot date when there's no corrective action. */
function followUpDateCell(row: Row): string | null {
  return row.caActionDate ?? row.followUpDate;
}

/** `YYYY-MM-DD` → `DD/MM/YY`, matching the T2 summary cell's TEXT() mask so
 *  the cached result reads identically to a recalculated one. */
function formatDdMmYy(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y.slice(2)}` : iso;
}

function fmtBoolYesNo(v: boolean | null): string | null {
  if (v == null) return null;
  return v ? 'Yes' : 'No';
}

/** Cell-letter map for the template's data area (columns A-V).
 *  Order matches `Row 4` of the template. */
const CELL_MAP: ReadonlyArray<{ col: string; value: (row: Row) => unknown }> = [
  { col: 'A', value: (r) => r.visitSeq },
  { col: 'B', value: (r) => r.visitDate },
  { col: 'C', value: (r) => r.coachName },
  { col: 'D', value: (r) => r.farmerCode },
  { col: 'E', value: (r) => r.farmerName },
  { col: 'F', value: (r) => r.society },
  { col: 'G', value: (r) => r.district },
  { col: 'H', value: (r) => r.fieldId },
  { col: 'I', value: (r) => r.gapWeeded },
  { col: 'J', value: (r) => r.gapPruning },
  { col: 'K', value: (r) => r.gapShadeTrees },
  { col: 'L', value: (r) => chemicalsAndPpe(r) },
  { col: 'M', value: (r) => noDeforestation(r) },
  { col: 'N', value: (r) => workersOk(r) },
  { col: 'O', value: (r) => recordsAndTraining(r) },
  { col: 'P', value: (r) => r.clmrsRiskLevel },
  { col: 'Q', value: (r) => fmtBoolYesNo(r.childrenObservedWorking) },
  { col: 'R', value: (r) => r.nonComplianceObserved },
  { col: 'S', value: (r) => adviceAndGaps(r) },
  { col: 'T', value: (r) => fmtBoolYesNo(r.followUpRequired) },
  { col: 'U', value: (r) => followUpDateCell(r) },
  { col: 'V', value: (r) => signoffCombined(r) },
];

async function buildXlsx(rows: Row[]): Promise<Buffer> {
  const tplBuf = await readReportTemplate('KuanaData_Farmer_Coaching_Report_v3.xlsx');
  const wb = new ExcelJS.Workbook();
  // Bun's `readFile` returns `NonSharedBuffer` and exceljs's `.load()`
  // typing wants a different `Buffer` variant — same bytes either way,
  // cast through `any` to bridge the typedef mismatch.
  // biome-ignore lint/suspicious/noExplicitAny: typedef bridge
  await wb.xlsx.load(tplBuf as any);

  const sheet = wb.getWorksheet(TEMPLATE_SHEET_NAME);
  if (!sheet) {
    throw new Error(`Template missing sheet "${TEMPLATE_SHEET_NAME}"`);
  }

  // Strip every other sheet (e.g. the "Developer Spec" tab) so the
  // shipped file contains only the data sheet. Collect IDs first —
  // mutating during iteration breaks `eachSheet`.
  const toDrop: number[] = [];
  wb.eachSheet((s) => {
    if (s.id !== sheet.id) toDrop.push(s.id);
  });
  for (const id of toDrop) wb.removeWorksheet(id);

  // Correct the row-2 summary formulas: they were authored against an
  // earlier column layout and point at the wrong data columns. In the
  // current layout the KPI counts must read — NC observed: col R,
  // open follow-ups: col T (Follow-Up Required), CLMRS at-risk: col P
  // (Risk Level), % compliant: col R. (O2 especially must move off R,
  // which now holds NC Yes/No — otherwise it would count every row.)
  // Each carries its computed result as well — a formula alone has no
  // cached value, and Google Sheets / Numbers show exactly the cached value
  // (blank, here). See `lib/summary-cells.ts`.
  //
  // T2 ("Next follow-up due") is repointed too, and off `MIN(IF(…))` — an
  // array formula, which ExcelJS cannot write with the CSE marker older
  // Excel needs. `MINIFS` is an ordinary function over the same two columns.
  const total = rows.length;
  const nc = countWhere(rows, (r) => r.nonComplianceObserved === 'Yes');
  const compliant = countWhere(rows, (r) => r.nonComplianceObserved === 'No');
  const nextFollowUp = rows
    .filter((r) => r.followUpRequired)
    .map(followUpDateCell)
    .filter((d): d is string => !!d)
    .sort()[0];

  setFormula(sheet, 'B2', 'COUNTA(A5:A1004)', total);
  setFormula(sheet, 'G2', 'COUNTIF(R5:R1004,"Yes")', nc);
  setFormula(
    sheet,
    'K2',
    'COUNTIF(T5:T1004,"Yes")',
    countWhere(rows, (r) => r.followUpRequired),
  );
  setFormula(
    sheet,
    'O2',
    'COUNTIFS(P5:P1004,"<>No Risk",P5:P1004,"<>")',
    countWhere(rows, (r) => !!r.clmrsRiskLevel && r.clmrsRiskLevel !== 'No Risk'),
  );
  setFormula(
    sheet,
    'T2',
    'IFERROR(TEXT(MINIFS(U5:U1004,T5:T1004,"Yes"),"DD/MM/YY"),"—")',
    nextFollowUp ? formatDdMmYy(nextFollowUp) : '—',
  );
  setFormula(
    sheet,
    'Y2',
    'IFERROR(COUNTIF(R5:R1004,"No")/COUNTA(A5:A1004),"—")',
    ratioOr(compliant, total),
  );

  // Wipe the spec-annotation row (and any leftover sample data within
  // the formula range) so the row-2 COUNTA/COUNTIF formulas reflect
  // only freshly-written data.
  const wipeEnd = Math.max(DATA_END_ROW, DATA_START_ROW + rows.length);
  for (let r = DATA_START_ROW; r <= wipeEnd; r++) {
    const row = sheet.getRow(r);
    for (const m of CELL_MAP) {
      row.getCell(m.col).value = null;
    }
  }

  // Write data values into existing cells — preserves template styling.
  for (let i = 0; i < rows.length; i++) {
    const data = rows[i];
    const rowIdx = DATA_START_ROW + i;
    const row = sheet.getRow(rowIdx);
    for (const m of CELL_MAP) {
      const v = m.value(data);
      row.getCell(m.col).value = (v ?? null) as ExcelJS.CellValue;
    }
    row.commit();
  }

  // Ask Excel to recalc the row-2 summary formulas on open.
  wb.calcProperties.fullCalcOnLoad = true;

  const arrayBuf = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuf);
}

interface CsvRow {
  [key: string]: string | number | null;
}

const CSV_COLUMNS: ReadonlyArray<{ header: string; pick: (r: Row) => string | number | null }> = [
  { header: 'Visit #', pick: (r) => r.visitSeq },
  { header: 'Visit Date', pick: (r) => r.visitDate },
  { header: 'Coach Name', pick: (r) => r.coachName },
  { header: 'Farmer Code', pick: (r) => r.farmerCode },
  { header: 'Farmer Name', pick: (r) => r.farmerName },
  { header: 'Society / Community', pick: (r) => r.society },
  { header: 'District', pick: (r) => r.district },
  { header: 'Plot / Field ID', pick: (r) => r.fieldId },
  { header: 'Weeding OK? (GAP)', pick: (r) => r.gapWeeded },
  { header: 'Pruning OK? (GAP)', pick: (r) => r.gapPruning },
  { header: 'Shade Trees? (GAP)', pick: (r) => r.gapShadeTrees },
  { header: 'Chemicals & PPE OK? (IPM)', pick: (r) => chemicalsAndPpe(r) },
  { header: 'No Deforestation? (GEP)', pick: (r) => noDeforestation(r) },
  { header: 'Workers OK? (GSP)', pick: (r) => workersOk(r) },
  { header: 'Records & Training', pick: (r) => recordsAndTraining(r) },
  { header: 'CLMRS Risk Level', pick: (r) => r.clmrsRiskLevel },
  { header: 'Children Observed Working?', pick: (r) => fmtBoolYesNo(r.childrenObservedWorking) },
  { header: 'Non-Compliance Observed?', pick: (r) => r.nonComplianceObserved },
  { header: 'Coaching Advice & Gaps', pick: (r) => adviceAndGaps(r) },
  { header: 'Follow-Up Required?', pick: (r) => fmtBoolYesNo(r.followUpRequired) },
  { header: 'Next Follow-Up Date', pick: (r) => followUpDateCell(r) },
  { header: 'Coach & Farmer Sign-off', pick: (r) => signoffCombined(r) },
];

function buildCsv(rows: Row[]): Buffer {
  const records: CsvRow[] = rows.map((r) => {
    const obj: CsvRow = {};
    for (const c of CSV_COLUMNS) obj[c.header] = c.pick(r);
    return obj;
  });
  const text = stringifyCsv(records, {
    header: true,
    columns: CSV_COLUMNS.map((c) => c.header),
  });
  return Buffer.from(text, 'utf-8');
}

export async function generateFarmerCoachingV3(
  params: CoachingReportParams,
): Promise<GeneratedReport> {
  // Validate season early so a malformed slug surfaces as a clean error
  // before the DB round-trip.
  seasonToDateRange(params.season);

  const rows = await fetchRows(params);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const slug = seasonToSlug(params.season);

  if (params.outputFormat === 'csv') {
    return {
      buffer: buildCsv(rows),
      fileName: `KuanaData_Farmer_Coaching_Report_v3_${slug}_${stamp}.csv`,
      mimeType: CSV_MIME,
    };
  }
  return {
    buffer: await buildXlsx(rows),
    fileName: `KuanaData_Farmer_Coaching_Report_v3_${slug}_${stamp}.xlsx`,
    mimeType: XLSX_MIME,
  };
}
