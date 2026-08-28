-- AICIS planetary-memory epistemic truth floor v1
--
-- The legacy civilization-learning layer seeded synthetic historical memories and
-- converted those priors into analog similarity, resilience, forecast confidence,
-- risk outlook and recommendations. Long-horizon memory must retain evidence, not
-- preserve an earlier model's unsupported beliefs. Quarantine the synthetic scores
-- and introduce an append-only evidence memory substrate with explicit provenance.

-- -----------------------------------------------------------------------------
-- 1. Legacy planetary memory ledger: preserve text, withhold unsupported scores.
-- -----------------------------------------------------------------------------
ALTER TABLE public.planetary_memory_ledger
  ALTER COLUMN source_region DROP DEFAULT,
  ALTER COLUMN historical_significance_score DROP DEFAULT,
  ALTER COLUMN recurrence_probability DROP DEFAULT,
  ALTER COLUMN systemic_impact_score DROP DEFAULT,
  ALTER COLUMN resilience_outcome_score DROP DEFAULT,
  ALTER COLUMN coordination_effectiveness_score DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_source_region text,
  ADD COLUMN IF NOT EXISTS source_region_semantics text,
  ADD COLUMN IF NOT EXISTS reported_historical_significance_score numeric,
  ADD COLUMN IF NOT EXISTS historical_significance_semantics text,
  ADD COLUMN IF NOT EXISTS reported_recurrence_probability numeric,
  ADD COLUMN IF NOT EXISTS recurrence_probability_semantics text,
  ADD COLUMN IF NOT EXISTS reported_systemic_impact_score numeric,
  ADD COLUMN IF NOT EXISTS systemic_impact_semantics text,
  ADD COLUMN IF NOT EXISTS reported_resilience_outcome_score numeric,
  ADD COLUMN IF NOT EXISTS resilience_outcome_semantics text,
  ADD COLUMN IF NOT EXISTS reported_coordination_effectiveness_score numeric,
  ADD COLUMN IF NOT EXISTS coordination_effectiveness_semantics text,
  ADD COLUMN IF NOT EXISTS memory_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified',
  ADD COLUMN IF NOT EXISTS source_record_keys text[] NOT NULL DEFAULT '{}';

UPDATE public.planetary_memory_ledger
SET
  reported_source_region = COALESCE(reported_source_region, source_region),
  source_region = NULL,
  source_region_semantics = COALESCE(source_region_semantics, 'legacy_memory_region_semantics_unverified'),
  reported_historical_significance_score = COALESCE(reported_historical_significance_score, historical_significance_score),
  historical_significance_score = NULL,
  historical_significance_semantics = COALESCE(historical_significance_semantics, 'legacy_significance_score_semantics_unverified'),
  reported_recurrence_probability = COALESCE(reported_recurrence_probability, recurrence_probability),
  recurrence_probability = NULL,
  recurrence_probability_semantics = COALESCE(recurrence_probability_semantics, 'withheld_not_established_as_probability'),
  reported_systemic_impact_score = COALESCE(reported_systemic_impact_score, systemic_impact_score),
  systemic_impact_score = NULL,
  systemic_impact_semantics = COALESCE(systemic_impact_semantics, 'legacy_systemic_impact_semantics_unverified'),
  reported_resilience_outcome_score = COALESCE(reported_resilience_outcome_score, resilience_outcome_score),
  resilience_outcome_score = NULL,
  resilience_outcome_semantics = COALESCE(resilience_outcome_semantics, 'legacy_resilience_outcome_semantics_unverified'),
  reported_coordination_effectiveness_score = COALESCE(reported_coordination_effectiveness_score, coordination_effectiveness_score),
  coordination_effectiveness_score = NULL,
  coordination_effectiveness_semantics = COALESCE(coordination_effectiveness_semantics, 'legacy_coordination_effectiveness_semantics_unverified'),
  memory_semantics = COALESCE(memory_semantics, 'legacy_seed_or_derived_memory_claim_unverified'),
  evidence_status = 'legacy_unverified',
  source_record_keys = '{}';

