-- Adaptive Relevance Intelligence Engine
-- Personalized strategic filtering + relevance scoring

CREATE TABLE IF NOT EXISTS user_intelligence_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  profile_name text DEFAULT 'default',
  strategic_focus jsonb DEFAULT '[]'::jsonb,
  monitored_regions jsonb DEFAULT '[]'::jsonb,
  monitored_categories jsonb DEFAULT '[]'::jsonb,
  monitored_entities jsonb DEFAULT '[]'::jsonb,
  risk_sensitivity numeric DEFAULT 50,
  anomaly_sensitivity numeric DEFAULT 50,
  predictive_sensitivity numeric DEFAULT 50,
  noise_tolerance numeric DEFAULT 50,
  strategic_weight_vector jsonb DEFAULT '{
    "urgency":0.25,
    "impact":0.25,
    "predictive":0.20,
    "anomaly":0.15,
    "proximity":0.15
  }'::jsonb,
  learning_enabled boolean DEFAULT true,
  last_profile_adaptation_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_intelligence_profiles_unique
ON user_intelligence_profiles(user_id, profile_name);

CREATE TABLE IF NOT EXISTS signal_relevance_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL,
  user_id uuid NOT NULL,
  relevance_score numeric NOT NULL,
  urgency_component numeric DEFAULT 0,
  impact_component numeric DEFAULT 0,
  predictive_component numeric DEFAULT 0,
  anomaly_component numeric DEFAULT 0,
  proximity_component numeric DEFAULT 0,
  narrative_alignment_component numeric DEFAULT 0,
  strategic_match_reasons jsonb DEFAULT '[]'::jsonb,
  suppressed_reason text,
  generated_at timestamptz DEFAULT now(),
  UNIQUE(signal_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_signal_relevance_user
ON signal_relevance_scores(user_id, relevance_score DESC);

CREATE INDEX IF NOT EXISTS idx_signal_relevance_signal
ON signal_relevance_scores(signal_id);

CREATE TABLE IF NOT EXISTS adaptive_signal_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL,
  user_id uuid NOT NULL,
  feedback_type text NOT NULL,
  feedback_weight numeric DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adaptive_feedback_user
ON adaptive_signal_feedback(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION compute_signal_relevance(
  p_signal_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_signal record;
  v_profile record;
  v_urgency numeric := 0;
  v_impact numeric := 0;
  v_predictive numeric := 0;
  v_anomaly numeric := 0;
  v_proximity numeric := 0;
  v_narrative numeric := 0;
  v_total numeric := 0;
  v_reasons jsonb := '[]'::jsonb;
BEGIN
  SELECT *
  INTO v_signal
  FROM global_signals
  WHERE id = p_signal_id;

  SELECT *
  INTO v_profile
  FROM user_intelligence_profiles
  WHERE user_id = p_user_id
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_signal IS NULL THEN
    RETURN jsonb_build_object('status','error','message','signal_not_found');
  END IF;

  IF v_profile IS NULL THEN
    RETURN jsonb_build_object('status','error','message','profile_not_found');
  END IF;

  v_urgency := COALESCE(v_signal.urgency_score,0)
    * COALESCE((v_profile.strategic_weight_vector->>'urgency')::numeric,0.25);

  v_impact := COALESCE(v_signal.impact_score,0)
    * COALESCE((v_profile.strategic_weight_vector->>'impact')::numeric,0.25);

  v_predictive := COALESCE(v_signal.predictive_priority,0)
    * COALESCE((v_profile.strategic_weight_vector->>'predictive')::numeric,0.20);

  v_anomaly := COALESCE(v_signal.anomaly_score,0)
    * COALESCE((v_profile.strategic_weight_vector->>'anomaly')::numeric,0.15);

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(v_profile.monitored_categories) x
    WHERE lower(x.value) = lower(COALESCE(v_signal.category,''))
  ) THEN
    v_narrative := 25;
    v_reasons := v_reasons || jsonb_build_array('category_match');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(v_profile.monitored_regions) x
    WHERE x.value = ANY(COALESCE(v_signal.affected_countries,'{}'))
  ) THEN
    v_proximity := 30;
    v_reasons := v_reasons || jsonb_build_array('regional_match');
  END IF;

  IF COALESCE(v_signal.predictive_priority,0) >= v_profile.predictive_sensitivity THEN
    v_reasons := v_reasons || jsonb_build_array('predictive_threshold_exceeded');
  END IF;

  IF COALESCE(v_signal.anomaly_score,0) >= v_profile.anomaly_sensitivity THEN
    v_reasons := v_reasons || jsonb_build_array('anomaly_threshold_exceeded');
  END IF;

  v_total := LEAST(100,
    ROUND(
      v_urgency +
      v_impact +
      v_predictive +
      v_anomaly +
      v_proximity +
      v_narrative
    ,2)
  );

  INSERT INTO signal_relevance_scores (
    signal_id,
    user_id,
    relevance_score,
    urgency_component,
    impact_component,
    predictive_component,
    anomaly_component,
    proximity_component,
    narrative_alignment_component,
    strategic_match_reasons
  )
  VALUES (
    p_signal_id,
    p_user_id,
    v_total,
    v_urgency,
    v_impact,
    v_predictive,
    v_anomaly,
    v_proximity,
    v_narrative,
    v_reasons
  )
  ON CONFLICT(signal_id,user_id)
  DO UPDATE SET
    relevance_score = EXCLUDED.relevance_score,
    urgency_component = EXCLUDED.urgency_component,
    impact_component = EXCLUDED.impact_component,
    predictive_component = EXCLUDED.predictive_component,
    anomaly_component = EXCLUDED.anomaly_component,
    proximity_component = EXCLUDED.proximity_component,
    narrative_alignment_component = EXCLUDED.narrative_alignment_component,
    strategic_match_reasons = EXCLUDED.strategic_match_reasons,
    generated_at = now();

  RETURN jsonb_build_object(
    'status','success',
    'relevance_score',v_total,
    'reasons',v_reasons,
    'urgency_component',v_urgency,
    'impact_component',v_impact,
    'predictive_component',v_predictive,
    'anomaly_component',v_anomaly,
    'proximity_component',v_proximity
  );
END;
$$;

CREATE OR REPLACE VIEW adaptive_relevance_overview AS
SELECT
  srs.user_id,
  COUNT(*) AS scored_signals,
  ROUND(AVG(srs.relevance_score)::numeric,2) AS avg_relevance,
  ROUND(MAX(srs.relevance_score)::numeric,2) AS max_relevance,
  COUNT(*) FILTER (WHERE srs.relevance_score >= 75) AS critical_signals,
  COUNT(*) FILTER (WHERE srs.relevance_score BETWEEN 50 AND 74) AS strategic_signals,
  COUNT(*) FILTER (WHERE srs.relevance_score < 25) AS suppressed_noise,
  MAX(srs.generated_at) AS last_scored_at
FROM signal_relevance_scores srs
GROUP BY srs.user_id;

INSERT INTO automation_logs(job_name,status,message)
VALUES (
  'adaptive-relevance-engine-bootstrap',
  'success',
  'adaptive relevance infrastructure initialized'
);
