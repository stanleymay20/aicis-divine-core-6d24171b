-- AICIS Normalized Ingestion Truth Floor v1
--
-- Canonical normalized data must distinguish:
--   * source-provided facts from ingestion receipt metadata;
--   * measured/declared numeric quality from unknown quality;
--   * source event/observation time from system retrieval time;
--   * entity-link evidence from mere link existence.
--
-- Existing values are preserved. Legacy numeric values are marked semantically
-- unverified rather than retroactively interpreted as measured truth.

-- ---------------------------------------------------------------------------
-- Normalized metrics
-- ---------------------------------------------------------------------------
ALTER TABLE public.normalized_metrics
  ALTER COLUMN confidence DROP DEFAULT,
  ALTER COLUMN provenance_observed_at DROP DEFAULT,
  ALTER COLUMN freshness_score DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS freshness_semantics text,
  ADD COLUMN IF NOT EXISTS provenance_observed_at_semantics text,
  ADD COLUMN IF NOT EXISTS retrieved_at timestamptz NOT NULL DEFAULT now();

UPDATE public.normalized_metrics
SET confidence_semantics = 'legacy_numeric_semantics_unverified'
WHERE confidence IS NOT NULL AND confidence_semantics IS NULL;

UPDATE public.normalized_metrics
SET freshness_semantics = 'legacy_numeric_semantics_unverified'
WHERE freshness_score IS NOT NULL AND freshness_semantics IS NULL;

UPDATE public.normalized_metrics
SET provenance_observed_at_semantics = 'legacy_time_semantics_unverified'
WHERE provenance_observed_at IS NOT NULL
  AND provenance_observed_at_semantics IS NULL;

ALTER TABLE public.normalized_metrics
  ADD CONSTRAINT normalized_metrics_confidence_unit_v1
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)) NOT VALID,
  ADD CONSTRAINT normalized_metrics_freshness_unit_v1
    CHECK (freshness_score IS NULL OR (freshness_score >= 0 AND freshness_score <= 1)) NOT VALID;

-- ---------------------------------------------------------------------------
-- Normalized events
-- ---------------------------------------------------------------------------
ALTER TABLE public.normalized_events
  ALTER COLUMN confidence DROP DEFAULT,
  ALTER COLUMN freshness_score DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS freshness_semantics text,
  ADD COLUMN IF NOT EXISTS started_at_semantics text,
  ADD COLUMN IF NOT EXISTS retrieved_at timestamptz NOT NULL DEFAULT now();

UPDATE public.normalized_events
SET confidence_semantics = 'legacy_numeric_semantics_unverified'
WHERE confidence IS NOT NULL AND confidence_semantics IS NULL;

UPDATE public.normalized_events
SET freshness_semantics = 'legacy_numeric_semantics_unverified'
WHERE freshness_score IS NOT NULL AND freshness_semantics IS NULL;

UPDATE public.normalized_events
SET started_at_semantics = 'legacy_time_semantics_unverified'
WHERE started_at IS NOT NULL AND started_at_semantics IS NULL;

ALTER TABLE public.normalized_events
  ADD CONSTRAINT normalized_events_confidence_unit_v1
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)) NOT VALID,
  ADD CONSTRAINT normalized_events_freshness_unit_v1
    CHECK (freshness_score IS NULL OR (freshness_score >= 0 AND freshness_score <= 1)) NOT VALID;

-- ---------------------------------------------------------------------------
-- Entity links: an existing link does not imply confidence=1.
-- ---------------------------------------------------------------------------
ALTER TABLE public.entity_metric_links
  ALTER COLUMN confidence DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS confidence_semantics text;

ALTER TABLE public.entity_event_links
  ALTER COLUMN confidence DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS confidence_semantics text;

UPDATE public.entity_metric_links
SET confidence_semantics = 'legacy_numeric_semantics_unverified'
WHERE confidence IS NOT NULL AND confidence_semantics IS NULL;

UPDATE public.entity_event_links
SET confidence_semantics = 'legacy_numeric_semantics_unverified'
WHERE confidence IS NOT NULL AND confidence_semantics IS NULL;

ALTER TABLE public.entity_metric_links
  ADD CONSTRAINT entity_metric_links_confidence_unit_v1
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)) NOT VALID;

