/**
 * Generator for `gmr_template` — Group Member Registry export per the
 * Rainforest Alliance Annex S13 v1.3 spec, adapted for ThinkCocoa.
 *
 * Mirrors the Demo Cocoa template
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
import { countWhere, type FormulaResult, ratioOr, setFormula, sumOf } from '../lib/summary-cells';
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
const TAB_DASHBOARD = 'Dashboard';
const STRIP_SHEETS = new Set(['DB Field Mapping']);

interface PlotRow {
  plotId: string;
  farmerCode: string;
  farmerFirstName: string | null;
  farmerLastName: string | null;
  otherNames: string | null;
  farmerSex: string | null;
  farmerPhone: string | null;
  farmerNationalId: string | null;
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

async function fetchRows(params: GmrReportParams): Promise<PlotRow[]> {
  const { from, to } = seasonToDateRange(params.season);

  const conds = [
    eq(parcels.cooperativeId, params.cooperativeId),
    sql`${parcels.deletedAt} IS NULL`,
  ];
  if (params.societyId) {
    conds.push(eq(farmers.society, params.societyId));
  }

  // Parcels + farmer + coop + geometry. The comment here used to say the
  // geometry table was empty and that lat/lon came from the inspection's
  // `Member/Gps_location` text — that stopped being true twice over: the
  // table IS populated (171 of 171 parcels on ADWUMA carry a point), and
  // the raw Kobo payload this read from was emptied by the decoupling, so
  // every coordinate on tab 3 came out blank. On a tab titled "Farm Units
  // (GPS)". Projected the same way `traceability.ts` does it — drizzle
  // doesn't model PostGIS types, hence the raw ST_X/ST_Y.
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
      nationalId: farmers.nationalIdNumber,
      dob: farmers.dateOfBirth,
      society: farmers.society,
      cooperativeName: cooperatives.name,
      longitude: sql<number | null>`ST_X(pg.point_geom)`,
      latitude: sql<number | null>`ST_Y(pg.point_geom)`,
    })
    .from(parcels)
    .leftJoin(farmers, eq(farmers.id, parcels.farmerId))
    .leftJoin(cooperatives, eq(cooperatives.id, parcels.cooperativeId))
    .leftJoin(sql`gis.parcel_geometries pg`, sql`pg.parcel_id = ${parcels.id}`)
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
      // Workforce + traceability figures. These are real columns and always
      // were; the generator was reading them out of the Kobo `raw_data`
      // payload, which the decoupling emptied — so tab 1's staff columns and
      // tab 2's harvest/volume/estimate columns were blank, and six of the
      // Dashboard's indicators totalled 0.
      permanentStaff: inspections.permanentStaff,
      temporaryStaff: inspections.temporaryStaff,
      totalHarvestKg: inspections.totalHarvestKg,
      totalSoldKg: inspections.totalSoldKg,
      nextSeasonEstimateKg: inspections.nextSeasonEstimateKg,
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
    const dateInspection = i?.dateInspection ? new Date(i.dateInspection) : null;

    return {
      plotId: r.plotId,
      farmerCode: r.farmerId ?? '',
      farmerFirstName: r.firstName,
      farmerLastName: r.lastName,
      otherNames: r.otherNames,
      farmerSex: r.sex,
      farmerPhone: r.phone,
      farmerNationalId: r.nationalId,
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
      permanentStaff: i?.permanentStaff ?? null,
      temporaryStaff: i?.temporaryStaff ?? null,
      harvestCurrentSeason: parseNum(i?.totalHarvestKg),
      // The inspection carries one harvest reading, not a per-year series,
      // so previous-season repeats it — the template wants both columns and
      // this is the most recent figure available for either.
      harvestPrevSeason: parseNum(i?.totalHarvestKg),
      volumeSoldGroup: parseNum(i?.totalSoldKg),
      estimateNextSeason: parseNum(i?.nextSeasonEstimateKg),
      latitude: r.latitude,
      longitude: r.longitude,
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
  { col: 'B', value: () => null }, // National Farm ID (N/A)
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
  { col: 'M', value: (r) => r.farmerNationalId },
  { col: 'N', value: (r) => r.farmerSex },
  { col: 'O', value: (r) => r.farmerDobYear },
  { col: 'P', value: (r) => r.farmerFirstName }, // Owner = same farmer
  { col: 'Q', value: (r) => r.farmerLastName },
  { col: 'R', value: (r) => r.farmerPhone },
  { col: 'S', value: (r) => r.farmerNationalId },
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

/**
 * Per-row result for each formula column, mirroring the template formula
 * printed above it. A formula with no cached result is BLANK in Google
 * Sheets and Numbers (they never recalculate) — 300 cells' worth on this
 * workbook. See `lib/summary-cells.ts`.
 *
 * The three presence checks are unconditional `✓`: every plot row is
 * written to all three tabs by `buildXlsx`, so a cross-tab COUNTIF can
 * never miss. If that ever stops being true, these become real lookups.
 */
