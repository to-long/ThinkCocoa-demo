/**
 * One-shot helper: re-parse every stored training submission through
 * the current parser — WITHOUT hitting live Kobo.
 *
 * Reason: the parser now handles the single-instance flattened
 * `participants_farmers/<field>` shape Kobo emits when a repeat group
 * has exactly one entry (previously those sessions parsed to 0 roster
 * rows). Re-running the parser over the raw payload already stored in
 * `training.training_sessions.raw_data` back-fills the missing roster
 * rows. `parseAndUpsertTrainingSession` is idempotent (keyed on
 * kobo_uuid, DELETE+INSERT roster) so this is safe to run repeatedly.
 *
 *   bun run scripts/reparse-training.ts
 */

import { db } from '../src/db/client';
import { trainingSessions } from '../src/db/schema/training';
import { type KoboPayload, parseAndUpsertTrainingSession } from '../src/features/training/parser';

const rows = await db
  .select({ uuid: trainingSessions.koboUuid, raw: trainingSessions.rawData })
  .from(trainingSessions);

let ok = 0;
let roster = 0;
let skipped = 0;
for (const row of rows) {
  const res = await parseAndUpsertTrainingSession(db, row.raw as KoboPayload);
  if (!res) {
    skipped += 1;
    continue;
  }
  ok += 1;
  roster += res.attendanceCount;
}

console.log(
  JSON.stringify({ sessions: rows.length, reparsed: ok, skipped, rosterRows: roster }, null, 2),
);
process.exit(0);
