/**
 * Generator for `eudr_compliance` — one row per parcel in the active
 * cooperative, gathering everything the EU Deforestation Regulation
 * (Art. 30) Due Diligence Statement needs: farmer identity, plot
 * geolocation, year established, inspection-derived EUDR verdict,
 * and the downstream traceability chain (last-season purchase
 * volume + linked secondary waybill + sourcing partner).
 *
 * Mirrors the Demo Cocoa Ghana template
 * `apps/be/reports/ThinkCocoa_EUDR_Compliance_Report.xlsx` (columns
 * A-S). Two columns stay blank in v1 because they need an external
 * GIS / Global Forest Watch raster analysis we don't yet import:
 *   M — Deforestation Status (post-2020 polygon overlap check)
 *   N — Analysis Date
 *
 * When a `parcel_geometries` table is finally populated and an
 * external GFW job lands its verdict, columns M and N become a
 * left-join + projection.
 */

import { stringify as stringifyCsv } from 'csv-stringify/sync';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import ExcelJS from 'exceljs';
import { db } from '../../../db/client';
import { farmers } from '../../../db/schema/farmer';
import { eudrStatus, parcels } from '../../../db/schema/gis';
import { cooperatives } from '../../../db/schema/iam';
import { inspections } from '../../../db/schema/inspection';
import { primaryEvacLotPurchases, primaryEvacLots } from '../../../db/schema/primary-evacuation';
import { cocoaPurchases } from '../../../db/schema/purchase';
import {
  secondaryEvacLotPrimaries,
  secondaryEvacLots,
} from '../../../db/schema/secondary-evacuation';
import { seasonToDateRange, seasonToSlug } from '../lib/season';
import { readReportTemplate } from '../lib/templates';

export type EudrReportFormat = 'excel' | 'csv';

export interface EudrReportParams {
  cooperativeId: string;
  season: string;
  societyId: string | null;
  outputFormat: EudrReportFormat;
}

