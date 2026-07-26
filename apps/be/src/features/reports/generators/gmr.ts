/**
 * Generator for `gmr_template` — Group Member Registry export per the
 * Rainforest Alliance Annex S13 v1.3 spec, adapted for ImpactCocoa.
 *
 * Mirrors the Demo Cocoa Ghana template
 * `apps/be/reports/ThinkCocoa_GMR_Template.xlsx`. Three data sheets
 * all keyed by `plot_id`:
 *   • Tab 1 "1. Farm Information"   — 28 cols, one row per parcel
 *   • Tab 2 "2. Certified Crop"     — 17 cols, one row per parcel
 *   • Tab 3 "3. Farm Unit"          — 10 cols, one row per parcel
 *
 * The template also ships a "Cover Page" and a "Dashboard" we keep
 * verbatim, and a "DB Field Mapping" spec tab we strip from the
 * shipped file.
 *
 * Cross-sheet validation formulas (AA/AB on Tab 1; H–P on Tab 2;
 * F–I on Tab 3) are read once from row 5 of the template and
 * re-emitted per data row with cell refs adjusted from `…5` to `…N`,
 * so every row gets its own validation marks once Excel recalculates.
 */

import { stringify as stringifyCsv } from 'csv-stringify/sync';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { db } from '../../../db/client';
import { farmers } from '../../../db/schema/farmer';
import { parcels } from '../../../db/schema/gis';
import { cooperatives } from '../../../db/schema/iam';
import { inspections } from '../../../db/schema/inspection';
import { seasonToDateRange, seasonToSlug } from '../lib/season';
import { readReportTemplate } from '../lib/templates';

export type GmrReportFormat = 'excel' | 'csv';

export interface GmrReportParams {
  cooperativeId: string;
  season: string;
  societyId: string | null;
  outputFormat: GmrReportFormat;
}

