-- Commercial Intelligence Production Safety Hotfix
-- Fixes blocking SQL/runtime risks from commercial intelligence migrations.
-- Goals:
-- 1. Add missing columns used by functions.
-- 2. Add stable idempotency constraints.
-- 3. Replace unstable forecast key generation.
-- 4. Reduce duplicate accumulation.
-- 5. Add indexes for heavy joins.
-- 6. Avoid migration-time heavy processing.

-- =====================================================
-- 1. Defensive global_signals columns used by scoring
-- =====================================================
ALTER TABLE public.global_signals
  ADD COLUMN IF NOT EXISTS predictive_priority numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS anomaly_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weak_signal_score numeric DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_global_signals_predictive_priority
ON public.global_signals(predictive_priority DESC)
WHERE predictive_priority IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_global_signals_anomaly_score
ON public.global_signals(anomaly_score DESC)
WHERE anomaly_score IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_global_signals_impact_recent
ON public.global_signals(impact_score DESC, ingested_at DESC)
WHERE impact_score IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_global_signals_canonical_recent
ON public.global_signals(canonical_event_status, ingested_at DESC)
WHERE canonical_event_status IS NOT NULL;

-- =====================================================
-- 2. Fix missing updated_at on memory edges
-- =====================================================
ALTER TABLE public.strategic_memory_edges
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- =====================================================
-- 3. Add idempotency / duplicate-prevention constraints
-- =====================================================

-- Strategic anomalies: one anomaly type per signal.
CREATE UNIQUE INDEX IF NOT EXISTS uq_strategic_anomaly_signal_type
ON public.strategic_anomaly_events(signal_id, anomaly_type);

-- Intervention recommendations: one recommendation type per signal.
CREATE UNIQUE INDEX IF NOT EXISTS uq_intervention_signal_type
ON public.intervention_recommendations(signal_id, recommendation_type);

-- False positives: one suppression reason per signal.
CREATE UNIQUE INDEX IF NOT EXISTS uq_false_positive_signal_reason
ON public.false_positive_suppression_events(signal_id, suppression_reason);

-- Forecast validations: one validation signal per forecast.
CREATE UNIQUE INDEX IF NOT EXISTS uq_forecast_validation_pair
ON public.forecast_validation_events(forecast_id, validating_signal_id);

-- Briefing packets: only one packet per window bucket and title.
ALTER TABLE public.executive_briefing_packets
  ADD COLUMN IF NOT EXISTS briefing_date date DEFAULT CURRENT_DATE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_executive_briefing_window_date
ON public.executive_briefing_packets(briefing_window, briefing_date, briefing_title);

-- Predictive forecast stable uniqueness by originating signal + domain + window.
CREATE UNIQUE INDEX IF NOT EXISTS uq_predictive_forecast_signal_domain_window
ON public.predictive_forecasts(originating_signal_id, forecast_domain, forecast_window_hours)
WHERE originating_signal_id IS NOT NULL;

-- =====================================================
-- 4. Performance indexes for causal and memory workloads
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_strategic_causal_links_recent_confidence
ON public.strategic_causal_links(created_at DESC, causal_confidence DESC);

