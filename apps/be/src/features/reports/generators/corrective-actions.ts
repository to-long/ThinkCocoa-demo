/**
 * Generator for `corrective_actions` — one row per corrective action
 * found in the active cooperative's inspections inside the selected
 * season. Mirrors the Demo Cocoa template
 * `apps/be/reports/KuanaData_Corrective_Actions_Report.xlsx`:
 *   • Row 1: title
 *   • Row 2: summary formulas — Total CAs / Open / In Progress /
 *     Closed / Overdue / % Closed
 *   • Row 3: section headers
 *   • Row 4: column headers (A-T)
 *
 * CA detection: a corrective action is recorded on a Kobo submission
 * via a triple of fields next to the NC question:
 *   <prefix>ActionDate           — date the inspector committed to
 *   <prefix>FollowupAction       — follow-up text (or "NA" when waived)
 *   <prefix>_CADate / _CAFollowupAction — older form's naming convention
 *
 * We scan each inspection's raw_data for the presence of an ActionDate
 * field and emit a row. There's no central `corrective_actions` table
 * yet, so the CA ID is synthesised as `<koboId>-<base>`.
 *
 * Status rule:
 *   - FollowupAction empty            → Open
 *   - FollowupAction == "NA" / "N/A"  → Waived
 *   - FollowupAction otherwise        → Closed
 *
 * NC description (column J) is derived from the field's base name
 * (e.g. `FarmingPractices/CalenderSpraying` → "Calender Spraying").
 * The Corrective Action Text (column M) and Person Responsible /
 * Checked By columns stay blank until a CA workflow table lands.
 */

import { stringify as stringifyCsv } from 'csv-stringify/sync';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { db } from '../../../db/client';
import { farmers } from '../../../db/schema/farmer';
import { cooperatives } from '../../../db/schema/iam';
import { inspections } from '../../../db/schema/inspection';
import { seasonToDateRange, seasonToSlug } from '../lib/season';
import { countWhere, ratioOr, setFormula } from '../lib/summary-cells';
import { readReportTemplate } from '../lib/templates';

export type CorrectiveActionsFormat = 'excel' | 'csv';

export interface CorrectiveActionsParams {
  cooperativeId: string;
  season: string;
  societyId: string | null;
  outputFormat: CorrectiveActionsFormat;
}

