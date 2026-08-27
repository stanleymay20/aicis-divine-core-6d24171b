-- AICIS Legacy Strategic Generator Quarantine v1
--
-- Telemetry ingestion historically invoked strategic digital-twin and government
-- risk generators that did not consume the newly ingested telemetry. Those
-- generators also converted missing signal fields to zero and synthesized risk,
-- resilience, confidence, and recommendations from ungoverned formulas.
-- Preserve historical output for audit, but prevent further silent promotion.

-- -----------------------------------------------------------------------------
-- Strategic digital twins
-- -----------------------------------------------------------------------------
ALTER TABLE public.strategic_digital_twins
  ALTER COLUMN resilience_index DROP DEFAULT,
  ALTER COLUMN fragility_index DROP DEFAULT,
  ALTER COLUMN forecast_instability_index DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_legacy_indices jsonb,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unknown',
  ADD COLUMN IF NOT EXISTS twin_semantics text NOT NULL DEFAULT 'legacy_strategic_twin_unverified',
  ADD COLUMN IF NOT EXISTS resilience_semantics text,
  ADD COLUMN IF NOT EXISTS fragility_semantics text,
  ADD COLUMN IF NOT EXISTS instability_semantics text,
  ADD COLUMN IF NOT EXISTS input_evidence_semantics text,
  ADD COLUMN IF NOT EXISTS generation_status text NOT NULL DEFAULT 'legacy';

UPDATE public.strategic_digital_twins
SET
  reported_legacy_indices = COALESCE(
    reported_legacy_indices,
    jsonb_build_object(
      'resilience_index', resilience_index,
      'fragility_index', fragility_index,
      'forecast_instability_index', forecast_instability_index
    )
  ),
  resilience_index = NULL,
  fragility_index = NULL,
  forecast_instability_index = NULL,
  evidence_status = 'legacy_unknown',
  twin_semantics = 'legacy_strategic_twin_unverified',
  resilience_semantics = COALESCE(resilience_semantics, 'withheld_legacy_resilience_formula_unverified'),
  fragility_semantics = COALESCE(fragility_semantics, 'withheld_legacy_fragility_formula_unverified'),
  instability_semantics = COALESCE(instability_semantics, 'withheld_legacy_instability_formula_unverified'),
  input_evidence_semantics = COALESCE(input_evidence_semantics, 'legacy_global_signal_inputs_missing_values_coerced_to_zero'),
  generation_status = 'quarantined_legacy'
WHERE twin_semantics = 'legacy_strategic_twin_unverified'
   OR evidence_status = 'legacy_unknown';

-- -----------------------------------------------------------------------------
-- Operational risk assessments
-- -----------------------------------------------------------------------------
ALTER TABLE public.operational_risk_assessments
  ALTER COLUMN infrastructure_risk DROP DEFAULT,
  ALTER COLUMN economic_risk DROP DEFAULT,
  ALTER COLUMN social_risk DROP DEFAULT,
  ALTER COLUMN climate_risk DROP DEFAULT,
  ALTER COLUMN cyber_risk DROP DEFAULT,
  ALTER COLUMN geopolitical_risk DROP DEFAULT,
  ALTER COLUMN humanitarian_risk DROP DEFAULT,
  ALTER COLUMN aggregate_risk_index DROP DEFAULT,
  ALTER COLUMN confidence_score DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_legacy_scores jsonb,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unknown',
  ADD COLUMN IF NOT EXISTS risk_semantics text,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS supporting_evidence_semantics text,
  ADD COLUMN IF NOT EXISTS recommendation_semantics text,
  ADD COLUMN IF NOT EXISTS generation_status text NOT NULL DEFAULT 'legacy';