-- -----------------------------------------------------------------------------
-- 2. Historical analogs: similarity requires an evaluated method, not prior scores.
-- -----------------------------------------------------------------------------
ALTER TABLE public.historical_analog_graph
  ALTER COLUMN similarity_score DROP DEFAULT,
  ALTER COLUMN propagation_similarity DROP DEFAULT,
  ALTER COLUMN intervention_similarity DROP DEFAULT,
  ALTER COLUMN resilience_similarity DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_similarity_score numeric,
  ADD COLUMN IF NOT EXISTS reported_propagation_similarity numeric,
  ADD COLUMN IF NOT EXISTS reported_intervention_similarity numeric,
  ADD COLUMN IF NOT EXISTS reported_resilience_similarity numeric,
  ADD COLUMN IF NOT EXISTS similarity_method text,
  ADD COLUMN IF NOT EXISTS similarity_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.historical_analog_graph
SET
  reported_similarity_score = COALESCE(reported_similarity_score, similarity_score),
  reported_propagation_similarity = COALESCE(reported_propagation_similarity, propagation_similarity),
  reported_intervention_similarity = COALESCE(reported_intervention_similarity, intervention_similarity),
  reported_resilience_similarity = COALESCE(reported_resilience_similarity, resilience_similarity),
  similarity_score = NULL,
  propagation_similarity = NULL,
  intervention_similarity = NULL,
  resilience_similarity = NULL,
  similarity_method = COALESCE(similarity_method, 'legacy_weighted_prior_score'),
  similarity_semantics = COALESCE(similarity_semantics, 'withheld_method_not_evaluated'),
  evidence_status = 'legacy_unverified';

-- -----------------------------------------------------------------------------
-- 3. Civilization resilience: no observations must never become neutral 50/70.
-- -----------------------------------------------------------------------------
ALTER TABLE public.civilization_resilience_profiles
  ALTER COLUMN infrastructure_resilience DROP DEFAULT,
  ALTER COLUMN humanitarian_resilience DROP DEFAULT,
  ALTER COLUMN economic_resilience DROP DEFAULT,
  ALTER COLUMN governance_resilience DROP DEFAULT,
  ALTER COLUMN climate_resilience DROP DEFAULT,
  ALTER COLUMN cyber_resilience DROP DEFAULT,
  ALTER COLUMN coordination_capacity DROP DEFAULT,
  ALTER COLUMN adaptive_learning_score DROP DEFAULT,
  ALTER COLUMN overall_resilience_score DROP DEFAULT,
  ALTER COLUMN risk_outlook DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_infrastructure_resilience numeric,
  ADD COLUMN IF NOT EXISTS reported_humanitarian_resilience numeric,
  ADD COLUMN IF NOT EXISTS reported_economic_resilience numeric,
  ADD COLUMN IF NOT EXISTS reported_governance_resilience numeric,
  ADD COLUMN IF NOT EXISTS reported_climate_resilience numeric,
  ADD COLUMN IF NOT EXISTS reported_cyber_resilience numeric,
  ADD COLUMN IF NOT EXISTS reported_coordination_capacity numeric,
  ADD COLUMN IF NOT EXISTS reported_adaptive_learning_score numeric,
  ADD COLUMN IF NOT EXISTS reported_overall_resilience_score numeric,
  ADD COLUMN IF NOT EXISTS reported_risk_outlook text,
  ADD COLUMN IF NOT EXISTS resilience_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified',
  ADD COLUMN IF NOT EXISTS evidence_record_ids uuid[] NOT NULL DEFAULT '{}';

