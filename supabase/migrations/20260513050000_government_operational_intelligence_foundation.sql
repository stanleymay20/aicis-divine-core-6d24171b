-- Governmental + Planetary Operational Intelligence Foundation
-- Evolves AICIS from signal intelligence toward operational coordination infrastructure.

-- =====================================================
-- 1. Critical infrastructure registry
-- =====================================================
CREATE TABLE IF NOT EXISTS public.critical_infrastructure_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_key text UNIQUE NOT NULL,
  asset_type text NOT NULL,
  asset_name text NOT NULL,
  country_code text,
  region_name text,
  latitude numeric,
  longitude numeric,
  operational_status text DEFAULT 'operational',
  strategic_importance numeric DEFAULT 0,
  vulnerability_score numeric DEFAULT 0,
  resilience_score numeric DEFAULT 0,
  dependency_graph jsonb DEFAULT '[]'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_critical_assets_type_country
ON public.critical_infrastructure_assets(asset_type, country_code);

-- =====================================================
-- 2. Government operational risk registry
-- =====================================================
CREATE TABLE IF NOT EXISTS public.operational_risk_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_key text UNIQUE NOT NULL,
  country_code text,
  sector text,
  infrastructure_risk numeric DEFAULT 0,
  economic_risk numeric DEFAULT 0,
  social_risk numeric DEFAULT 0,
  climate_risk numeric DEFAULT 0,
  cyber_risk numeric DEFAULT 0,
  geopolitical_risk numeric DEFAULT 0,
  humanitarian_risk numeric DEFAULT 0,
  aggregate_risk_index numeric DEFAULT 0,
  confidence_score numeric DEFAULT 0,
  supporting_signals jsonb DEFAULT '[]'::jsonb,
  recommendations jsonb DEFAULT '[]'::jsonb,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operational_risk_country
ON public.operational_risk_assessments(country_code, aggregate_risk_index DESC);

-- =====================================================
-- 3. Intervention outcome learning
-- =====================================================
CREATE TABLE IF NOT EXISTS public.intervention_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_id uuid REFERENCES public.intervention_recommendations(id) ON DELETE CASCADE,
  outcome_status text DEFAULT 'pending',
  outcome_effectiveness numeric DEFAULT 0,
  escalation_reduction numeric DEFAULT 0,
  economic_impact_reduction numeric DEFAULT 0,
  humanitarian_impact_reduction numeric DEFAULT 0,
  lessons_learned text,
  validated_by text,
  validation_evidence jsonb DEFAULT '[]'::jsonb,
  evaluated_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(intervention_id)
);

-- =====================================================
-- 4. Scenario simulation engine
-- =====================================================
CREATE TABLE IF NOT EXISTS public.scenario_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_key text UNIQUE NOT NULL,
  simulation_title text,
  simulation_type text,
  initiating_region text,
  initiating_category text,
  scenario_assumptions jsonb DEFAULT '[]'::jsonb,
  projected_cascade_effects jsonb DEFAULT '[]'::jsonb,
  projected_economic_impact numeric DEFAULT 0,
  projected_humanitarian_impact numeric DEFAULT 0,
  projected_geopolitical_impact numeric DEFAULT 0,
  probability_score numeric DEFAULT 0,
  confidence_score numeric DEFAULT 0,
  simulation_horizon_days integer DEFAULT 30,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scenario_simulation_type
ON public.scenario_simulations(simulation_type, probability_score DESC);

-- =====================================================
-- 5. Cross-agency coordination layer
-- =====================================================
CREATE TABLE IF NOT EXISTS public.coordination_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_key text UNIQUE NOT NULL,
  task_title text,
  task_category text,
  owning_agency text,
  supporting_agencies jsonb DEFAULT '[]'::jsonb,
  priority_band text DEFAULT 'monitor',
  operational_status text DEFAULT 'open',
  linked_signals jsonb DEFAULT '[]'::jsonb,
  linked_interventions jsonb DEFAULT '[]'::jsonb,
  execution_window_hours integer DEFAULT 72,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =====================================================
-- 6. Population stress monitoring
-- =====================================================
CREATE TABLE IF NOT EXISTS public.population_stress_indicators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text,
  region_name text,
  food_stress numeric DEFAULT 0,
  migration_pressure numeric DEFAULT 0,
  civil_unrest_pressure numeric DEFAULT 0,
  healthcare_stress numeric DEFAULT 0,
  infrastructure_stress numeric DEFAULT 0,
  environmental_stress numeric DEFAULT 0,
  aggregate_population_stress numeric DEFAULT 0,
  signal_sources jsonb DEFAULT '[]'::jsonb,
  calculated_at timestamptz DEFAULT now(),
  UNIQUE(country_code, region_name, calculated_at)
);