ALTER TABLE public.entity_event_links
  ADD CONSTRAINT entity_event_links_confidence_unit_v1
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)) NOT VALID;

-- ---------------------------------------------------------------------------
-- Provenance quality: unknown is NULL, never perfect freshness or neutral 0.5.
-- observed_at remains the system observation/receipt timestamp. It is not the
-- source event timestamp; source-specific times belong on the normalized fact.
-- ---------------------------------------------------------------------------
ALTER TABLE public.data_provenance
  ALTER COLUMN freshness_score DROP DEFAULT,
  ALTER COLUMN quality_score DROP DEFAULT,
  ALTER COLUMN confidence DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS freshness_semantics text,
  ADD COLUMN IF NOT EXISTS quality_semantics text,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS entity_match_confidence_semantics text,
  ADD COLUMN IF NOT EXISTS observed_at_semantics text;

UPDATE public.data_provenance
SET freshness_semantics = 'legacy_numeric_semantics_unverified'
WHERE freshness_score IS NOT NULL AND freshness_semantics IS NULL;

UPDATE public.data_provenance
SET quality_semantics = 'legacy_numeric_semantics_unverified'
WHERE quality_score IS NOT NULL AND quality_semantics IS NULL;

UPDATE public.data_provenance
SET confidence_semantics = 'legacy_numeric_semantics_unverified'
WHERE confidence IS NOT NULL AND confidence_semantics IS NULL;

UPDATE public.data_provenance
SET entity_match_confidence_semantics = 'legacy_numeric_semantics_unverified'
WHERE entity_match_confidence IS NOT NULL
  AND entity_match_confidence_semantics IS NULL;

UPDATE public.data_provenance
SET observed_at_semantics = 'legacy_observation_time_semantics_unverified'
WHERE observed_at IS NOT NULL AND observed_at_semantics IS NULL;

ALTER TABLE public.data_provenance
  ADD CONSTRAINT data_provenance_freshness_unit_v1
    CHECK (freshness_score IS NULL OR (freshness_score >= 0 AND freshness_score <= 1)) NOT VALID,
  ADD CONSTRAINT data_provenance_quality_unit_v1
    CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 1)) NOT VALID,
  ADD CONSTRAINT data_provenance_confidence_unit_v1
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)) NOT VALID,
  ADD CONSTRAINT data_provenance_entity_match_confidence_unit_v1
    CHECK (entity_match_confidence IS NULL OR (entity_match_confidence >= 0 AND entity_match_confidence <= 1)) NOT VALID;

COMMENT ON COLUMN public.normalized_metrics.confidence IS
  'Nullable confidence with declared semantics. NULL means unknown/not quantified; never substitute a default.';
COMMENT ON COLUMN public.normalized_metrics.provenance_observed_at IS
  'Nullable source observation timestamp only when the provider semantics establish it. Ingestion/retrieval time belongs in retrieved_at.';
COMMENT ON COLUMN public.normalized_metrics.freshness_score IS
  'Nullable freshness metric with declared semantics. NULL means freshness has not been measured.';
COMMENT ON COLUMN public.normalized_events.started_at IS
  'Nullable source event start time. Missing source event time must remain NULL; system retrieval time belongs in retrieved_at.';
COMMENT ON COLUMN public.entity_metric_links.confidence IS
  'Nullable quantified entity-link confidence. Link existence is not confidence=1; inspect confidence_semantics.';
COMMENT ON COLUMN public.entity_event_links.confidence IS
  'Nullable quantified entity-link confidence. Link existence is not confidence=1; inspect confidence_semantics.';
COMMENT ON COLUMN public.data_provenance.observed_at IS
  'System observation/receipt time for this provenance record. It must not be substituted for a source event timestamp.';
COMMENT ON COLUMN public.data_provenance.freshness_score IS
  'Nullable explicitly computed freshness score. NULL means not computed; no perfect-freshness default.';
COMMENT ON COLUMN public.data_provenance.quality_score IS
  'Nullable explicitly measured/derived quality score with declared semantics.';
COMMENT ON COLUMN public.data_provenance.confidence IS
  'Nullable source/fact confidence with declared semantics; unknown remains NULL.';
