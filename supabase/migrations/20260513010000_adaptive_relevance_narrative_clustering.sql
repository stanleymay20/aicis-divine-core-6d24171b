-- Adaptive Relevance Learning + Narrative Clustering
-- Moves AICIS from static scoring toward adaptive strategic intelligence

CREATE TABLE IF NOT EXISTS user_intelligence_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  organization_id uuid,
  profile_key text UNIQUE NOT NULL,
  profile_name text NOT NULL,
  primary_domains jsonb DEFAULT '[]'::jsonb,
  primary_regions jsonb DEFAULT '[]'::jsonb,
  preferred_categories jsonb DEFAULT '[]'::jsonb,
  suppressed_categories jsonb DEFAULT '[]'::jsonb,
  strategic_interest_weights jsonb DEFAULT '{}'::jsonb,
  minimum_relevance_threshold numeric DEFAULT 60,
  adaptive_learning_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intelligence_feedback_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid REFERENCES global_signals(id) ON DELETE CASCADE,
  profile_key text NOT NULL,
  feedback_type text NOT NULL,
  feedback_score numeric DEFAULT 0,
  feedback_reason text,
  event_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_profile_signal
ON intelligence_feedback_events(profile_key, signal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS adaptive_signal_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid REFERENCES global_signals(id) ON DELETE CASCADE,
  profile_key text NOT NULL,
  adaptive_relevance_score numeric DEFAULT 0,
  personalization_boost numeric DEFAULT 0,
  suppression_penalty numeric DEFAULT 0,
  strategic_priority_rank integer,
  ranking_explanation jsonb DEFAULT '[]'::jsonb,
  ranked_at timestamptz DEFAULT now(),
  UNIQUE(signal_id, profile_key)
);

CREATE INDEX IF NOT EXISTS idx_adaptive_rankings_profile
ON adaptive_signal_rankings(profile_key, adaptive_relevance_score DESC);

CREATE TABLE IF NOT EXISTS narrative_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_key text UNIQUE NOT NULL,
  narrative_title text,
  narrative_summary text,
  primary_category text,
  affected_regions jsonb DEFAULT '[]'::jsonb,
  signal_count integer DEFAULT 0,
  avg_urgency numeric DEFAULT 0,
  avg_impact numeric DEFAULT 0,
  avg_confidence numeric DEFAULT 0,
  narrative_momentum_score numeric DEFAULT 0,
  strategic_importance_score numeric DEFAULT 0,
  anomaly_amplification_score numeric DEFAULT 0,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS narrative_cluster_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid REFERENCES narrative_clusters(id) ON DELETE CASCADE,
  signal_id uuid REFERENCES global_signals(id) ON DELETE CASCADE,
  cluster_confidence numeric DEFAULT 0,
  narrative_role text DEFAULT 'supporting',
  linked_at timestamptz DEFAULT now(),
  UNIQUE(cluster_id, signal_id)
);

CREATE INDEX IF NOT EXISTS idx_narrative_cluster_signals_cluster
ON narrative_cluster_signals(cluster_id, cluster_confidence DESC);

CREATE TABLE IF NOT EXISTS strategic_anomaly_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid REFERENCES global_signals(id) ON DELETE CASCADE,
  anomaly_type text,
  anomaly_score numeric DEFAULT 0,
  anomaly_reason text,
  escalation_probability numeric DEFAULT 0,
  systemic_risk_projection numeric DEFAULT 0,
  recommended_attention_band text DEFAULT 'monitor',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strategic_anomaly_events_score
ON strategic_anomaly_events(anomaly_score DESC, escalation_probability DESC);

