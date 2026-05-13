-- Executive Planetary Dashboard Intelligence Layer
-- Converts AICIS from raw telemetry/intelligence tables into boardroom-ready operational intelligence.
-- Inspired by executive BI principles: KPI compression, global filters, interpretive insights, and action clarity.

-- =====================================================
-- 1. Dashboard filter presets
-- =====================================================
CREATE TABLE IF NOT EXISTS public.executive_dashboard_filter_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_key text UNIQUE NOT NULL,
  preset_name text NOT NULL,
  preset_description text,
  default_time_window text DEFAULT '24h',
  included_domains jsonb DEFAULT '[]'::jsonb,
  included_regions jsonb DEFAULT '[]'::jsonb,
  included_risk_bands jsonb DEFAULT '[]'::jsonb,
  included_source_tiers jsonb DEFAULT '[]'::jsonb,
  minimum_confidence numeric DEFAULT 50,
  minimum_relevance numeric DEFAULT 50,
  preset_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

INSERT INTO public.executive_dashboard_filter_presets (
  preset_key,
  preset_name,
  preset_description,
  default_time_window,
  included_domains,
  included_regions,
  included_risk_bands,
  included_source_tiers,
  minimum_confidence,
  minimum_relevance
)
VALUES
('global_executive_overview','Global Executive Overview','Boardroom-level overview across all global risk domains.','24h','["weather-climate","aviation-logistics","shipping-logistics","geophysical-disaster","climate-disaster","geopolitics","economy","cybersecurity","health"]'::jsonb,'["GLOBAL"]'::jsonb,'["critical","strategic","monitor"]'::jsonb,'["tier_1","tier_2","tier_3"]'::jsonb,50,55),
('government_crisis_room','Government Crisis Room','High-priority operational risks for public-sector coordination.','72h','["geopolitics","weather-climate","climate-disaster","geophysical-disaster","health","energy-infrastructure","shipping-logistics","aviation-logistics"]'::jsonb,'["GLOBAL"]'::jsonb,'["critical","strategic"]'::jsonb,'["tier_1","tier_2"]'::jsonb,65,70),
('supply_chain_watch','Global Supply Chain Watch','Ports, maritime, aviation, weather, energy, and geopolitical disruption view.','7d','["shipping-logistics","aviation-logistics","weather-climate","energy-infrastructure","geopolitics","economy"]'::jsonb,'["GLOBAL"]'::jsonb,'["critical","strategic","monitor"]'::jsonb,'["tier_1","tier_2"]'::jsonb,55,60),
('humanitarian_early_warning','Humanitarian Early Warning','Population stress, disaster, health, migration, food, and climate risk.','7d','["climate-disaster","weather-climate","geophysical-disaster","health","migration","food-security","conflict"]'::jsonb,'["GLOBAL"]'::jsonb,'["critical","strategic"]'::jsonb,'["tier_1","tier_2"]'::jsonb,60,65)
ON CONFLICT(preset_key) DO UPDATE SET
  preset_name = EXCLUDED.preset_name,
  preset_description = EXCLUDED.preset_description,
  included_domains = EXCLUDED.included_domains,
  included_risk_bands = EXCLUDED.included_risk_bands,
  included_source_tiers = EXCLUDED.included_source_tiers,
  minimum_confidence = EXCLUDED.minimum_confidence,
  minimum_relevance = EXCLUDED.minimum_relevance,
  updated_at = now();

-- =====================================================
-- 2. Executive KPI snapshots
-- =====================================================
CREATE TABLE IF NOT EXISTS public.executive_planetary_kpi_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_key text UNIQUE NOT NULL,
  preset_key text REFERENCES public.executive_dashboard_filter_presets(preset_key) ON DELETE SET NULL,
  time_window text DEFAULT '24h',
  global_risk_index numeric DEFAULT 0,
  telemetry_coverage_score numeric DEFAULT 0,
  active_critical_events integer DEFAULT 0,
  active_strategic_events integer DEFAULT 0,
  forecast_escalation_index numeric DEFAULT 0,
  institutional_trust_score numeric DEFAULT 0,
  evidence_quality_score numeric DEFAULT 0,
  analyst_queue_pressure integer DEFAULT 0,
  operational_response_pressure numeric DEFAULT 0,
  top_risk_domain text,
  top_risk_region text,
  kpi_payload jsonb DEFAULT '{}'::jsonb,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_kpi_snapshots_preset_time