UPDATE public.civilization_resilience_profiles
SET
  reported_infrastructure_resilience = COALESCE(reported_infrastructure_resilience, infrastructure_resilience),
  reported_humanitarian_resilience = COALESCE(reported_humanitarian_resilience, humanitarian_resilience),
  reported_economic_resilience = COALESCE(reported_economic_resilience, economic_resilience),
  reported_governance_resilience = COALESCE(reported_governance_resilience, governance_resilience),
  reported_climate_resilience = COALESCE(reported_climate_resilience, climate_resilience),
  reported_cyber_resilience = COALESCE(reported_cyber_resilience, cyber_resilience),
  reported_coordination_capacity = COALESCE(reported_coordination_capacity, coordination_capacity),
  reported_adaptive_learning_score = COALESCE(reported_adaptive_learning_score, adaptive_learning_score),
  reported_overall_resilience_score = COALESCE(reported_overall_resilience_score, overall_resilience_score),
  reported_risk_outlook = COALESCE(reported_risk_outlook, risk_outlook),
  infrastructure_resilience = NULL,
  humanitarian_resilience = NULL,
  economic_resilience = NULL,
  governance_resilience = NULL,
  climate_resilience = NULL,
  cyber_resilience = NULL,
  coordination_capacity = NULL,
  adaptive_learning_score = NULL,
  overall_resilience_score = NULL,
  risk_outlook = NULL,
  resilience_semantics = COALESCE(resilience_semantics, 'withheld_event_count_heuristic_not_resilience_measurement'),
  evidence_status = 'legacy_unverified',
  evidence_record_ids = '{}';

-- -----------------------------------------------------------------------------
-- 4. Cross-crisis learning and memory-informed forecasts.
-- -----------------------------------------------------------------------------
ALTER TABLE public.cross_crisis_learning_ledger
  ALTER COLUMN confidence_score DROP DEFAULT,
  ALTER COLUMN recurrence_weight DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_confidence_score numeric,
  ADD COLUMN IF NOT EXISTS reported_recurrence_weight numeric,
  ADD COLUMN IF NOT EXISTS learning_semantics text,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.cross_crisis_learning_ledger
SET
  reported_confidence_score = COALESCE(reported_confidence_score, confidence_score),
  reported_recurrence_weight = COALESCE(reported_recurrence_weight, recurrence_weight),
  confidence_score = NULL,
  recurrence_weight = NULL,
  learning_semantics = COALESCE(learning_semantics, 'legacy_cross_crisis_learning_semantics_unverified'),
  confidence_semantics = COALESCE(confidence_semantics, 'withheld_not_established_as_epistemic_confidence'),
  evidence_status = 'legacy_unverified';

ALTER TABLE public.memory_informed_forecasts
  ALTER COLUMN historical_analog_count DROP DEFAULT,
  ALTER COLUMN forecast_confidence DROP DEFAULT,
  ALTER COLUMN historical_basis_score DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_historical_analog_count integer,
  ADD COLUMN IF NOT EXISTS reported_forecast_confidence numeric,
  ADD COLUMN IF NOT EXISTS reported_historical_basis_score numeric,
  ADD COLUMN IF NOT EXISTS forecast_semantics text,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS historical_basis_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.memory_informed_forecasts
SET
  reported_historical_analog_count = COALESCE(reported_historical_analog_count, historical_analog_count),
  reported_forecast_confidence = COALESCE(reported_forecast_confidence, forecast_confidence),
  reported_historical_basis_score = COALESCE(reported_historical_basis_score, historical_basis_score),
  historical_analog_count = NULL,
  forecast_confidence = NULL,
  historical_basis_score = NULL,
  projected_risk_trend = NULL,
  projected_resilience_trend = NULL,
  projected_coordination_outcome = NULL,
  forecast_semantics = COALESCE(forecast_semantics, 'legacy_analog_heuristic_not_forecast_model'),
  confidence_semantics = COALESCE(confidence_semantics, 'withheld_not_established_as_calibrated_forecast_confidence'),
  historical_basis_semantics = COALESCE(historical_basis_semantics, 'withheld_analog_method_not_evaluated'),
  evidence_status = 'legacy_unverified';