export interface GeneratedReport {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_MIME = 'text/csv; charset=utf-8';

const DATA_START_ROW = 5;
const DATA_END_ROW = 104;

/** Sheets to ship in the output. "DB Field Mapping" is a spec doc and
 *  is stripped before write. */
const TAB_FARM = '1. Farm Information';
const TAB_CROP = '2. Certified Crop';
const TAB_UNIT = '3. Farm Unit';
const STRIP_SHEETS = new Set(['DB Field Mapping']);

interface PlotRow {
  plotId: string;
  farmerCode: string;
  farmerFirstName: string | null;
  farmerLastName: string | null;
  otherNames: string | null;
  farmerSex: string | null;
  farmerPhone: string | null;
  farmerGhCard: string | null;
  farmerDobYear: number | null;
  society: string | null;
  cooperativeName: string | null;
  areaHa: number | null;
  cocoaVariety: string | null;
  plotsForFarmer: number;
  inspectorCode: string | null;
  inspectionYear: number | null;
  inspectionMonth: number | null;
  inspectionDay: number | null;
  permanentStaff: number | null;
  temporaryStaff: number | null;
  harvestCurrentSeason: number | null;
  harvestPrevSeason: number | null;
  volumeSoldGroup: number | null;
  estimateNextSeason: number | null;
  latitude: number | null;
  longitude: number | null;
}

function parseNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Member/Gps_location is a space-separated `lat lon alt accuracy`
 *  string from Kobo's geopoint widget. */
function parseGps(v: unknown): { lat: number; lon: number } | null {
  if (typeof v !== 'string') return null;
  const parts = v.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const lat = Number.parseFloat(parts[0]!);
  const lon = Number.parseFloat(parts[1]!);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

async function fetchRows(params: GmrReportParams): Promise<PlotRow[]> {
  const { from, to } = seasonToDateRange(params.season);

  const conds = [
    eq(parcels.cooperativeId, params.cooperativeId),
    sql`${parcels.deletedAt} IS NULL`,
  ];
  if (params.societyId) {
    conds.push(eq(farmers.society, params.societyId));
  }

  // Parcels + farmer + coop. Geometry table is empty in this dataset,
  // so lat/lon come from the inspection's `Member/Gps_location` text.
  const baseRows = await db
    .select({
      plotId: parcels.id,
      farmerId: parcels.farmerId,
      areaHa: parcels.calculatedAreaHa,
      cocoaVariety: parcels.cocoaVariety,
      firstName: farmers.firstName,
      lastName: farmers.lastName,
      otherNames: farmers.otherNames,
      sex: farmers.sex,
      phone: farmers.phoneNumber,
      ghCard: farmers.nationalIdNumber,
      dob: farmers.dateOfBirth,
      society: farmers.society,
      cooperativeName: cooperatives.name,
    })
    .from(parcels)
    .leftJoin(farmers, eq(farmers.id, parcels.farmerId))
    .leftJoin(cooperatives, eq(cooperatives.id, parcels.cooperativeId))
    .where(and(...conds))
    .orderBy(parcels.id);

  if (baseRows.length === 0) return [];

  // Count plots per farmer for column H (Tab 1).
  const plotsPerFarmer = new Map<string, number>();
  for (const r of baseRows) {
    if (!r.farmerId) continue;
    plotsPerFarmer.set(r.farmerId, (plotsPerFarmer.get(r.farmerId) ?? 0) + 1);
  }

  // Latest inspection per parcel inside the season window.
  const insp = await db
    .select({
      parcelId: inspections.parcelId,
      dateInspection: inspections.dateInspection,
      inspectorCode: inspections.inspectorCode,
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

  const latestByParcel = new Map<string, (typeof insp)[number]>();
  for (const i of insp) {
    if (!i.parcelId) continue;
    if (!latestByParcel.has(i.parcelId)) latestByParcel.set(i.parcelId, i);
  }

  return baseRows.map((r) => {
    const i = latestByParcel.get(r.plotId);
    const raw: Record<string, unknown> = {};
    const gps = parseGps(raw['Member/Gps_location']);
    const dateInspection = i?.dateInspection ? new Date(i.dateInspection) : null;

    return {
      plotId: r.plotId,
      farmerCode: r.farmerId ?? '',
      farmerFirstName: r.firstName,
      farmerLastName: r.lastName,
      otherNames: r.otherNames,
      farmerSex: r.sex,
      farmerPhone: r.phone,
      farmerGhCard: r.ghCard,
      farmerDobYear: r.dob ? Number.parseInt(r.dob.slice(0, 4), 10) : null,
      society: r.society,
      cooperativeName: r.cooperativeName,
      areaHa: r.areaHa == null ? null : Number(r.areaHa),
      cocoaVariety: r.cocoaVariety,
      plotsForFarmer: r.farmerId ? (plotsPerFarmer.get(r.farmerId) ?? 1) : 1,
      inspectorCode: i?.inspectorCode ?? null,
      inspectionYear: dateInspection ? dateInspection.getUTCFullYear() : null,
      inspectionMonth: dateInspection ? dateInspection.getUTCMonth() + 1 : null,
      inspectionDay: dateInspection ? dateInspection.getUTCDate() : null,
      permanentStaff: parseNum(raw['Member/PermanentStaff']),
      temporaryStaff: parseNum(raw['Member/TemporaryStaff']),
      harvestCurrentSeason: parseNum(raw['Traceability/TotalHarvet']),
      // Previous-year harvest / volume aren't captured separately in
      // raw_data; use current-season as the most recent reading.
      harvestPrevSeason: parseNum(raw['Traceability/TotalHarvet']),
      volumeSoldGroup: parseNum(raw['Traceability/TotalSold']),
      estimateNextSeason: parseNum(raw['Traceability/TotalSeasonEstimate']),
      latitude: gps?.lat ?? null,
      longitude: gps?.lon ?? null,
    };
  });
}

function farmType(areaHa: number | null): string | null {
  if (areaHa == null) return null;
  // RA convention: ≤ 4 ha smallholder, larger commercial.
  return areaHa <= 4 ? 'Small' : 'Large';
}

function fullName(r: PlotRow): string {
  return [r.farmerFirstName, r.otherNames, r.farmerLastName].filter(Boolean).join(' ').trim();
}

/** Cell maps per data sheet — only the data columns. Formula columns
 *  are read from row 5 of the template and re-emitted per data row. */
const TAB_FARM_CELLS: ReadonlyArray<{ col: string; value: (r: PlotRow) => unknown }> = [
  { col: 'A', value: (r) => r.plotId },
  { col: 'B', value: () => null }, // National Farm ID (N/A in Ghana)
  { col: 'C', value: (r) => r.society }, // Village/City (closest proxy)
  { col: 'D', value: (r) => r.cooperativeName }, // District (coop as proxy)
  { col: 'E', value: (r) => r.cooperativeName }, // Inspection Region
  { col: 'F', value: (r) => r.areaHa },
  { col: 'G', value: (r) => farmType(r.areaHa) },
  { col: 'H', value: (r) => r.plotsForFarmer },
  { col: 'I', value: () => 1 }, // No. of Certified Crops (HARDCODE = 1 per spec)
  { col: 'J', value: (r) => r.farmerFirstName }, // Operator = farmer (no separate operator master)
  { col: 'K', value: (r) => r.farmerLastName },
  { col: 'L', value: (r) => r.farmerPhone },
  { col: 'M', value: (r) => r.farmerGhCard },
  { col: 'N', value: (r) => r.farmerSex },
  { col: 'O', value: (r) => r.farmerDobYear },
  { col: 'P', value: (r) => r.farmerFirstName }, // Owner = same farmer
  { col: 'Q', value: (r) => r.farmerLastName },
  { col: 'R', value: (r) => r.farmerPhone },
  { col: 'S', value: (r) => r.farmerGhCard },
  { col: 'T', value: (r) => r.farmerSex },
  { col: 'U', value: (r) => r.permanentStaff },
  { col: 'V', value: (r) => r.temporaryStaff },
  { col: 'W', value: (r) => r.inspectorCode },
  { col: 'X', value: (r) => r.inspectionYear },
  { col: 'Y', value: (r) => r.inspectionMonth },
  { col: 'Z', value: (r) => r.inspectionDay },
];

const TAB_CROP_CELLS: ReadonlyArray<{ col: string; value: (r: PlotRow) => unknown }> = [
  { col: 'A', value: (r) => r.plotId },
  { col: 'B', value: () => 'Cocoa' },
  { col: 'C', value: (r) => r.cocoaVariety },
  { col: 'D', value: (r) => r.areaHa },
  { col: 'E', value: (r) => r.estimateNextSeason },
  { col: 'F', value: (r) => r.harvestCurrentSeason },
  { col: 'G', value: (r) => r.volumeSoldGroup },
];

const TAB_UNIT_CELLS: ReadonlyArray<{ col: string; value: (r: PlotRow) => unknown }> = [
  { col: 'A', value: (r) => r.plotId },
  { col: 'B', value: (r) => r.plotId }, // Farm Unit ID = plot_id for single-plot farms
  { col: 'C', value: (r) => r.areaHa },
  { col: 'D', value: (r) => r.latitude },
  { col: 'E', value: (r) => r.longitude },
];

/** Formula columns per sheet that should be filled down from row 5
 *  to every data row, adjusting `…5` row refs to the current row. */
const FORMULA_COLS_BY_SHEET: Record<string, string[]> = {
  [TAB_FARM]: ['AA', 'AB'],
  [TAB_CROP]: ['H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'],
  [TAB_UNIT]: ['F', 'G', 'H', 'I'],
};

/** Adjust `<col>5` cell refs in a formula to `<col><n>` so a row-5
 *  template formula can be re-emitted on row n. Only matches refs
 *  that are NOT part of an absolute range (e.g. `A:A` is untouched
 *  because there's no row number). */
function adjustFormulaRow(formula: string, n: number): string {
  return formula.replace(/(\$?[A-Z]+)\$?5\b/g, `$1${n}`);
}

function writeDataSheet(
  sheet: ExcelJS.Worksheet,
  cellMap: ReadonlyArray<{ col: string; value: (r: PlotRow) => unknown }>,
  formulaCols: string[],
  rows: PlotRow[],
): void {
  // Snapshot row-5 formula text for each formula column.
  const formulaTemplates = new Map<string, string>();
  for (const col of formulaCols) {
    const cell = sheet.getRow(DATA_START_ROW).getCell(col);
    const v = cell.value as ExcelJS.CellFormulaValue | string | null;
    if (v && typeof v === 'object' && 'formula' in v && typeof v.formula === 'string') {
      formulaTemplates.set(col, v.formula);
    }
  }

  // Wipe data + formula columns across the entire range.
  const wipeEnd = Math.max(DATA_END_ROW, DATA_START_ROW + rows.length);
  for (let r = DATA_START_ROW; r <= wipeEnd; r++) {
    const row = sheet.getRow(r);
    for (const m of cellMap) row.getCell(m.col).value = null;
    for (const col of formulaCols) row.getCell(col).value = null;
  }

  // Write data + propagate formulas per row.
  for (let i = 0; i < rows.length; i++) {
    const data = rows[i]!;
    const rowIdx = DATA_START_ROW + i;
    const row = sheet.getRow(rowIdx);
    for (const m of cellMap) {
      const v = m.value(data);
      row.getCell(m.col).value = (v ?? null) as ExcelJS.CellValue;
    }
    for (const col of formulaCols) {
      const tpl = formulaTemplates.get(col);
      if (!tpl) continue;
      const formula = adjustFormulaRow(tpl, rowIdx);
      row.getCell(col).value = { formula, date1904: false };
    }
    row.commit();
  }
}

async function buildXlsx(rows: PlotRow[]): Promise<Buffer> {
  const tplBuf = await readReportTemplate('ThinkCocoa_GMR_Template.xlsx');
  const wb = new ExcelJS.Workbook();
  // biome-ignore lint/suspicious/noExplicitAny: typedef bridge — see farmer-coaching-v3.ts
  await wb.xlsx.load(tplBuf as any);

  // Strip the developer spec sheet — keep Cover, the 3 data tabs, and
  // Dashboard.
  const toDrop: number[] = [];
  wb.eachSheet((s) => {
    if (STRIP_SHEETS.has(s.name)) toDrop.push(s.id);
  });
  for (const id of toDrop) wb.removeWorksheet(id);

  const farmSheet = wb.getWorksheet(TAB_FARM);
  const cropSheet = wb.getWorksheet(TAB_CROP);
  const unitSheet = wb.getWorksheet(TAB_UNIT);
  if (!farmSheet || !cropSheet || !unitSheet) {
    throw new Error('GMR template missing one of the three data sheets');
  }

  writeDataSheet(farmSheet, TAB_FARM_CELLS, FORMULA_COLS_BY_SHEET[TAB_FARM] ?? [], rows);
  writeDataSheet(cropSheet, TAB_CROP_CELLS, FORMULA_COLS_BY_SHEET[TAB_CROP] ?? [], rows);
  writeDataSheet(unitSheet, TAB_UNIT_CELLS, FORMULA_COLS_BY_SHEET[TAB_UNIT] ?? [], rows);

  wb.calcProperties.fullCalcOnLoad = true;

  const arrayBuf = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuf);
}

/** CSV flatten: union of the three sheets keyed by plot_id, prefixed
 *  to make column origin clear. Validation formula columns are
 *  omitted — they're spreadsheet-only. */
const CSV_COLUMNS: ReadonlyArray<{ header: string; pick: (r: PlotRow) => string | number | null }> =
  [
    { header: 'Plot ID', pick: (r) => r.plotId },
    { header: 'Farm Area (ha)', pick: (r) => r.areaHa },
    { header: 'Farm Type', pick: (r) => farmType(r.areaHa) },
    { header: 'Plots for Farmer', pick: (r) => r.plotsForFarmer },
    { header: 'Village / Society', pick: (r) => r.society },
    { header: 'District / Coop', pick: (r) => r.cooperativeName },
    { header: 'Inspection Region', pick: (r) => r.cooperativeName },
    { header: 'Farmer Full Name', pick: (r) => fullName(r) },
    { header: 'Farmer Gender', pick: (r) => r.farmerSex },
    { header: 'Farmer Year of Birth', pick: (r) => r.farmerDobYear },
    { header: 'Farmer Phone', pick: (r) => r.farmerPhone },
    { header: 'Farmer Ghana Card', pick: (r) => r.farmerGhCard },
    { header: 'Permanent Workers', pick: (r) => r.permanentStaff },
    { header: 'Temporary Workers', pick: (r) => r.temporaryStaff },
    { header: 'Inspector', pick: (r) => r.inspectorCode },
    { header: 'Inspection Year', pick: (r) => r.inspectionYear },
    { header: 'Inspection Month', pick: (r) => r.inspectionMonth },
    { header: 'Inspection Day', pick: (r) => r.inspectionDay },
    { header: 'Certified Crop', pick: () => 'Cocoa' },
    { header: 'Variety', pick: (r) => r.cocoaVariety },
    { header: 'Harvest Estimate Next Season (kg)', pick: (r) => r.estimateNextSeason },
    { header: 'Harvest Current Season (kg)', pick: (r) => r.harvestCurrentSeason },
    { header: 'Volume Sold to Group (kg)', pick: (r) => r.volumeSoldGroup },
    { header: 'Latitude (WGS84)', pick: (r) => r.latitude },
    { header: 'Longitude (WGS84)', pick: (r) => r.longitude },
  ];

function buildCsv(rows: PlotRow[]): Buffer {
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

export async function generateGmrReport(params: GmrReportParams): Promise<GeneratedReport> {
  seasonToDateRange(params.season);

  const rows = await fetchRows(params);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const slug = seasonToSlug(params.season);

  if (params.outputFormat === 'csv') {
    return {
      buffer: buildCsv(rows),
      fileName: `ThinkCocoa_GMR_${slug}_${stamp}.csv`,
      mimeType: CSV_MIME,
    };
  }
  return {
    buffer: await buildXlsx(rows),
    fileName: `ThinkCocoa_GMR_${slug}_${stamp}.xlsx`,
    mimeType: XLSX_MIME,
  };
}