ON public.executive_planetary_kpi_snapshots(preset_key, generated_at DESC);

-- =====================================================
-- 3. Dynamic executive insights
-- =====================================================
CREATE TABLE IF NOT EXISTS public.executive_dynamic_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_key text UNIQUE NOT NULL,
  preset_key text REFERENCES public.executive_dashboard_filter_presets(preset_key) ON DELETE SET NULL,
  insight_type text DEFAULT 'info',
  severity_band text DEFAULT 'monitor',
  insight_title text NOT NULL,
  insight_summary text NOT NULL,
  evidence_score numeric DEFAULT 0,
  confidence_score numeric DEFAULT 0,
  recommended_action text,
  linked_subject_type text,
  linked_subject_id uuid,
  display_rank integer DEFAULT 100,
  active boolean DEFAULT true,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_dynamic_insights_active_rank
ON public.executive_dynamic_insights(preset_key, active, display_rank, generated_at DESC);

-- =====================================================
-- 4. Executive chart data cache
-- =====================================================
CREATE TABLE IF NOT EXISTS public.executive_chart_data_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text UNIQUE NOT NULL,
  preset_key text REFERENCES public.executive_dashboard_filter_presets(preset_key) ON DELETE SET NULL,
  chart_type text NOT NULL,
  chart_title text NOT NULL,
  chart_description text,
  data_payload jsonb DEFAULT '[]'::jsonb,
  config_payload jsonb DEFAULT '{}'::jsonb,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_chart_cache_preset
ON public.executive_chart_data_cache(preset_key, chart_type, generated_at DESC);

