/**
 * One-shot helper: populate `inspection.corrective_actions` from the
 * follow-ups already stored in `inspection.inspections.raw_data` —
 * WITHOUT hitting live Kobo.
 *
 * Reason: corrective-action follow-ups used to be derived from raw_data
 * at read time. They now live in a dedicated table so field staff can
 * toggle a mutable `status` (open → processing → done, plus reopen) that
 * must survive Kobo re-syncs. This backfills the table from existing
 * submissions; new rows default to `status = 'open'`.
 *
 * `syncCorrectiveActions` is idempotent (upsert by (inspection_id, topic),
 * ON CONFLICT never touches `status`, missing topics deleted) so this is
 * safe to run repeatedly — re-running preserves any status already set.
 *
 *   bun run scripts/backfill-corrective-actions.ts
 */

import { db } from '../src/db/client';
import { inspections } from '../src/db/schema/inspection';
import { syncCorrectiveActions } from '../src/features/inspections/parser';

const rows = await db
  .select({
    id: inspections.id,
    farmerId: inspections.farmerId,
    parcelId: inspections.parcelId,
    cooperativeId: inspections.cooperativeId,
    dateInspection: inspections.dateInspection,
    raw: inspections.rawData,
  })
  .from(inspections);

let inspectionsWithActions = 0;
let upserted = 0;
for (const row of rows) {
  const n = await syncCorrectiveActions(db, {
    inspectionId: row.id,
    farmerId: row.farmerId,
    parcelId: row.parcelId,
    cooperativeId: row.cooperativeId,
    dateInspection: row.dateInspection,
    raw: row.raw as Record<string, unknown>,
  });
  if (n > 0) inspectionsWithActions += 1;
  upserted += n;
}

console.log(
  JSON.stringify(
    { inspections: rows.length, inspectionsWithActions, correctiveActions: upserted },
    null,
    2,
  ),
);
process.exit(0);
