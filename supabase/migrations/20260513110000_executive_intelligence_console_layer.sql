-- Executive Intelligence Console Layer
-- Implements dashboard lessons for AICIS: KPI summary, global filters,
-- automated insights, boardroom-ready intelligence cards, and decision clarity.

-- =====================================================
-- 1. Executive console profiles / saved filters
-- =====================================================
CREATE TABLE IF NOT EXISTS public.executive_console_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_key text UNIQUE NOT NULL,
  profile_name text NOT NULL,
  audience_type text DEFAULT 'executive',
  default_time_window text DEFAULT '24h',
  default_regions jsonb DEFAULT '[]'::jsonb,
  default_domains jsonb DEFAULT '[]'::jsonb,
  default_risk_bands jsonb DEFAULT '[]'::jsonb,
  default_source_tiers jsonb DEFAULT '[]'::jsonb,
  minimum_confidence numeric DEFAULT 50,
  minimum_relevance numeric DEFAULT 50,
  layout_config jsonb DEFAULT '{}'::jsonb,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =====================================================
-- 2. Executive KPI snapshots
-- =====================================================
CREATE TABLE IF NOT EXISTS public.executive_kpi_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_key text UNIQUE NOT NULL,
  profile_key text REFERENCES public.executive_console_profiles(profile_key) ON DELETE SET NULL,
  time_window text DEFAULT '24h',
  total_signals integer DEFAULT 0,
  high_priority_signals integer DEFAULT 0,
  active_narratives integer DEFAULT 0,
  active_forecasts integer DEFAULT 0,
  critical_anomalies integer DEFAULT 0,
  telemetry_connectors_active integer DEFAULT 0,
  telemetry_connectors_degraded integer DEFAULT 0,
  global_risk_index numeric DEFAULT 0,
  evidence_quality_index numeric DEFAULT 0,
  forecast_validation_rate numeric DEFAULT 0,
  analyst_review_backlog integer DEFAULT 0,
  institutional_readiness_grade text DEFAULT 'ungraded',
  trend_direction text DEFAULT 'stable',
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_kpi_snapshots_profile_time
ON public.executive_kpi_snapshots(profile_key, generated_at DESC);

-- =====================================================
-- 3. Automated executive insight cards
-- =====================================================
CREATE TABLE IF NOT EXISTS public.executive_insight_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_key text UNIQUE NOT NULL,
  profile_key text REFERENCES public.executive_console_profiles(profile_key) ON DELETE SET NULL,
  insight_type text NOT NULL,
  severity text DEFAULT 'info',
  icon_hint text DEFAULT 'info',
  title text NOT NULL,
  insight_text text NOT NULL,
  evidence_subject_type text,
  evidence_subject_id uuid,
  affected_regions jsonb DEFAULT '[]'::jsonb,
  affected_domains jsonb DEFAULT '[]'::jsonb,
  confidence_score numeric DEFAULT 0,
  action_recommendation text,
  sort_rank integer DEFAULT 100,
  expires_at timestamptz,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_insight_cards_profile_rank
ON public.executive_insight_cards(profile_key, sort_rank, generated_at DESC);

-- =====================================================
-- 4. Executive chart dataset registry
-- =====================================================
CREATE TABLE IF NOT EXISTS public.executive_chart_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_key text UNIQUE NOT NULL,
  profile_key text REFERENCES public.executive_console_profiles(profile_key) ON DELETE SET NULL,
  chart_type text NOT NULL,
  chart_title text NOT NULL,
  chart_description text,
  data_payload jsonb DEFAULT '{}'::jsonb,
  filter_context jsonb DEFAULT '{}'::jsonb,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_chart_datasets_profile
ON public.executive_chart_datasets(profile_key, generated_at DESC);

-- =====================================================
-- 5. Decision clarity scorecards
-- =====================================================
CREATE TABLE IF NOT EXISTS public.decision_clarity_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scorecard_key text UNIQUE NOT NULL,
  profile_key text REFERENCES public.executive_console_profiles(profile_key) ON DELETE SET NULL,
  signal_to_noise_score numeric DEFAULT 0,
  interpretability_score numeric DEFAULT 0,
  actionability_score numeric DEFAULT 0,
  evidence_score numeric DEFAULT 0,
  timeliness_score numeric DEFAULT 0,
  overall_clarity_score numeric DEFAULT 0,
  clarity_grade text DEFAULT 'ungraded',
  improvement_recommendations jsonb DEFAULT '[]'::jsonb,
  generated_at timestamptz DEFAULT now()
);