INSERT INTO user_intelligence_profiles (
  profile_key,
  profile_name,
  primary_domains,
  preferred_categories,
  suppressed_categories,
  strategic_interest_weights,
  minimum_relevance_threshold
)
VALUES
(
  'global_exec_default',
  'Global Executive Intelligence',
  jsonb_build_array('geopolitics','economics','energy','supply-chain'),
  jsonb_build_array('conflict','energy','economy','cybersecurity','supply-chain','trade'),
  jsonb_build_array('sports','celebrity','entertainment'),
  jsonb_build_object(
    'urgency',0.24,
    'impact',0.28,
    'confidence',0.18,
    'predictive',0.20,
    'anomaly',0.10
  ),
  68
),
(
  'humanitarian_response_default',
  'Humanitarian Response Intelligence',
  jsonb_build_array('humanitarian','migration','climate','public_health'),
  jsonb_build_array('migration_displacement','public_health','food_agriculture','climate_disaster','conflict'),
  jsonb_build_array('celebrity','gaming','consumer-tech'),
  jsonb_build_object(
    'urgency',0.30,
    'impact',0.25,
    'confidence',0.18,
    'predictive',0.15,
    'anomaly',0.12
  ),
  62
)
ON CONFLICT(profile_key) DO UPDATE SET
  profile_name = EXCLUDED.profile_name,
  preferred_categories = EXCLUDED.preferred_categories,
  suppressed_categories = EXCLUDED.suppressed_categories,
  strategic_interest_weights = EXCLUDED.strategic_interest_weights,
  updated_at = now();

