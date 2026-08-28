-- AICIS government-foundation legacy epistemic quarantine v1
--
-- The 2026-05-13 foundation created several numeric defaults where 0 meant both
-- "not measured" and a legitimate zero. These tables have no committed executable
-- writers beyond the already-quarantined operational-risk branch, so preserve their
-- history for audit and prevent the schema from manufacturing future certainty.

-- -----------------------------------------------------------------------------
-- Intervention outcomes: pending/unresolved is not zero effectiveness.
-- -----------------------------------------------------------------------------
ALTER TABLE public.intervention_outcomes
  ALTER COLUMN outcome_effectiveness DROP DEFAULT,
  ALTER COLUMN escalation_reduction DROP DEFAULT,
  ALTER COLUMN economic_impact_reduction DROP DEFAULT,
  ALTER COLUMN humanitarian_impact_reduction DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_outcome_effectiveness numeric,
  ADD COLUMN IF NOT EXISTS reported_escalation_reduction numeric,
  ADD COLUMN IF NOT EXISTS reported_economic_impact_reduction numeric,
  ADD COLUMN IF NOT EXISTS reported_humanitarian_impact_reduction numeric,
  ADD COLUMN IF NOT EXISTS outcome_metric_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'unresolved'
    CHECK (evidence_status IN ('unresolved','partial','validated'));

UPDATE public.intervention_outcomes
SET
  reported_outcome_effectiveness = COALESCE(reported_outcome_effectiveness, outcome_effectiveness),
  reported_escalation_reduction = COALESCE(reported_escalation_reduction, escalation_reduction),
  reported_economic_impact_reduction = COALESCE(reported_economic_impact_reduction, economic_impact_reduction),
  reported_humanitarian_impact_reduction = COALESCE(reported_humanitarian_impact_reduction, humanitarian_impact_reduction),
  outcome_effectiveness = NULL,
  escalation_reduction = NULL,
  economic_impact_reduction = NULL,
  humanitarian_impact_reduction = NULL,
  outcome_metric_semantics = COALESCE(outcome_metric_semantics, 'legacy_outcome_metrics_semantics_unverified'),
  evidence_status = CASE
    WHEN evaluated_at IS NOT NULL AND cardinality(ARRAY(SELECT jsonb_array_elements(validation_evidence))) > 0
      THEN 'partial'
    ELSE 'unresolved'
  END;

-- -----------------------------------------------------------------------------
-- Legacy scenario simulations: synthetic outputs were not calibrated forecasts.
-- -----------------------------------------------------------------------------
ALTER TABLE public.scenario_simulations
  ALTER COLUMN projected_economic_impact DROP DEFAULT,
  ALTER COLUMN projected_humanitarian_impact DROP DEFAULT,
  ALTER COLUMN projected_geopolitical_impact DROP DEFAULT,
  ALTER COLUMN probability_score DROP DEFAULT,
  ALTER COLUMN confidence_score DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_projected_economic_impact numeric,
  ADD COLUMN IF NOT EXISTS reported_projected_humanitarian_impact numeric,
  ADD COLUMN IF NOT EXISTS reported_projected_geopolitical_impact numeric,
  ADD COLUMN IF NOT EXISTS reported_probability_score numeric,
  ADD COLUMN IF NOT EXISTS reported_confidence_score numeric,
  ADD COLUMN IF NOT EXISTS simulation_semantics text,
  ADD COLUMN IF NOT EXISTS probability_semantics text,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.scenario_simulations
SET
  reported_projected_economic_impact = COALESCE(reported_projected_economic_impact, projected_economic_impact),
  reported_projected_humanitarian_impact = COALESCE(reported_projected_humanitarian_impact, projected_humanitarian_impact),
  reported_projected_geopolitical_impact = COALESCE(reported_projected_geopolitical_impact, projected_geopolitical_impact),
  reported_probability_score = COALESCE(reported_probability_score, probability_score),
  reported_confidence_score = COALESCE(reported_confidence_score, confidence_score),
  projected_economic_impact = NULL,
  projected_humanitarian_impact = NULL,
  projected_geopolitical_impact = NULL,
  probability_score = NULL,
  confidence_score = NULL,
  simulation_semantics = COALESCE(simulation_semantics, 'legacy_scenario_output_semantics_unverified'),
  probability_semantics = COALESCE(probability_semantics, 'withheld_not_established_as_probability'),
  confidence_semantics = COALESCE(confidence_semantics, 'withheld_not_established_as_epistemic_confidence'),
  evidence_status = 'legacy_unverified';

