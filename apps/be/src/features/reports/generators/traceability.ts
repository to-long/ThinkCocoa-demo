/**
 * Generator for `traceability_report` — one row per parcel in the
 * active cooperative, joined to the farmer master, cooperative, the
 * parcel's polygon/point geometry, and the most recent inspection
 * inside the selected season for the per-parcel harvest figures.
 *
 * Mirrors the Demo Cocoa Ghana template
 * `apps/be/reports/ImpactCocoa_Traceability_Report_Template.xlsx`:
 *   • Row 1: title (preserved as-is)
 *   • Row 2: summary formulas — COUNTA / SUM / COUNTIF over the data range
 *   • Row 3: section headings (Geometry / Farmer / Location / Yield / GPS)
 *   • Row 4: column headers
 *   • Row 5 onward: spec annotations to overwrite with data
 *
 * Society filter (optional) narrows to `farmers.society = …`. Season
 * picks which inspection's `Traceability/TotalHarvet` and
 * `Traceability/TotalSeasonEstimate` values feed columns J & K.
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

export type TraceabilityReportFormat = 'excel' | 'csv';

export interface TraceabilityReportParams {
  cooperativeId: string;
  season: string;
  societyId: string | null;
  outputFormat: TraceabilityReportFormat;
}

export interface GeneratedReport {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_MIME = 'text/csv; charset=utf-8';

const TEMPLATE_SHEET_NAME = 'Traceability Report';
const DATA_START_ROW = 5;
/** Max data rows the template's summary formulas reference (`B5:B10004`). */
const DATA_END_ROW = 10004;

/** Per-RA standard, treated as the per-hectare maximum yield used to
 *  compute the "Maximum Capacity" column. Hardcoded on purpose — it's
 *  the same value the spec workbook stamps in column L row 5. */
const MAX_YIELD_KG_PER_HA = 800;

/** Planting year that flips the ImpactCocoa risk classification to
 *  "HIGH RISK" (any parcel planted after this is past the EUDR cut-off
 *  for forest-conversion-free declarations). */
const HIGH_RISK_PLANTING_YEAR = 2020;

interface Row {
  parcelId: string;
  farmerCode: string;
  farmerName: string | null;
  gender: string | null;
  society: string | null;
  cooperativeName: string | null;
  areaHa: number | null;
  longitude: number | null;
  latitude: number | null;
  hasPolygon: boolean;
  wktPolygon: string | null;
  harvestKg: number | null;
  nextSeasonEstimateKg: number | null;
  plantingYear: number | null;
}

function parseNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function fetchRows(params: TraceabilityReportParams): Promise<Row[]> {
  const { from, to } = seasonToDateRange(params.season);

  // 1. Parcels + farmer + coop + geometry (single trip, geometry table
  // is left-joined so parcels without coords still surface). Geometry
  // columns are projected via raw SQL (ST_X/ST_Y/ST_AsText) — drizzle
  // doesn't model PostGIS types natively.
  const conds = [
    eq(parcels.cooperativeId, params.cooperativeId),
    sql`${parcels.deletedAt} IS NULL`,
  ];
  if (params.societyId) {
    conds.push(eq(farmers.society, params.societyId));
  }

  const baseRows = await db
    .select({
      parcelId: parcels.id,
      areaHa: parcels.calculatedAreaHa,
      plantingDate: parcels.plantingDate,
      farmerCode: farmers.id,
      firstName: farmers.firstName,
      lastName: farmers.lastName,
      otherNames: farmers.otherNames,
      gender: farmers.sex,
      society: farmers.society,
      cooperativeName: cooperatives.name,
      longitude: sql<number | null>`ST_X(pg.point_geom)`,
      latitude: sql<number | null>`ST_Y(pg.point_geom)`,
      wktPolygon: sql<string | null>`ST_AsText(pg.geom)`,
    })
    .from(parcels)
    .leftJoin(farmers, eq(farmers.id, parcels.farmerId))
    .leftJoin(cooperatives, eq(cooperatives.id, parcels.cooperativeId))
    .leftJoin(sql`gis.parcel_geometries pg`, sql`pg.parcel_id = ${parcels.id}`)
    .where(and(...conds))
    .orderBy(parcels.id);

  if (baseRows.length === 0) return [];

  // 2. For each parcel, latest inspection inside the season window —
  // its raw_data carries the harvest + next-season estimate.
  return baseRows.map((r) => {
    // rawData removed with the Kobo decoupling — raw-derived columns
    // are no longer populated in this report.
    const raw: Record<string, unknown> = {};
    const fullName = [r.firstName, r.otherNames, r.lastName].filter(Boolean).join(' ');

    return {
      parcelId: r.parcelId,
      farmerCode: r.farmerCode ?? '',
      farmerName: fullName || null,
      gender: r.gender,
      society: r.society,
      cooperativeName: r.cooperativeName,
      areaHa: r.areaHa == null ? null : Number(r.areaHa),
      longitude: r.longitude,
      latitude: r.latitude,
      hasPolygon: r.wktPolygon != null,
      wktPolygon: r.wktPolygon,
      harvestKg: parseNum(raw['Traceability/TotalHarvet']),
      nextSeasonEstimateKg: parseNum(raw['Traceability/TotalSeasonEstimate']),
      plantingYear: r.plantingDate ? Number.parseInt(r.plantingDate.slice(0, 4), 10) : null,
    };
  });
}

