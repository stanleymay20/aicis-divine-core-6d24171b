-- AICIS evidence-preserving export schema v2
--
-- v1 normalized missing values into numbers/timestamps in several paths. v2 is
-- intentionally nullable and carries score/provenance semantics. Existing
-- profiles are migrated explicitly while retaining their prior schema version.

ALTER TABLE public.export_profiles
  ADD COLUMN IF NOT EXISTS previous_schema_version text,
  ADD COLUMN IF NOT EXISTS schema_migrated_at timestamptz,
  ALTER COLUMN schema_version SET DEFAULT 'v2';

ALTER TABLE public.export_profile_presets
  ADD COLUMN IF NOT EXISTS previous_schema_version text,
  ADD COLUMN IF NOT EXISTS schema_migrated_at timestamptz,
  ALTER COLUMN schema_version SET DEFAULT 'v2';

UPDATE public.export_profiles
SET
  previous_schema_version = COALESCE(previous_schema_version, schema_version),
  schema_version = 'v2',
  schema_migrated_at = COALESCE(schema_migrated_at, now())
WHERE schema_version IS DISTINCT FROM 'v2';

UPDATE public.export_profile_presets
SET
  previous_schema_version = COALESCE(previous_schema_version, schema_version),
  schema_version = 'v2',
  schema_migrated_at = COALESCE(schema_migrated_at, now())
WHERE schema_version IS DISTINCT FROM 'v2';

COMMENT ON COLUMN public.export_profiles.schema_version IS
  'Effective export contract. v2 preserves unknown/withheld evidence as NULL and emits explicit score/provenance semantics.';
COMMENT ON COLUMN public.export_profiles.previous_schema_version IS
  'Audit-preserved schema version held by the profile before the evidence-preserving v2 migration.';
COMMENT ON COLUMN public.export_profile_presets.schema_version IS
  'Effective preset export contract. New/legacy presets use evidence-preserving v2.';