export interface GeneratedReport {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_MIME = 'text/csv; charset=utf-8';

const TEMPLATE_SHEET_NAME = 'EUDR Compliance Register';
const DATA_START_ROW = 5;
const DATA_END_ROW = 10004;

/** EUDR Art. 2(7) — operators must show no deforestation after this
 *  cut-off. Any plot established after this year is flagged as
 *  post-cutoff in column L. */
const EUDR_CUTOFF_YEAR = 2020;

type EudrCompliance = 'COMPLIANT' | 'HIGH RISK' | 'PENDING ASSESSMENT';

interface EudrRow {
  plotId: string;
  farmerCode: string;
  district: string | null;
  cooperativeName: string | null;
  farmerName: string | null;
  ghanaCard: string | null;
  society: string | null;
  areaHa: number | null;
  latitude: number | null;
  longitude: number | null;
  yearEstablished: number | null;
  /** Column M — composed from the imported EUDR assessment
   *  (deforestation risk + protected-area risk + overlap). */
  deforestationStatus: string | null;
  /** Column N — EUDR assessment date (gis.eudr_status.assessed_at). */
  analysisDate: string | null;
  complianceStatus: EudrCompliance;
  complianceDate: string | null;
  lastSeasonPurchaseKg: number | null;
  linkedWaybill: string | null;
  sourcingPartner: string | null;
}

function parseGps(v: unknown): { lat: number; lon: number } | null {
  if (typeof v !== 'string') return null;
  const parts = v.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const lat = Number.parseFloat(parts[0]!);
  const lon = Number.parseFloat(parts[1]!);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

/** Map the inspection-derived `eudrStatus` enum to the template's
 *  uppercase label set. Anything that isn't a clear pass or fail
 *  (incl. inspections we haven't scored yet) bucket to PENDING. */
function complianceFromInspection(status: string | null): EudrCompliance {
  if (status === 'compliant') return 'COMPLIANT';
  if (status === 'non_compliant') return 'HIGH RISK';
  return 'PENDING ASSESSMENT';
}

/** Map the imported EUDR assessment verdict (gis.eudr_status.status) to
 *  the template's label set. Returns null for unknown/absent so the
 *  caller can fall back to the inspection-derived verdict. */
function complianceFromEudrStatus(status: string | null): EudrCompliance | null {
  if (status === 'compliant') return 'COMPLIANT';
  if (status === 'non_compliant') return 'HIGH RISK';
  if (status === 'needs_review') return 'PENDING ASSESSMENT';
  return null;
}

async function fetchRows(params: EudrReportParams): Promise<EudrRow[]> {
  const { from, to } = seasonToDateRange(params.season);

  const parcelConds = [
    eq(parcels.cooperativeId, params.cooperativeId),
    sql`${parcels.deletedAt} IS NULL`,
  ];
  if (params.societyId) {
    parcelConds.push(eq(farmers.society, params.societyId));
  }

  const baseRows = await db
    .select({
      plotId: parcels.id,
      farmerId: parcels.farmerId,
      areaHa: parcels.calculatedAreaHa,
      firstName: farmers.firstName,
      lastName: farmers.lastName,
      otherNames: farmers.otherNames,
      ghCard: farmers.nationalIdNumber,
      society: farmers.society,
      cooperativeName: cooperatives.name,
      // EUDR assessment (from the imported EUDR CSV → gis.eudr_status).
      eudrStatusVal: eudrStatus.status,
      eudrDeforestationRisk: eudrStatus.deforestationRisk,
      eudrProtectedAreaRisk: eudrStatus.protectedAreaRisk,
      eudrOverlap: eudrStatus.overlap,
      eudrAssessedAt: eudrStatus.assessedAt,
    })
    .from(parcels)
    .leftJoin(farmers, eq(farmers.id, parcels.farmerId))
    .leftJoin(cooperatives, eq(cooperatives.id, parcels.cooperativeId))
    .leftJoin(eudrStatus, eq(eudrStatus.parcelId, parcels.id))
    .where(and(...parcelConds))
    .orderBy(parcels.id);

  if (baseRows.length === 0) return [];

  const plotIds = baseRows.map((r) => r.plotId);

  // Latest inspection per parcel in the season — EUDR verdict +
  // year established + GPS fallback all come from here.
  const insp = await db
    .select({
      parcelId: inspections.parcelId,
      dateInspection: inspections.dateInspection,
      eudrStatus: inspections.eudrStatus,
      eudrAssessedAt: inspections.eudrAssessedAt,
    })
    .from(inspections)
    .where(
      and(
        eq(inspections.cooperativeId, params.cooperativeId),
        gte(inspections.dateInspection, from),
        lte(inspections.dateInspection, to),
        inArray(inspections.parcelId, plotIds),
      ),
    )
    .orderBy(desc(inspections.dateInspection));

  const latestInspectionByParcel = new Map<string, (typeof insp)[number]>();
  for (const i of insp) {
    if (!i.parcelId) continue;
    if (!latestInspectionByParcel.has(i.parcelId)) {
      latestInspectionByParcel.set(i.parcelId, i);
    }
  }

  // Sum of season purchase weight per parcel (kg).
  const purchaseSums = await db
    .select({
      parcelId: cocoaPurchases.parcelId,
      total: sql<string>`COALESCE(SUM(${cocoaPurchases.weightKg}), 0)`,
    })
    .from(cocoaPurchases)
    .where(
      and(
        eq(cocoaPurchases.cooperativeId, params.cooperativeId),
        gte(cocoaPurchases.purchaseDate, from),
        lte(cocoaPurchases.purchaseDate, to),
        inArray(cocoaPurchases.parcelId, plotIds),
      ),
    )
    .groupBy(cocoaPurchases.parcelId);

  const purchaseKgByParcel = new Map<string, number>();
  for (const p of purchaseSums) {
    if (p.parcelId) purchaseKgByParcel.set(p.parcelId, Number(p.total));
  }

  // Secondary-evac waybill + sourcing partner per parcel. Walk the
  // chain: cocoa_purchases → primary_evac_lot_purchases → primary_evac_lots
  // → secondary_evac_lot_primaries → secondary_evac_lots. Pick the
  // most recent secondary waybill per parcel.
  //
  // Both primary + secondary lot tables are named `lots` (in their own
  // schemas), so Drizzle needs explicit aliases on the JOINs to avoid
  // an "Alias already used" error.
  const primaryLots = alias(primaryEvacLots, 'primary_lots');
  const secondaryLots = alias(secondaryEvacLots, 'secondary_lots');
  const chain = await db
    .select({
      parcelId: cocoaPurchases.parcelId,
      secondaryWaybill: secondaryLots.secondaryWaybillNumber,
      sourcingPartner: secondaryLots.sourcingPartner,
      evacuationDate: secondaryLots.evacuationDate,
    })
    .from(cocoaPurchases)
    .innerJoin(primaryEvacLotPurchases, eq(primaryEvacLotPurchases.purchaseId, cocoaPurchases.id))
    .innerJoin(primaryLots, eq(primaryLots.id, primaryEvacLotPurchases.lotId))
    .innerJoin(
      secondaryEvacLotPrimaries,
      eq(secondaryEvacLotPrimaries.primaryLotId, primaryLots.id),
    )
    .innerJoin(secondaryLots, eq(secondaryLots.id, secondaryEvacLotPrimaries.secondaryLotId))
    .where(
      and(
        eq(cocoaPurchases.cooperativeId, params.cooperativeId),
        inArray(cocoaPurchases.parcelId, plotIds),
      ),
    )
    .orderBy(desc(secondaryLots.evacuationDate));

  const chainByParcel = new Map<string, { waybill: string; partner: string }>();
  for (const c of chain) {
    if (!c.parcelId) continue;
    if (!chainByParcel.has(c.parcelId)) {
      chainByParcel.set(c.parcelId, {
        waybill: c.secondaryWaybill,
        partner: c.sourcingPartner,
      });
    }
  }

  return baseRows.map((r) => {
    const i = latestInspectionByParcel.get(r.plotId);
    const raw: Record<string, unknown> = {};
    const gps = parseGps(raw['Member/Gps_location']);
    const farmEstablished =
      typeof raw['Member/FarmEstablised'] === 'string'
        ? (raw['Member/FarmEstablised'] as string)
        : null;
    const yearEstablished = farmEstablished
      ? Number.parseInt(farmEstablished.slice(0, 4), 10)
      : null;
    const fullName = [r.firstName, r.otherNames, r.lastName].filter(Boolean).join(' ').trim();
    const link = chainByParcel.get(r.plotId);

    // Column M — pack the imported EUDR risk assessment into the
    // reserved "Deforestation Status" cell.
    const deforestationStatus =
      [
        r.eudrDeforestationRisk ? `Deforestation: ${r.eudrDeforestationRisk}` : null,
        r.eudrProtectedAreaRisk ? `Protected area: ${r.eudrProtectedAreaRisk}` : null,
        r.eudrOverlap ? `Overlap: ${r.eudrOverlap}` : null,
      ]
        .filter(Boolean)
        .join('; ') || null;
    const analysisDate = r.eudrAssessedAt ? r.eudrAssessedAt.toISOString().slice(0, 10) : null;

    // Prefer the imported EUDR verdict/date; fall back to the
    // inspection-derived one when no EUDR row exists for the parcel.
    const importedCompliance = complianceFromEudrStatus(r.eudrStatusVal ?? null);
    const inspectionDate = i?.eudrAssessedAt ? i.eudrAssessedAt.toISOString().slice(0, 10) : null;

    return {
      plotId: r.plotId,
      farmerCode: r.farmerId ?? '',
      // No district column on farmer master — coop name is the
      // closest proxy until that field is sourced.
      district: r.cooperativeName,
      cooperativeName: r.cooperativeName,
      farmerName: fullName || null,
      ghanaCard: r.ghCard,
      society: r.society,
      areaHa: r.areaHa == null ? null : Number(r.areaHa),
      latitude: gps?.lat ?? null,
      longitude: gps?.lon ?? null,
      yearEstablished: yearEstablished && Number.isFinite(yearEstablished) ? yearEstablished : null,
      deforestationStatus,
      analysisDate,
      complianceStatus: importedCompliance ?? complianceFromInspection(i?.eudrStatus ?? null),
      complianceDate: analysisDate ?? inspectionDate,
      lastSeasonPurchaseKg: purchaseKgByParcel.get(r.plotId) ?? null,
      linkedWaybill: link?.waybill ?? null,
      sourcingPartner: link?.partner ?? null,
    };
  });
}

function postCutoffFlag(row: EudrRow): string | null {
  if (row.yearEstablished == null) return null;
  return row.yearEstablished > EUDR_CUTOFF_YEAR ? 'POST CUTOFF' : 'PRE CUTOFF';
}

/** Cell-letter map for the template's data area (columns A-S). Order
 *  matches row 4 of the template. */
const CELL_MAP: ReadonlyArray<{ col: string; value: (row: EudrRow) => unknown }> = [
  { col: 'A', value: (r) => r.plotId },
  { col: 'B', value: (r) => r.farmerCode },
  { col: 'C', value: (r) => r.district },
  { col: 'D', value: (r) => r.cooperativeName },
  { col: 'E', value: (r) => r.farmerName },
  { col: 'F', value: (r) => r.ghanaCard },
  { col: 'G', value: (r) => r.society },
  { col: 'H', value: (r) => r.areaHa },
  { col: 'I', value: (r) => r.latitude },
  { col: 'J', value: (r) => r.longitude },
  { col: 'K', value: (r) => r.yearEstablished },
  { col: 'L', value: (r) => postCutoffFlag(r) },
  // M (Deforestation Status) + N (Analysis Date) — now sourced from the
  // imported EUDR assessment (gis.eudr_status). Blank when a parcel has
  // no EUDR row yet.
  { col: 'M', value: (r) => r.deforestationStatus },
  { col: 'N', value: (r) => r.analysisDate },
  { col: 'O', value: (r) => r.complianceStatus },
  { col: 'P', value: (r) => r.complianceDate },
  { col: 'Q', value: (r) => r.lastSeasonPurchaseKg },
  { col: 'R', value: (r) => r.linkedWaybill },
  { col: 'S', value: (r) => r.sourcingPartner },
];

async function buildXlsx(rows: EudrRow[]): Promise<Buffer> {
  const tplBuf = await readReportTemplate('ThinkCocoa_EUDR_Compliance_Report.xlsx');
  const wb = new ExcelJS.Workbook();
  // biome-ignore lint/suspicious/noExplicitAny: typedef bridge — see farmer-coaching-v3.ts
  await wb.xlsx.load(tplBuf as any);

  const sheet = wb.getWorksheet(TEMPLATE_SHEET_NAME);
  if (!sheet) throw new Error(`Template missing sheet "${TEMPLATE_SHEET_NAME}"`);

  // Strip dev-spec sheets so the shipped file only carries data.
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

const CSV_COLUMNS: ReadonlyArray<{ header: string; pick: (r: EudrRow) => string | number | null }> =
  [
    { header: 'Plot ID', pick: (r) => r.plotId },
    { header: 'Farmer Code', pick: (r) => r.farmerCode },
    { header: 'District', pick: (r) => r.district },
    { header: 'Cooperative', pick: (r) => r.cooperativeName },
    { header: 'Farmer Name', pick: (r) => r.farmerName },
    { header: 'Ghana Card No.', pick: (r) => r.ghanaCard },
    { header: 'Society', pick: (r) => r.society },
    { header: 'Plot Area (ha)', pick: (r) => r.areaHa },
    { header: 'Latitude (WGS84 DD)', pick: (r) => r.latitude },
    { header: 'Longitude (WGS84 DD)', pick: (r) => r.longitude },
    { header: 'Year Farm Established', pick: (r) => r.yearEstablished },
    { header: 'Post-Cutoff Flag', pick: (r) => postCutoffFlag(r) },
    { header: 'Deforestation Status', pick: (r) => r.deforestationStatus },
    { header: 'Analysis Date', pick: (r) => r.analysisDate },
    { header: 'Overall Compliance Status', pick: (r) => r.complianceStatus },
    { header: 'Compliance Date', pick: (r) => r.complianceDate },
    { header: 'Last Season Purchase (kg)', pick: (r) => r.lastSeasonPurchaseKg },
    { header: 'Linked Export Waybill', pick: (r) => r.linkedWaybill },
    { header: 'Sourcing Partner', pick: (r) => r.sourcingPartner },
  ];

function buildCsv(rows: EudrRow[]): Buffer {
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

export async function generateEudrReport(params: EudrReportParams): Promise<GeneratedReport> {
  seasonToDateRange(params.season);

  const rows = await fetchRows(params);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const slug = seasonToSlug(params.season);

  if (params.outputFormat === 'csv') {
    return {
      buffer: buildCsv(rows),
      fileName: `ThinkCocoa_EUDR_Compliance_${slug}_${stamp}.csv`,
      mimeType: CSV_MIME,
    };
  }
  return {
    buffer: await buildXlsx(rows),
    fileName: `ThinkCocoa_EUDR_Compliance_${slug}_${stamp}.xlsx`,
    mimeType: XLSX_MIME,
  };
}
