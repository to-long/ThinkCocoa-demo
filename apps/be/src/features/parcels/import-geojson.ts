import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { parcelGeometries } from '../../db/schema/index';

export interface GeoJsonImportResult {
  summary: {
    totalFeatures: number;
    upserted: number;
    skipped: Array<{ parcelId?: string; reason: string }>;
  };
}

export async function processGeoJsonImport(
  db: Db,
  geoJsonText: string,
  mapping: { parcelId: string; capturedAt: string },
): Promise<GeoJsonImportResult> {
  const summary: GeoJsonImportResult['summary'] = {
    totalFeatures: 0,
    upserted: 0,
    skipped: [],
  };

  // biome-ignore lint/suspicious/noExplicitAny: parsing dynamic JSON
  let data: any;
  try {
    data = JSON.parse(geoJsonText);
  } catch {
    throw new Error('Invalid JSON format');
  }

  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new Error('Expected a GeoJSON FeatureCollection');
  }

  summary.totalFeatures = data.features.length;

  // biome-ignore lint/suspicious/noExplicitAny: parsing dynamic JSON
  const validFeatures: { feature: any; parcelId: string }[] = [];
  const parcelIdsToLookUp = new Set<string>();

  // 1. Initial parsing and validation
  for (const feature of data.features) {
    if (!feature.properties) {
      summary.skipped.push({ reason: 'No properties object in feature' });
      continue;
    }
    const parcelId = feature.properties[mapping.parcelId]?.toString();
    if (!parcelId) {
      summary.skipped.push({ reason: `Missing mapped parcel ID property (${mapping.parcelId})` });
      continue;
    }
    parcelIdsToLookUp.add(parcelId);
    validFeatures.push({ feature, parcelId });
  }

  if (validFeatures.length === 0) {
    return { summary };
  }

  // 2. Fetch existing parcels in batches to avoid Postgres IN clause limits (~32k/65k)
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

  // 3. Process the geometries in batches
  const UPSERT_BATCH_SIZE = 200;
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle schema
  let currentBatch: any[] = [];

  const flushBatch = async () => {
    if (currentBatch.length === 0) return;
    try {
      await db
        .insert(parcelGeometries)
        .values(currentBatch)
        .onConflictDoUpdate({
          target: parcelGeometries.parcelId,
          set: {
            sourceFormat: sql`EXCLUDED.source_format`,
            capturedAt: sql`EXCLUDED.captured_at`,
            geom: sql`EXCLUDED.geom`,
          },
        });
      summary.upserted += currentBatch.length;
    } catch (err) {
      for (const item of currentBatch) {
        summary.skipped.push({
          parcelId: item.parcelId,
          reason:
            err instanceof Error ? err.message : 'Database error during batch geometry upsert',
        });
      }
    }
    currentBatch = [];
  };

  for (const { feature, parcelId } of validFeatures) {
    if (!existingParcelIds.has(parcelId)) {
      summary.skipped.push({ parcelId, reason: 'Parcel ID not found in database' });
      continue;
    }

    let capturedAtDate: Date | null = null;
    if (mapping.capturedAt && feature.properties[mapping.capturedAt]) {
      const parsed = new Date(feature.properties[mapping.capturedAt]);
      if (!Number.isNaN(parsed.getTime())) {
        capturedAtDate = parsed;
      }
    }

    const geomSql = sql`ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(feature.geometry)}), 4326))::geometry(MultiPolygon, 4326)`;

    currentBatch.push({
      parcelId,
      sourceFormat: 'geojson',
      capturedAt: capturedAtDate,
      // biome-ignore lint/suspicious/noExplicitAny: Drizzle schema expects specific geometry type
      geom: geomSql as any,
    });

    if (currentBatch.length >= UPSERT_BATCH_SIZE) {
      await flushBatch();
    }
  }

  await flushBatch();

  return { summary };
}
