-- CLMRS follow-up reminder plumbing on clmrs.cases:
--   created_by       — user id of whoever opened the case, so the daily
--                      reminder scan can email the follow-up notice to its
--                      creator (created_by_name was denormalized display text
--                      only). Nullable for rows opened before this column.
--   reminder_sent_at — set once the T-5 reminder email has gone out so the
--                      scan never double-sends; reset to NULL when
--                      follow_up_date changes to re-arm the reminder.
-- Both additive + IF NOT EXISTS so the migration is idempotent.
ALTER TABLE "clmrs"."cases" ADD COLUMN IF NOT EXISTS "created_by" uuid;
ALTER TABLE "clmrs"."cases" ADD COLUMN IF NOT EXISTS "reminder_sent_at" timestamp with time zone;
