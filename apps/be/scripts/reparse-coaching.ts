/**
 * One-shot helper: re-parse every stored coaching submission through
 * the current parser — WITHOUT hitting live Kobo.
 *
 * Reason: the parser now populates the Section P non-compliance columns
 * (`non_compliance`, `non_compliance_type`, `non_compliance_desc`).
 * Re-running it over the raw payload already stored in
 * `coaching.coaching_visits.raw_data` back-fills those columns on rows
 * ingested before this change. `parseAndUpsertCoachingVisit` is
 * idempotent (keyed on kobo_uuid) so this is safe to run repeatedly.
 *
 *   bun run scripts/reparse-coaching.ts
 */

import { db } from '../src/db/client';
import { coachingVisits } from '../src/db/schema/coaching';
import { type KoboPayload, parseAndUpsertCoachingVisit } from '../src/features/coaching/parser';

const rows = await db
  .select({ uuid: coachingVisits.koboUuid, raw: coachingVisits.rawData })
  .from(coachingVisits);

let ok = 0;
let skipped = 0;
for (const row of rows) {
  const res = await parseAndUpsertCoachingVisit(db, row.raw as KoboPayload);
  if (!res) {
    skipped += 1;
    continue;
  }
  ok += 1;
}

console.log(JSON.stringify({ visits: rows.length, reparsed: ok, skipped }, null, 2));
process.exit(0);