const FORMULA_RESULTS: Record<string, (r: PlotRow) => FormulaResult> = {
  // 1. Farm Information — present in tab 2 / tab 3.
  AA: () => '✓ Present',
  AB: () => '✓ Present',
  // 2. Certified Crop. D=area, E=next-season estimate, F=harvest, G=volume
  // sold to the group; 64 kg is the standard bag.
  H: () => '✓',
  I: (r) => (num(r.volumeSoldGroup) > num(r.harvestCurrentSeason) ? '⚠ Vol>Harvest' : 'OK'),
  J: (r) => div(num(r.estimateNextSeason) - num(r.harvestCurrentSeason), r.harvestCurrentSeason),
  K: (r) => div(num(r.estimateNextSeason), r.areaHa),
  L: (r) => div(num(r.harvestCurrentSeason), r.areaHa),
  M: (r) => div(num(r.volumeSoldGroup), r.harvestCurrentSeason),
  N: (r) => div(num(r.estimateNextSeason), 64),
  O: (r) => div(num(r.harvestCurrentSeason), 64),
  P: (r) => div(num(r.volumeSoldGroup), 64),
};

/** Tab 3 shares column letters F/G/H/I with tab 2 but means different
 *  things by them, so it gets its own map. */
const FORMULA_RESULTS_UNIT: Record<string, (r: PlotRow) => FormulaResult> = {
  F: () => '✓',
  G: (r) => latLonVerdict(r.latitude, 90),
  H: (r) => latLonVerdict(r.longitude, 180),
  // "★ Largest" marks the biggest farm unit within a plot. One unit per
  // plot here (unit ID = plot ID), so every row is its own maximum.
  I: () => '★ Largest',
};

const num = (v: number | null | undefined): number => (typeof v === 'number' ? v : 0);

/** `IFERROR(IF(AND(ISNUMBER(..),divisor<>0), a/divisor, "—"), " ")`. */
function div(a: number, divisor: number | null | undefined): FormulaResult {
  return typeof divisor === 'number' && divisor !== 0 ? a / divisor : '—';
}

/**
 * `IF(v="","",IF(AND(ISNUMBER(v),-limit<=v<=limit),"✓ Valid","⚠ Check value"))`.
 *
 * The blank branch returns `''`, which ExcelJS cannot store: its model copy
 * guards on `if (value)` and drops every falsy result. The cell ends up with
 * a formula and no cached value — which renders blank, exactly what `""`
 * renders as. So the omission is harmless HERE, and only here; a cached `0`
 * survives (verified) because the drop happens in the value copy, not the
 * writer.
 */
function latLonVerdict(v: number | null | undefined, limit: number): FormulaResult {
  if (v == null) return '';
  return v >= -limit && v <= limit ? '✓ Valid' : '⚠ Check value';
}

function writeDataSheet(
  sheet: ExcelJS.Worksheet,
  cellMap: ReadonlyArray<{ col: string; value: (r: PlotRow) => unknown }>,
  formulaCols: string[],
  rows: PlotRow[],
  results: Record<string, (r: PlotRow) => FormulaResult> = FORMULA_RESULTS,
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

  // The template only styles a fixed number of data rows — borders, banded
  // fills, per-column alignment and number formats. Past that, rows written
  // by ExcelJS are bare, and the report visibly falls apart mid-table (it
  // did: everything from ABM-0066-F1 onward printed as plain text). So the
  // style travels with the data, taken from the template's first two data
  // rows so the banding keeps alternating instead of flattening to one
  // colour.
  const bandTemplates = [sheet.getRow(DATA_START_ROW), sheet.getRow(DATA_START_ROW + 1)];
  const lastCol = sheet.columnCount;

  // Write data + propagate formulas per row.
  for (let i = 0; i < rows.length; i++) {
    const data = rows[i]!;
    const rowIdx = DATA_START_ROW + i;
    const row = sheet.getRow(rowIdx);
    const band = bandTemplates[i % 2]!;
    if (rowIdx > DATA_START_ROW + 1) {
      row.height = band.height;
      for (let c = 1; c <= lastCol; c++) {
        row.getCell(c).style = { ...band.getCell(c).style };
      }
    }
    for (const m of cellMap) {
      const v = m.value(data);
      row.getCell(m.col).value = (v ?? null) as ExcelJS.CellValue;
    }
    for (const col of formulaCols) {
      const tpl = formulaTemplates.get(col);
      if (!tpl) continue;
      const formula = adjustFormulaRow(tpl, rowIdx);
      const result = results[col]?.(data);
      row.getCell(col).value = { formula, date1904: false, result } as ExcelJS.CellValue;
    }
    row.commit();
  }
}