-- =====================================================
-- 6. Seed executive profiles
-- =====================================================
INSERT INTO public.executive_console_profiles (
  profile_key,
  profile_name,
  audience_type,
  default_time_window,
  default_regions,
  default_domains,
  default_risk_bands,
  default_source_tiers,
  minimum_confidence,
  minimum_relevance,
  layout_config
)
VALUES
(
  'global_executive_console',
  'Global Executive Command Console',
  'ceo_cabinet_board',
  '24h',
  '[]'::jsonb,
  jsonb_build_array('conflict','climate-disaster','shipping-logistics','aviation-logistics','energy','public-health','economy'),
  jsonb_build_array('critical','strategic','monitor'),
  jsonb_build_array('tier_1','tier_2'),
  55,
  60,
  jsonb_build_object(
    'kpi_cards',5,
    'chart_grid','3x4',
    'insights_position','right_sidebar',
    'theme','deep_navy_white_teal_amber_red'
  )
),
(
  'government_crisis_console',
  'Government Crisis Coordination Console',
  'government_operations',
  '24h',
  '[]'::jsonb,
  jsonb_build_array('conflict','climate-disaster','migration','food-security','public-health','energy','cybersecurity'),
  jsonb_build_array('critical','strategic'),
  jsonb_build_array('tier_1','tier_2'),
  60,
  65,
  jsonb_build_object(
    'kpi_cards',7,
    'chart_grid','war_room',
    'insights_position','top_priority',
    'theme','government_command'
  )
)
ON CONFLICT(profile_key) DO UPDATE SET
  profile_name = EXCLUDED.profile_name,
  default_domains = EXCLUDED.default_domains,
  layout_config = EXCLUDED.layout_config,
  updated_at = now();

-- =====================================================
-- 7. Filtered executive signal view
-- =====================================================
CREATE OR REPLACE VIEW public.executive_filtered_signal_view AS
SELECT
  gs.id,
  COALESCE(gs.translated_title, gs.title) AS title,
  gs.category,
  gs.affected_countries,
  gs.source_trust_tier,
  gs.urgency_score,
  gs.impact_score,
  gs.confidence_score,
  gs.predictive_priority,
  gs.anomaly_score,
  COALESCE(asr.adaptive_relevance_score, css.commercial_relevance_score, gs.impact_score, 0) AS executive_relevance_score,
  COALESCE(rts.inherited_trust_score, gs.confidence_score, 0) AS recursive_trust_score,
  COALESCE(iep.evidence_quality_score, 0) AS evidence_quality_score,
  gs.ingested_at,
  gs.created_at
FROM public.global_signals gs
LEFT JOIN public.adaptive_signal_rankings asr
  ON asr.signal_id = gs.id
 AND asr.profile_key = 'global_exec_default'
LEFT JOIN public.commercial_signal_scores css
  ON css.signal_id = gs.id
 AND css.segment_key = 'executive_global_risk'
LEFT JOIN public.recursive_trust_scores rts
  ON rts.signal_id = gs.id
LEFT JOIN public.intelligence_evidence_packets iep
  ON iep.subject_type = 'signal'
 AND iep.subject_id = gs.id
WHERE COALESCE(gs.canonical_event_status,'canonical') = 'canonical';

