-- Planetary Memory + Civilization Learning Layer
-- Adds long-horizon memory, historical analog reasoning, resilience scoring,
-- adaptive learning, and memory-informed forecasting.

-- =====================================================
-- 1. Planetary memory ledger
-- =====================================================
CREATE TABLE IF NOT EXISTS public.planetary_memory_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_key text UNIQUE NOT NULL,
  memory_type text NOT NULL,
  source_domain text,
  source_region text DEFAULT 'GLOBAL',
  event_title text,
  event_summary text,
  event_timespan text,
  historical_significance_score numeric DEFAULT 50,
  recurrence_probability numeric DEFAULT 0,
  systemic_impact_score numeric DEFAULT 0,
  resilience_outcome_score numeric DEFAULT 0,
  coordination_effectiveness_score numeric DEFAULT 0,
  lessons_learned jsonb DEFAULT '[]'::jsonb,
  causal_patterns jsonb DEFAULT '[]'::jsonb,
  intervention_patterns jsonb DEFAULT '[]'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planetary_memory_domain_region
ON public.planetary_memory_ledger(source_domain, source_region, historical_significance_score DESC);

-- =====================================================
-- 2. Historical analog graph
-- =====================================================
CREATE TABLE IF NOT EXISTS public.historical_analog_graph (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analog_key text UNIQUE NOT NULL,
  current_event_reference text,
  historical_memory_id uuid REFERENCES public.planetary_memory_ledger(id) ON DELETE CASCADE,
  similarity_score numeric DEFAULT 0,
  propagation_similarity numeric DEFAULT 0,
  intervention_similarity numeric DEFAULT 0,
  resilience_similarity numeric DEFAULT 0,
  analog_summary text,
  recommended_historical_lessons jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_historical_analog_similarity
ON public.historical_analog_graph(similarity_score DESC, propagation_similarity DESC);

-- =====================================================
-- 3. Civilization resilience profiles
-- =====================================================
CREATE TABLE IF NOT EXISTS public.civilization_resilience_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_key text UNIQUE NOT NULL,
  region_code text,
  civilization_domain text,
  infrastructure_resilience numeric DEFAULT 50,
  humanitarian_resilience numeric DEFAULT 50,
  economic_resilience numeric DEFAULT 50,
  governance_resilience numeric DEFAULT 50,
  climate_resilience numeric DEFAULT 50,
  cyber_resilience numeric DEFAULT 50,
  coordination_capacity numeric DEFAULT 50,
  adaptive_learning_score numeric DEFAULT 50,
  overall_resilience_score numeric DEFAULT 50,
  risk_outlook text DEFAULT 'moderate',
  vulnerability_factors jsonb DEFAULT '[]'::jsonb,
  strategic_strengths jsonb DEFAULT '[]'::jsonb,
  recommended_reinforcements jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resilience_profiles_region
ON public.civilization_resilience_profiles(region_code, overall_resilience_score DESC);

-- =====================================================
-- 4. Cross-crisis learning ledger
-- =====================================================
CREATE TABLE IF NOT EXISTS public.cross_crisis_learning_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_key text UNIQUE NOT NULL,
  learning_category text,
  trigger_pattern text,
  observed_outcome text,
  intervention_outcome text,
  coordination_outcome text,
  systemic_lesson text,
  confidence_score numeric DEFAULT 0,
  recurrence_weight numeric DEFAULT 0,
  strategic_recommendations jsonb DEFAULT '[]'::jsonb,
  source_memory_ids jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- =====================================================
-- 5. Memory-informed forecasting layer
-- =====================================================
CREATE TABLE IF NOT EXISTS public.memory_informed_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_key text UNIQUE NOT NULL,
  source_event text,
  source_domain text,
  source_region text,
  historical_analog_count integer DEFAULT 0,
  projected_risk_trend text,
  projected_resilience_trend text,
  projected_coordination_outcome text,
  forecast_confidence numeric DEFAULT 0,
  historical_basis_score numeric DEFAULT 0,
  forecast_summary text,
  supporting_memory_patterns jsonb DEFAULT '[]'::jsonb,
  recommended_actions jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_forecast_domain
ON public.memory_informed_forecasts(source_domain, forecast_confidence DESC);

-- =====================================================
-- 6. Seed memory records
-- =====================================================
INSERT INTO public.planetary_memory_ledger(
  memory_key,memory_type,source_domain,source_region,event_title,event_summary,
  historical_significance_score,recurrence_probability,systemic_impact_score,
  resilience_outcome_score,coordination_effectiveness_score,lessons_learned,causal_patterns,intervention_patterns
)
VALUES
(
  'global-food-chain-disruption-pattern',
  'systemic_pattern',
  'food',
  'GLOBAL',
  'Global Food Chain Disruption Pattern',
  'Historical pattern of supply disruption leading to inflation, migration pressure, and humanitarian instability.',
  90,85,88,55,62,
  jsonb_build_array('early logistics coordination reduces escalation','regional reserves improve resilience'),
  jsonb_build_array('supply disruption -> inflation -> migration pressure'),
  jsonb_build_array('food relief coordination','logistics rerouting')
),
(
  'climate-disaster-escalation-pattern',
  'climate_pattern',
  'climate',
  'GLOBAL',
  'Climate Disaster Escalation Pattern',
  'Escalating climate events amplify humanitarian and infrastructure instability.',
  92,88,91,48,58,
  jsonb_build_array('predeployment improves humanitarian outcomes','cross-border coordination reduces delay'),
  jsonb_build_array('extreme weather -> infrastructure disruption -> humanitarian stress'),
  jsonb_build_array('predeployment','evacuation coordination')
)
ON CONFLICT(memory_key) DO UPDATE SET
  historical_significance_score = EXCLUDED.historical_significance_score,
  updated_at = now();

-- =====================================================
-- 7. Historical analog generation
-- =====================================================
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
DECLARE
  mem record;
  v_similarity numeric;
  v_count integer := 0;
BEGIN
  FOR mem IN
    SELECT *
    FROM public.planetary_memory_ledger
    WHERE source_domain = p_source_domain
    ORDER BY historical_significance_score DESC
    LIMIT 25
  LOOP
    v_similarity := ROUND(
      (
        (COALESCE(mem.recurrence_probability,50) * 0.35)
      + (COALESCE(mem.systemic_impact_score,50) * 0.35)
      + (COALESCE(mem.coordination_effectiveness_score,50) * 0.30)
      )::numeric / 1.0,
      2
    );

    INSERT INTO public.historical_analog_graph(
      analog_key,
      current_event_reference,
      historical_memory_id,
      similarity_score,
      propagation_similarity,
      intervention_similarity,
      resilience_similarity,
      analog_summary,
      recommended_historical_lessons,
      created_at
    ) VALUES (
      md5(p_source_event || '|' || mem.memory_key),
      p_source_event,
      mem.id,
      v_similarity,
      COALESCE(mem.systemic_impact_score,50),
      COALESCE(mem.coordination_effectiveness_score,50),
      COALESCE(mem.resilience_outcome_score,50),
      mem.event_summary,
      mem.lessons_learned,
      now()
    )
    ON CONFLICT(analog_key) DO UPDATE SET
      similarity_score = EXCLUDED.similarity_score,
      created_at = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('status','success','analogs_generated',v_count);
END;
$$;

-- =====================================================
-- 8. Resilience scoring engine
-- =====================================================
CREATE OR REPLACE FUNCTION public.calculate_civilization_resilience(
  p_region_code text,
  p_domain text DEFAULT 'general'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_infra numeric := 50;
  v_human numeric := 50;
  v_econ numeric := 50;
  v_gov numeric := 50;
  v_climate numeric := 50;
  v_cyber numeric := 50;
  v_coord numeric := 50;
  v_learning numeric := 50;
  v_overall numeric := 50;
BEGIN
  SELECT
    LEAST(100, GREATEST(0, 70 - COUNT(*) FILTER (WHERE source_domain='energy') * 2)),
    LEAST(100, GREATEST(0, 70 - COUNT(*) FILTER (WHERE source_domain='health') * 2)),
    LEAST(100, GREATEST(0, 70 - COUNT(*) FILTER (WHERE source_domain='economy') * 2)),
    LEAST(100, GREATEST(0, 70 - COUNT(*) FILTER (WHERE source_domain='governance') * 2)),
    LEAST(100, GREATEST(0, 70 - COUNT(*) FILTER (WHERE source_domain='climate') * 2)),
    LEAST(100, GREATEST(0, 70 - COUNT(*) FILTER (WHERE source_domain='cyber') * 2))
  INTO v_infra,v_human,v_econ,v_gov,v_climate,v_cyber
  FROM public.planetary_propagation_events
  WHERE source_region = p_region_code
    AND generated_at >= now() - interval '180 days';

  v_coord := ROUND(((v_infra + v_human + v_gov)/3.0)::numeric,2);
  v_learning := ROUND(((v_coord + v_climate + v_cyber)/3.0)::numeric,2);

  v_overall := ROUND(((
    v_infra + v_human + v_econ + v_gov + v_climate + v_cyber + v_coord + v_learning
  ) / 8.0)::numeric,2);

  INSERT INTO public.civilization_resilience_profiles(
    profile_key,
    region_code,
    civilization_domain,
    infrastructure_resilience,
    humanitarian_resilience,
    economic_resilience,
    governance_resilience,
    climate_resilience,
    cyber_resilience,
    coordination_capacity,
    adaptive_learning_score,
    overall_resilience_score,
    risk_outlook,
    vulnerability_factors,
    strategic_strengths,
    recommended_reinforcements,
    created_at,
    updated_at
  ) VALUES (
    md5(p_region_code || '|' || p_domain),
    p_region_code,
    p_domain,
    v_infra,
    v_human,
    v_econ,
    v_gov,
    v_climate,
    v_cyber,
    v_coord,
    v_learning,
    v_overall,
    CASE WHEN v_overall >= 75 THEN 'stable' WHEN v_overall >= 55 THEN 'moderate' ELSE 'fragile' END,
    jsonb_build_array('systemic disruption exposure','cross-domain propagation risk'),
    jsonb_build_array('adaptive coordination','operational learning'),
    jsonb_build_array('improve infrastructure redundancy','strengthen regional coordination'),
    now(),
    now()
  )
  ON CONFLICT(profile_key) DO UPDATE SET
    infrastructure_resilience = EXCLUDED.infrastructure_resilience,
    humanitarian_resilience = EXCLUDED.humanitarian_resilience,
    economic_resilience = EXCLUDED.economic_resilience,
    governance_resilience = EXCLUDED.governance_resilience,
    climate_resilience = EXCLUDED.climate_resilience,
    cyber_resilience = EXCLUDED.cyber_resilience,
    coordination_capacity = EXCLUDED.coordination_capacity,
    adaptive_learning_score = EXCLUDED.adaptive_learning_score,
    overall_resilience_score = EXCLUDED.overall_resilience_score,
    risk_outlook = EXCLUDED.risk_outlook,
    updated_at = now();

  RETURN jsonb_build_object('status','success','overall_resilience_score',v_overall,'risk_outlook',CASE WHEN v_overall >= 75 THEN 'stable' WHEN v_overall >= 55 THEN 'moderate' ELSE 'fragile' END);
END;
$$;

-- =====================================================
-- 9. Memory-informed forecasting
-- =====================================================
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
DECLARE
  v_analog_count integer := 0;
  v_avg_similarity numeric := 0;
  v_forecast_confidence numeric := 0;
  v_key text;
BEGIN
  PERFORM public.generate_historical_analogs(p_source_event,p_source_domain,p_source_region);

  SELECT COUNT(*), COALESCE(AVG(similarity_score),0)
  INTO v_analog_count, v_avg_similarity
  FROM public.historical_analog_graph
  WHERE current_event_reference = p_source_event;

  v_forecast_confidence := ROUND(
    LEAST(100, (v_avg_similarity * 0.75) + (LEAST(v_analog_count,10) * 2.5))::numeric,
    2
  );

  v_key := md5(p_source_event || '|' || p_source_domain || '|forecast');

  INSERT INTO public.memory_informed_forecasts(
    forecast_key,
    source_event,
    source_domain,
    source_region,
    historical_analog_count,
    projected_risk_trend,
    projected_resilience_trend,
    projected_coordination_outcome,
    forecast_confidence,
    historical_basis_score,
    forecast_summary,
    supporting_memory_patterns,
    recommended_actions,
    created_at
  ) VALUES (
    v_key,
    p_source_event,
    p_source_domain,
    p_source_region,
    v_analog_count,
    CASE WHEN v_avg_similarity >= 75 THEN 'elevated_risk' WHEN v_avg_similarity >= 55 THEN 'moderate_risk' ELSE 'contained_risk' END,
    CASE WHEN v_avg_similarity >= 75 THEN 'fragile_pressure' ELSE 'manageable_pressure' END,
    CASE WHEN v_forecast_confidence >= 80 THEN 'strong_coordination_required' ELSE 'regional_monitoring_recommended' END,
    v_forecast_confidence,
    v_avg_similarity,
    'Forecast generated from historical analog and planetary memory analysis.',
    jsonb_build_array('historical propagation similarity','cross-crisis learning'),
    jsonb_build_array('increase monitoring','activate mitigation preparation','evaluate regional resilience'),
    now()
  )
  ON CONFLICT(forecast_key) DO UPDATE SET
    forecast_confidence = EXCLUDED.forecast_confidence,
    historical_basis_score = EXCLUDED.historical_basis_score,
    created_at = now();

  RETURN jsonb_build_object(
    'status','success',
    'historical_analog_count',v_analog_count,
    'forecast_confidence',v_forecast_confidence
  );
END;
$$;

-- =====================================================
-- 10. Autonomous civilization learning cycle
-- =====================================================
CREATE OR REPLACE FUNCTION public.run_civilization_learning_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  v_forecasts integer := 0;
  v_resilience integer := 0;
BEGIN
  FOR rec IN
    SELECT DISTINCT source_event, source_domain, source_region
    FROM public.planetary_propagation_events
    WHERE generated_at >= now() - interval '7 days'
      AND impact_severity >= 55
    LIMIT 50
  LOOP
    PERFORM public.generate_memory_informed_forecast(rec.source_event, rec.source_domain, rec.source_region);
    v_forecasts := v_forecasts + 1;
  END LOOP;

  FOR rec IN
    SELECT DISTINCT source_region
    FROM public.planetary_propagation_events
    WHERE source_region IS NOT NULL
      AND generated_at >= now() - interval '180 days'
    LIMIT 50
  LOOP
    PERFORM public.calculate_civilization_resilience(rec.source_region,'general');
    v_resilience := v_resilience + 1;
  END LOOP;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES (
    'civilization-learning-cycle',
    'success',
    'forecasts=' || v_forecasts || ', resilience_profiles=' || v_resilience
  );

  RETURN jsonb_build_object(
    'status','success',
    'forecasts_generated',v_forecasts,
    'resilience_profiles_generated',v_resilience
  );
END;
$$;

-- =====================================================
-- 11. Command views
-- =====================================================
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
  created_at
FROM public.planetary_memory_ledger
ORDER BY historical_significance_score DESC;

CREATE OR REPLACE VIEW public.historical_analog_command_view AS
SELECT
  current_event_reference,
  similarity_score,
  propagation_similarity,
  intervention_similarity,
  resilience_similarity,
  analog_summary,
  created_at
FROM public.historical_analog_graph
ORDER BY similarity_score DESC, created_at DESC;

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
  updated_at
FROM public.civilization_resilience_profiles
ORDER BY overall_resilience_score DESC;

CREATE OR REPLACE VIEW public.memory_forecast_command_view AS
SELECT
  source_event,
  source_domain,
  source_region,
  historical_analog_count,
  projected_risk_trend,
  forecast_confidence,
  projected_coordination_outcome,
  created_at
FROM public.memory_informed_forecasts
ORDER BY forecast_confidence DESC, created_at DESC;

INSERT INTO public.automation_logs(job_name,status,message)
VALUES (
  'planetary-memory-and-civilization-learning',
  'success',
  'planetary memory, resilience scoring, historical analogs, and civilization learning initialized'
);
