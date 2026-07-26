-- VSLA groups gain a society field (filterable, like farmers/purchases).
ALTER TABLE "vsla"."groups" ADD COLUMN IF NOT EXISTS "society" text;