UPDATE public.operational_risk_assessments
SET
  reported_legacy_scores = COALESCE(
    reported_legacy_scores,
    jsonb_build_object(
      'infrastructure_risk', infrastructure_risk,
      'economic_risk', economic_risk,
      'social_risk', social_risk,
      'climate_risk', climate_risk,
      'cyber_risk', cyber_risk,
      'geopolitical_risk', geopolitical_risk,
      'humanitarian_risk', humanitarian_risk,
      'aggregate_risk_index', aggregate_risk_index,
      'confidence_score', confidence_score
    )
  ),
  infrastructure_risk = NULL,
  economic_risk = NULL,
  social_risk = NULL,
  climate_risk = NULL,
  cyber_risk = NULL,
  geopolitical_risk = NULL,
  humanitarian_risk = NULL,
  aggregate_risk_index = NULL,
  confidence_score = NULL,
  evidence_status = 'legacy_unknown',
  risk_semantics = COALESCE(risk_semantics, 'withheld_legacy_operational_risk_formula_unverified'),
  confidence_semantics = COALESCE(confidence_semantics, 'withheld_legacy_average_signal_score_not_epistemic_confidence'),
  supporting_evidence_semantics = COALESCE(supporting_evidence_semantics, 'legacy_signal_ids_without_complete_quantitative_semantics'),
  recommendation_semantics = COALESCE(recommendation_semantics, 'legacy_generic_template_recommendations_not_evidence_derived'),
  generation_status = 'quarantined_legacy'
WHERE evidence_status = 'legacy_unknown';

CREATE OR REPLACE VIEW public.government_operational_command_view AS
SELECT
  ora.country_code,
  ora.sector,
  ora.aggregate_risk_index,
  ora.infrastructure_risk,
  ora.economic_risk,
  ora.social_risk,
  ora.climate_risk,
  ora.cyber_risk,
  ora.geopolitical_risk,
  ora.humanitarian_risk,
  ora.confidence_score,
  ora.evidence_status,
  ora.risk_semantics,
  ora.confidence_semantics,
  ora.generation_status,
  ora.generated_at
FROM public.operational_risk_assessments ora
ORDER BY ora.aggregate_risk_index DESC NULLS LAST, ora.generated_at DESC;

-- -----------------------------------------------------------------------------
-- Quarantine legacy generators. Return a non-error status so historical telemetry
-- adapters that still invoke the RPCs do not fail ingestion; they simply stop
-- mutating strategic truth until replacement governed engines are deployed.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_strategic_digital_twins(
  p_window interval DEFAULT interval '14 days'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES (
    'strategic-digital-twins',
    'skipped',
    'legacy generator quarantined: telemetry refresh does not itself justify strategic twin recomputation'
  );

  RETURN jsonb_build_object(
    'status', 'quarantined',
    'digital_twins', 0,
    'reason', 'legacy_generator_coerced_missing_evidence_and_did_not_consume_triggering_telemetry',
    'replacement_required', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_operational_risk_assessments(
  p_window interval DEFAULT interval '14 days'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES (
    'government-operational-risk',
    'skipped',
    'legacy generator quarantined: missing signal fields were coerced to zero and generic recommendations were emitted'
  );

  RETURN jsonb_build_object(
    'status', 'quarantined',
    'assessments', 0,
    'reason', 'legacy_generator_coerced_missing_scores_to_zero_and_used_ungoverned_composite_formula',
    'replacement_required', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.generate_strategic_digital_twins(interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_strategic_digital_twins(interval)
  TO service_role;

REVOKE ALL ON FUNCTION public.generate_operational_risk_assessments(interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_operational_risk_assessments(interval)
  TO service_role;

-- -----------------------------------------------------------------------------
-- The older bounded-probabilistic RPC has no committed executable caller. It
-- fabricated a baseline of 50, treated missing impact as zero, and drew arbitrary
-- random deltas. The tables were quarantined in the preceding migration; disable
-- the writer explicitly as well.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_probabilistic_risk_simulation(
  p_source_subject_type text DEFAULT 'global',
  p_source_subject_id uuid DEFAULT NULL,
  p_horizon_days integer DEFAULT 30,
  p_samples integer DEFAULT 250
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'legacy_probabilistic_risk_simulation_quarantined_use_governed_sensitivity_or_validated_forecast_engine';
END;
$$;

REVOKE ALL ON FUNCTION public.run_probabilistic_risk_simulation(text, uuid, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.strategic_digital_twins IS
  'Historical strategic-twin rows retained for audit. Legacy numeric indices are quarantined until a governed evidence-aware twin engine is introduced.';
COMMENT ON TABLE public.operational_risk_assessments IS
  'Historical operational-risk rows retained for audit. Legacy risk/confidence formulas are quarantined; canonical numeric fields remain NULL until governed recomputation.';
COMMENT ON FUNCTION public.generate_strategic_digital_twins(interval) IS
  'Quarantined compatibility stub. Returns status without mutating strategic twin truth.';
COMMENT ON FUNCTION public.generate_operational_risk_assessments(interval) IS
  'Quarantined compatibility stub. Returns status without mutating operational risk truth.';
