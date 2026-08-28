-- Operational graph epistemic truth floor v1
--
-- Purpose:
--   Preserve deterministic graph structure while preventing restored/source-era
--   defaults from manufacturing confidence, validation freshness, historical
--   effectiveness, or reliability evidence.
--
-- Safety:
--   * This migration does not schedule or invoke any writer.
--   * ALTER TABLE IF EXISTS makes it safe before source graph tables are restored.
--   * Unknown epistemic values remain NULL until measured or explicitly verified.

ALTER TABLE IF EXISTS public.operational_graph_edges
  ALTER COLUMN strength DROP DEFAULT,
  ALTER COLUMN strength DROP NOT NULL,
  ALTER COLUMN confidence DROP DEFAULT,
  ALTER COLUMN confidence DROP NOT NULL,
  ALTER COLUMN propagation_weight DROP DEFAULT,
  ALTER COLUMN propagation_weight DROP NOT NULL,
  ALTER COLUMN validity_decay_score DROP DEFAULT,
  ALTER COLUMN validity_decay_score DROP NOT NULL,
  ALTER COLUMN last_validated_at DROP DEFAULT,
  ALTER COLUMN last_validated_at DROP NOT NULL,
  ALTER COLUMN edge_staleness_state DROP DEFAULT,
  ALTER COLUMN edge_staleness_state DROP NOT NULL,
  ALTER COLUMN max_propagation_influence DROP DEFAULT,
  ALTER COLUMN max_propagation_influence DROP NOT NULL,
  ALTER COLUMN propagation_saturation_score DROP DEFAULT,
  ALTER COLUMN propagation_saturation_score DROP NOT NULL;

ALTER TABLE IF EXISTS public.operational_graph_edges
  ADD COLUMN IF NOT EXISTS strength_semantics text,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS propagation_semantics text,
  ADD COLUMN IF NOT EXISTS relationship_verification_status text,
  ADD COLUMN IF NOT EXISTS validation_semantics text;

ALTER TABLE IF EXISTS public.graph_topology_scores
  ALTER COLUMN evidence_confidence DROP DEFAULT,
  ALTER COLUMN evidence_confidence DROP NOT NULL,
  ALTER COLUMN relationship_stability DROP DEFAULT,
  ALTER COLUMN relationship_stability DROP NOT NULL,
  ALTER COLUMN cross_source_consistency DROP DEFAULT,
  ALTER COLUMN cross_source_consistency DROP NOT NULL,
  ALTER COLUMN topology_reliability DROP DEFAULT,
  ALTER COLUMN topology_reliability DROP NOT NULL,
  ALTER COLUMN historical_accuracy DROP DEFAULT,
  ALTER COLUMN historical_accuracy DROP NOT NULL;

ALTER TABLE IF EXISTS public.graph_topology_scores
  ADD COLUMN IF NOT EXISTS score_semantics jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS epistemic_status text NOT NULL DEFAULT 'legacy_unverified';

ALTER TABLE IF EXISTS public.graph_memory_patterns
  ALTER COLUMN historical_effectiveness DROP DEFAULT;

ALTER TABLE IF EXISTS public.graph_memory_patterns
  ADD COLUMN IF NOT EXISTS effectiveness_semantics text,
  ADD COLUMN IF NOT EXISTS pattern_semantics text;

DO $$
BEGIN
  IF to_regclass('public.operational_graph_edges') IS NOT NULL THEN
    UPDATE public.operational_graph_edges
    SET
      strength_semantics = COALESCE(strength_semantics, 'legacy_numeric_semantics_unverified'),
      confidence_semantics = COALESCE(confidence_semantics, 'legacy_numeric_semantics_unverified'),
      propagation_semantics = COALESCE(propagation_semantics, 'legacy_numeric_semantics_unverified'),
      relationship_verification_status = COALESCE(relationship_verification_status, 'legacy_unverified'),
      validation_semantics = COALESCE(validation_semantics, 'legacy_timestamp_semantics_unverified');
  END IF;

  IF to_regclass('public.graph_topology_scores') IS NOT NULL THEN
    UPDATE public.graph_topology_scores
    SET
      epistemic_status = 'legacy_unverified',
      score_semantics = COALESCE(score_semantics, '{}'::jsonb) || jsonb_build_object(
        'legacy_numeric_fields', true,
        'calibration_status', 'not_established'
      );
  END IF;

  IF to_regclass('public.graph_memory_patterns') IS NOT NULL THEN
    UPDATE public.graph_memory_patterns
    SET
      effectiveness_semantics = COALESCE(effectiveness_semantics, 'legacy_numeric_semantics_unverified'),
      pattern_semantics = COALESCE(pattern_semantics, 'legacy_recurrence_semantics_unverified');
  END IF;
END
$$;
