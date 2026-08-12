-- Per-cooperative farmer-code prefix (`SNK` → `SNK-0001`). Set once at
-- creation, immutable after. Nullable for legacy rows; FE falls back to
-- coopFarmerCodePrefix(code) when absent.
ALTER TABLE "iam"."cooperatives" ADD COLUMN IF NOT EXISTS "farmer_code_prefix" text;

-- Backfill existing coops: known demo codes → their short prefix, otherwise
-- the first three letters of the code. Idempotent (only fills NULLs).
UPDATE "iam"."cooperatives"
SET "farmer_code_prefix" = CASE "code"
  WHEN 'SANKOFA' THEN 'SNK'
  WHEN 'NKABOM'  THEN 'NKB'
  WHEN 'ADWUMA'  THEN 'ADW'
  WHEN 'ABOMA'   THEN 'ABM'
  WHEN 'AYEKOO'  THEN 'AYK'
  WHEN 'NHYIRA'  THEN 'NHY'
  ELSE UPPER(LEFT("code", 3))
END
WHERE "farmer_code_prefix" IS NULL;
