-- Causal Forecasting + Calibration + Contagion Intelligence Engine
-- Pushes AICIS toward strategic foresight instead of reactive aggregation

CREATE TABLE IF NOT EXISTS strategic_causal_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_signal_id uuid REFERENCES global_signals(id) ON DELETE CASCADE,
  target_signal_id uuid REFERENCES global_signals(id) ON DELETE CASCADE,
  causal_confidence numeric DEFAULT 0,
  causal_direction text DEFAULT 'forward',
  causal_type text,
  propagation_delay_hours numeric DEFAULT 0,
  systemic_impact_multiplier numeric DEFAULT 1,
  evidence jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE(source_signal_id, target_signal_id)
);

CREATE INDEX IF NOT EXISTS idx_strategic_causal_links_source
ON strategic_causal_links(source_signal_id, causal_confidence DESC);

CREATE INDEX IF NOT EXISTS idx_strategic_causal_links_target
ON strategic_causal_links(target_signal_id, causal_confidence DESC);

CREATE TABLE IF NOT EXISTS predictive_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_key text UNIQUE NOT NULL,
  originating_signal_id uuid REFERENCES global_signals(id) ON DELETE CASCADE,
  forecast_domain text,
  forecast_title text,
  forecast_hypothesis text,
  forecast_probability numeric DEFAULT 0,
  forecast_confidence numeric DEFAULT 0,
  expected_impact numeric DEFAULT 0,
  escalation_risk numeric DEFAULT 0,
  forecast_window_hours integer DEFAULT 168,
  expected_regions jsonb DEFAULT '[]'::jsonb,
  expected_categories jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'active',
  validation_outcome text,
  calibration_error numeric,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  validated_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_predictive_forecasts_status
ON predictive_forecasts(status, forecast_probability DESC);

CREATE TABLE IF NOT EXISTS forecast_validation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id uuid REFERENCES predictive_forecasts(id) ON DELETE CASCADE,
  validating_signal_id uuid REFERENCES global_signals(id) ON DELETE CASCADE,
  validation_score numeric DEFAULT 0,
  validation_type text,
  validation_notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contagion_propagation_maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  propagation_key text UNIQUE NOT NULL,
  origin_region text,
  affected_regions jsonb DEFAULT '[]'::jsonb,
  propagation_category text,
  propagation_strength numeric DEFAULT 0,
  contagion_velocity numeric DEFAULT 0,
  estimated_spread_probability numeric DEFAULT 0,
  strategic_severity numeric DEFAULT 0,
  propagation_summary text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contagion_maps_strength
ON contagion_propagation_maps(propagation_strength DESC, strategic_severity DESC);

CREATE TABLE IF NOT EXISTS intervention_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid REFERENCES global_signals(id) ON DELETE CASCADE,
  recommendation_type text,
  recommendation_title text,
  recommendation_summary text,
  urgency_band text DEFAULT 'monitor',
  expected_effectiveness numeric DEFAULT 0,
  implementation_complexity numeric DEFAULT 0,
  confidence numeric DEFAULT 0,
  recommended_window_hours integer DEFAULT 72,
  recommendation_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intervention_recommendations_urgency
ON intervention_recommendations(urgency_band, expected_effectiveness DESC);

