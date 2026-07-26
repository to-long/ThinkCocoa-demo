-- Coaching visit form payload (synthetic Kobo-shaped JSON) used to render
-- the rich Section A–H detail page. Dropped in the Kobo decouple; re-added
-- as a demo-only jsonb blob (NOT a real Kobo submission) so the coaching
-- detail's farm profile, activity log, compliance flags and CLMRS panel
-- have data to show. Nullable — visits without it render the structured
-- columns only.
ALTER TABLE "coaching"."coaching_visits" ADD COLUMN IF NOT EXISTS "raw_data" jsonb;