/**
 * The Dashboard tab's 21 indicators, formula + cached result.
 *
 * Two ranges change here:
 *   - Every range was hard-capped at row 104, the template's styled depth.
 *     A cooperative with more than 100 plots silently dropped the rest from
 *     every total. They now span the data actually written.
 *   - "Farms with missing inspection data" counted `⚠ MISSING!` in column W,
 *     which holds the inspector CODE — a marker that never appears there, so
 *     the answer was always 0. Blank inspector is what the label describes.
 */
function writeDashboard(sheet: ExcelJS.Worksheet, rows: PlotRow[]): void {
  const end = Math.max(DATA_END_ROW, DATA_START_ROW + rows.length - 1);
  const at = (tab: string, col: string) => `'${tab}'!${col}${DATA_START_ROW}:${col}${end}`;
  const farm = (col: string) => at(TAB_FARM, col);
  const crop = (col: string) => at(TAB_CROP, col);
  const unit = (col: string) => at(TAB_UNIT, col);

  const area = sumOf(rows, (r) => r.areaHa);
  const estimate = sumOf(rows, (r) => r.estimateNextSeason);
  const harvest = sumOf(rows, (r) => r.harvestCurrentSeason);

  // Tab 1 — completeness.
  setFormula(sheet, 'C5', `COUNTA(${farm('A')})`, rows.length);
  setFormula(
    sheet,
    'C6',
    `COUNTBLANK(${farm('W')})`,
    countWhere(rows, (r) => !r.inspectorCode),
  );
  // AB is tab 1's "present in tab 3" check — every plot row is written to
  // all three tabs, so nothing is ever missing.
  setFormula(sheet, 'C7', `COUNTIF(${farm('AB')},"⚠ MISSING!")`, 0);

  // Tab 2 — certified crop.
  setFormula(sheet, 'C9', `COUNTA(${crop('A')})`, rows.length);
  setFormula(sheet, 'C10', `SUM(${crop('D')})`, area);
  setFormula(sheet, 'C11', `SUM(${crop('E')})`, estimate);
  setFormula(sheet, 'C12', `SUM(${crop('F')})`, harvest);
  setFormula(
    sheet,
    'C13',
    `SUM(${crop('G')})`,
    sumOf(rows, (r) => r.volumeSoldGroup),
  );
  setFormula(
    sheet,
    'C14',
    `IFERROR(SUM(${crop('E')})/SUM(${crop('D')}),"—")`,
    ratioOr(estimate, area),
  );
  setFormula(
    sheet,
    'C15',
    `IFERROR(SUM(${crop('F')})/SUM(${crop('D')}),"—")`,
    ratioOr(harvest, area),
  );
  setFormula(
    sheet,
    'C16',
    `COUNTIF(${crop('I')},"⚠ Vol>Harvest")`,
    countWhere(rows, (r) => num(r.volumeSoldGroup) > num(r.harvestCurrentSeason)),
  );

  // Tab 3 — farm units / GPS. The two error counts follow the formula's own
  // definition: out-of-range coordinates. A blank coordinate yields "" on
  // the row, so it is not counted despite the label saying "/ missing".
  setFormula(sheet, 'C18', `COUNTA(${unit('A')})`, rows.length);
  setFormula(sheet, 'C19', `SUM(${unit('C')})`, area);
  setFormula(
    sheet,
    'C20',
    `COUNTIF(${unit('G')},"⚠ Check value")`,
    countWhere(rows, (r) => latLonVerdict(r.latitude, 90) === '⚠ Check value'),
  );
  setFormula(
    sheet,
    'C21',
    `COUNTIF(${unit('H')},"⚠ Check value")`,
    countWhere(rows, (r) => latLonVerdict(r.longitude, 180) === '⚠ Check value'),
  );
  setFormula(sheet, 'C22', `COUNTIF(${unit('I')},"★ Largest")`, rows.length);

  // Workforce.
  setFormula(
    sheet,
    'C24',
    `SUM(${farm('U')})`,
    sumOf(rows, (r) => r.permanentStaff),
  );
  setFormula(
    sheet,
    'C25',
    `SUM(${farm('V')})`,
    sumOf(rows, (r) => r.temporaryStaff),
  );
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
  writeDataSheet(
    unitSheet,
    TAB_UNIT_CELLS,
    FORMULA_COLS_BY_SHEET[TAB_UNIT] ?? [],
    rows,
    FORMULA_RESULTS_UNIT,
  );

  // The Dashboard reads from the three data tabs, so it goes last.
  const dashboard = wb.getWorksheet(TAB_DASHBOARD);
  if (dashboard) writeDashboard(dashboard, rows);

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
    { header: 'Farmer National ID', pick: (r) => r.farmerNationalId },
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