CREATE TABLE IF NOT EXISTS intelligence_calibration_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_window text,
  forecast_count integer DEFAULT 0,
  validated_forecasts integer DEFAULT 0,
  avg_calibration_error numeric DEFAULT 0,
  prediction_accuracy numeric DEFAULT 0,
  false_positive_rate numeric DEFAULT 0,
  false_negative_rate numeric DEFAULT 0,
  calibration_grade text DEFAULT 'ungraded',
  notes jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION generate_causal_signal_links(
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_links integer := 0;
BEGIN
  INSERT INTO strategic_causal_links (
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
    LEAST(100, ROUND((
      CASE WHEN lower(COALESCE(s1.category,'')) = lower(COALESCE(s2.category,'')) THEN 30 ELSE 0 END +
      CASE WHEN s1.affected_countries && s2.affected_countries THEN 25 ELSE 0 END +
      ABS(COALESCE(s1.predictive_priority,0) - COALESCE(s2.predictive_priority,0)) * -0.20 +
      (COALESCE(s1.impact_score,0) + COALESCE(s2.impact_score,0)) * 0.20 +
      CASE WHEN s1.corroboration_count >= 2 AND s2.corroboration_count >= 2 THEN 10 ELSE 0 END
    )::numeric,2)),
    'forward',
    CASE
      WHEN lower(COALESCE(s1.category,'')) = lower(COALESCE(s2.category,'')) THEN 'same-domain-escalation'
      WHEN s1.affected_countries && s2.affected_countries THEN 'regional-propagation'
      ELSE 'cross-domain-influence'
    END,
    EXTRACT(EPOCH FROM (COALESCE(s2.ingested_at,s2.created_at) - COALESCE(s1.ingested_at,s1.created_at))) / 3600,
    LEAST(5, ROUND(((COALESCE(s1.impact_score,0) + COALESCE(s2.impact_score,0))/100)::numeric,2)),
    jsonb_build_array(
      jsonb_build_object('source_category',COALESCE(s1.category,'unknown')),
      jsonb_build_object('target_category',COALESCE(s2.category,'unknown')),
      jsonb_build_object('shared_regions',COALESCE(s1.affected_countries,'{}'))
    ),
    now()
  FROM global_signals s1
  JOIN global_signals s2
    ON s1.id <> s2.id
   AND COALESCE(s2.ingested_at,s2.created_at) > COALESCE(s1.ingested_at,s1.created_at)
   AND COALESCE(s2.ingested_at,s2.created_at) <= COALESCE(s1.ingested_at,s1.created_at) + interval '72 hours'
  WHERE COALESCE(s1.ingested_at,s1.created_at) >= now() - p_window
    AND COALESCE(s1.impact_score,0) >= 60
    AND COALESCE(s2.impact_score,0) >= 60
  ON CONFLICT(source_signal_id, target_signal_id) DO UPDATE SET
    causal_confidence = EXCLUDED.causal_confidence,
    causal_type = EXCLUDED.causal_type,
    propagation_delay_hours = EXCLUDED.propagation_delay_hours,
    systemic_impact_multiplier = EXCLUDED.systemic_impact_multiplier,
    evidence = EXCLUDED.evidence;

  GET DIAGNOSTICS v_links = ROW_COUNT;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES ('causal-link-generation','success','links=' || v_links);

  RETURN jsonb_build_object(
    'status','success',
    'causal_links_generated',v_links
  );
END;
$$;

CREATE OR REPLACE FUNCTION generate_predictive_forecasts(
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_forecasts integer := 0;
BEGIN
  INSERT INTO predictive_forecasts (
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
    md5(gs.id::text || now()::text),
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
  FROM global_signals gs
  WHERE COALESCE(gs.ingested_at,gs.created_at) >= now() - p_window
    AND (
      COALESCE(gs.predictive_priority,0) >= 70
      OR COALESCE(gs.anomaly_score,0) >= 70
      OR COALESCE(gs.impact_score,0) >= 80
    )
  ON CONFLICT(forecast_key) DO NOTHING;

  GET DIAGNOSTICS v_forecasts = ROW_COUNT;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES ('predictive-forecast-generation','success','forecasts=' || v_forecasts);

  RETURN jsonb_build_object(
    'status','success',
    'forecasts_generated',v_forecasts
  );
END;
$$;

CREATE OR REPLACE FUNCTION compute_contagion_maps(
  p_window interval DEFAULT interval '72 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_maps integer := 0;
BEGIN
  WITH regional_patterns AS (
    SELECT
      lower(COALESCE(category,'unknown')) AS category,
      unnest(COALESCE(affected_countries, ARRAY['GLOBAL'])) AS region,
      COUNT(*) AS signals,
      AVG(COALESCE(impact_score,0)) AS avg_impact,
      AVG(COALESCE(urgency_score,0)) AS avg_urgency,
      AVG(COALESCE(predictive_priority,0)) AS avg_predictive
    FROM global_signals
    WHERE COALESCE(ingested_at,created_at) >= now() - p_window
      AND canonical_event_status = 'canonical'
    GROUP BY 1,2
  )
  INSERT INTO contagion_propagation_maps (
    propagation_key,
    origin_region,
    affected_regions,
    propagation_category,
    propagation_strength,
    contagion_velocity,
    estimated_spread_probability,
    strategic_severity,
    propagation_summary,
    created_at,
    updated_at
  )
  SELECT
    md5(rp.category || '|' || rp.region),
    rp.region,
    jsonb_build_array(rp.region),
    rp.category,
    LEAST(100, ROUND((
      rp.signals * 5 +
      rp.avg_impact * 0.35 +
      rp.avg_predictive * 0.25
    )::numeric,2)),
    LEAST(100, ROUND((
      rp.avg_urgency * 0.40 +
      rp.avg_predictive * 0.30
    )::numeric,2)),
    LEAST(100, ROUND((
      rp.avg_predictive * 0.50 +
      rp.avg_impact * 0.30
    )::numeric,2)),
    LEAST(100, ROUND((
      rp.avg_impact * 0.40 +
      rp.avg_urgency * 0.30 +
      rp.signals * 2
    )::numeric,2)),
    CONCAT(
      'Elevated propagation detected in ',
      rp.category,
      ' affecting ',
      rp.region,
      ' with ',
      rp.signals,
      ' related signals.'
    ),
    now(),
    now()
  FROM regional_patterns rp
  WHERE rp.signals >= 3
  ON CONFLICT(propagation_key) DO UPDATE SET
    propagation_strength = EXCLUDED.propagation_strength,
    contagion_velocity = EXCLUDED.contagion_velocity,
    estimated_spread_probability = EXCLUDED.estimated_spread_probability,
    strategic_severity = EXCLUDED.strategic_severity,
    propagation_summary = EXCLUDED.propagation_summary,
    updated_at = now();

  GET DIAGNOSTICS v_maps = ROW_COUNT;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES ('contagion-map-generation','success','maps=' || v_maps);

  RETURN jsonb_build_object(
    'status','success',
    'contagion_maps_generated',v_maps
  );
END;
$$;

CREATE OR REPLACE FUNCTION generate_intervention_recommendations(
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recommendations integer := 0;
BEGIN
  INSERT INTO intervention_recommendations (
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
    LEAST(100, ROUND((
      CASE WHEN COALESCE(gs.category,'') IN ('conflict','geopolitics') THEN 70
           WHEN COALESCE(gs.category,'') IN ('cybersecurity') THEN 55
           ELSE 45 END
    )::numeric,2)),
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
  FROM global_signals gs
  WHERE COALESCE(gs.ingested_at,gs.created_at) >= now() - p_window
    AND (
      COALESCE(gs.impact_score,0) >= 70
      OR COALESCE(gs.predictive_priority,0) >= 70
      OR COALESCE(gs.urgency_score,0) >= 75
    )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_recommendations = ROW_COUNT;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES ('intervention-recommendation-generation','success','recommendations=' || v_recommendations);

  RETURN jsonb_build_object(
    'status','success',
    'recommendations_generated',v_recommendations
  );
END;
$$;

CREATE OR REPLACE FUNCTION run_prediction_calibration_audit()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total integer := 0;
  v_validated integer := 0;
  v_accuracy numeric := 0;
  v_false_positive numeric := 0;
  v_grade text := 'ungraded';
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM predictive_forecasts;

  SELECT COUNT(*) INTO v_validated
  FROM predictive_forecasts
  WHERE validation_outcome IS NOT NULL;

  v_accuracy := CASE
    WHEN v_total = 0 THEN 0
    ELSE ROUND((v_validated::numeric / v_total::numeric) * 100,2)
  END;

  v_false_positive := CASE
    WHEN v_total = 0 THEN 0
    ELSE ROUND((
      (
        SELECT COUNT(*) FROM predictive_forecasts
        WHERE validation_outcome = 'false_positive'
      )::numeric / v_total::numeric
    ) * 100,2)
  END;

  v_grade := CASE
    WHEN v_accuracy >= 80 THEN 'high-calibration'
    WHEN v_accuracy >= 65 THEN 'moderate-calibration'
    WHEN v_accuracy >= 50 THEN 'emerging-calibration'
    ELSE 'low-calibration'
  END;

  INSERT INTO intelligence_calibration_history (
    audit_window,
    forecast_count,
    validated_forecasts,
    avg_calibration_error,
    prediction_accuracy,
    false_positive_rate,
    false_negative_rate,
    calibration_grade,
    notes,
    created_at
  ) VALUES (
    'global',
    v_total,
    v_validated,
    ROUND((100 - v_accuracy)::numeric,2),
    v_accuracy,
    v_false_positive,
    0,
    v_grade,
    jsonb_build_array(
      jsonb_build_object('note','prediction calibration audit executed'),
      jsonb_build_object('recommendation', CASE
        WHEN v_accuracy < 65 THEN 'increase forecast validation and suppress weak predictions'
        ELSE 'continue calibration refinement'
      END)
    ),
    now()
  );

  INSERT INTO automation_logs(job_name,status,message)
  VALUES ('prediction-calibration-audit','success','accuracy=' || v_accuracy || ', grade=' || v_grade);

  RETURN jsonb_build_object(
    'status','success',
    'prediction_accuracy',v_accuracy,
    'calibration_grade',v_grade
  );
END;
$$;

CREATE OR REPLACE VIEW strategic_forecasting_command_view AS
SELECT
  pf.forecast_title,
  pf.forecast_domain,
  pf.forecast_probability,
  pf.forecast_confidence,
  pf.expected_impact,
  pf.escalation_risk,
  pf.forecast_window_hours,
  pf.status,
  pf.expected_regions,
  pf.created_at,
  pf.expires_at
FROM predictive_forecasts pf
WHERE pf.status = 'active'
ORDER BY pf.forecast_probability DESC,
         pf.escalation_risk DESC;

CREATE OR REPLACE VIEW contagion_intelligence_command_view AS
SELECT
  cpm.origin_region,
  cpm.propagation_category,
  cpm.propagation_strength,
  cpm.contagion_velocity,
  cpm.estimated_spread_probability,
  cpm.strategic_severity,
  cpm.propagation_summary,
  cpm.updated_at
FROM contagion_propagation_maps cpm
ORDER BY cpm.strategic_severity DESC,
         cpm.propagation_strength DESC;

CREATE OR REPLACE VIEW intervention_command_view AS
SELECT
  ir.recommendation_type,
  ir.recommendation_title,
  ir.recommendation_summary,
  ir.urgency_band,
  ir.expected_effectiveness,
  ir.implementation_complexity,
  ir.confidence,
  ir.recommended_window_hours,
  gs.category,
  gs.affected_countries,
  ir.created_at
FROM intervention_recommendations ir
JOIN global_signals gs
  ON gs.id = ir.signal_id
ORDER BY ir.expected_effectiveness DESC,
         ir.confidence DESC;

SELECT generate_causal_signal_links(interval '24 hours');
SELECT generate_predictive_forecasts(interval '24 hours');
SELECT compute_contagion_maps(interval '72 hours');
SELECT generate_intervention_recommendations(interval '24 hours');
SELECT run_prediction_calibration_audit();

INSERT INTO automation_logs(job_name,status,message)
VALUES (
  'strategic-forecasting-bootstrap',
  'success',
  'causal forecasting, contagion mapping, intervention recommendations, and calibration initialized'
);
