/**
 * Generator for `training_attendance` — the Training Attendance Register
 * (FR-TRAIN-01). One row per participant per session, mirroring the
 * Demo Cocoa Ghana template `apps/be/reports/ThinkCocoa_Training_Attendance_Report.xlsx`:
 *   • Row 1: title
 *   • Row 2: summary — Total records / Unique sessions / Total male /
 *     Total female / Farmers attending / Consent captured
 *   • Row 3: section group headers
 *   • Row 4: column headers (A-V)
 *   • Row 5: field-mapping spec (developer doc) — spliced out at build
 *   • Row 6+: data
 *
 * Source: `training.training_attendance` (one row per farmer sign-in)
 * joined to its parent `training.training_sessions`. Session-level
 * fields (program, trainer, totals, evaluation) repeat on every
 * participant row; participant fields are unique per row.
 */

import { stringify as stringifyCsv } from 'csv-stringify/sync';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { db } from '../../../db/client';
import { farmers } from '../../../db/schema/farmer';
import { trainingAttendance, trainingSessions } from '../../../db/schema/training';
import { seasonToDateRange, seasonToSlug } from '../lib/season';
import { setFormula } from '../lib/summary-cells';
import { readReportTemplate } from '../lib/templates';

export type TrainingAttendanceFormat = 'excel' | 'csv';

export interface TrainingAttendanceParams {
  cooperativeId: string;
  season: string;
  societyId: string | null;
  outputFormat: TrainingAttendanceFormat;
}

