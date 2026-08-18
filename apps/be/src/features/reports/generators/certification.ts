/**
 * Generator for `certification_status` — one row per farmer in the
 * active cooperative, surfacing their latest inspection's score,
 * derived certification tier, and (placeholder) corrective-action
 * counters. Mirrors the Demo Cocoa template
 * `apps/be/reports/KuanaData_Certification_Status_Report.xlsx`:
 *   • Row 1: title
 *   • Row 2: summary formulas — COUNTIF/Approved + Approved with
 *     Conditions + Not Approved + Overdue CAs + % Approved
 *   • Row 3: section headers
 *   • Row 4: column headers (A-R)
 *
 * Certification tier is computed exactly like the FE
 * `lib/certification.ts`: score / 142 × 100% bucketed against
 * a year-based threshold table read from `Management/DateOfCertification`.
 * The four FE tiers map onto the template's three positive labels
 * (Approved / Approved with Conditions / Not Approved); the
 * `disqualified` tier renders as "Disqualified" so reviewers see it
 * even though row-2 formulas only count the first three explicitly.
 *
 * Corrective-action columns (N-R) are blank in v1 — we don't yet
 * have a CA tracking table. Committee-approval columns (L, M) are
 * also blank until the certification-decisions workflow lands.
 */

import { stringify as stringifyCsv } from 'csv-stringify/sync';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { db } from '../../../db/client';
import { farmers } from '../../../db/schema/farmer';
import { cooperatives } from '../../../db/schema/iam';
import { inspections } from '../../../db/schema/inspection';
import { seasonToDateRange, seasonToSlug } from '../lib/season';
import { countWhere, ratioOr, setFormula } from '../lib/summary-cells';
import { readReportTemplate } from '../lib/templates';

export type CertificationReportFormat = 'excel' | 'csv';

export interface CertificationReportParams {
  cooperativeId: string;
  season: string;
  societyId: string | null;
  outputFormat: CertificationReportFormat;
}

