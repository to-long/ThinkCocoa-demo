-- Promote the inspection fields that used to live in raw_data into
-- real, typed columns (source-agnostic — any ingest maps into them).

ALTER TABLE "inspection"."inspections"
  ADD COLUMN IF NOT EXISTS "farmer_dob" text,
  ADD COLUMN IF NOT EXISTS "farmer_gender" text,
  ADD COLUMN IF NOT EXISTS "ghana_card" text,
  ADD COLUMN IF NOT EXISTS "cocobod_card" text,
  ADD COLUMN IF NOT EXISTS "household_size" smallint,
  ADD COLUMN IF NOT EXISTS "children_count" smallint,
  ADD COLUMN IF NOT EXISTS "clmrs_assessed" boolean,
  ADD COLUMN IF NOT EXISTS "field_size_ha" numeric(10, 4),
  ADD COLUMN IF NOT EXISTS "year_established" smallint,
  ADD COLUMN IF NOT EXISTS "farm_mapped" boolean,
  ADD COLUMN IF NOT EXISTS "gps_location" text,
  ADD COLUMN IF NOT EXISTS "permanent_staff" smallint,
  ADD COLUMN IF NOT EXISTS "temporary_staff" smallint,
  ADD COLUMN IF NOT EXISTS "total_harvest_kg" numeric(12, 2),
  ADD COLUMN IF NOT EXISTS "total_sold_kg" numeric(12, 2),
  ADD COLUMN IF NOT EXISTS "next_season_estimate_kg" numeric(12, 2),
  ADD COLUMN IF NOT EXISTS "another_lbc" boolean,
  ADD COLUMN IF NOT EXISTS "another_lbc_reason" text,
  ADD COLUMN IF NOT EXISTS "training_topics" text,
  ADD COLUMN IF NOT EXISTS "ra_child_labour" text,
  ADD COLUMN IF NOT EXISTS "ra_forced_labour" text,
  ADD COLUMN IF NOT EXISTS "ra_discrimination" text,
  ADD COLUMN IF NOT EXISTS "ra_abuse" text;
