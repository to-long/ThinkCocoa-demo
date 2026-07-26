-- EUDR risk zones — shared red overlays for the parcel map (deforestation
-- patches + protected-area boundaries). One row per distinct zone; the
-- Farm detail map pulls the zones near a parcel by spatial proximity, so a
-- zone is stored once and shared instead of duplicated per parcel.
CREATE TABLE IF NOT EXISTS "gis"."risk_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"risk_type" text NOT NULL,
	"severity" text NOT NULL,
	"name" text,
	"source_parcel_id" text,
	"geom" public.geometry(MultiPolygon, 4326),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_zones_code_unique" UNIQUE("code"),
	CONSTRAINT "risk_zones_risk_type_check" CHECK ("risk_type" IN ('deforestation','protected_area')),
	CONSTRAINT "risk_zones_severity_check" CHECK ("severity" IN ('medium','high'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_zones_geom_gix" ON "gis"."risk_zones" USING GIST ("geom");