function avgYieldKgPerHa(row: Row): number | null {
  if (row.harvestKg == null || row.areaHa == null || row.areaHa <= 0) return null;
  return Math.round(row.harvestKg / row.areaHa);
}

function maxCapacityKg(row: Row): number | null {
  if (row.areaHa == null) return null;
  return Math.round(row.areaHa * MAX_YIELD_KG_PER_HA);
}

function riskLabel(row: Row): string | null {
  if (row.plantingYear == null) return null;
  return row.plantingYear > HIGH_RISK_PLANTING_YEAR ? 'HIGH RISK' : 'OK';
}

/** Cell-letter map for the template's data area (columns A-P). Order
 *  matches row 4 of the template. */
const CELL_MAP: ReadonlyArray<{ col: string; value: (row: Row) => unknown }> = [
  { col: 'A', value: (r) => r.wktPolygon },
  { col: 'B', value: (r) => r.farmerCode },
  { col: 'C', value: (r) => r.parcelId },
  { col: 'D', value: (r) => r.areaHa },
  { col: 'E', value: (r) => r.farmerName },
  { col: 'F', value: (r) => r.gender },
  { col: 'G', value: (r) => r.cooperativeName },
  { col: 'H', value: (r) => r.society },
  { col: 'I', value: (r) => avgYieldKgPerHa(r) },
  { col: 'J', value: (r) => r.harvestKg },
  { col: 'K', value: (r) => r.nextSeasonEstimateKg },
  { col: 'L', value: () => MAX_YIELD_KG_PER_HA },
  { col: 'M', value: (r) => maxCapacityKg(r) },
  { col: 'N', value: (r) => r.longitude },
  { col: 'O', value: (r) => r.latitude },
  { col: 'P', value: (r) => riskLabel(r) },
];

async function buildXlsx(rows: Row[]): Promise<Buffer> {
  const tplBuf = await readReportTemplate('ImpactCocoa_Traceability_Report_Template.xlsx');
  const wb = new ExcelJS.Workbook();
  // biome-ignore lint/suspicious/noExplicitAny: typedef bridge — see farmer-coaching-v3.ts
  await wb.xlsx.load(tplBuf as any);

  const sheet = wb.getWorksheet(TEMPLATE_SHEET_NAME);
  if (!sheet) throw new Error(`Template missing sheet "${TEMPLATE_SHEET_NAME}"`);

  // Strip every other sheet so the shipped file ships only the data
  // tab — same pattern as the coaching generator.
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

  wb.calcProperties.fullCalcOnLoad = true;

  const arrayBuf = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuf);
}

const CSV_COLUMNS: ReadonlyArray<{ header: string; pick: (r: Row) => string | number | null }> = [
  { header: 'WKT Polygon', pick: (r) => r.wktPolygon },
  { header: 'Producer Code', pick: (r) => r.farmerCode },
  { header: 'Plantation Code', pick: (r) => r.parcelId },
  { header: 'Area (Ha)', pick: (r) => r.areaHa },
  { header: 'Producer', pick: (r) => r.farmerName },
  { header: 'Gender', pick: (r) => r.gender },
  { header: 'Section / District', pick: (r) => r.cooperativeName },
  { header: 'Society / Community', pick: (r) => r.society },
  { header: 'Average Yield (Kg/Ha)', pick: (r) => avgYieldKgPerHa(r) },
  { header: 'Average Estimation (Kg)', pick: (r) => r.harvestKg },
  { header: 'GMR Estimate (Kg)', pick: (r) => r.nextSeasonEstimateKg },
  { header: 'Maximum Yield (Kg/Ha)', pick: () => MAX_YIELD_KG_PER_HA },
  { header: 'Maximum Capacity (Kg)', pick: (r) => maxCapacityKg(r) },
  { header: 'Longitude (WGS84 DD)', pick: (r) => r.longitude },
  { header: 'Latitude (WGS84 DD)', pick: (r) => r.latitude },
  { header: 'ImpactCocoa Risk', pick: (r) => riskLabel(r) },
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

export async function generateTraceabilityReport(
  params: TraceabilityReportParams,
): Promise<GeneratedReport> {
  seasonToDateRange(params.season);

  const rows = await fetchRows(params);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const slug = seasonToSlug(params.season);

  if (params.outputFormat === 'csv') {
    return {
      buffer: buildCsv(rows),
      fileName: `ThinkCocoa_Traceability_Report_${slug}_${stamp}.csv`,
      mimeType: CSV_MIME,
    };
  }
  return {
    buffer: await buildXlsx(rows),
    fileName: `ThinkCocoa_Traceability_Report_${slug}_${stamp}.xlsx`,
    mimeType: XLSX_MIME,
  };
}