-- =====================================================
-- 8. Executive KPI generation
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_executive_kpi_snapshot(
  p_profile_key text DEFAULT 'global_executive_console',
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer := 0;
  v_high integer := 0;
  v_narratives integer := 0;
  v_forecasts integer := 0;
  v_anomalies integer := 0;
  v_active_connectors integer := 0;
  v_degraded_connectors integer := 0;
  v_global_risk numeric := 0;
  v_evidence numeric := 0;
  v_validation numeric := 0;
  v_backlog integer := 0;
  v_grade text := 'ungraded';
  v_trend text := 'stable';
  v_key text;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE COALESCE(executive_relevance_score,0) >= 75 OR COALESCE(predictive_priority,0) >= 75 OR COALESCE(anomaly_score,0) >= 75),
         ROUND(COALESCE(AVG(COALESCE(impact_score,0)),0)::numeric,2),
         ROUND(COALESCE(AVG(COALESCE(evidence_quality_score,0)),0)::numeric,2)
  INTO v_total, v_high, v_global_risk, v_evidence
  FROM public.executive_filtered_signal_view
  WHERE COALESCE(ingested_at,created_at) >= now() - p_window;

  SELECT COUNT(*) INTO v_narratives
  FROM public.narrative_clusters
  WHERE updated_at >= now() - p_window;

  SELECT COUNT(*) INTO v_forecasts
  FROM public.predictive_forecasts
  WHERE status = 'active'
    AND created_at >= now() - p_window;

  SELECT COUNT(*) INTO v_anomalies
  FROM public.strategic_anomaly_events
  WHERE created_at >= now() - p_window
    AND COALESCE(anomaly_score,0) >= 75;

  SELECT COUNT(*) FILTER (WHERE operational_status = 'active'),
         COUNT(*) FILTER (WHERE operational_status = 'degraded' OR consecutive_failures >= 3)
  INTO v_active_connectors, v_degraded_connectors
  FROM public.telemetry_connectors;

  SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE ROUND((COUNT(*) FILTER (WHERE validation_status IN ('auto_validated','human_validated'))::numeric / COUNT(*)::numeric) * 100,2) END
  INTO v_validation
  FROM public.forecast_validation_queue
  WHERE created_at >= now() - interval '30 days';

  SELECT COUNT(*) INTO v_backlog
  FROM public.analyst_review_queue
  WHERE review_status = 'open';

  SELECT institutional_readiness_grade
  INTO v_grade
  FROM public.institutional_trust_scorecards
  ORDER BY generated_at DESC
  LIMIT 1;

  v_trend := CASE
    WHEN v_global_risk >= 75 THEN 'rising'
    WHEN v_global_risk <= 35 THEN 'easing'
    ELSE 'stable'
  END;

  v_key := md5(p_profile_key || '|kpi|' || current_date::text || '|' || EXTRACT(hour FROM now())::text);

  INSERT INTO public.executive_kpi_snapshots (
    snapshot_key,
    profile_key,
    time_window,
    total_signals,
    high_priority_signals,
    active_narratives,
    active_forecasts,
    critical_anomalies,
    telemetry_connectors_active,
    telemetry_connectors_degraded,
    global_risk_index,
    evidence_quality_index,
    forecast_validation_rate,
    analyst_review_backlog,
    institutional_readiness_grade,
    trend_direction,
    generated_at
  ) VALUES (
    v_key,
    p_profile_key,
    p_window::text,
    v_total,
    v_high,
    v_narratives,
    v_forecasts,
    v_anomalies,
    v_active_connectors,
    v_degraded_connectors,
    v_global_risk,
    v_evidence,
    v_validation,
    v_backlog,
    COALESCE(v_grade,'ungraded'),
    v_trend,
    now()
  )
  ON CONFLICT(snapshot_key) DO UPDATE SET
    total_signals = EXCLUDED.total_signals,
    high_priority_signals = EXCLUDED.high_priority_signals,
    active_narratives = EXCLUDED.active_narratives,
    active_forecasts = EXCLUDED.active_forecasts,
    critical_anomalies = EXCLUDED.critical_anomalies,
    telemetry_connectors_active = EXCLUDED.telemetry_connectors_active,
    telemetry_connectors_degraded = EXCLUDED.telemetry_connectors_degraded,
    global_risk_index = EXCLUDED.global_risk_index,
    evidence_quality_index = EXCLUDED.evidence_quality_index,
    forecast_validation_rate = EXCLUDED.forecast_validation_rate,
    analyst_review_backlog = EXCLUDED.analyst_review_backlog,
    institutional_readiness_grade = EXCLUDED.institutional_readiness_grade,
    trend_direction = EXCLUDED.trend_direction,
    generated_at = now();

  RETURN jsonb_build_object(
    'status','success',
    'profile_key',p_profile_key,
    'total_signals',v_total,
    'high_priority_signals',v_high,
    'global_risk_index',v_global_risk,
    'trend_direction',v_trend
  );
