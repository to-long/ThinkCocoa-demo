-- Globalize domain naming: currency-neutral + country-neutral columns.
-- Ghana Cedi (GHS) / COCOBOD / Ghana-Card names are renamed to generic
-- equivalents so the product reads as an international cocoa platform.
-- Every rename is guarded with an existence check so the migration
-- re-applies cleanly (idempotent).

-- purchase.cocoa_purchases: drop the GHS currency suffix
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'purchase' AND table_name = 'cocoa_purchases'
      AND column_name = 'amount_received_ghs') THEN
    ALTER TABLE "purchase"."cocoa_purchases" RENAME COLUMN "amount_received_ghs" TO "amount_received";
  END IF;
END $$;

-- purchase.cocoa_purchases: COCOBOD card -> purchasing-clerk card
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'purchase' AND table_name = 'cocoa_purchases'
      AND column_name = 'cocobod_card_number') THEN
    ALTER TABLE "purchase"."cocoa_purchases" RENAME COLUMN "cocobod_card_number" TO "purchasing_clerk_card_number";
  END IF;
END $$;

-- inspection.inspections: Ghana Card -> national-ID card
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'inspection' AND table_name = 'inspections'
      AND column_name = 'ghana_card') THEN
    ALTER TABLE "inspection"."inspections" RENAME COLUMN "ghana_card" TO "national_id_card";
  END IF;
END $$;

-- inspection.inspections: COCOBOD card -> purchasing-clerk card
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'inspection' AND table_name = 'inspections'
      AND column_name = 'cocobod_card') THEN
    ALTER TABLE "inspection"."inspections" RENAME COLUMN "cocobod_card" TO "purchasing_clerk_card";
  END IF;
END $$;

-- farmer.farmers: the national-ID type value tracks the "National ID" label
UPDATE "farmer"."farmers" SET "national_id_type" = 'national_id' WHERE "national_id_type" = 'ghana_card';

-- integration.sync_settings: scrub GHS / COCOBOD naming out of the seeded
-- field-mapping metadata (visible in the admin Sync dialog). Text-rewrite
-- the jsonb so the internal field names match the renamed columns.
UPDATE "integration"."sync_settings"
SET "field_mapping" = (
  replace(
  replace(
  replace(
  replace(
  replace(
    "field_mapping"::text,
    '"amountReceivedGhs"', '"amountReceived"'),
    '"cocobodCardNumber"', '"purchasingClerkCardNumber"'),
    'farmer_info/cocobod_card_number', 'farmer_info/purchasing_clerk_card_number'),
    '— GHS', '— USD'),
    'optional COCOBOD external ID', 'optional external ID')
)::jsonb
WHERE "field_mapping"::text LIKE '%amountReceivedGhs%'
   OR "field_mapping"::text LIKE '%cocobodCardNumber%'
   OR "field_mapping"::text LIKE '%cocobod_card_number%'
   OR "field_mapping"::text LIKE '%COCOBOD%';