-- -----------------------------------------------------------------------------
-- Population stress: no observation is not zero stress.
-- -----------------------------------------------------------------------------
ALTER TABLE public.population_stress_indicators
  ALTER COLUMN food_stress DROP DEFAULT,
  ALTER COLUMN migration_pressure DROP DEFAULT,
  ALTER COLUMN civil_unrest_pressure DROP DEFAULT,
  ALTER COLUMN healthcare_stress DROP DEFAULT,
  ALTER COLUMN infrastructure_stress DROP DEFAULT,
  ALTER COLUMN environmental_stress DROP DEFAULT,
  ALTER COLUMN aggregate_population_stress DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_food_stress numeric,
  ADD COLUMN IF NOT EXISTS reported_migration_pressure numeric,
  ADD COLUMN IF NOT EXISTS reported_civil_unrest_pressure numeric,
  ADD COLUMN IF NOT EXISTS reported_healthcare_stress numeric,
  ADD COLUMN IF NOT EXISTS reported_infrastructure_stress numeric,
  ADD COLUMN IF NOT EXISTS reported_environmental_stress numeric,
  ADD COLUMN IF NOT EXISTS reported_aggregate_population_stress numeric,
  ADD COLUMN IF NOT EXISTS metric_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'unknown';

UPDATE public.population_stress_indicators
SET
  reported_food_stress = COALESCE(reported_food_stress, food_stress),
  reported_migration_pressure = COALESCE(reported_migration_pressure, migration_pressure),
  reported_civil_unrest_pressure = COALESCE(reported_civil_unrest_pressure, civil_unrest_pressure),
  reported_healthcare_stress = COALESCE(reported_healthcare_stress, healthcare_stress),
  reported_infrastructure_stress = COALESCE(reported_infrastructure_stress, infrastructure_stress),
  reported_environmental_stress = COALESCE(reported_environmental_stress, environmental_stress),
  reported_aggregate_population_stress = COALESCE(reported_aggregate_population_stress, aggregate_population_stress),
  food_stress = NULL,
  migration_pressure = NULL,
  civil_unrest_pressure = NULL,
  healthcare_stress = NULL,
  infrastructure_stress = NULL,
  environmental_stress = NULL,
  aggregate_population_stress = NULL,
  metric_semantics = COALESCE(metric_semantics, 'legacy_population_stress_semantics_unverified'),
  evidence_status = 'legacy_unverified';

-- -----------------------------------------------------------------------------
-- Policy simulation: model confidence cannot default to zero/known.
-- -----------------------------------------------------------------------------
ALTER TABLE public.policy_simulations
  ALTER COLUMN confidence_score DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_confidence_score numeric,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS simulation_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.policy_simulations
SET
  reported_confidence_score = COALESCE(reported_confidence_score, confidence_score),
  confidence_score = NULL,
  confidence_semantics = COALESCE(confidence_semantics, 'withheld_not_established_as_epistemic_confidence'),
  simulation_semantics = COALESCE(simulation_semantics, 'legacy_policy_simulation_semantics_unverified'),
  evidence_status = 'legacy_unverified';

-- Compatibility command views remain queryable but cannot rank NULL as low risk.
CREATE OR REPLACE VIEW public.population_stress_command_view AS
SELECT
  country_code,
  region_name,
  aggregate_population_stress,
  food_stress,
  migration_pressure,
  civil_unrest_pressure,
  healthcare_stress,
  infrastructure_stress,
  environmental_stress,
  calculated_at
FROM public.population_stress_indicators
ORDER BY aggregate_population_stress DESC NULLS LAST, calculated_at DESC;

CREATE OR REPLACE VIEW public.scenario_simulation_command_view AS
SELECT
  simulation_title,
  simulation_type,
  initiating_region,
  projected_economic_impact,
  projected_humanitarian_impact,
  projected_geopolitical_impact,
  probability_score,
  confidence_score,
  simulation_horizon_days,
  generated_at
FROM public.scenario_simulations
ORDER BY probability_score DESC NULLS LAST, generated_at DESC;

COMMENT ON TABLE public.scenario_simulations IS
  'Legacy scenario table retained for audit/compatibility. Canonical probability/confidence fields are withheld until an evaluated forecast contract exists.';
COMMENT ON TABLE public.population_stress_indicators IS
  'Legacy population-stress table retained for audit. Missing evidence is NULL, never zero stress.';
COMMENT ON COLUMN public.intervention_outcomes.outcome_effectiveness IS
  'Nullable validated outcome metric only. Pending or unresolved interventions must remain NULL.';
