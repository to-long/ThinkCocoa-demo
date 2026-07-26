import { sql } from 'drizzle-orm';
import Papa from 'papaparse';
import type { Db } from '../../db/client';
import { eudrStatus } from '../../db/schema/index';
export interface EudrCsvImportResult {
  summary: {
    totalRows: number;
    upserted: number;
    skipped: Array<{ row: number; parcelId?: string; reason: string }>;
  };
}

export async function processEudrCsvImport(
  db: Db,
  csvText: string,
  mapping: Record<string, string>,
): Promise<EudrCsvImportResult> {
  const summary: EudrCsvImportResult['summary'] = {
    totalRows: 0,
    upserted: 0,
    skipped: [],
  };

  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    throw new Error(`CSV parsing failed: ${parsed.errors[0].message}`);
  }

  const rows = parsed.data as Record<string, string>[];
  summary.totalRows = rows.length;

  const validRows: { row: Record<string, string>; rowNum: number; parcelId: string }[] = [];
  const parcelIdsToLookUp = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1; // 1-indexed for user display

    const parcelId = row[mapping.parcelId]?.trim();
    if (!parcelId) {
      summary.skipped.push({
        row: rowNum,
        reason: `Missing mapped parcel ID column (${mapping.parcelId})`,
      });
      continue;
    }

    parcelIdsToLookUp.add(parcelId);
    validRows.push({ row, rowNum, parcelId });
  }

  if (validRows.length === 0) {
    return { summary };
  }

  // 1. Fetch existing parcels in batches to avoid Postgres limits
  const existingParcelIds = new Set<string>();
  const idArray = Array.from(parcelIdsToLookUp);
  const CHUNK_SIZE = 5000;

  for (let i = 0; i < idArray.length; i += CHUNK_SIZE) {
    const chunk = idArray.slice(i, i + CHUNK_SIZE);
    const existing = await db.query.parcels.findMany({
      where: (t, { inArray }) => inArray(t.id, chunk),
      columns: { id: true },
    });
    for (const p of existing) {
      existingParcelIds.add(p.id);
    }
  }

  // 2. Process the EUDR data in batches
  const UPSERT_BATCH_SIZE = 200;
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle schema
  let currentBatch: any[] = [];

  const flushBatch = async () => {
    if (currentBatch.length === 0) return;
    try {
      await db
        .insert(eudrStatus)
        .values(currentBatch)
        .onConflictDoUpdate({
          target: eudrStatus.parcelId,
          set: {
            assessedAt: sql`EXCLUDED.assessed_at`,
            assessedBy: sql`EXCLUDED.assessed_by`,
            notes: sql`EXCLUDED.notes`,
            status: sql`EXCLUDED.status`,
            overlap: sql`EXCLUDED.overlap`,
            onLand: sql`EXCLUDED.on_land`,
            inCountry: sql`EXCLUDED.in_country`,
            deforestationRisk: sql`EXCLUDED.deforestation_risk`,
            protectedAreaRisk: sql`EXCLUDED.protected_area_risk`,
            eudrData: sql`EXCLUDED.eudr_data`,
            eudrExplanation: sql`EXCLUDED.eudr_explanation`,
          },
        });
      summary.upserted += currentBatch.length;
    } catch (err) {
      for (const item of currentBatch) {
        const rowData = validRows.find((v) => v.parcelId === item.parcelId);
        summary.skipped.push({
          row: rowData?.rowNum ?? 0,
          parcelId: item.parcelId,
          reason: err instanceof Error ? err.message : 'Database update failed',
        });
      }
    }
    currentBatch = [];
  };

  for (const { row, rowNum, parcelId } of validRows) {
    if (!existingParcelIds.has(parcelId)) {
      summary.skipped.push({ row: rowNum, parcelId, reason: 'Parcel ID not found in database' });
      continue;
    }

    const item: Partial<typeof eudrStatus.$inferInsert> = { parcelId };

    const normalizeRisk = (val: string | null | undefined) => {
      if (!val) return null;
      const v = val.trim().toLowerCase();
      if (v === 'low') return 'Low';
      if (v === 'medium') return 'Medium';
      if (v === 'high') return 'High';
      return val.trim();
    };

    const defRiskRaw =
      mapping.deforestationRisk && row[mapping.deforestationRisk]
        ? row[mapping.deforestationRisk]
        : null;
    const proRiskRaw =
      mapping.protectedAreaRisk && row[mapping.protectedAreaRisk]
        ? row[mapping.protectedAreaRisk]
        : null;
    const defRisk = normalizeRisk(defRiskRaw);
    const proRisk = normalizeRisk(proRiskRaw);

    const validRisks = ['Low', 'Medium', 'High'];
    if (defRisk && !validRisks.includes(defRisk)) {
      summary.skipped.push({
        row: rowNum,
        parcelId,
        reason: `Invalid deforestation_risk value: ${defRisk}. Must be Low, Medium, or High`,
      });
      continue;
    }
    if (proRisk && !validRisks.includes(proRisk)) {
      summary.skipped.push({
        row: rowNum,
        parcelId,
        reason: `Invalid protected_area_risk value: ${proRisk}. Must be Low, Medium, or High`,
      });
      continue;
    }

    const assessedAtRaw = mapping.assessedAt ? row[mapping.assessedAt] : null;
    const assessedByRaw = mapping.assessedBy ? row[mapping.assessedBy] : null;
    const notesRaw = mapping.notes ? row[mapping.notes] : null;
    const statusRaw = mapping.status ? row[mapping.status] : null;

    if (!assessedAtRaw) {
      summary.skipped.push({
        row: rowNum,
        parcelId,
        reason: 'Missing required field: Date of assessment (assessed_at)',
      });
      continue;
    }
    if (!assessedByRaw) {
      summary.skipped.push({
        row: rowNum,
        parcelId,
        reason: 'Missing required field: Personnel who run assessment (assessed_by)',
      });
      continue;
    }
    if (!notesRaw) {
      summary.skipped.push({
        row: rowNum,
        parcelId,
        reason: 'Missing required field: Notes on farm',
      });
      continue;
    }
    if (!statusRaw) {
      summary.skipped.push({
        row: rowNum,
        parcelId,
        reason: 'Missing required field: EUDR status of farm',
      });
      continue;
    }

    const normalizeStatus = (val: string) => {
      const v = val.trim().toLowerCase();
      if (v === 'compliant') return 'compliant';
      if (v === 'non_compliant' || v === 'non-compliant' || v === 'non compliant')
        return 'non_compliant';
      if (v === 'needs_review' || v === 'needs review') return 'needs_review';
      if (v === 'unknown') return 'unknown';
      return val.trim();
    };

    const statusNorm = normalizeStatus(statusRaw);
    const validStatuses = ['unknown', 'compliant', 'non_compliant', 'needs_review'];
    if (!validStatuses.includes(statusNorm)) {
      summary.skipped.push({
        row: rowNum,
        parcelId,
        reason: `Invalid status value: "${statusRaw}". Must be Compliant, Non-Compliant, Needs Review, or Unknown.`,
      });
      continue;
    }

    const parsedDate = new Date(assessedAtRaw);
    if (Number.isNaN(parsedDate.getTime())) {
      summary.skipped.push({
        row: rowNum,
        parcelId,
        reason: `Invalid date format for Date of assessment: "${assessedAtRaw}"`,
      });
      continue;
    }

    item.assessedAt = parsedDate;
    item.assessedBy = assessedByRaw;
    item.notes = notesRaw;
    item.status = statusNorm;

    // Standardize object keys for batched insert
    item.overlap = mapping.overlap && row[mapping.overlap] ? row[mapping.overlap] : null;
    item.onLand = mapping.onLand && row[mapping.onLand] ? row[mapping.onLand] : null;
    item.inCountry = mapping.inCountry && row[mapping.inCountry] ? row[mapping.inCountry] : null;
    item.deforestationRisk = defRisk;
    item.protectedAreaRisk = proRisk;
    item.eudrData = mapping.eudrData && row[mapping.eudrData] ? row[mapping.eudrData] : null;
    item.eudrExplanation =
      mapping.eudrExplanation && row[mapping.eudrExplanation] ? row[mapping.eudrExplanation] : null;

    currentBatch.push(item);

    if (currentBatch.length >= UPSERT_BATCH_SIZE) {
      await flushBatch();
    }
  }

  await flushBatch();

  return { summary };
}