-- =====================================================
-- 5. Executive action register
-- =====================================================
CREATE TABLE IF NOT EXISTS public.executive_action_register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_key text UNIQUE NOT NULL,
  action_title text NOT NULL,
  action_summary text,
  action_domain text,
  target_region text,
  urgency_band text DEFAULT 'monitor',
  owner_type text DEFAULT 'unassigned',
  action_status text DEFAULT 'recommended',
  expected_effectiveness numeric DEFAULT 0,
  evidence_quality_score numeric DEFAULT 0,
  linked_insight_id uuid REFERENCES public.executive_dynamic_insights(id) ON DELETE SET NULL,
  linked_intervention_id uuid REFERENCES public.intervention_recommendations(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_action_register_priority
ON public.executive_action_register(urgency_band, action_status, expected_effectiveness DESC);

-- =====================================================
-- 6. Generate executive KPI snapshot
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_executive_planetary_kpis(
  p_preset_key text DEFAULT 'global_executive_overview',
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_global_risk numeric := 0;
  v_coverage numeric := 0;
  v_critical integer := 0;
  v_strategic integer := 0;
  v_escalation numeric := 0;
  v_trust numeric := 0;
  v_evidence numeric := 0;
  v_queue integer := 0;
  v_response numeric := 0;
  v_top_domain text := 'unknown';
  v_top_region text := 'GLOBAL';
  v_key text;
BEGIN
  SELECT COALESCE(ROUND(AVG(COALESCE(impact_score,0))::numeric,2),0)
  INTO v_global_risk
  FROM public.global_signals
  WHERE COALESCE(ingested_at,created_at) >= now() - p_window
    AND COALESCE(canonical_event_status,'canonical') = 'canonical';

  SELECT COALESCE(ROUND(AVG(activation_percent)::numeric,2),0)
  INTO v_coverage
  FROM public.global_telemetry_coverage_command_view;

  SELECT COUNT(*) FILTER (WHERE COALESCE(impact_score,0) >= 85 OR COALESCE(urgency_score,0) >= 85),
         COUNT(*) FILTER (WHERE COALESCE(impact_score,0) >= 70 OR COALESCE(urgency_score,0) >= 70)
  INTO v_critical, v_strategic
  FROM public.global_signals
  WHERE COALESCE(ingested_at,created_at) >= now() - p_window
    AND COALESCE(canonical_event_status,'canonical') = 'canonical';

  SELECT COALESCE(ROUND(AVG(COALESCE(forecast_probability,0))::numeric,2),0)
  INTO v_escalation
  FROM public.predictive_forecasts
  WHERE created_at >= now() - p_window
    AND status = 'active';

  SELECT COALESCE(intelligence_accuracy_score,0), COALESCE(evidence_quality_score,0)
  INTO v_trust, v_evidence
  FROM public.institutional_trust_scorecards
  ORDER BY generated_at DESC
  LIMIT 1;

  SELECT COUNT(*)
  INTO v_queue
  FROM public.analyst_review_queue
  WHERE review_status = 'open';

  SELECT COALESCE(ROUND(AVG(COALESCE(expected_effectiveness,0))::numeric,2),0)
  INTO v_response
  FROM public.intervention_recommendations
  WHERE created_at >= now() - p_window;

  SELECT COALESCE(category,'unknown')
  INTO v_top_domain
  FROM public.global_signals
  WHERE COALESCE(ingested_at,created_at) >= now() - p_window
    AND COALESCE(canonical_event_status,'canonical') = 'canonical'
  GROUP BY category
  ORDER BY AVG(COALESCE(impact_score,0)) DESC NULLS LAST, COUNT(*) DESC
  LIMIT 1;

  SELECT COALESCE(unnest_country,'GLOBAL')
  INTO v_top_region
  FROM (
    SELECT unnest(COALESCE(affected_countries, ARRAY['GLOBAL'])) AS unnest_country,
           AVG(COALESCE(impact_score,0)) AS avg_impact,
           COUNT(*) AS ct
    FROM public.global_signals
    WHERE COALESCE(ingested_at,created_at) >= now() - p_window
      AND COALESCE(canonical_event_status,'canonical') = 'canonical'
    GROUP BY 1
    ORDER BY avg_impact DESC, ct DESC
    LIMIT 1
  ) x;

  v_key := md5(p_preset_key || '|' || p_window::text || '|' || date_trunc('hour',now())::text);

  INSERT INTO public.executive_planetary_kpi_snapshots (
    snapshot_key,
    preset_key,
    time_window,
    global_risk_index,
    telemetry_coverage_score,
    active_critical_events,
    active_strategic_events,
    forecast_escalation_index,
    institutional_trust_score,
    evidence_quality_score,
    analyst_queue_pressure,
    operational_response_pressure,
    top_risk_domain,
    top_risk_region,
    kpi_payload,
    generated_at
  ) VALUES (
    v_key,
    p_preset_key,
    p_window::text,
    v_global_risk,
    v_coverage,
    v_critical,
    v_strategic,
    v_escalation,
    v_trust,
    v_evidence,
    v_queue,
    v_response,
    v_top_domain,
    v_top_region,
    jsonb_build_object(
      'interpretation', CASE
        WHEN v_global_risk >= 80 THEN 'critical global risk posture'
        WHEN v_global_risk >= 65 THEN 'strategic global risk posture'
        ELSE 'monitoring posture'
      END,
      'generated_by','generate_executive_planetary_kpis'
    ),
    now()
  )
  ON CONFLICT(snapshot_key) DO UPDATE SET
    global_risk_index = EXCLUDED.global_risk_index,
    telemetry_coverage_score = EXCLUDED.telemetry_coverage_score,
    active_critical_events = EXCLUDED.active_critical_events,
    active_strategic_events = EXCLUDED.active_strategic_events,
    forecast_escalation_index = EXCLUDED.forecast_escalation_index,
    institutional_trust_score = EXCLUDED.institutional_trust_score,
    evidence_quality_score = EXCLUDED.evidence_quality_score,
    analyst_queue_pressure = EXCLUDED.analyst_queue_pressure,
    operational_response_pressure = EXCLUDED.operational_response_pressure,
    top_risk_domain = EXCLUDED.top_risk_domain,
    top_risk_region = EXCLUDED.top_risk_region,
    kpi_payload = EXCLUDED.kpi_payload,
    generated_at = now();

  RETURN jsonb_build_object(
    'status','success',
    'global_risk_index',v_global_risk,
    'telemetry_coverage_score',v_coverage,
    'critical_events',v_critical,
    'strategic_events',v_strategic,
    'top_domain',v_top_domain,
    'top_region',v_top_region
  );
END;
$$;

-- =====================================================
-- 7. Generate dynamic executive insights
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_executive_dynamic_insights(
  p_preset_key text DEFAULT 'global_executive_overview',
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  UPDATE public.executive_dynamic_insights
  SET active = false
  WHERE preset_key = p_preset_key;

  INSERT INTO public.executive_dynamic_insights (
    insight_key,
    preset_key,
    insight_type,
    severity_band,
    insight_title,
    insight_summary,
    evidence_score,
    confidence_score,
    recommended_action,
    linked_subject_type,
    linked_subject_id,
    display_rank,
    active,
    generated_at
  )
  SELECT
    md5(p_preset_key || '|top-risk-domain|' || COALESCE(category,'unknown') || '|' || date_trunc('hour',now())::text),
    p_preset_key,
    CASE WHEN AVG(COALESCE(impact_score,0)) >= 80 THEN 'warning' ELSE 'info' END,
    CASE WHEN AVG(COALESCE(impact_score,0)) >= 80 THEN 'critical' WHEN AVG(COALESCE(impact_score,0)) >= 65 THEN 'strategic' ELSE 'monitor' END,
    CONCAT('Top risk domain: ', COALESCE(category,'unknown')),
    CONCAT(
      COALESCE(category,'unknown'),
      ' currently carries the highest average impact across the selected window, with ',
      COUNT(*),
      ' canonical signals and average impact ',
      ROUND(AVG(COALESCE(impact_score,0))::numeric,1),
      '.'
    ),
    ROUND(AVG(COALESCE(confidence_score,0))::numeric,2),
    ROUND(AVG(COALESCE(confidence_score,0))::numeric,2),
    'Prioritize executive review of this domain and compare against forecast escalation and operational recommendations.',
    'domain',
    NULL,
    1,
    true,
    now()
  FROM public.global_signals
  WHERE COALESCE(ingested_at,created_at) >= now() - p_window
    AND COALESCE(canonical_event_status,'canonical') = 'canonical'
  GROUP BY category
  ORDER BY AVG(COALESCE(impact_score,0)) DESC, COUNT(*) DESC
  LIMIT 1
  ON CONFLICT(insight_key) DO UPDATE SET
    insight_summary = EXCLUDED.insight_summary,
    evidence_score = EXCLUDED.evidence_score,
    confidence_score = EXCLUDED.confidence_score,
    active = true,
    generated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.executive_dynamic_insights (
    insight_key,
    preset_key,
    insight_type,
    severity_band,
    insight_title,
    insight_summary,
    evidence_score,
    confidence_score,
    recommended_action,
    linked_subject_type,
    linked_subject_id,
    display_rank,
    active,
    generated_at
  )
  SELECT
    md5(p_preset_key || '|telemetry-coverage|' || date_trunc('hour',now())::text),
    p_preset_key,
    CASE WHEN AVG(activation_percent) < 50 THEN 'warning' ELSE 'success' END,
    CASE WHEN AVG(activation_percent) < 50 THEN 'strategic' ELSE 'monitor' END,
    'Planetary telemetry coverage status',
    CONCAT(
      'Average active telemetry coverage is ',
      ROUND(AVG(activation_percent)::numeric,1),
      '%. Domains with low activation should be scheduled for shard execution to improve sensing completeness.'
    ),
    ROUND(AVG(activation_percent)::numeric,2),
    85,
    'Run global mesh ingestion shards until weather, aviation, and strategic domains reach acceptable coverage activation.',
    'telemetry_coverage',
    NULL,
    2,
    true,
    now()
  FROM public.global_telemetry_coverage_command_view
  ON CONFLICT(insight_key) DO UPDATE SET
    insight_summary = EXCLUDED.insight_summary,
    evidence_score = EXCLUDED.evidence_score,
    active = true,
    generated_at = now();

  INSERT INTO public.executive_dynamic_insights (
    insight_key,
    preset_key,
    insight_type,
    severity_band,
    insight_title,
    insight_summary,
    evidence_score,
    confidence_score,
    recommended_action,
    linked_subject_type,
    linked_subject_id,
    display_rank,
    active,
    generated_at
  )
  SELECT
    md5(p_preset_key || '|forecast-escalation|' || id::text),
    p_preset_key,
    CASE WHEN forecast_probability >= 80 THEN 'warning' ELSE 'info' END,
    CASE WHEN forecast_probability >= 80 THEN 'critical' WHEN forecast_probability >= 65 THEN 'strategic' ELSE 'monitor' END,
    'Highest escalation forecast',
    CONCAT(forecast_title, ' has forecast probability ', forecast_probability, ' and escalation risk ', escalation_risk, '.'),
    forecast_confidence,
    forecast_confidence,
    'Review forecast evidence, validate assumptions, and prepare scenario response options.',
    'predictive_forecast',
    id,
    3,
    true,
    now()
  FROM public.predictive_forecasts
  WHERE status = 'active'
  ORDER BY forecast_probability DESC, escalation_risk DESC
  LIMIT 1
  ON CONFLICT(insight_key) DO UPDATE SET
    insight_summary = EXCLUDED.insight_summary,
    evidence_score = EXCLUDED.evidence_score,
    confidence_score = EXCLUDED.confidence_score,
    active = true,
    generated_at = now();

  INSERT INTO public.executive_dynamic_insights (
    insight_key,
    preset_key,
    insight_type,
    severity_band,
    insight_title,
    insight_summary,
    evidence_score,
    confidence_score,
    recommended_action,
    linked_subject_type,
    linked_subject_id,
    display_rank,
    active,
    generated_at
  )
  SELECT
    md5(p_preset_key || '|analyst-pressure|' || date_trunc('hour',now())::text),
    p_preset_key,
    CASE WHEN COUNT(*) > 50 THEN 'warning' ELSE 'info' END,
    CASE WHEN COUNT(*) > 50 THEN 'strategic' ELSE 'monitor' END,
    'Analyst review pressure',
    CONCAT(COUNT(*), ' intelligence items are awaiting analyst review. Urgent/high priority items should be cleared before executive publication.'),
    70,
    80,
    'Assign open urgent and high-priority reviews to domain analysts.',
    'analyst_queue',
    NULL,
    4,
    true,
    now()
  FROM public.analyst_review_queue
  WHERE review_status = 'open'
  ON CONFLICT(insight_key) DO UPDATE SET
    insight_summary = EXCLUDED.insight_summary,
    active = true,
    generated_at = now();

  INSERT INTO public.executive_dynamic_insights (
    insight_key,
    preset_key,
    insight_type,
    severity_band,
    insight_title,
    insight_summary,
    evidence_score,
    confidence_score,
    recommended_action,
    linked_subject_type,
    linked_subject_id,
    display_rank,
    active,
    generated_at
  )
  SELECT
    md5(p_preset_key || '|top-action|' || id::text),
    p_preset_key,
    CASE WHEN urgency_band = 'critical' THEN 'warning' ELSE 'success' END,
    urgency_band,
    'Top recommended action',
    CONCAT(recommendation_title, ' Expected effectiveness: ', expected_effectiveness, ', confidence: ', confidence, '.'),
    confidence,
    confidence,
    recommendation_summary,
    'intervention_recommendation',
    id,
    5,
    true,
    now()
  FROM public.intervention_recommendations
  ORDER BY expected_effectiveness DESC, confidence DESC
  LIMIT 1
  ON CONFLICT(insight_key) DO UPDATE SET
    insight_summary = EXCLUDED.insight_summary,
    evidence_score = EXCLUDED.evidence_score,
    confidence_score = EXCLUDED.confidence_score,
    recommended_action = EXCLUDED.recommended_action,
    active = true,
    generated_at = now();

  RETURN jsonb_build_object('status','success','preset_key',p_preset_key,'insights_generated','up to 5');
END;
$$;

-- =====================================================
-- 8. Generate chart cache data
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_executive_chart_cache(
  p_preset_key text DEFAULT 'global_executive_overview',
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.executive_chart_data_cache(cache_key,preset_key,chart_type,chart_title,chart_description,data_payload,config_payload,generated_at)
  SELECT
    md5(p_preset_key || '|risk-by-domain|' || date_trunc('hour',now())::text),
    p_preset_key,
    'bar',
    'Risk by Domain',
    'Average impact, urgency, and signal count by intelligence domain.',
    jsonb_agg(jsonb_build_object('domain',category,'avg_impact',avg_impact,'avg_urgency',avg_urgency,'signal_count',ct) ORDER BY avg_impact DESC),
    jsonb_build_object('x','domain','y','avg_impact','color_rule','risk_band'),
    now()
  FROM (
    SELECT COALESCE(category,'unknown') AS category,
           ROUND(AVG(COALESCE(impact_score,0))::numeric,2) AS avg_impact,
           ROUND(AVG(COALESCE(urgency_score,0))::numeric,2) AS avg_urgency,
           COUNT(*) AS ct
    FROM public.global_signals
    WHERE COALESCE(ingested_at,created_at) >= now() - p_window
      AND COALESCE(canonical_event_status,'canonical') = 'canonical'
    GROUP BY 1
    ORDER BY avg_impact DESC
    LIMIT 15
  ) x
  ON CONFLICT(cache_key) DO UPDATE SET data_payload = EXCLUDED.data_payload, generated_at = now();

  INSERT INTO public.executive_chart_data_cache(cache_key,preset_key,chart_type,chart_title,chart_description,data_payload,config_payload,generated_at)
  SELECT
    md5(p_preset_key || '|telemetry-coverage|' || date_trunc('hour',now())::text),
    p_preset_key,
    'donut',
    'Telemetry Coverage by Domain',
    'Activation percentage and active cells across planetary telemetry domains.',
    jsonb_agg(jsonb_build_object('domain',coverage_domain,'activation_percent',activation_percent,'active_cells',active_cells,'activated_cells',activated_cells) ORDER BY coverage_domain),
    jsonb_build_object('label','coverage_domain','value','activation_percent'),
    now()
  FROM public.global_telemetry_coverage_command_view
  ON CONFLICT(cache_key) DO UPDATE SET data_payload = EXCLUDED.data_payload, generated_at = now();

  INSERT INTO public.executive_chart_data_cache(cache_key,preset_key,chart_type,chart_title,chart_description,data_payload,config_payload,generated_at)
  SELECT
    md5(p_preset_key || '|forecast-escalation|' || date_trunc('hour',now())::text),
    p_preset_key,
    'scatter',
    'Forecast Probability vs Expected Impact',
    'Each point represents an active forecast; high-probability high-impact items require executive review.',
    COALESCE(jsonb_agg(jsonb_build_object('title',forecast_title,'domain',forecast_domain,'probability',forecast_probability,'impact',expected_impact,'confidence',forecast_confidence) ORDER BY forecast_probability DESC),'[]'::jsonb),
    jsonb_build_object('x','forecast_probability','y','expected_impact','size','forecast_confidence'),
    now()
  FROM public.predictive_forecasts
  WHERE status = 'active'
  ON CONFLICT(cache_key) DO UPDATE SET data_payload = EXCLUDED.data_payload, generated_at = now();

  INSERT INTO public.executive_chart_data_cache(cache_key,preset_key,chart_type,chart_title,chart_description,data_payload,config_payload,generated_at)
  SELECT
    md5(p_preset_key || '|regional-risk|' || date_trunc('hour',now())::text),
    p_preset_key,
    'horizontal_bar',
    'Top Regions by Risk',
    'Highest-impact affected regions in the selected time window.',
    jsonb_agg(jsonb_build_object('region',region,'avg_impact',avg_impact,'signal_count',ct) ORDER BY avg_impact DESC),
    jsonb_build_object('x','avg_impact','y','region'),
    now()
  FROM (
    SELECT unnest(COALESCE(affected_countries,ARRAY['GLOBAL'])) AS region,
           ROUND(AVG(COALESCE(impact_score,0))::numeric,2) AS avg_impact,
           COUNT(*) AS ct
    FROM public.global_signals
    WHERE COALESCE(ingested_at,created_at) >= now() - p_window
      AND COALESCE(canonical_event_status,'canonical') = 'canonical'
    GROUP BY 1
    ORDER BY avg_impact DESC, ct DESC
    LIMIT 20
  ) x
  ON CONFLICT(cache_key) DO UPDATE SET data_payload = EXCLUDED.data_payload, generated_at = now();

  RETURN jsonb_build_object('status','success','preset_key',p_preset_key,'charts_generated',4);
END;
$$;

-- =====================================================
-- 9. Promote top insight actions into action register
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_executive_action_register(
  p_preset_key text DEFAULT 'global_executive_overview'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  INSERT INTO public.executive_action_register (
    action_key,
    action_title,
    action_summary,
    action_domain,
    target_region,
    urgency_band,
    owner_type,
    action_status,
    expected_effectiveness,
    evidence_quality_score,
    linked_insight_id,
    created_at,
    updated_at
  )
  SELECT
    md5('exec-action|' || i.id::text),
    COALESCE(i.recommended_action, i.insight_title),
    i.insight_summary,
    i.linked_subject_type,
    'GLOBAL',
    i.severity_band,
    'executive-owner',
    'recommended',
    i.confidence_score,
    i.evidence_score,
    i.id,
    now(),
    now()
  FROM public.executive_dynamic_insights i
  WHERE i.preset_key = p_preset_key
    AND i.active = true
    AND i.severity_band IN ('critical','strategic')
  ON CONFLICT(action_key) DO UPDATE SET
    action_summary = EXCLUDED.action_summary,
    urgency_band = EXCLUDED.urgency_band,
    expected_effectiveness = EXCLUDED.expected_effectiveness,
    evidence_quality_score = EXCLUDED.evidence_quality_score,
    updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('status','success','actions_upserted',v_rows);
END;
$$;

-- =====================================================
-- 10. Command views for UI
-- =====================================================
CREATE OR REPLACE VIEW public.executive_planetary_dashboard_kpis_view AS
SELECT DISTINCT ON (preset_key)
  preset_key,
  time_window,
  global_risk_index,
  telemetry_coverage_score,
  active_critical_events,
  active_strategic_events,
  forecast_escalation_index,
  institutional_trust_score,
  evidence_quality_score,
  analyst_queue_pressure,
  operational_response_pressure,
  top_risk_domain,
  top_risk_region,
  generated_at
FROM public.executive_planetary_kpi_snapshots
ORDER BY preset_key, generated_at DESC;

CREATE OR REPLACE VIEW public.executive_planetary_insights_view AS
SELECT
  preset_key,
  insight_type,
  severity_band,
  insight_title,
  insight_summary,
  evidence_score,
  confidence_score,
  recommended_action,
  display_rank,
  generated_at
FROM public.executive_dynamic_insights
WHERE active = true
ORDER BY preset_key, display_rank ASC, generated_at DESC;

CREATE OR REPLACE VIEW public.executive_planetary_charts_view AS
SELECT DISTINCT ON (preset_key, chart_type)
  preset_key,
  chart_type,
  chart_title,
  chart_description,
  data_payload,
  config_payload,
  generated_at
FROM public.executive_chart_data_cache
ORDER BY preset_key, chart_type, generated_at DESC;

CREATE OR REPLACE VIEW public.executive_action_register_view AS
SELECT
  action_title,
  action_summary,
  action_domain,
  target_region,
  urgency_band,
  owner_type,
  action_status,
  expected_effectiveness,
  evidence_quality_score,
  created_at,
  updated_at
FROM public.executive_action_register
ORDER BY
  CASE urgency_band WHEN 'critical' THEN 1 WHEN 'strategic' THEN 2 WHEN 'monitor' THEN 3 ELSE 4 END,
  expected_effectiveness DESC;

-- =====================================================
-- 11. Executive dashboard cycle
-- =====================================================
CREATE OR REPLACE FUNCTION public.run_executive_dashboard_cycle(
  p_preset_key text DEFAULT 'global_executive_overview',
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r1 jsonb;
  r2 jsonb;
  r3 jsonb;
  r4 jsonb;
BEGIN
  r1 := public.generate_executive_planetary_kpis(p_preset_key,p_window);
  r2 := public.generate_executive_dynamic_insights(p_preset_key,p_window);
  r3 := public.generate_executive_chart_cache(p_preset_key,p_window);
  r4 := public.generate_executive_action_register(p_preset_key);

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('executive-dashboard-cycle','success','preset=' || p_preset_key);

  RETURN jsonb_build_object(
    'status','success',
    'preset_key',p_preset_key,
    'kpis',r1,
    'insights',r2,
    'charts',r3,
    'actions',r4
  );
END;
$$;

INSERT INTO public.automation_logs(job_name,status,message)
VALUES (
  'executive-planetary-dashboard-layer',
  'success',
  'executive dashboard KPI snapshots, filter presets, dynamic insights, chart cache, and action register initialized'
);