export interface GeneratedReport {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_MIME = 'text/csv; charset=utf-8';

const TEMPLATE_SHEET_NAME = 'Certification Status';
const DATA_START_ROW = 5;
const DATA_END_ROW = 5004; // matches summary formula range A5:A5004

/** Mirror of `apps/fe/src/features/inspections/lib/certification.ts`
 *  — kept duplicated rather than imported across the FE/BE boundary.
 *  When the spec changes, update both files together. */
const MAX_SCORE = 142;
const YEAR_THRESHOLDS = [
  { certified: 60, certifiedWithCa: 50, notCertified: 25 }, // Year 1
  { certified: 70, certifiedWithCa: 50, notCertified: 25 }, // Year 2
  { certified: 75, certifiedWithCa: 50, notCertified: 25 }, // Year 3
  { certified: 80, certifiedWithCa: 50, notCertified: 25 }, // Year 4
  { certified: 90, certifiedWithCa: 50, notCertified: 25 }, // Year 5+
];

type Tier = 'certified' | 'certified_with_ca' | 'not_certified' | 'disqualified';

const TIER_LABEL: Record<Tier, string> = {
  certified: 'Approved',
  certified_with_ca: 'Approved with Conditions',
  not_certified: 'Not Approved',
  disqualified: 'Disqualified',
};

function classifyTier(pct: number, yearSeq: number, forceDisqualified: boolean): Tier {
  const year = Math.min(Math.max(Math.trunc(yearSeq) || 1, 1), 5);
  const t = YEAR_THRESHOLDS[year - 1]!;
  if (forceDisqualified || pct < t.notCertified) return 'disqualified';
  if (pct < t.certifiedWithCa) return 'not_certified';
  if (pct < t.certified) return 'certified_with_ca';
  return 'certified';
}

function yearSeqFromRaw(raw: Record<string, unknown> | null): number {
  const v = raw?.['Management/DateOfCertification'];
  if (typeof v !== 'string') return 1;
  const m = /^year(\d+)/.exec(v);
  if (!m) return 1;
  const n = Number.parseInt(m[1]!, 10);
  return Math.min(Math.max(n, 1), 5);
}

interface Row {
  farmerCode: string;
  farmerName: string;
  cooperativeName: string | null;
  district: string | null;
  society: string | null;
  inspector: string | null;
  inspectionDate: string | null;
  score: number | null;
  pct: number | null;
  tier: Tier | null;
  yearsInProgramme: number | null;
}

async function fetchRows(params: CertificationReportParams): Promise<Row[]> {
  const { from, to } = seasonToDateRange(params.season);

  // Farmer master for the coop, filtered by society if requested.
  const conds = [
    eq(farmers.cooperativeId, params.cooperativeId),
    sql`${farmers.deletedAt} IS NULL`,
  ];
  if (params.societyId) {
    conds.push(eq(farmers.society, params.societyId));
  }

  const farmerRows = await db
    .select({
      id: farmers.id,
      firstName: farmers.firstName,
      lastName: farmers.lastName,
      otherNames: farmers.otherNames,
      society: farmers.society,
      cooperativeName: cooperatives.name,
    })
    .from(farmers)
    .leftJoin(cooperatives, eq(cooperatives.id, farmers.cooperativeId))
    .where(and(...conds))
    .orderBy(farmers.id);

  if (farmerRows.length === 0) return [];

  // Latest inspection per farmer within the season window.
  const insp = await db
    .select({
      farmerId: inspections.farmerId,
      dateInspection: inspections.dateInspection,
      inspectorCode: inspections.inspectorCode,
      complianceScore: inspections.complianceScore,
    })
    .from(inspections)
    .where(
      and(
        eq(inspections.cooperativeId, params.cooperativeId),
        gte(inspections.dateInspection, from),
        lte(inspections.dateInspection, to),
      ),
    )
    .orderBy(desc(inspections.dateInspection));

  const latestByFarmer = new Map<string, (typeof insp)[number]>();
  for (const i of insp) {
    if (!i.farmerId) continue;
    if (!latestByFarmer.has(i.farmerId)) latestByFarmer.set(i.farmerId, i);
  }

  return farmerRows.map((f) => {
    const i = latestByFarmer.get(f.id);
    const fullName = [f.firstName, f.otherNames, f.lastName].filter(Boolean).join(' ').trim();
    const raw: Record<string, unknown> = {};
    const score = i?.complianceScore ?? null;
    const pct = score == null ? null : Math.round((score / MAX_SCORE) * 10000) / 100;
    const year = i ? yearSeqFromRaw(raw) : null;
    const tier = pct != null && year != null ? classifyTier(pct, year, false) : null;

    return {
      farmerCode: f.id,
      farmerName: fullName,
      cooperativeName: f.cooperativeName,
      // farmer master has no district column — coop name is the closest
      // proxy until the dataset carries one.
      district: f.cooperativeName,
      society: f.society,
      inspector: i?.inspectorCode ?? null,
      inspectionDate: i?.dateInspection ?? null,
      score,
      pct,
      tier,
      yearsInProgramme: year,
    };
  });
}

/** Cell-letter map for the template's data area (columns A-R). Order
 *  matches row 4 of the template. */
const CELL_MAP: ReadonlyArray<{ col: string; value: (row: Row) => unknown }> = [
  { col: 'A', value: (r) => r.farmerCode },
  { col: 'B', value: (r) => r.farmerName },
  { col: 'C', value: (r) => r.cooperativeName },
  { col: 'D', value: (r) => r.district },
  { col: 'E', value: (r) => r.society },
  { col: 'F', value: (r) => r.inspector },
  { col: 'G', value: (r) => r.inspectionDate },
  { col: 'H', value: (r) => r.pct },
  { col: 'I', value: (r) => (r.tier ? TIER_LABEL[r.tier] : null) },
  { col: 'J', value: (r) => r.yearsInProgramme },
  // K (Additional Conditions), L (Approved By), M (Approval Date) — left
  // blank until the certification-decisions workflow lands.
  { col: 'K', value: () => null },
  { col: 'L', value: () => null },
  { col: 'M', value: () => null },
  // N-Q (CA counters) + R (CA status) — left blank until a corrective-
  // actions tracking table lands.
  { col: 'N', value: () => null },
  { col: 'O', value: () => null },
  { col: 'P', value: () => null },
  { col: 'Q', value: () => null },
  { col: 'R', value: () => null },
];

async function buildXlsx(rows: Row[]): Promise<Buffer> {
  const tplBuf = await readReportTemplate('KuanaData_Certification_Status_Report.xlsx');
  const wb = new ExcelJS.Workbook();
  // biome-ignore lint/suspicious/noExplicitAny: typedef bridge — see farmer-coaching-v3.ts
  await wb.xlsx.load(tplBuf as any);

  const sheet = wb.getWorksheet(TEMPLATE_SHEET_NAME);
  if (!sheet) throw new Error(`Template missing sheet "${TEMPLATE_SHEET_NAME}"`);

  const toDrop: number[] = [];
  wb.eachSheet((s) => {
    if (s.id !== sheet.id) toDrop.push(s.id);
  });
  for (const id of toDrop) wb.removeWorksheet(id);

  const wipeEnd = Math.max(DATA_END_ROW, DATA_START_ROW + rows.length);
  for (let r = DATA_START_ROW; r <= wipeEnd; r++) {
    const row = sheet.getRow(r);
    for (const m of CELL_MAP) {
      row.getCell(m.col).value = null;
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const data = rows[i]!;
    const row = sheet.getRow(DATA_START_ROW + i);
    for (const m of CELL_MAP) {
      const v = m.value(data);
      row.getCell(m.col).value = (v ?? null) as ExcelJS.CellValue;
    }
    row.commit();
  }

  writeSummary(sheet, rows);
  wb.calcProperties.fullCalcOnLoad = true;

  const arrayBuf = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Row-2 KPIs, formula + cached result — see `lib/summary-cells.ts` for why
 * the result matters.
 *
 * Two of these ranges are also CORRECTED here. The template counts tiers in
 * column G, which in the current layout holds the inspection DATE — column I
 * is the tier label. Every tier KPI therefore read 0 in Excel too, which is
 * exactly the failure mode a plausible zero hides.
 */
function writeSummary(sheet: ExcelJS.Worksheet, rows: Row[]): void {
  const span = (col: string) => `${col}${DATA_START_ROW}:${col}${DATA_END_ROW}`;
  const total = rows.length;
  const approved = countWhere(rows, (r) => r.tier === 'certified');
  const withConditions = countWhere(rows, (r) => r.tier === 'certified_with_ca');
  const notApproved = countWhere(rows, (r) => r.tier === 'not_certified');

  setFormula(sheet, 'B2', `COUNTA(${span('A')})`, total);
  setFormula(sheet, 'F2', `COUNTIF(${span('I')},"Approved")`, approved);
  setFormula(sheet, 'J2', `COUNTIF(${span('I')},"Approved with Conditions")`, withConditions);
  setFormula(sheet, 'N2', `COUNTIF(${span('I')},"Not Approved")`, notApproved);
  // Column R (CA status) is blank until a corrective-actions table lands, so
  // this is a true zero rather than a mis-pointed range.
  setFormula(sheet, 'R2', `COUNTIF(${span('R')},"⚠ Overdue")`, 0);
  setFormula(
    sheet,
    'V2',
    `IFERROR(COUNTIF(${span('I')},"Approved")/COUNTA(${span('A')}),"—")`,
    ratioOr(approved, total),
  );
}

const CSV_COLUMNS: ReadonlyArray<{ header: string; pick: (r: Row) => string | number | null }> = [
  { header: 'Farmer Code', pick: (r) => r.farmerCode },
  { header: 'Farmer Name', pick: (r) => r.farmerName },
  { header: 'Cooperative', pick: (r) => r.cooperativeName },
  { header: 'District / Cluster', pick: (r) => r.district },
  { header: 'Society', pick: (r) => r.society },
  { header: 'Inspector', pick: (r) => r.inspector },
  { header: 'Inspection Date', pick: (r) => r.inspectionDate },
  { header: 'Inspection Score (%)', pick: (r) => r.pct },
  { header: 'Certification Status', pick: (r) => (r.tier ? TIER_LABEL[r.tier] : null) },
  { header: 'Years in Programme', pick: (r) => r.yearsInProgramme },
  { header: 'Additional Conditions / Remarks', pick: () => null },
  { header: 'Approved By', pick: () => null },
  { header: 'Approval Date', pick: () => null },
  { header: 'Total CAs', pick: () => null },
  { header: 'CAs Closed', pick: () => null },
  { header: 'CAs Open', pick: () => null },
  { header: 'CAs Overdue', pick: () => null },
  { header: 'CA Status', pick: () => null },
];

function buildCsv(rows: Row[]): Buffer {
  const records = rows.map((r) => {
    const obj: Record<string, string | number | null> = {};
    for (const c of CSV_COLUMNS) obj[c.header] = c.pick(r);
    return obj;
  });
  const text = stringifyCsv(records, {
    header: true,
    columns: CSV_COLUMNS.map((c) => c.header),
  });
  return Buffer.from(text, 'utf-8');
}

export async function generateCertificationReport(
  params: CertificationReportParams,
): Promise<GeneratedReport> {
  seasonToDateRange(params.season);

  const rows = await fetchRows(params);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const slug = seasonToSlug(params.season);

  if (params.outputFormat === 'csv') {
    return {
      buffer: buildCsv(rows),
      fileName: `KuanaData_Certification_Status_${slug}_${stamp}.csv`,
      mimeType: CSV_MIME,
    };
  }
  return {
    buffer: await buildXlsx(rows),
    fileName: `KuanaData_Certification_Status_${slug}_${stamp}.xlsx`,
    mimeType: XLSX_MIME,
  };
}