CREATE INDEX IF NOT EXISTS idx_population_stress
ON public.population_stress_indicators(aggregate_population_stress DESC);

-- =====================================================
-- 7. Strategic policy simulation engine
-- =====================================================
CREATE TABLE IF NOT EXISTS public.policy_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key text UNIQUE NOT NULL,
  policy_title text,
  policy_domain text,
  affected_regions jsonb DEFAULT '[]'::jsonb,
  baseline_conditions jsonb DEFAULT '{}'::jsonb,
  projected_outcomes jsonb DEFAULT '{}'::jsonb,
  best_case_projection jsonb DEFAULT '{}'::jsonb,
  worst_case_projection jsonb DEFAULT '{}'::jsonb,
  unintended_consequences jsonb DEFAULT '[]'::jsonb,
  recommendation_summary text,
  confidence_score numeric DEFAULT 0,
  generated_at timestamptz DEFAULT now()
);

-- =====================================================
-- 8. Government command views
-- =====================================================
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
  ora.generated_at
FROM public.operational_risk_assessments ora
ORDER BY ora.aggregate_risk_index DESC;

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
ORDER BY aggregate_population_stress DESC;

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
ORDER BY probability_score DESC;

-- =====================================================
-- 9. Operational risk generation engine
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_operational_risk_assessments(
  p_window interval DEFAULT interval '14 days'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  INSERT INTO public.operational_risk_assessments (
    assessment_key,
    country_code,
    sector,
    infrastructure_risk,
    economic_risk,
    social_risk,
    climate_risk,
    cyber_risk,
    geopolitical_risk,
    humanitarian_risk,
    aggregate_risk_index,
    confidence_score,
    supporting_signals,
    recommendations,
    generated_at
  )
  SELECT
    md5(COALESCE(c,'GLOBAL') || '|' || COALESCE(gs.category,'unknown')),
    COALESCE(c,'GLOBAL'),
    COALESCE(gs.category,'unknown'),
    ROUND(AVG(COALESCE(gs.impact_score,0))::numeric,2),
    ROUND(AVG(COALESCE(gs.predictive_priority,0))::numeric,2),
    ROUND(AVG(COALESCE(gs.urgency_score,0))::numeric,2),
    ROUND(AVG(CASE WHEN gs.category IN ('climate','weather','environment') THEN COALESCE(gs.impact_score,0) ELSE 0 END)::numeric,2),
    ROUND(AVG(CASE WHEN gs.category IN ('cybersecurity') THEN COALESCE(gs.impact_score,0) ELSE 0 END)::numeric,2),
    ROUND(AVG(CASE WHEN gs.category IN ('conflict','geopolitics') THEN COALESCE(gs.impact_score,0) ELSE 0 END)::numeric,2),
    ROUND(AVG(CASE WHEN gs.category IN ('health','migration','food-security') THEN COALESCE(gs.impact_score,0) ELSE 0 END)::numeric,2),
    ROUND((AVG(COALESCE(gs.impact_score,0)) + AVG(COALESCE(gs.predictive_priority,0)) + AVG(COALESCE(gs.confidence_score,0))) / 3::numeric,2),
    ROUND(AVG(COALESCE(gs.confidence_score,0))::numeric,2),
    jsonb_agg(gs.id),
    jsonb_build_array(
      'Increase monitoring',
      'Coordinate agencies',
      'Review escalation pathways'
    ),
    now()
  FROM public.global_signals gs
  CROSS JOIN LATERAL unnest(COALESCE(gs.affected_countries, ARRAY['GLOBAL'])) c
  WHERE COALESCE(gs.ingested_at,gs.created_at) >= now() - p_window
    AND COALESCE(gs.canonical_event_status,'canonical') = 'canonical'
  GROUP BY c, gs.category
  ON CONFLICT(assessment_key) DO UPDATE SET
    aggregate_risk_index = EXCLUDED.aggregate_risk_index,
    confidence_score = EXCLUDED.confidence_score,
    supporting_signals = EXCLUDED.supporting_signals,
    generated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('government-operational-risk','success','assessments=' || v_rows);

  RETURN jsonb_build_object('status','success','assessments',v_rows);
END;
$$;

INSERT INTO public.automation_logs(job_name,status,message)
VALUES (
  'government-operational-intelligence-foundation',
  'success',
  'critical infrastructure, operational risk, simulations, coordination, and intervention outcome learning initialized'
);