CREATE OR REPLACE FUNCTION generate_narrative_clusters(
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_clusters integer := 0;
BEGIN
  WITH clustered AS (
    SELECT
      md5(
        lower(COALESCE(category,'unknown')) || '|' ||
        COALESCE(array_to_string(affected_countries,','),'global')
      ) AS cluster_key,
      category,
      affected_countries,
      COUNT(*) AS signal_count,
      AVG(COALESCE(urgency_score,0)) AS avg_urgency,
      AVG(COALESCE(impact_score,0)) AS avg_impact,
      AVG(COALESCE(confidence_score,0)) AS avg_confidence,
      AVG(COALESCE(anomaly_score,0)) AS avg_anomaly,
      MIN(COALESCE(first_detected_at,created_at)) AS first_seen,
      MAX(COALESCE(first_detected_at,created_at)) AS last_seen,
      ARRAY_AGG(id ORDER BY COALESCE(impact_score,0) DESC) AS signal_ids
    FROM global_signals
    WHERE COALESCE(ingested_at, created_at) >= now() - p_window
      AND canonical_event_status = 'canonical'
    GROUP BY 1,2,3
    HAVING COUNT(*) >= 2
  )
  INSERT INTO narrative_clusters (
    cluster_key,
    narrative_title,
    narrative_summary,
    primary_category,
    affected_regions,
    signal_count,
    avg_urgency,
    avg_impact,
    avg_confidence,
    narrative_momentum_score,
    strategic_importance_score,
    anomaly_amplification_score,
    first_seen_at,
    last_seen_at,
    updated_at
  )
  SELECT
    c.cluster_key,
    CONCAT(
      initcap(REPLACE(COALESCE(c.category,'unknown'),'-',' ')),
      ' narrative cluster'
    ),
    CONCAT(
      c.signal_count,
      ' related signals detected across ',
      COALESCE(array_length(c.affected_countries,1),0),
      ' regions with avg impact ',
      ROUND(c.avg_impact::numeric,1)
    ),
    c.category,
    to_jsonb(COALESCE(c.affected_countries, ARRAY['GLOBAL']::text[])),
    c.signal_count,
    ROUND(c.avg_urgency::numeric,2),
    ROUND(c.avg_impact::numeric,2),
    ROUND(c.avg_confidence::numeric,2),
    LEAST(100, ROUND((
      c.signal_count * 4 +
      c.avg_urgency * 0.30 +
      c.avg_impact * 0.30
    )::numeric,2)),
    LEAST(100, ROUND((
      c.avg_impact * 0.40 +
      c.avg_confidence * 0.20 +
      c.signal_count * 3 +
      c.avg_urgency * 0.20
    )::numeric,2)),
    LEAST(100, ROUND((
      c.avg_anomaly * 0.50 +
      c.signal_count * 2
    )::numeric,2)),
    c.first_seen,
    c.last_seen,
    now()
  FROM clustered c
  ON CONFLICT(cluster_key) DO UPDATE SET
    narrative_summary = EXCLUDED.narrative_summary,
    signal_count = EXCLUDED.signal_count,
    avg_urgency = EXCLUDED.avg_urgency,
    avg_impact = EXCLUDED.avg_impact,
    avg_confidence = EXCLUDED.avg_confidence,
    narrative_momentum_score = EXCLUDED.narrative_momentum_score,
    strategic_importance_score = EXCLUDED.strategic_importance_score,
    anomaly_amplification_score = EXCLUDED.anomaly_amplification_score,
    last_seen_at = EXCLUDED.last_seen_at,
    updated_at = now();

  GET DIAGNOSTICS v_clusters = ROW_COUNT;

  INSERT INTO narrative_cluster_signals (
    cluster_id,
    signal_id,
    cluster_confidence,
    narrative_role,
    linked_at
  )
  SELECT
    nc.id,
    gs.id,
    LEAST(100, ROUND((
      COALESCE(gs.confidence_score,0) * 0.40 +
      COALESCE(gs.impact_score,0) * 0.30 +
      COALESCE(gs.urgency_score,0) * 0.30
    )::numeric,2)),
    CASE
      WHEN COALESCE(gs.impact_score,0) >= 80 THEN 'primary-driver'
      WHEN COALESCE(gs.urgency_score,0) >= 70 THEN 'escalation-signal'
      ELSE 'supporting'
    END,
    now()
  FROM narrative_clusters nc
  JOIN global_signals gs
    ON md5(
      lower(COALESCE(gs.category,'unknown')) || '|' ||
      COALESCE(array_to_string(gs.affected_countries,','),'global')
    ) = nc.cluster_key
  WHERE COALESCE(gs.ingested_at, gs.created_at) >= now() - p_window
  ON CONFLICT(cluster_id, signal_id) DO UPDATE SET
    cluster_confidence = EXCLUDED.cluster_confidence,
    narrative_role = EXCLUDED.narrative_role,
    linked_at = now();

  INSERT INTO automation_logs(job_name,status,message)
  VALUES ('narrative-clustering','success','clusters=' || v_clusters);

  RETURN jsonb_build_object(
    'status','success',
    'clusters_generated',v_clusters,
    'generated_at',now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION compute_adaptive_signal_rankings(
  p_profile_key text DEFAULT 'global_exec_default',
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_threshold numeric := 60;
  v_ranked integer := 0;
BEGIN
  SELECT minimum_relevance_threshold
  INTO v_threshold
  FROM user_intelligence_profiles
  WHERE profile_key = p_profile_key;

  INSERT INTO adaptive_signal_rankings (
    signal_id,
    profile_key,
    adaptive_relevance_score,
    personalization_boost,
    suppression_penalty,
    strategic_priority_rank,
    ranking_explanation,
    ranked_at
  )
  SELECT
    gs.id,
    p_profile_key,
    LEAST(100, ROUND((
      COALESCE(css.commercial_relevance_score,0) * 0.40 +
      COALESCE(css.trust_adjusted_score,0) * 0.25 +
      COALESCE(gs.predictive_priority,0) * 0.20 +
      COALESCE(gs.anomaly_score,0) * 0.15 +
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(uip.preferred_categories) pc
          WHERE lower(pc.value) = lower(COALESCE(gs.category,''))
        ) THEN 15 ELSE 0 END -
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(uip.suppressed_categories) sc
          WHERE lower(sc.value) = lower(COALESCE(gs.category,''))
        ) THEN 35 ELSE 0 END
    )::numeric,2)) AS adaptive_relevance_score,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(uip.preferred_categories) pc
        WHERE lower(pc.value) = lower(COALESCE(gs.category,''))
      ) THEN 15
      ELSE 0
    END AS personalization_boost,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(uip.suppressed_categories) sc
        WHERE lower(sc.value) = lower(COALESCE(gs.category,''))
      ) THEN 35
      ELSE 0
    END AS suppression_penalty,
    ROW_NUMBER() OVER (
      ORDER BY
        (
          COALESCE(css.trust_adjusted_score,0) +
          COALESCE(gs.predictive_priority,0) +
          COALESCE(gs.impact_score,0)
        ) DESC,
        gs.ingested_at DESC
    ),
    jsonb_build_array(
      jsonb_build_object('commercial_score',COALESCE(css.commercial_relevance_score,0)),
      jsonb_build_object('trust_score',COALESCE(css.trust_adjusted_score,0)),
      jsonb_build_object('predictive_priority',COALESCE(gs.predictive_priority,0)),
      jsonb_build_object('category',COALESCE(gs.category,'unknown'))
    ),
    now()
  FROM global_signals gs
  LEFT JOIN commercial_signal_scores css
    ON css.signal_id = gs.id
   AND css.segment_key = 'executive_global_risk'
  JOIN user_intelligence_profiles uip
    ON uip.profile_key = p_profile_key
  WHERE COALESCE(gs.ingested_at, gs.created_at) >= now() - p_window
    AND COALESCE(css.commercial_relevance_score,0) >= v_threshold
  ON CONFLICT(signal_id, profile_key) DO UPDATE SET
    adaptive_relevance_score = EXCLUDED.adaptive_relevance_score,
    personalization_boost = EXCLUDED.personalization_boost,
    suppression_penalty = EXCLUDED.suppression_penalty,
    strategic_priority_rank = EXCLUDED.strategic_priority_rank,
    ranking_explanation = EXCLUDED.ranking_explanation,
    ranked_at = now();

  GET DIAGNOSTICS v_ranked = ROW_COUNT;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES ('adaptive-relevance-ranking','success','profile=' || p_profile_key || ', ranked=' || v_ranked);

  RETURN jsonb_build_object(
    'status','success',
    'profile_key',p_profile_key,
    'ranked_signals',v_ranked
  );