export interface GeneratedReport {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_MIME = 'text/csv; charset=utf-8';

const TEMPLATE_SHEET_NAME = 'Corrective Actions';
const DATA_START_ROW = 5;
const DATA_END_ROW = 5004;

/** Kobo group prefix → NC category label rendered in column L. */
const GROUP_TO_CATEGORY: Record<string, string> = {
  Management: 'Governance',
  Traceability: 'Traceability',
  environment: 'Environment',
  FarmingPractices: 'Agronomic',
  Social: 'Social',
};

interface CARow {
  caId: string;
  inspectionId: number;
  farmerCode: string;
  farmerName: string | null;
  cooperativeName: string | null;
  district: string | null;
  inspector: string | null;
  inspectionDate: string;
  plotId: string | null;
  ncDescription: string;
  ncCategory: string | null;
  dueDate: string | null;
  followupText: string | null;
  status: 'Open' | 'In Progress' | 'Closed' | 'Waived';
  daysOverdue: number | null;
}

/** Convert `FarmingPractices/CalenderSpraying` → "Calender Spraying"
 *  by stripping the group prefix and splitting CamelCase. */
function ncLabelFromKey(key: string): string {
  const base = key.includes('/') ? key.split('/').pop()! : key;
  // Drop trailing _CA marker for old naming convention.
  const stripped = base.replace(/_CA$/, '');
  return stripped
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim();
}

/** Derive the NC category from the group prefix (e.g. "FarmingPractices"
 *  → "Agronomic"). Falls back to the prefix itself if unmapped. */
function categoryFromKey(key: string): string | null {
  if (!key.includes('/')) return null;
  const group = key.split('/')[0]!;
  return GROUP_TO_CATEGORY[group] ?? group;
}

function statusFromFollowup(followup: string | null): CARow['status'] {
  if (followup == null || followup.trim() === '') return 'Open';
  const t = followup.trim().toLowerCase();
  if (t === 'na' || t === 'n/a') return 'Waived';
  return 'Closed';
}

function daysOverdue(status: CARow['status'], dueDate: string | null, now: Date): number | null {
  if (status === 'Closed' || status === 'Waived') return null;
  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const diffMs = now.getTime() - due.getTime();
  const days = Math.floor(diffMs / 86_400_000);
  return days > 0 ? days : null;
}

async function fetchRows(params: CorrectiveActionsParams): Promise<CARow[]> {
  const { from, to } = seasonToDateRange(params.season);

  // Inspections in season, joined to the farmer master + coop name.
  // Society filter narrows via farmer.society.
  const conds = [
    eq(inspections.cooperativeId, params.cooperativeId),
    gte(inspections.dateInspection, from),
    lte(inspections.dateInspection, to),
  ];
  if (params.societyId) {
    conds.push(eq(farmers.society, params.societyId));
  }

  const rows = await db
    .select({
      koboId: inspections.id,
      dateInspection: inspections.dateInspection,
      inspectorCode: inspections.inspectorCode,
      parcelId: inspections.parcelId,
      farmerId: inspections.farmerId,
      firstName: farmers.firstName,
      lastName: farmers.lastName,
      otherNames: farmers.otherNames,
      cooperativeName: cooperatives.name,
    })
    .from(inspections)
    .leftJoin(farmers, eq(farmers.id, inspections.farmerId))
    .leftJoin(cooperatives, eq(cooperatives.id, inspections.cooperativeId))
    .where(and(...conds))
    .orderBy(desc(inspections.dateInspection));

  const now = new Date();
  const out: CARow[] = [];

  for (const r of rows) {
    const raw: Record<string, unknown> = {}; // Collect base prefixes that have an ActionDate field (new convention)
    // or a CADate field (older naming). The presence of either marks a
    // recorded corrective action.
    const seen = new Set<string>();
    for (const key of Object.keys(raw)) {
      let base: string | null = null;
      if (key.endsWith('ActionDate')) base = key.slice(0, -'ActionDate'.length);
      else if (key.endsWith('_CADate')) base = key.slice(0, -'_CADate'.length);
      else if (key.endsWith('CADate') && !key.endsWith('_CADate'))
        base = key.slice(0, -'CADate'.length);
      if (!base || seen.has(base)) continue;
      seen.add(base);

      const dueDate = (raw[key] as string) || null;
      const followup =
        (raw[`${base}FollowupAction`] as string) ||
        (raw[`${base}_CAFollowupAction`] as string) ||
        null;
      const status = statusFromFollowup(followup);
      const fullName = [r.firstName, r.otherNames, r.lastName].filter(Boolean).join(' ').trim();

      out.push({
        caId: `${r.koboId}-${base.replace('/', '_')}`,
        inspectionId: r.koboId,
        farmerCode: r.farmerId ?? '',
        farmerName: fullName || null,
        cooperativeName: r.cooperativeName,
        district: r.cooperativeName,
        inspector: r.inspectorCode,
        inspectionDate: r.dateInspection,
        plotId: r.parcelId,
        ncDescription: ncLabelFromKey(base),
        ncCategory: categoryFromKey(base),
        dueDate,
        followupText: followup,
        status,
        daysOverdue: daysOverdue(status, dueDate, now),
      });
    }
  }

  // Sort by inspection date desc, then CA ID for stable output.
  out.sort((a, b) => {
    if (a.inspectionDate !== b.inspectionDate) return a.inspectionDate < b.inspectionDate ? 1 : -1;
    return a.caId.localeCompare(b.caId);
  });
  return out;
}

/** Cell-letter map for the template's data area (columns A-T). Order
 *  matches row 4 of the template. */
const CELL_MAP: ReadonlyArray<{ col: string; value: (row: CARow) => unknown }> = [
  { col: 'A', value: (r) => r.caId },
  { col: 'B', value: (r) => r.inspectionId },
  { col: 'C', value: (r) => r.farmerCode },
  { col: 'D', value: (r) => r.farmerName },
  { col: 'E', value: (r) => r.cooperativeName },
  { col: 'F', value: (r) => r.district },
  { col: 'G', value: (r) => r.inspector },
  { col: 'H', value: (r) => r.inspectionDate },
  { col: 'I', value: (r) => r.plotId },
  { col: 'J', value: (r) => r.ncDescription },
  // K (RA Criterion Reference) — needs an external lookup against the
  // RA standard; left blank until that mapping is seeded.
  { col: 'K', value: () => null },
  { col: 'L', value: (r) => r.ncCategory },
  // M (Corrective Action Text) — comes from the form's CA label, which
  // is not on the submission payload. Left blank until a question→label
  // map is seeded server-side.
  { col: 'M', value: () => null },
  { col: 'N', value: (r) => r.dueDate },
  // O (Person Responsible) / Q (Checked By) — not captured by the
  // current Kobo form; left blank.
  { col: 'O', value: () => null },
  // P (Follow-Up Check Date) — no separate timestamp captured; the
  // FollowupAction text is the only signal.
  { col: 'P', value: () => null },
  { col: 'Q', value: () => null },
  { col: 'R', value: (r) => r.status },
  { col: 'S', value: (r) => r.daysOverdue },
  { col: 'T', value: (r) => r.followupText },
];

async function buildXlsx(rows: CARow[]): Promise<Buffer> {
  const tplBuf = await readReportTemplate('KuanaData_Corrective_Actions_Report.xlsx');
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
 * Row-2 KPIs, formula + cached result (see `lib/summary-cells.ts`). These
 * ranges are the template's own — status is column R and the due date is
 * column N, which is where this generator writes them.
 *
 * "⚠ Overdue" keeps its `TODAY()` formula, so the live workbook re-evaluates
 * as the file ages, while the cached result is `daysOverdue` — same
 * definition (open/in-progress AND past due), evaluated at generation time.
 */
function writeSummary(sheet: ExcelJS.Worksheet, rows: CARow[]): void {
  const span = (col: string) => `${col}${DATA_START_ROW}:${col}${DATA_END_ROW}`;
  const total = rows.length;
  const closed = countWhere(rows, (r) => r.status === 'Closed');

  setFormula(sheet, 'B2', `COUNTA(${span('A')})`, total);
  setFormula(
    sheet,
    'F2',
    `COUNTIF(${span('R')},"Open")`,
    countWhere(rows, (r) => r.status === 'Open'),
  );
  setFormula(
    sheet,
    'J2',
    `COUNTIF(${span('R')},"In Progress")`,
    countWhere(rows, (r) => r.status === 'In Progress'),
  );
  setFormula(sheet, 'N2', `COUNTIF(${span('R')},"Closed")`, closed);
  setFormula(
    sheet,
    'R2',
    `COUNTIFS(${span('R')},"<>Closed",${span('R')},"<>Waived",${span('N')},"<"&TODAY())`,
    countWhere(rows, (r) => r.daysOverdue != null),
  );
  setFormula(
    sheet,
    'V2',
    `IFERROR(COUNTIF(${span('R')},"Closed")/COUNTA(${span('A')}),"—")`,
    ratioOr(closed, total),
  );
}

const CSV_COLUMNS: ReadonlyArray<{ header: string; pick: (r: CARow) => string | number | null }> = [
  { header: 'CA ID', pick: (r) => r.caId },
  { header: 'Inspection Record ID', pick: (r) => r.inspectionId },
  { header: 'Farmer Code', pick: (r) => r.farmerCode },
  { header: 'Farmer Name', pick: (r) => r.farmerName },
  { header: 'Cooperative', pick: (r) => r.cooperativeName },
  { header: 'District', pick: (r) => r.district },
  { header: 'Inspector', pick: (r) => r.inspector },
  { header: 'Inspection Date', pick: (r) => r.inspectionDate },
  { header: 'Plot ID', pick: (r) => r.plotId },
  { header: 'NC Description', pick: (r) => r.ncDescription },
  { header: 'RA Criterion Reference', pick: () => null },
  { header: 'NC Category', pick: (r) => r.ncCategory },
  { header: 'Corrective Action Text (SMART)', pick: () => null },
  { header: 'Due Date', pick: (r) => r.dueDate },
  { header: 'Person Responsible', pick: () => null },
  { header: 'Follow-Up Check Date', pick: () => null },
  { header: 'Checked By', pick: () => null },
  { header: 'Status', pick: (r) => r.status },
  { header: 'Days Overdue', pick: (r) => r.daysOverdue },
  { header: 'Notes / Remarks', pick: (r) => r.followupText },
];

function buildCsv(rows: CARow[]): Buffer {
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

export async function generateCorrectiveActionsReport(
  params: CorrectiveActionsParams,
): Promise<GeneratedReport> {
  seasonToDateRange(params.season);

  const rows = await fetchRows(params);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const slug = seasonToSlug(params.season);

  if (params.outputFormat === 'csv') {
    return {
      buffer: buildCsv(rows),
      fileName: `KuanaData_Corrective_Actions_${slug}_${stamp}.csv`,
      mimeType: CSV_MIME,
    };
  }
  return {
    buffer: await buildXlsx(rows),
    fileName: `KuanaData_Corrective_Actions_${slug}_${stamp}.xlsx`,
    mimeType: XLSX_MIME,
  };
}
