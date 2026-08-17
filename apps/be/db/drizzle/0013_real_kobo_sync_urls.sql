-- Point five sync jobs at their real KoboToolbox assets (the 0000 seed used
-- placeholder asset ids). Keyed by job_key + idempotent, so it re-applies
-- cleanly and updates existing databases the 0000 INSERT can no longer touch.
UPDATE "integration"."sync_settings" SET "source_url" = 'https://kf.kobotoolbox.org/api/v2/assets/aFNuLEWDog67QKkXBZJSsc/data/?format=json' WHERE "job_key" = 'shade_trees';
UPDATE "integration"."sync_settings" SET "source_url" = 'https://kf.kobotoolbox.org/api/v2/assets/aTfZnRmHMqrd272DFyVLge/data/?format=json' WHERE "job_key" = 'vsla_form';
UPDATE "integration"."sync_settings" SET "source_url" = 'https://kf.kobotoolbox.org/api/v2/assets/aYbYc6H74gjGvKpPQheYvM/data/?format=json' WHERE "job_key" = 'yield_estimation';
UPDATE "integration"."sync_settings" SET "source_url" = 'https://kf.kobotoolbox.org/api/v2/assets/ak8wxUwkJFGJpfxTm6CPmR/data/?format=json' WHERE "job_key" = 'internal_inspection';
UPDATE "integration"."sync_settings" SET "source_url" = 'https://kf.kobotoolbox.org/api/v2/assets/an7F4ebpXG4ngobQu7FEWi/data/?format=json' WHERE "job_key" = 'farmer_registration';