export interface GeneratedReport {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_MIME = 'text/csv; charset=utf-8';

const TEMPLATE_SHEET_NAME = 'Training Attendance';
// Row 5 (the field-mapping spec) is spliced out at build time, so the
// styled data region starts at row 5 immediately below the headers.
const DATA_START_ROW = 5;
const DATA_END_ROW = 5004;

interface AttendeeRow {
  sessionUuid: string;
  trainingDate: string;
  program: string | null;
  trainingType: string | null;
  trainingTopics: string | null;
  district: string | null;
  society: string | null;
  venue: string | null;
  trainerName: string | null;
  trainerPhone: string | null;
  numMale: number | null;
  numFemale: number | null;
  totalParticipants: number | null;
  participantCategory: string;
  farmerCode: string | null;
  participantName: string | null;
  gender: string | null;
  consent: boolean;
  signatureCaptured: boolean;
  objectivesMet: boolean | null;
  engagement: string | null;
  trainerRemarks: string | null;
}

const yesNo = (v: boolean | null | undefined): string | null =>
  v == null ? null : v ? 'Yes' : 'No';

async function fetchRows(params: TrainingAttendanceParams): Promise<AttendeeRow[]> {
  const { from, to } = seasonToDateRange(params.season);

  const conds = [
    eq(trainingSessions.cooperativeId, params.cooperativeId),
    gte(trainingSessions.trainingDate, from),
    lte(trainingSessions.trainingDate, to),
  ];
  if (params.societyId) conds.push(eq(trainingSessions.society, params.societyId));

  const rows = await db
    .select({
      sessionUuid: trainingSessions.koboUuid,
      trainingDate: trainingSessions.trainingDate,
      program: trainingSessions.program,
      trainingType: trainingSessions.trainingType,
      trainingTopics: trainingSessions.trainingTopics,
      district: trainingSessions.district,
      society: trainingSessions.society,
      venue: trainingSessions.venue,
      trainerName: trainingSessions.trainerName,
      trainerPhone: trainingSessions.trainerPhone,
      numMale: trainingSessions.numMale,
      numFemale: trainingSessions.numFemale,
      totalParticipants: trainingSessions.totalParticipants,
      participantCategory: trainingSessions.participantCategory,
      objectivesMet: trainingSessions.sessionObjectivesMet,
      engagement: trainingSessions.participantEngagement,
      trainerRemarks: trainingSessions.trainerRemarks,
      farmerCode: trainingAttendance.farmerCode,
      participantName: trainingAttendance.farmerName,
      gender: trainingAttendance.gender,
      consent: trainingAttendance.consent,
      signatureUrl: trainingAttendance.signatureUrl,
      // Farmer master fallback — attendance rows for farmers store only
      // the code; name + sex are resolved from the master (per spec).
      farmerFirstName: farmers.firstName,
      farmerOtherNames: farmers.otherNames,
      farmerLastName: farmers.lastName,
      farmerSex: farmers.sex,
    })
    .from(trainingAttendance)
    .innerJoin(trainingSessions, eq(trainingSessions.id, trainingAttendance.sessionId))
    .leftJoin(farmers, eq(farmers.id, trainingAttendance.farmerCode))
    .where(and(...conds))
    .orderBy(
      desc(trainingSessions.trainingDate),
      asc(trainingSessions.koboUuid),
      asc(trainingAttendance.farmerName),
    );

  return rows.map((r) => ({
    sessionUuid: r.sessionUuid,
    trainingDate: r.trainingDate,
    program: r.program,
    trainingType: r.trainingType,
    trainingTopics: (r.trainingTopics ?? []).join(', ') || null,
    district: r.district,
    society: r.society,
    venue: r.venue,
    trainerName: r.trainerName,
    trainerPhone: r.trainerPhone,
    numMale: r.numMale,
    numFemale: r.numFemale,
    totalParticipants: r.totalParticipants,
    // Attendance rows are farmer sign-ins; fall back to the session's
    // participant category when set.
    participantCategory: r.participantCategory ?? 'Farmers',
    farmerCode: r.farmerCode,
    participantName:
      r.participantName ??
      ([r.farmerFirstName, r.farmerOtherNames, r.farmerLastName].filter(Boolean).join(' ').trim() ||
        null),
    gender: r.gender ?? r.farmerSex ?? null,
    consent: r.consent,
    signatureCaptured: !!r.signatureUrl,
    objectivesMet: r.objectivesMet,
    engagement: r.engagement,
    trainerRemarks: r.trainerRemarks,
  }));
}

interface Totals {
  records: number;
  sessions: number;
  male: number;
  female: number;
  farmers: number;
  consent: number;
}

function computeTotals(rows: AttendeeRow[]): Totals {
  const sessions = new Set<string>();
  let male = 0;
  let female = 0;
  let farmers = 0;
  let consent = 0;
  for (const r of rows) {
    sessions.add(r.sessionUuid);
    const g = (r.gender ?? '').trim().toLowerCase();
    if (g.startsWith('m')) male += 1;
    else if (g.startsWith('f')) female += 1;
    if (r.farmerCode) farmers += 1;
    if (r.consent) consent += 1;
  }
  return { records: rows.length, sessions: sessions.size, male, female, farmers, consent };
}

/** Cell-letter map for the template's data area (columns A-V), matching
 *  row 4 headers. */
const CELL_MAP: ReadonlyArray<{ col: string; value: (r: AttendeeRow) => unknown }> = [
  { col: 'A', value: (r) => r.sessionUuid },
  { col: 'B', value: (r) => r.trainingDate },
  { col: 'C', value: (r) => r.program },
  { col: 'D', value: (r) => r.trainingType },
  { col: 'E', value: (r) => r.trainingTopics },
  { col: 'F', value: (r) => r.district },
  { col: 'G', value: (r) => r.society },
  { col: 'H', value: (r) => r.venue },
  { col: 'I', value: (r) => r.trainerName },
  { col: 'J', value: (r) => r.trainerPhone },
  { col: 'K', value: (r) => r.numMale },
  { col: 'L', value: (r) => r.numFemale },
  { col: 'M', value: (r) => r.totalParticipants },
  { col: 'N', value: (r) => r.participantCategory },
  { col: 'O', value: (r) => r.farmerCode },
  { col: 'P', value: (r) => r.participantName },
  { col: 'Q', value: (r) => r.gender },
  { col: 'R', value: (r) => yesNo(r.consent) },
  { col: 'S', value: (r) => yesNo(r.signatureCaptured) },
  { col: 'T', value: (r) => yesNo(r.objectivesMet) },
  { col: 'U', value: (r) => r.engagement },
  { col: 'V', value: (r) => r.trainerRemarks },
];

async function buildXlsx(rows: AttendeeRow[], totals: Totals): Promise<Buffer> {
  const tplBuf = await readReportTemplate('ThinkCocoa_Training_Attendance_Report.xlsx');
  const wb = new ExcelJS.Workbook();
  // biome-ignore lint/suspicious/noExplicitAny: typedef bridge — see farmer-coaching-v3.ts
  await wb.xlsx.load(tplBuf as any);

  const sheet = wb.getWorksheet(TEMPLATE_SHEET_NAME);
  if (!sheet) throw new Error(`Template missing sheet "${TEMPLATE_SHEET_NAME}"`);

  // Drop the Developer Spec (and any other) sheet.
  const toDrop: number[] = [];
  wb.eachSheet((s) => {
    if (s.id !== sheet.id) toDrop.push(s.id);
  });
  for (const id of toDrop) wb.removeWorksheet(id);

  // Remove the field-mapping spec row (row 5) so the styled data region
  // sits directly under the headers.
  sheet.spliceRows(5, 1);

  // Summary cells (row 2). These were plain numbers — correct in every app,
  // but they replaced the template's formulas, so the KPI row stopped being
  // live: widen the data and the totals no longer move. Now both, formula +
  // cached result (see `lib/summary-cells.ts`).
  //
  // The template's own ranges are NOT reusable here. They were authored
  // against a layout where the data started on row 6 and gender sat in P;
  // this sheet drops the spec row (so data starts at DATA_START_ROW) and
  // holds gender in Q, category in N, participant name in P. Reusing them
  // would count "Male" in the NAME column — a plausible zero.
  const span = (col: string) => `${col}${DATA_START_ROW}:${col}${DATA_END_ROW}`;
  setFormula(sheet, 'B2', `COUNTA(${span('A')})`, totals.records);
  setFormula(
    sheet,
    'G2',
    `IFERROR(SUMPRODUCT(1/COUNTIF(${span('A')},${span('A')})*(${span('A')}<>"")),0)`,
    totals.sessions,
  );
  setFormula(sheet, 'L2', `COUNTIF(${span('Q')},"Male")`, totals.male);
  setFormula(sheet, 'P2', `COUNTIF(${span('Q')},"Female")`, totals.female);
  // `farmers` counts rows carrying a farmer code, which is what the label
  // "Farmers attending" means here — not the participant-category text.
  setFormula(sheet, 'T2', `COUNTA(${span('O')})`, totals.farmers);
  setFormula(sheet, 'Y2', `COUNTIF(${span('R')},"Yes")`, totals.consent);

  const wipeEnd = Math.max(DATA_END_ROW, DATA_START_ROW + rows.length);
  for (let r = DATA_START_ROW; r <= wipeEnd; r++) {
    const row = sheet.getRow(r);
    for (const m of CELL_MAP) row.getCell(m.col).value = null;
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

const CSV_COLUMNS: ReadonlyArray<{
  header: string;
  pick: (r: AttendeeRow) => string | number | null;
}> = [
  { header: 'Session ID', pick: (r) => r.sessionUuid },
  { header: 'Training Date', pick: (r) => r.trainingDate },
  { header: 'Program', pick: (r) => r.program },
  { header: 'Training Type', pick: (r) => r.trainingType },
  { header: 'Training Topics', pick: (r) => r.trainingTopics },
  { header: 'District', pick: (r) => r.district },
  { header: 'Society / Location', pick: (r) => r.society },
  { header: 'Venue', pick: (r) => r.venue },
  { header: 'Trainer Name(s)', pick: (r) => r.trainerName },
  { header: 'Trainer Phone', pick: (r) => r.trainerPhone },
  { header: 'Total Male', pick: (r) => r.numMale },
  { header: 'Total Female', pick: (r) => r.numFemale },
  { header: 'Total Participants', pick: (r) => r.totalParticipants },
  { header: 'Participant Category', pick: (r) => r.participantCategory },
  { header: 'Farmer Code', pick: (r) => r.farmerCode },
  { header: 'Participant Full Name', pick: (r) => r.participantName },
  { header: 'Gender', pick: (r) => r.gender },
  { header: 'Consent Given?', pick: (r) => yesNo(r.consent) },
  { header: 'Signature Captured?', pick: (r) => yesNo(r.signatureCaptured) },
  { header: 'Objectives Met?', pick: (r) => yesNo(r.objectivesMet) },
  { header: 'Participant Engagement', pick: (r) => r.engagement },
  { header: 'Trainer Remarks', pick: (r) => r.trainerRemarks },
];

function buildCsv(rows: AttendeeRow[]): Buffer {
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

export async function generateTrainingAttendanceReport(
  params: TrainingAttendanceParams,
): Promise<GeneratedReport> {
  seasonToDateRange(params.season);

  const rows = await fetchRows(params);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const slug = seasonToSlug(params.season);

  if (params.outputFormat === 'csv') {
    return {
      buffer: buildCsv(rows),
      fileName: `ThinkCocoa_Training_Attendance_${slug}_${stamp}.csv`,
      mimeType: CSV_MIME,
    };
  }
  return {
    buffer: await buildXlsx(rows, computeTotals(rows)),
    fileName: `ThinkCocoa_Training_Attendance_${slug}_${stamp}.xlsx`,
    mimeType: XLSX_MIME,
  };
}