-- -----------------------------------------------------------------------------
-- 5. Append-only evidence memory substrate.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planetary_memory_evidence_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_key text NOT NULL,
  memory_type text NOT NULL,
  source_domain text,
  source_region text,
  event_title text NOT NULL,
  event_summary text,
  occurred_from timestamptz,
  occurred_to timestamptz,
  observed_at timestamptz NOT NULL,
  source_record_keys text[] NOT NULL,
  source_independence_status text NOT NULL DEFAULT 'not_assessed',
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_status text NOT NULL DEFAULT 'observed'
    CHECK (evidence_status IN ('observed','validated','contradicted','retracted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(source_record_keys) > 0),
  CHECK (occurred_to IS NULL OR occurred_from IS NULL OR occurred_to >= occurred_from)
);

CREATE INDEX IF NOT EXISTS idx_planetary_memory_evidence_subject_v1
ON public.planetary_memory_evidence_records(subject_key, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_planetary_memory_evidence_domain_region_v1
ON public.planetary_memory_evidence_records(source_domain, source_region, observed_at DESC);

CREATE OR REPLACE FUNCTION public.block_planetary_memory_evidence_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'planetary_memory_evidence_records is append-only; add a contradiction/retraction record instead';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_planetary_memory_evidence_update_v1
ON public.planetary_memory_evidence_records;
CREATE TRIGGER trg_block_planetary_memory_evidence_update_v1
BEFORE UPDATE OR DELETE ON public.planetary_memory_evidence_records
FOR EACH ROW EXECUTE FUNCTION public.block_planetary_memory_evidence_mutation_v1();

ALTER TABLE public.planetary_memory_evidence_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.planetary_memory_evidence_records FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.planetary_memory_evidence_records TO service_role;

CREATE OR REPLACE FUNCTION public.record_planetary_memory_evidence_v1(
  p_subject_key text,
  p_memory_type text,
  p_event_title text,
  p_observed_at timestamptz,
  p_source_record_keys text[],
  p_source_domain text DEFAULT NULL,
  p_source_region text DEFAULT NULL,
  p_event_summary text DEFAULT NULL,
  p_occurred_from timestamptz DEFAULT NULL,
  p_occurred_to timestamptz DEFAULT NULL,
  p_source_independence_status text DEFAULT 'not_assessed',
  p_provenance jsonb DEFAULT '{}'::jsonb,
  p_evidence_status text DEFAULT 'observed'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_subject_key IS NULL OR btrim(p_subject_key) = '' THEN
    RAISE EXCEPTION 'subject_key is required';
  END IF;
  IF p_memory_type IS NULL OR btrim(p_memory_type) = '' THEN
    RAISE EXCEPTION 'memory_type is required';
  END IF;
  IF p_event_title IS NULL OR btrim(p_event_title) = '' THEN
    RAISE EXCEPTION 'event_title is required';
  END IF;
  IF p_observed_at IS NULL THEN
    RAISE EXCEPTION 'observed_at is required and must represent evidence observation time';
  END IF;
  IF p_source_record_keys IS NULL OR cardinality(p_source_record_keys) = 0 THEN
    RAISE EXCEPTION 'at least one source_record_key is required';
  END IF;
  IF p_occurred_from IS NOT NULL AND p_occurred_to IS NOT NULL AND p_occurred_to < p_occurred_from THEN
    RAISE EXCEPTION 'occurred_to cannot precede occurred_from';
  END IF;
  IF p_evidence_status NOT IN ('observed','validated','contradicted','retracted') THEN
    RAISE EXCEPTION 'invalid evidence_status %', p_evidence_status;
  END IF;

  INSERT INTO public.planetary_memory_evidence_records(
    subject_key,
    memory_type,
    source_domain,
    source_region,
    event_title,
    event_summary,
    occurred_from,
    occurred_to,
    observed_at,
    source_record_keys,
    source_independence_status,
    provenance,
    evidence_status
  ) VALUES (
    p_subject_key,
    p_memory_type,
    p_source_domain,
    p_source_region,
    p_event_title,
    p_event_summary,
    p_occurred_from,
    p_occurred_to,
    p_observed_at,
    p_source_record_keys,
    p_source_independence_status,
    COALESCE(p_provenance,'{}'::jsonb),
    p_evidence_status
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Disable synthetic learning/forecast generators. Compatibility names remain
-- callable but emit explicit abstentions rather than writes.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_historical_analogs(
  p_source_event text,
  p_source_domain text,
  p_source_region text DEFAULT 'GLOBAL'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'status','quarantined',
    'reason','evaluated_historical_analog_method_required',
    'source_event',p_source_event,
    'source_domain',p_source_domain,
    'source_region',p_source_region
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_civilization_resilience(
  p_region_code text,
  p_domain text DEFAULT 'general'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'status','quarantined',
    'reason','evidence_backed_resilience_model_required',
    'region_code',p_region_code,
    'domain',p_domain
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_memory_informed_forecast(
  p_source_event text,
  p_source_domain text,
  p_source_region text DEFAULT 'GLOBAL'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'status','quarantined',
    'reason','evaluated_forecast_model_and_analog_method_required',
    'source_event',p_source_event,
    'source_domain',p_source_domain,
    'source_region',p_source_region
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.run_civilization_learning_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES (
    'civilization-learning-cycle',
    'skipped',
    'quarantined: synthetic analog/resilience/forecast learning disabled; evidence memory remains active'
  );

  RETURN jsonb_build_object(
    'status','quarantined',
    'forecasts_generated',0,
    'resilience_profiles_generated',0,
    'evidence_memory_available',true
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Compatibility views expose evidence status and sort unknowns last.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.planetary_memory_command_view AS
SELECT
  memory_type,
  source_domain,
  source_region,
  event_title,
  historical_significance_score,
  recurrence_probability,
  systemic_impact_score,
  coordination_effectiveness_score,
  evidence_status,
  memory_semantics,
  created_at
FROM public.planetary_memory_ledger
ORDER BY historical_significance_score DESC NULLS LAST, created_at DESC;

CREATE OR REPLACE VIEW public.historical_analog_command_view AS
SELECT
  current_event_reference,
  similarity_score,
  propagation_similarity,
  intervention_similarity,
  resilience_similarity,
  similarity_method,
  similarity_semantics,
  evidence_status,
  analog_summary,
  created_at
FROM public.historical_analog_graph
ORDER BY similarity_score DESC NULLS LAST, created_at DESC;

CREATE OR REPLACE VIEW public.civilization_resilience_command_view AS
SELECT
  region_code,
  civilization_domain,
  overall_resilience_score,
  infrastructure_resilience,
  governance_resilience,
  climate_resilience,
  coordination_capacity,
  adaptive_learning_score,
  risk_outlook,
  evidence_status,
  resilience_semantics,
  updated_at
FROM public.civilization_resilience_profiles
ORDER BY overall_resilience_score DESC NULLS LAST, updated_at DESC;

CREATE OR REPLACE VIEW public.memory_forecast_command_view AS
SELECT
  source_event,
  source_domain,
  source_region,
  historical_analog_count,
  projected_risk_trend,
  forecast_confidence,
  projected_coordination_outcome,
  forecast_semantics,
  confidence_semantics,
  evidence_status,
  created_at
FROM public.memory_informed_forecasts
ORDER BY forecast_confidence DESC NULLS LAST, created_at DESC;

REVOKE ALL ON FUNCTION public.record_planetary_memory_evidence_v1(text,text,text,timestamptz,text[],text,text,text,timestamptz,timestamptz,text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_historical_analogs(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calculate_civilization_resilience(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_memory_informed_forecast(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_civilization_learning_cycle() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_planetary_memory_evidence_v1(text,text,text,timestamptz,text[],text,text,text,timestamptz,timestamptz,text,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_historical_analogs(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.calculate_civilization_resilience(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_memory_informed_forecast(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_civilization_learning_cycle() TO service_role;

COMMENT ON TABLE public.planetary_memory_evidence_records IS
  'Append-only evidence memory. It stores observed/validated/contradicted/retracted records with explicit source keys and observation time; it issues no probability or resilience score.';
COMMENT ON COLUMN public.planetary_memory_evidence_records.observed_at IS
  'Time the supporting evidence was observed/reported; never silently substituted with row creation time.';