END;
$$;

CREATE OR REPLACE FUNCTION detect_strategic_anomalies(
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_events integer := 0;
BEGIN
  INSERT INTO strategic_anomaly_events (
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
  FROM global_signals gs
  WHERE COALESCE(gs.ingested_at, gs.created_at) >= now() - p_window
    AND (
      COALESCE(gs.anomaly_score,0) >= 65
      OR COALESCE(gs.predictive_priority,0) >= 70
      OR (
        COALESCE(gs.impact_score,0) >= 80
        AND COALESCE(gs.corroboration_count,0) >= 2
      )
    )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_events = ROW_COUNT;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES ('strategic-anomaly-detection','success','events=' || v_events);

  RETURN jsonb_build_object(
    'status','success',
    'anomaly_events',v_events
  );
END;
$$;

CREATE OR REPLACE VIEW adaptive_intelligence_command_view AS
SELECT
  asr.profile_key,
  asr.strategic_priority_rank,
  COALESCE(gs.translated_title, gs.title) AS title,
  gs.category,
  gs.affected_countries,
  asr.adaptive_relevance_score,
  asr.personalization_boost,
  asr.suppression_penalty,
  gs.predictive_priority,
  gs.impact_score,
  gs.urgency_score,
  gs.confidence_score,
  asr.ranked_at
FROM adaptive_signal_rankings asr
JOIN global_signals gs
  ON gs.id = asr.signal_id
ORDER BY asr.profile_key,
         asr.strategic_priority_rank ASC;

CREATE OR REPLACE VIEW narrative_intelligence_command_view AS
SELECT
  nc.narrative_title,
  nc.primary_category,
  nc.signal_count,
  nc.avg_urgency,
  nc.avg_impact,
  nc.avg_confidence,
  nc.narrative_momentum_score,
  nc.strategic_importance_score,
  nc.anomaly_amplification_score,
  nc.affected_regions,
  nc.last_seen_at
FROM narrative_clusters nc
ORDER BY nc.strategic_importance_score DESC,
         nc.narrative_momentum_score DESC;

SELECT generate_narrative_clusters(interval '24 hours');
SELECT compute_adaptive_signal_rankings('global_exec_default', interval '24 hours');
SELECT compute_adaptive_signal_rankings('humanitarian_response_default', interval '24 hours');
SELECT detect_strategic_anomalies(interval '24 hours');

INSERT INTO automation_logs(job_name,status,message)
VALUES (
  'adaptive-intelligence-bootstrap',
  'success',
  'adaptive relevance, narrative clustering, and anomaly detection initialized'
);