END;
$$;

-- =====================================================
-- 9. Automated insight generation
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_executive_insight_cards(
  p_profile_key text DEFAULT 'global_executive_console',
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
  v_top_region text;
  v_top_category text;
  v_degraded integer := 0;
  v_open_reviews integer := 0;
  v_high_anomaly record;
BEGIN
  SELECT COALESCE(category,'unknown')
  INTO v_top_category
  FROM public.executive_filtered_signal_view
  WHERE COALESCE(ingested_at,created_at) >= now() - p_window
  GROUP BY category
  ORDER BY AVG(COALESCE(executive_relevance_score,0)) DESC, COUNT(*) DESC
  LIMIT 1;

  SELECT region
  INTO v_top_region
  FROM (
    SELECT unnest(COALESCE(affected_countries, ARRAY['GLOBAL'])) AS region,
           AVG(COALESCE(executive_relevance_score,0)) AS avg_rel,
           COUNT(*) AS ct
    FROM public.executive_filtered_signal_view
    WHERE COALESCE(ingested_at,created_at) >= now() - p_window
    GROUP BY 1
    ORDER BY avg_rel DESC, ct DESC
    LIMIT 1
  ) x;

  SELECT COUNT(*) INTO v_degraded
  FROM public.telemetry_connectors
  WHERE operational_status = 'degraded' OR consecutive_failures >= 3;

  SELECT COUNT(*) INTO v_open_reviews
  FROM public.analyst_review_queue
  WHERE review_status = 'open';

  SELECT * INTO v_high_anomaly
  FROM public.strategic_anomaly_events
  ORDER BY anomaly_score DESC, created_at DESC
  LIMIT 1;

  DELETE FROM public.executive_insight_cards
  WHERE profile_key = p_profile_key
    AND generated_at < now() - interval '48 hours';

  INSERT INTO public.executive_insight_cards (
    insight_key, profile_key, insight_type, severity, icon_hint, title, insight_text,
    affected_regions, affected_domains, confidence_score, action_recommendation, sort_rank, expires_at, generated_at
  )
  VALUES
  (
    md5(p_profile_key || '|top-category|' || current_date::text),
    p_profile_key,
    'domain_concentration',
    'info',
    'info',
    'Highest-priority domain concentration',
    CONCAT('The highest-priority intelligence domain in the selected window is ', COALESCE(v_top_category,'unknown'), '. This should anchor the executive briefing narrative.'),
    '[]'::jsonb,
    jsonb_build_array(COALESCE(v_top_category,'unknown')),
    75,
    'Review top narratives and causal links for this domain.',
    10,
    now() + interval '24 hours',
    now()
  ),
  (
    md5(p_profile_key || '|top-region|' || current_date::text),
    p_profile_key,
    'regional_concentration',
    'info',
    'map',
    'Highest-priority region',
    CONCAT('The region with the strongest current concentration of relevant signals is ', COALESCE(v_top_region,'GLOBAL'), '.'),
    jsonb_build_array(COALESCE(v_top_region,'GLOBAL')),
    '[]'::jsonb,
    72,
    'Open regional operational risk and digital twin views for this region.',
    20,
    now() + interval '24 hours',
    now()
  ),
  (
    md5(p_profile_key || '|telemetry-health|' || current_date::text),
    p_profile_key,
    'telemetry_health',
    CASE WHEN v_degraded > 0 THEN 'warning' ELSE 'success' END,
    CASE WHEN v_degraded > 0 THEN 'warning' ELSE 'success' END,
    'Telemetry health status',
    CASE WHEN v_degraded > 0
      THEN CONCAT(v_degraded, ' telemetry connector(s) are degraded. Coverage may be incomplete until recovery.')
      ELSE 'All active telemetry connectors are reporting without major degradation.'
    END,
    '[]'::jsonb,
    jsonb_build_array('telemetry'),
    80,
    CASE WHEN v_degraded > 0 THEN 'Inspect telemetry health command view and connector error logs.' ELSE 'Continue standard monitoring.' END,
    30,
    now() + interval '24 hours',
    now()
  ),
  (
    md5(p_profile_key || '|analyst-backlog|' || current_date::text),
    p_profile_key,
    'analyst_workflow',
    CASE WHEN v_open_reviews > 25 THEN 'warning' ELSE 'info' END,
    'review',
    'Analyst review workload',
    CONCAT(v_open_reviews, ' intelligence item(s) are awaiting analyst review.'),
    '[]'::jsonb,
    jsonb_build_array('human-ai-review'),
    70,
    'Prioritize urgent and high-confidence-impact review items first.',
    40,
    now() + interval '24 hours',
    now()
  )
  ON CONFLICT(insight_key) DO UPDATE SET
    severity = EXCLUDED.severity,
    insight_text = EXCLUDED.insight_text,
    confidence_score = EXCLUDED.confidence_score,
    action_recommendation = EXCLUDED.action_recommendation,
    sort_rank = EXCLUDED.sort_rank,
    expires_at = EXCLUDED.expires_at,
    generated_at = now();

  IF v_high_anomaly.id IS NOT NULL THEN
    INSERT INTO public.executive_insight_cards (
      insight_key, profile_key, insight_type, severity, icon_hint, title, insight_text,
      evidence_subject_type, evidence_subject_id, affected_regions, affected_domains,
      confidence_score, action_recommendation, sort_rank, expires_at, generated_at
    ) VALUES (
      md5(p_profile_key || '|top-anomaly|' || v_high_anomaly.id::text),
      p_profile_key,
      'critical_anomaly',
      CASE WHEN v_high_anomaly.anomaly_score >= 85 THEN 'warning' ELSE 'info' END,
      'warning',
      'Highest anomaly requiring attention',
      CONCAT('A ', COALESCE(v_high_anomaly.anomaly_type,'strategic'), ' anomaly scored ', COALESCE(v_high_anomaly.anomaly_score,0), '. ', COALESCE(v_high_anomaly.anomaly_reason,'')),
      'strategic_anomaly',
      v_high_anomaly.id,
      '[]'::jsonb,
      '[]'::jsonb,
      COALESCE(v_high_anomaly.anomaly_score,0),
      'Route to analyst review and verify evidence lineage before operational escalation.',
      5,
      now() + interval '24 hours',
      now()
    )
    ON CONFLICT(insight_key) DO UPDATE SET
      insight_text = EXCLUDED.insight_text,
      confidence_score = EXCLUDED.confidence_score,
      generated_at = now();
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object('status','success','insights_upserted',v_rows);
END;
$$;

-- =====================================================
-- 10. Executive chart payload generation
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_executive_chart_datasets(
  p_profile_key text DEFAULT 'global_executive_console',
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
  INSERT INTO public.executive_chart_datasets (
    dataset_key,
    profile_key,
    chart_type,
    chart_title,
    chart_description,
    data_payload,
    filter_context,
    generated_at
  )
  VALUES
  (
    md5(p_profile_key || '|domain-risk|' || current_date::text),
    p_profile_key,
    'donut',
    'Risk Concentration by Domain',
    'Shows where strategic attention is concentrated across intelligence domains.',
    COALESCE((
      SELECT jsonb_agg(row_to_json(x))
      FROM (
        SELECT category AS label,
               COUNT(*) AS signal_count,
               ROUND(AVG(COALESCE(executive_relevance_score,0))::numeric,2) AS avg_relevance,
               ROUND(AVG(COALESCE(impact_score,0))::numeric,2) AS avg_impact
        FROM public.executive_filtered_signal_view
        WHERE COALESCE(ingested_at,created_at) >= now() - p_window
        GROUP BY category
        ORDER BY avg_relevance DESC
        LIMIT 12
      ) x
    ), '[]'::jsonb),
    jsonb_build_object('window',p_window::text),
    now()
  ),
  (
    md5(p_profile_key || '|regional-risk|' || current_date::text),
    p_profile_key,
    'horizontal_bar',
    'Top Regions by Strategic Risk',
    'Ranks regions by relevance, impact, and signal concentration.',
    COALESCE((
      SELECT jsonb_agg(row_to_json(x))
      FROM (
        SELECT region AS label,
               COUNT(*) AS signal_count,
               ROUND(AVG(COALESCE(executive_relevance_score,0))::numeric,2) AS avg_relevance,
               ROUND(AVG(COALESCE(impact_score,0))::numeric,2) AS avg_impact
        FROM (
          SELECT unnest(COALESCE(affected_countries, ARRAY['GLOBAL'])) AS region,
                 executive_relevance_score,
                 impact_score,
                 ingested_at,
                 created_at
          FROM public.executive_filtered_signal_view
        ) s
        WHERE COALESCE(ingested_at,created_at) >= now() - p_window
        GROUP BY region
        ORDER BY avg_relevance DESC, signal_count DESC
        LIMIT 15
      ) x
    ), '[]'::jsonb),
    jsonb_build_object('window',p_window::text),
    now()
  ),
  (
    md5(p_profile_key || '|telemetry-health|' || current_date::text),
    p_profile_key,
    'status_grid',
    'Telemetry Connector Health',
    'Operational status of live telemetry sources.',
    COALESCE((
      SELECT jsonb_agg(row_to_json(x))
      FROM (
        SELECT connector_key,
               connector_name,
               data_domain,
               operational_status,
               consecutive_failures,
               last_success_at
        FROM public.telemetry_connectors
        ORDER BY data_domain, connector_name
      ) x
    ), '[]'::jsonb),
    jsonb_build_object('window','current'),
    now()
  )
  ON CONFLICT(dataset_key) DO UPDATE SET
    data_payload = EXCLUDED.data_payload,
    filter_context = EXCLUDED.filter_context,
    generated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('status','success','datasets_upserted',v_rows);
END;
$$;

-- =====================================================
-- 11. Decision clarity score generation
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_decision_clarity_scorecard(
  p_profile_key text DEFAULT 'global_executive_console',
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_signal_to_noise numeric := 0;
  v_interpretability numeric := 0;
  v_actionability numeric := 0;
  v_evidence numeric := 0;
  v_timeliness numeric := 0;
  v_overall numeric := 0;
  v_grade text := 'ungraded';
  v_total integer := 0;
  v_high integer := 0;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE COALESCE(executive_relevance_score,0) >= 70)
  INTO v_total, v_high
  FROM public.executive_filtered_signal_view
  WHERE COALESCE(ingested_at,created_at) >= now() - p_window;

  v_signal_to_noise := CASE WHEN v_total = 0 THEN 0 ELSE ROUND((v_high::numeric / v_total::numeric) * 100,2) END;

  SELECT COALESCE(AVG(CASE WHEN recommended_human_review THEN 75 ELSE 90 END),0)
  INTO v_interpretability
  FROM public.intelligence_explainability_traces
  WHERE generated_at >= now() - p_window;

  SELECT COALESCE(AVG(expected_effectiveness),0)
  INTO v_actionability
  FROM public.intervention_recommendations
  WHERE created_at >= now() - p_window;

  SELECT COALESCE(AVG(evidence_quality_score),0)
  INTO v_evidence
  FROM public.intelligence_evidence_packets
  WHERE generated_at >= now() - p_window;

  SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE ROUND((COUNT(*) FILTER (WHERE last_success_at >= now() - interval '24 hours')::numeric / COUNT(*)::numeric) * 100,2) END
  INTO v_timeliness
  FROM public.telemetry_connectors;

  v_overall := ROUND((
    v_signal_to_noise * 0.20 +
    v_interpretability * 0.25 +
    v_actionability * 0.20 +
    v_evidence * 0.20 +
    v_timeliness * 0.15
  )::numeric,2);

  v_grade := CASE
    WHEN v_overall >= 85 THEN 'boardroom-ready'
    WHEN v_overall >= 75 THEN 'executive-ready'
    WHEN v_overall >= 65 THEN 'pilot-ready'
    WHEN v_overall >= 50 THEN 'needs-analyst-layer'
    ELSE 'not-ready'
  END;

  INSERT INTO public.decision_clarity_scorecards (
    scorecard_key,
    profile_key,
    signal_to_noise_score,
    interpretability_score,
    actionability_score,
    evidence_score,
    timeliness_score,
    overall_clarity_score,
    clarity_grade,
    improvement_recommendations,
    generated_at
  ) VALUES (
    md5(p_profile_key || '|clarity|' || current_date::text),
    p_profile_key,
    v_signal_to_noise,
    ROUND(v_interpretability::numeric,2),
    ROUND(v_actionability::numeric,2),
    ROUND(v_evidence::numeric,2),
    ROUND(v_timeliness::numeric,2),
    v_overall,
    v_grade,
    jsonb_build_array(
      CASE WHEN v_signal_to_noise < 60 THEN 'Tighten relevance filters to reduce noise.' ELSE 'Signal-to-noise acceptable.' END,
      CASE WHEN v_evidence < 65 THEN 'Increase authoritative source corroboration.' ELSE 'Evidence quality acceptable.' END,
      CASE WHEN v_timeliness < 75 THEN 'Improve telemetry freshness and connector recovery.' ELSE 'Telemetry freshness acceptable.' END
    ),
    now()
  )
  ON CONFLICT(scorecard_key) DO UPDATE SET
    signal_to_noise_score = EXCLUDED.signal_to_noise_score,
    interpretability_score = EXCLUDED.interpretability_score,
    actionability_score = EXCLUDED.actionability_score,
    evidence_score = EXCLUDED.evidence_score,
    timeliness_score = EXCLUDED.timeliness_score,
    overall_clarity_score = EXCLUDED.overall_clarity_score,
    clarity_grade = EXCLUDED.clarity_grade,
    improvement_recommendations = EXCLUDED.improvement_recommendations,
    generated_at = now();

  RETURN jsonb_build_object('status','success','clarity_score',v_overall,'clarity_grade',v_grade);
END;
$$;

-- =====================================================
-- 12. Command views for frontend console
-- =====================================================
CREATE OR REPLACE VIEW public.executive_console_kpi_view AS
SELECT *
FROM public.executive_kpi_snapshots
ORDER BY generated_at DESC;

CREATE OR REPLACE VIEW public.executive_insight_card_view AS
SELECT
  profile_key,
  insight_type,
  severity,
  icon_hint,
  title,
  insight_text,
  affected_regions,
  affected_domains,
  confidence_score,
  action_recommendation,
  sort_rank,
  generated_at,
  expires_at
FROM public.executive_insight_cards
WHERE expires_at IS NULL OR expires_at > now()
ORDER BY sort_rank ASC, generated_at DESC;

CREATE OR REPLACE VIEW public.executive_chart_dataset_view AS
SELECT
  profile_key,
  chart_type,
  chart_title,
  chart_description,
  data_payload,
  filter_context,
  generated_at
FROM public.executive_chart_datasets
ORDER BY generated_at DESC;

CREATE OR REPLACE VIEW public.decision_clarity_command_view AS
SELECT
  profile_key,
  signal_to_noise_score,
  interpretability_score,
  actionability_score,
  evidence_score,
  timeliness_score,
  overall_clarity_score,
  clarity_grade,
  improvement_recommendations,
  generated_at
FROM public.decision_clarity_scorecards
ORDER BY generated_at DESC;

-- =====================================================
-- 13. Master executive console cycle
-- =====================================================
CREATE OR REPLACE FUNCTION public.run_executive_console_cycle(
  p_profile_key text DEFAULT 'global_executive_console',
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
  r1 := public.generate_executive_kpi_snapshot(p_profile_key, p_window);
  r2 := public.generate_executive_insight_cards(p_profile_key, p_window);
  r3 := public.generate_executive_chart_datasets(p_profile_key, p_window);
  r4 := public.generate_decision_clarity_scorecard(p_profile_key, p_window);

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('executive-console-cycle','success','profile=' || p_profile_key || ', window=' || p_window::text);

  RETURN jsonb_build_object(
    'status','success',
    'profile_key',p_profile_key,
    'kpi_snapshot',r1,
    'insight_cards',r2,
    'chart_datasets',r3,
    'decision_clarity',r4
  );
END;
$$;

INSERT INTO public.automation_logs(job_name,status,message)
VALUES (
  'executive-intelligence-console-layer',
  'success',
  'executive KPI snapshots, insight cards, chart datasets, decision clarity scoring, and command views initialized'
);
