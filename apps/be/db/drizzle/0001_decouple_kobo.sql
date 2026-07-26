-- Kobo decoupling: the demo is source-agnostic, so the raw Kobo
-- submission payload (`raw_data`) and the entire Kobo sync/integration
-- schema are dropped. Domain "value" columns (scores, dates, statuses,
-- names, ids) are kept.

ALTER TABLE "coaching"."coaching_visits" DROP COLUMN IF EXISTS "raw_data";--> statement-breakpoint
ALTER TABLE "inspection"."inspections" DROP COLUMN IF EXISTS "raw_data";--> statement-breakpoint
ALTER TABLE "primary_evacuation"."lots" DROP COLUMN IF EXISTS "raw_data";--> statement-breakpoint
ALTER TABLE "purchase"."cocoa_purchases" DROP COLUMN IF EXISTS "raw_data";--> statement-breakpoint
ALTER TABLE "secondary_evacuation"."lots" DROP COLUMN IF EXISTS "raw_data";--> statement-breakpoint
ALTER TABLE "shade"."tree_profiling" DROP COLUMN IF EXISTS "raw_data";--> statement-breakpoint
ALTER TABLE "training"."training_sessions" DROP COLUMN IF EXISTS "raw_data";--> statement-breakpoint
ALTER TABLE "vsla"."monthly_reports" DROP COLUMN IF EXISTS "raw_data";--> statement-breakpoint
-- Drop the Kobo sync-execution tables but KEEP integration.sync_settings
-- (the admin Sync page still reads/saves settings; only the Kobo-calling
-- jobs are gone).
DROP TABLE IF EXISTS "integration"."kobo_submissions_raw" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "integration"."kobo_attachment" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "integration"."attachment_link" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "integration"."kobo_validation_errors" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "integration"."sync_jobs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "integration"."sync_cursors" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "integration"."sync_errors" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "integration"."migration_jobs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "integration"."reconciliation_results" CASCADE;