CREATE INDEX IF NOT EXISTS idx_predictive_forecasts_origin_signal
ON public.predictive_forecasts(originating_signal_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contagion_maps_category_region
ON public.contagion_propagation_maps(propagation_category, origin_region);

CREATE INDEX IF NOT EXISTS idx_signal_decay_band_relevance
ON public.signal_decay_tracking(persistence_band, current_relevance DESC);

CREATE INDEX IF NOT EXISTS idx_recursive_trust_signal
ON public.recursive_trust_scores(signal_id, inherited_trust_score DESC);

CREATE INDEX IF NOT EXISTS idx_commercial_scores_signal_segment
ON public.commercial_signal_scores(signal_id, segment_key, trust_adjusted_score DESC);

-- =====================================================
-- 5. Replace unsafe forecasting function with stable keys
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_predictive_forecasts(
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_forecasts integer := 0;
BEGIN
  INSERT INTO public.predictive_forecasts (
    forecast_key,
    originating_signal_id,
    forecast_domain,
    forecast_title,
    forecast_hypothesis,
    forecast_probability,
    forecast_confidence,
    expected_impact,
    escalation_risk,
    forecast_window_hours,
    expected_regions,
    expected_categories,
    status,
    created_at,
    expires_at
  )
  SELECT
    md5(gs.id::text || '|' || COALESCE(gs.category,'unknown') || '|168h') AS forecast_key,
    gs.id,
    COALESCE(gs.category,'unknown'),
    CONCAT('Projected escalation: ', COALESCE(gs.translated_title, gs.title)),
    CONCAT(
      'Current signal pattern suggests elevated probability of escalation or cross-domain propagation in ',
      COALESCE(gs.category,'unknown'),
      ' within the next 7 days.'
    ),
    LEAST(100, ROUND((
      COALESCE(gs.predictive_priority,0) * 0.45 +
      COALESCE(gs.anomaly_score,0) * 0.20 +
      COALESCE(gs.impact_score,0) * 0.20 +
      COALESCE(gs.urgency_score,0) * 0.15
    )::numeric,2)),
    LEAST(100, ROUND((
      COALESCE(gs.confidence_score,0) * 0.60 +
      CASE WHEN COALESCE(gs.corroboration_count,0) >= 2 THEN 20 ELSE 0 END
    )::numeric,2)),
    ROUND(COALESCE(gs.impact_score,0)::numeric,2),
    LEAST(100, ROUND((
      COALESCE(gs.predictive_priority,0) * 0.50 +
      COALESCE(gs.urgency_score,0) * 0.30 +
      COALESCE(gs.anomaly_score,0) * 0.20
    )::numeric,2)),
    168,
    to_jsonb(COALESCE(gs.affected_countries, ARRAY['GLOBAL']::text[])),
    jsonb_build_array(COALESCE(gs.category,'unknown')),
    'active',
    now(),
    now() + interval '7 days'
  FROM public.global_signals gs
  WHERE COALESCE(gs.ingested_at,gs.created_at) >= now() - p_window
    AND COALESCE(gs.canonical_event_status,'canonical') = 'canonical'
    AND (
      COALESCE(gs.predictive_priority,0) >= 70
      OR COALESCE(gs.anomaly_score,0) >= 70
      OR COALESCE(gs.impact_score,0) >= 80
    )
  ON CONFLICT(forecast_key) DO UPDATE SET
    forecast_probability = EXCLUDED.forecast_probability,
    forecast_confidence = EXCLUDED.forecast_confidence,
    expected_impact = EXCLUDED.expected_impact,
    escalation_risk = EXCLUDED.escalation_risk,
    expected_regions = EXCLUDED.expected_regions,
    expected_categories = EXCLUDED.expected_categories,
    status = CASE
      WHEN public.predictive_forecasts.status = 'validated' THEN public.predictive_forecasts.status
      ELSE EXCLUDED.status
    END,
    expires_at = EXCLUDED.expires_at;

  GET DIAGNOSTICS v_forecasts = ROW_COUNT;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('predictive-forecast-generation','success','forecasts_upserted=' || v_forecasts);

  RETURN jsonb_build_object(
    'status','success',
    'forecasts_upserted',v_forecasts
  );
END;
$$;

-- =====================================================
-- 6. Replace causal link function with bounded candidate set
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_causal_signal_links(
  p_window interval DEFAULT interval '24 hours',
  p_candidate_limit integer DEFAULT 750
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_links integer := 0;
BEGIN
  WITH candidates AS (
    SELECT *
    FROM public.global_signals
    WHERE COALESCE(ingested_at,created_at) >= now() - p_window
      AND COALESCE(canonical_event_status,'canonical') = 'canonical'
      AND COALESCE(impact_score,0) >= 60
    ORDER BY COALESCE(impact_score,0) DESC,
             COALESCE(predictive_priority,0) DESC,
             COALESCE(ingested_at,created_at) DESC
    LIMIT GREATEST(50, LEAST(p_candidate_limit, 1500))
  )
  INSERT INTO public.strategic_causal_links (
    source_signal_id,
    target_signal_id,
    causal_confidence,
    causal_direction,
    causal_type,
    propagation_delay_hours,
    systemic_impact_multiplier,
    evidence,
    created_at
  )
  SELECT
    s1.id,
    s2.id,
    GREATEST(0, LEAST(100, ROUND((
      CASE WHEN lower(COALESCE(s1.category,'')) = lower(COALESCE(s2.category,'')) THEN 30 ELSE 0 END +
      CASE WHEN COALESCE(s1.affected_countries,'{}') && COALESCE(s2.affected_countries,'{}') THEN 25 ELSE 0 END +
      (100 - LEAST(100, ABS(COALESCE(s1.predictive_priority,0) - COALESCE(s2.predictive_priority,0)))) * 0.10 +
      (COALESCE(s1.impact_score,0) + COALESCE(s2.impact_score,0)) * 0.18 +
      CASE WHEN COALESCE(s1.corroboration_count,0) >= 2 AND COALESCE(s2.corroboration_count,0) >= 2 THEN 10 ELSE 0 END
    )::numeric,2))),
    'forward',
    CASE
      WHEN lower(COALESCE(s1.category,'')) = lower(COALESCE(s2.category,'')) THEN 'same-domain-escalation'
      WHEN COALESCE(s1.affected_countries,'{}') && COALESCE(s2.affected_countries,'{}') THEN 'regional-propagation'
      ELSE 'cross-domain-influence'
    END,
    EXTRACT(EPOCH FROM (COALESCE(s2.ingested_at,s2.created_at) - COALESCE(s1.ingested_at,s1.created_at))) / 3600,
    LEAST(5, ROUND(((COALESCE(s1.impact_score,0) + COALESCE(s2.impact_score,0))/100)::numeric,2)),
    jsonb_build_array(
      jsonb_build_object('source_category',COALESCE(s1.category,'unknown')),
      jsonb_build_object('target_category',COALESCE(s2.category,'unknown')),
      jsonb_build_object('source_regions',COALESCE(s1.affected_countries,'{}')),
      jsonb_build_object('target_regions',COALESCE(s2.affected_countries,'{}'))
    ),
    now()
  FROM candidates s1
  JOIN candidates s2
    ON s1.id <> s2.id
   AND COALESCE(s2.ingested_at,s2.created_at) > COALESCE(s1.ingested_at,s1.created_at)
   AND COALESCE(s2.ingested_at,s2.created_at) <= COALESCE(s1.ingested_at,s1.created_at) + interval '72 hours'
  WHERE (
    lower(COALESCE(s1.category,'')) = lower(COALESCE(s2.category,''))
    OR COALESCE(s1.affected_countries,'{}') && COALESCE(s2.affected_countries,'{}')
    OR ABS(COALESCE(s1.predictive_priority,0) - COALESCE(s2.predictive_priority,0)) <= 15
  )
  ON CONFLICT(source_signal_id, target_signal_id) DO UPDATE SET
    causal_confidence = EXCLUDED.causal_confidence,
    causal_type = EXCLUDED.causal_type,
    propagation_delay_hours = EXCLUDED.propagation_delay_hours,
    systemic_impact_multiplier = EXCLUDED.systemic_impact_multiplier,
    evidence = EXCLUDED.evidence;

  GET DIAGNOSTICS v_links = ROW_COUNT;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('causal-link-generation','success','bounded_links_upserted=' || v_links);

  RETURN jsonb_build_object(
    'status','success',
    'causal_links_upserted',v_links,
    'candidate_limit',p_candidate_limit
  );
END;
$$;

-- =====================================================
-- 7. Replace duplicate-prone anomaly function
-- =====================================================
CREATE OR REPLACE FUNCTION public.detect_strategic_anomalies(
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_events integer := 0;
BEGIN
  INSERT INTO public.strategic_anomaly_events (
    signal_id,
    anomaly_type,
    anomaly_score,
    anomaly_reason,
    escalation_probability,
    systemic_risk_projection,
    recommended_attention_band,
    created_at
  )
  SELECT
    gs.id,
    CASE
      WHEN COALESCE(gs.anomaly_score,0) >= 85 THEN 'extreme_outlier'
      WHEN COALESCE(gs.predictive_priority,0) >= 80 THEN 'predictive_escalation'
      WHEN COALESCE(gs.impact_score,0) >= 85 AND COALESCE(gs.corroboration_count,0) >= 3 THEN 'systemic_event'
      ELSE 'emerging_pattern'
    END,
    LEAST(100, ROUND((
      COALESCE(gs.anomaly_score,0) * 0.45 +
      COALESCE(gs.predictive_priority,0) * 0.30 +
      COALESCE(gs.impact_score,0) * 0.25
    )::numeric,2)),
    CONCAT(
      'High strategic divergence detected in category ',
      COALESCE(gs.category,'unknown'),
      ' with predictive priority ',
      COALESCE(gs.predictive_priority,0)
    ),
    LEAST(100, ROUND((
      COALESCE(gs.predictive_priority,0) * 0.50 +
      COALESCE(gs.urgency_score,0) * 0.30 +
      COALESCE(gs.anomaly_score,0) * 0.20
    )::numeric,2)),
    LEAST(100, ROUND((
      COALESCE(gs.impact_score,0) * 0.40 +
      COALESCE(gs.corroboration_count,0) * 8 +
      COALESCE(gs.confidence_score,0) * 0.20
    )::numeric,2)),
    CASE
      WHEN COALESCE(gs.predictive_priority,0) >= 85 THEN 'critical'
      WHEN COALESCE(gs.anomaly_score,0) >= 70 THEN 'strategic'
      ELSE 'monitor'
    END,
    now()
  FROM public.global_signals gs
  WHERE COALESCE(gs.ingested_at, gs.created_at) >= now() - p_window
    AND COALESCE(gs.canonical_event_status,'canonical') = 'canonical'
    AND (
      COALESCE(gs.anomaly_score,0) >= 65
      OR COALESCE(gs.predictive_priority,0) >= 70
      OR (
        COALESCE(gs.impact_score,0) >= 80
        AND COALESCE(gs.corroboration_count,0) >= 2
      )
    )
  ON CONFLICT(signal_id, anomaly_type) DO UPDATE SET
    anomaly_score = EXCLUDED.anomaly_score,
    anomaly_reason = EXCLUDED.anomaly_reason,
    escalation_probability = EXCLUDED.escalation_probability,
    systemic_risk_projection = EXCLUDED.systemic_risk_projection,
    recommended_attention_band = EXCLUDED.recommended_attention_band,
    created_at = now();

  GET DIAGNOSTICS v_events = ROW_COUNT;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('strategic-anomaly-detection','success','events_upserted=' || v_events);

  RETURN jsonb_build_object('status','success','anomaly_events_upserted',v_events);
END;
$$;

-- =====================================================
-- 8. Replace duplicate-prone intervention function
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_intervention_recommendations(
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recommendations integer := 0;
BEGIN
  INSERT INTO public.intervention_recommendations (
    signal_id,
    recommendation_type,
    recommendation_title,
    recommendation_summary,
    urgency_band,
    expected_effectiveness,
    implementation_complexity,
    confidence,
    recommended_window_hours,
    recommendation_metadata,
    created_at
  )
  SELECT
    gs.id,
    CASE
      WHEN COALESCE(gs.category,'') IN ('conflict','geopolitics') THEN 'strategic-monitoring'
      WHEN COALESCE(gs.category,'') IN ('cybersecurity') THEN 'security-hardening'
      WHEN COALESCE(gs.category,'') IN ('supply-chain','energy') THEN 'operational-contingency'
      ELSE 'executive-review'
    END,
    CONCAT('Recommended response for: ', COALESCE(gs.translated_title, gs.title)),
    CONCAT(
      'Elevated intelligence conditions detected. Suggested action: ',
      CASE
        WHEN COALESCE(gs.predictive_priority,0) >= 80 THEN 'immediate escalation review'
        WHEN COALESCE(gs.impact_score,0) >= 75 THEN 'cross-functional assessment'
        ELSE 'enhanced monitoring'
      END
    ),
    CASE
      WHEN COALESCE(gs.predictive_priority,0) >= 85 THEN 'critical'
      WHEN COALESCE(gs.impact_score,0) >= 70 THEN 'strategic'
      ELSE 'monitor'
    END,
    LEAST(100, ROUND((
      COALESCE(gs.confidence_score,0) * 0.40 +
      COALESCE(gs.predictive_priority,0) * 0.35 +
      COALESCE(gs.impact_score,0) * 0.25
    )::numeric,2)),
    CASE WHEN COALESCE(gs.category,'') IN ('conflict','geopolitics') THEN 70
         WHEN COALESCE(gs.category,'') IN ('cybersecurity') THEN 55
         ELSE 45 END,
    ROUND(COALESCE(gs.confidence_score,0)::numeric,2),
    CASE
      WHEN COALESCE(gs.predictive_priority,0) >= 85 THEN 12
      WHEN COALESCE(gs.impact_score,0) >= 75 THEN 24
      ELSE 72
    END,
    jsonb_build_object(
      'category',COALESCE(gs.category,'unknown'),
      'affected_regions',COALESCE(gs.affected_countries,'{}'),
      'source_trust_tier',COALESCE(gs.source_trust_tier,'unknown')
    ),
    now()
  FROM public.global_signals gs
  WHERE COALESCE(gs.ingested_at,gs.created_at) >= now() - p_window
    AND COALESCE(gs.canonical_event_status,'canonical') = 'canonical'
    AND (
      COALESCE(gs.impact_score,0) >= 70
      OR COALESCE(gs.predictive_priority,0) >= 70
      OR COALESCE(gs.urgency_score,0) >= 75
    )
  ON CONFLICT(signal_id, recommendation_type) DO UPDATE SET
    recommendation_title = EXCLUDED.recommendation_title,
    recommendation_summary = EXCLUDED.recommendation_summary,
    urgency_band = EXCLUDED.urgency_band,
    expected_effectiveness = EXCLUDED.expected_effectiveness,
    implementation_complexity = EXCLUDED.implementation_complexity,
    confidence = EXCLUDED.confidence,
    recommended_window_hours = EXCLUDED.recommended_window_hours,
    recommendation_metadata = EXCLUDED.recommendation_metadata,
    created_at = now();

  GET DIAGNOSTICS v_recommendations = ROW_COUNT;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('intervention-recommendation-generation','success','recommendations_upserted=' || v_recommendations);

  RETURN jsonb_build_object('status','success','recommendations_upserted',v_recommendations);
END;
$$;

-- =====================================================
-- 9. Replace duplicate-prone false positive function
-- =====================================================
CREATE OR REPLACE FUNCTION public.detect_false_positive_patterns(
  p_window interval DEFAULT interval '14 days'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_suppressed integer := 0;
BEGIN
  INSERT INTO public.false_positive_suppression_events (
    signal_id,
    suppression_reason,
    suppression_score,
    suppression_confidence,
    review_status,
    evidence,
    created_at
  )
  SELECT
    gs.id,
    CASE
      WHEN COALESCE(gs.confidence_score,0) < 40 THEN 'low-confidence-signal'
      WHEN COALESCE(gs.corroboration_count,0) = 0 THEN 'uncorroborated-signal'
      WHEN COALESCE(gs.source_trust_tier,'') = 'tier_3' AND COALESCE(gs.impact_score,0) < 40 THEN 'low-trust-low-impact'
      ELSE 'noise-pattern'
    END,
    LEAST(100, ROUND((
      (100 - COALESCE(gs.confidence_score,0)) * 0.40 +
      CASE WHEN COALESCE(gs.corroboration_count,0) = 0 THEN 30 ELSE 0 END +
      CASE WHEN COALESCE(gs.source_trust_tier,'') = 'tier_3' THEN 20 ELSE 0 END
    )::numeric,2)),
    LEAST(100, ROUND((
      (100 - COALESCE(gs.confidence_score,0)) * 0.50 +
      CASE WHEN COALESCE(gs.corroboration_count,0) = 0 THEN 25 ELSE 0 END
    )::numeric,2)),
    'suppressed',
    jsonb_build_array(
      jsonb_build_object('confidence',COALESCE(gs.confidence_score,0)),
      jsonb_build_object('corroboration',COALESCE(gs.corroboration_count,0)),
      jsonb_build_object('source_tier',COALESCE(gs.source_trust_tier,'unknown'))
    ),
    now()
  FROM public.global_signals gs
  WHERE COALESCE(gs.ingested_at,gs.created_at) >= now() - p_window
    AND COALESCE(gs.canonical_event_status,'canonical') = 'canonical'
    AND (
      COALESCE(gs.confidence_score,0) < 40
      OR (
        COALESCE(gs.corroboration_count,0) = 0
        AND COALESCE(gs.source_trust_tier,'') = 'tier_3'
      )
    )
  ON CONFLICT(signal_id, suppression_reason) DO UPDATE SET
    suppression_score = EXCLUDED.suppression_score,
    suppression_confidence = EXCLUDED.suppression_confidence,
    review_status = EXCLUDED.review_status,
    evidence = EXCLUDED.evidence,
    created_at = now();

  GET DIAGNOSTICS v_suppressed = ROW_COUNT;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('false-positive-suppression','success','suppressed_upserted=' || v_suppressed);

  RETURN jsonb_build_object('status','success','suppressed_events_upserted',v_suppressed);
END;
$$;

-- =====================================================
-- 10. Replace executive briefing with date-bucket idempotency
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_executive_briefing_packet()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_global_risk numeric := 0;
  v_key text := md5(current_date::text || '|24h|Global Strategic Intelligence Briefing');
BEGIN
  SELECT ROUND(COALESCE(AVG(COALESCE(impact_score,0)),0)::numeric,2)
  INTO v_global_risk
  FROM public.global_signals
  WHERE COALESCE(ingested_at,created_at) >= now() - interval '24 hours'
    AND COALESCE(canonical_event_status,'canonical') = 'canonical';

  INSERT INTO public.executive_briefing_packets (
    briefing_key,
    briefing_date,
    briefing_title,
    briefing_summary,
    strategic_priority_band,
    top_narratives,
    top_forecasts,
    top_anomalies,
    intervention_actions,
    global_risk_index,
    executive_confidence,
    briefing_window,
    generated_at
  ) VALUES (
    v_key,
    current_date,
    'Global Strategic Intelligence Briefing',
    CONCAT(
      'Automated executive intelligence synthesis generated with global risk index ',
      v_global_risk
    ),
    CASE
      WHEN v_global_risk >= 80 THEN 'critical'
      WHEN v_global_risk >= 65 THEN 'strategic'
      ELSE 'monitor'
    END,
    COALESCE((
      SELECT jsonb_agg(x)
      FROM (
        SELECT narrative_title, strategic_importance_score
        FROM public.narrative_intelligence_command_view
        LIMIT 5
      ) x
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(x)
      FROM (
        SELECT forecast_title, forecast_probability
        FROM public.strategic_forecasting_command_view
        LIMIT 5
      ) x
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(x)
      FROM (
        SELECT anomaly_type, anomaly_score
        FROM public.strategic_anomaly_events
        ORDER BY anomaly_score DESC
        LIMIT 5
      ) x
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(x)
      FROM (
        SELECT recommendation_title, urgency_band
        FROM public.intervention_command_view
        LIMIT 5
      ) x
    ), '[]'::jsonb),
    v_global_risk,
    LEAST(100, ROUND((v_global_risk * 0.40 + 45)::numeric,2)),
    '24h',
    now()
  )
  ON CONFLICT(briefing_key) DO UPDATE SET
    briefing_date = EXCLUDED.briefing_date,
    briefing_summary = EXCLUDED.briefing_summary,
    strategic_priority_band = EXCLUDED.strategic_priority_band,
    top_narratives = EXCLUDED.top_narratives,
    top_forecasts = EXCLUDED.top_forecasts,
    top_anomalies = EXCLUDED.top_anomalies,
    intervention_actions = EXCLUDED.intervention_actions,
    global_risk_index = EXCLUDED.global_risk_index,
    executive_confidence = EXCLUDED.executive_confidence,
    generated_at = now();

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('executive-briefing-generation','success','global_risk=' || v_global_risk);

  RETURN jsonb_build_object('status','success','global_risk_index',v_global_risk,'briefing_key',v_key);
END;
$$;

-- =====================================================
-- 11. Replace memory graph function after updated_at fix
-- =====================================================
CREATE OR REPLACE FUNCTION public.build_strategic_memory_graph(
  p_window interval DEFAULT interval '30 days'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nodes integer := 0;
  v_edges integer := 0;
BEGIN
  INSERT INTO public.strategic_memory_nodes (
    memory_key,
    memory_type,
    memory_title,
    memory_summary,
    primary_regions,
    primary_categories,
    strategic_weight,
    persistence_score,
    recurrence_score,
    confidence_score,
    first_observed_at,
    last_observed_at,
    created_at,
    updated_at
  )
  SELECT
    md5(
      lower(COALESCE(category,'unknown')) || '|' ||
      COALESCE(array_to_string(affected_countries,','),'global')
    ),
    'narrative-memory',
    CONCAT(initcap(REPLACE(COALESCE(category,'unknown'),'-',' ')), ' strategic memory'),
    CONCAT(COUNT(*), ' recurring canonical signals detected across historical ingestion windows.'),
    to_jsonb(COALESCE(affected_countries, ARRAY['GLOBAL']::text[])),
    jsonb_build_array(COALESCE(category,'unknown')),
    LEAST(100, ROUND((AVG(COALESCE(impact_score,0)) * 0.40 + AVG(COALESCE(predictive_priority,0)) * 0.30 + COUNT(*) * 2)::numeric,2)),
    LEAST(100, ROUND((COUNT(*) * 3 + AVG(COALESCE(confidence_score,0)) * 0.30)::numeric,2)),
    LEAST(100, ROUND((COUNT(DISTINCT DATE_TRUNC('day', COALESCE(ingested_at,created_at))) * 5)::numeric,2)),
    ROUND(AVG(COALESCE(confidence_score,0))::numeric,2),
    MIN(COALESCE(ingested_at,created_at)),
    MAX(COALESCE(ingested_at,created_at)),
    now(),
    now()
  FROM public.global_signals
  WHERE COALESCE(ingested_at,created_at) >= now() - p_window
    AND COALESCE(canonical_event_status,'canonical') = 'canonical'
  GROUP BY category, affected_countries
  HAVING COUNT(*) >= 3
  ON CONFLICT(memory_key) DO UPDATE SET
    strategic_weight = EXCLUDED.strategic_weight,
    persistence_score = EXCLUDED.persistence_score,
    recurrence_score = EXCLUDED.recurrence_score,
    confidence_score = EXCLUDED.confidence_score,
    last_observed_at = EXCLUDED.last_observed_at,
    updated_at = now();

  GET DIAGNOSTICS v_nodes = ROW_COUNT;

  INSERT INTO public.strategic_memory_edges (
    source_memory_id,
    target_memory_id,
    relationship_type,
    relationship_strength,
    recursive_depth,
    evidence,
    created_at,
    updated_at
  )
  SELECT
    sm1.id,
    sm2.id,
    CASE
      WHEN sm1.primary_categories = sm2.primary_categories THEN 'same-domain-memory'
      WHEN sm1.primary_regions = sm2.primary_regions THEN 'regional-memory-link'
      ELSE 'cross-domain-memory'
    END,
    LEAST(100, ROUND((
      CASE WHEN sm1.primary_categories = sm2.primary_categories THEN 35 ELSE 0 END +
      CASE WHEN sm1.primary_regions = sm2.primary_regions THEN 30 ELSE 0 END +
      (sm1.strategic_weight + sm2.strategic_weight) * 0.15
    )::numeric,2)),
    1,
    jsonb_build_array(
      jsonb_build_object('source_memory',sm1.memory_title),
      jsonb_build_object('target_memory',sm2.memory_title)
    ),
    now(),
    now()
  FROM public.strategic_memory_nodes sm1
  JOIN public.strategic_memory_nodes sm2
    ON sm1.id <> sm2.id
  WHERE sm1.updated_at >= now() - interval '1 day'
    AND sm2.updated_at >= now() - interval '1 day'
    AND (
      sm1.primary_categories = sm2.primary_categories
      OR sm1.primary_regions = sm2.primary_regions
    )
  ON CONFLICT(source_memory_id, target_memory_id) DO UPDATE SET
    relationship_strength = EXCLUDED.relationship_strength,
    evidence = EXCLUDED.evidence,
    updated_at = now();

  GET DIAGNOSTICS v_edges = ROW_COUNT;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('strategic-memory-graph','success','nodes=' || v_nodes || ', edges=' || v_edges);

  RETURN jsonb_build_object('status','success','memory_nodes',v_nodes,'memory_edges',v_edges);
END;
$$;

-- =====================================================
-- 12. Safe orchestration function. Run this from cron/edge, not migrations.
-- =====================================================
CREATE OR REPLACE FUNCTION public.run_commercial_intelligence_jobs(
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
  r5 jsonb;
  r6 jsonb;
  r7 jsonb;
  r8 jsonb;
BEGIN
  r1 := public.compute_commercial_signal_scores(p_window);
  r2 := public.generate_narrative_clusters(p_window);
  r3 := public.compute_adaptive_signal_rankings('global_exec_default', p_window);
  r4 := public.detect_strategic_anomalies(p_window);
  r5 := public.generate_predictive_forecasts(p_window);
  r6 := public.compute_contagion_maps(interval '72 hours');
  r7 := public.generate_intervention_recommendations(p_window);
  r8 := public.generate_executive_briefing_packet();

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('commercial-intelligence-orchestrator','success','jobs_completed');

  RETURN jsonb_build_object(
    'status','success',
    'commercial_scores',r1,
    'narrative_clusters',r2,
    'adaptive_rankings',r3,
    'anomalies',r4,
    'forecasts',r5,
    'contagion',r6,
    'interventions',r7,
    'briefing',r8
  );
END;
$$;

INSERT INTO public.automation_logs(job_name,status,message)
VALUES (
  'commercial-intelligence-hotfix',
  'success',
  'production safety hotfix installed: stable forecasts, bounded causal links, duplicate guards, missing columns, memory updated_at'
);
