-- Recursive Intelligence Memory + Trust Propagation Engine
-- Evolves AICIS toward persistent strategic cognition and recursive intelligence refinement

CREATE TABLE IF NOT EXISTS strategic_memory_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_key text UNIQUE NOT NULL,
  memory_type text NOT NULL,
  memory_title text,
  memory_summary text,
  memory_embedding jsonb DEFAULT '[]'::jsonb,
  primary_regions jsonb DEFAULT '[]'::jsonb,
  primary_categories jsonb DEFAULT '[]'::jsonb,
  strategic_weight numeric DEFAULT 0,
  persistence_score numeric DEFAULT 0,
  recurrence_score numeric DEFAULT 0,
  confidence_score numeric DEFAULT 0,
  first_observed_at timestamptz,
  last_observed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strategic_memory_nodes_weight
ON strategic_memory_nodes(strategic_weight DESC, persistence_score DESC);

CREATE TABLE IF NOT EXISTS strategic_memory_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_memory_id uuid REFERENCES strategic_memory_nodes(id) ON DELETE CASCADE,
  target_memory_id uuid REFERENCES strategic_memory_nodes(id) ON DELETE CASCADE,
  relationship_type text,
  relationship_strength numeric DEFAULT 0,
  recursive_depth integer DEFAULT 1,
  evidence jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE(source_memory_id, target_memory_id)
);

CREATE INDEX IF NOT EXISTS idx_strategic_memory_edges_strength
ON strategic_memory_edges(relationship_strength DESC, recursive_depth DESC);

CREATE TABLE IF NOT EXISTS recursive_trust_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid REFERENCES global_signals(id) ON DELETE CASCADE,
  inherited_trust_score numeric DEFAULT 0,
  recursive_confidence numeric DEFAULT 0,
  network_reinforcement_score numeric DEFAULT 0,
  source_lineage jsonb DEFAULT '[]'::jsonb,
  trust_explanation jsonb DEFAULT '[]'::jsonb,
  calculated_at timestamptz DEFAULT now(),
  UNIQUE(signal_id)
);

CREATE INDEX IF NOT EXISTS idx_recursive_trust_scores
ON recursive_trust_scores(inherited_trust_score DESC, recursive_confidence DESC);

CREATE TABLE IF NOT EXISTS executive_briefing_packets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_key text UNIQUE NOT NULL,
  briefing_title text,
  briefing_summary text,
  strategic_priority_band text DEFAULT 'monitor',
  top_narratives jsonb DEFAULT '[]'::jsonb,
  top_forecasts jsonb DEFAULT '[]'::jsonb,
  top_anomalies jsonb DEFAULT '[]'::jsonb,
  intervention_actions jsonb DEFAULT '[]'::jsonb,
  global_risk_index numeric DEFAULT 0,
  executive_confidence numeric DEFAULT 0,
  briefing_window text DEFAULT '24h',
  generated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signal_decay_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid REFERENCES global_signals(id) ON DELETE CASCADE,
  original_relevance numeric DEFAULT 0,
  current_relevance numeric DEFAULT 0,
  decay_velocity numeric DEFAULT 0,
  persistence_band text DEFAULT 'transient',
  reinforcement_events integer DEFAULT 0,
  last_reinforced_at timestamptz,
  calculated_at timestamptz DEFAULT now(),
  UNIQUE(signal_id)
);

CREATE TABLE IF NOT EXISTS false_positive_suppression_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid REFERENCES global_signals(id) ON DELETE CASCADE,
  suppression_reason text,
  suppression_score numeric DEFAULT 0,
  suppression_confidence numeric DEFAULT 0,
  review_status text DEFAULT 'suppressed',
  evidence jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_false_positive_suppression
ON false_positive_suppression_events(suppression_score DESC);

CREATE OR REPLACE FUNCTION build_strategic_memory_graph(
  p_window interval DEFAULT interval '30 days'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_nodes integer := 0;
  v_edges integer := 0;
BEGIN
  INSERT INTO strategic_memory_nodes (
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
    CONCAT(
      initcap(REPLACE(COALESCE(category,'unknown'),'-',' ')),
      ' strategic memory'
    ),
    CONCAT(
      COUNT(*),
      ' recurring signals detected across historical ingestion windows.'
    ),
    to_jsonb(COALESCE(affected_countries, ARRAY['GLOBAL']::text[])),
    jsonb_build_array(COALESCE(category,'unknown')),
    LEAST(100, ROUND((
      AVG(COALESCE(impact_score,0)) * 0.40 +
      AVG(COALESCE(predictive_priority,0)) * 0.30 +
      COUNT(*) * 2
    )::numeric,2)),
    LEAST(100, ROUND((
      COUNT(*) * 3 +
      AVG(COALESCE(confidence_score,0)) * 0.30
    )::numeric,2)),
    LEAST(100, ROUND((
      COUNT(DISTINCT DATE_TRUNC('day', COALESCE(ingested_at,created_at))) * 5
    )::numeric,2)),
    ROUND(AVG(COALESCE(confidence_score,0))::numeric,2),
    MIN(COALESCE(ingested_at,created_at)),
    MAX(COALESCE(ingested_at,created_at)),
    now(),
    now()
  FROM global_signals
  WHERE COALESCE(ingested_at,created_at) >= now() - p_window
    AND canonical_event_status = 'canonical'
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

  INSERT INTO strategic_memory_edges (
    source_memory_id,
    target_memory_id,
    relationship_type,
    relationship_strength,
    recursive_depth,
    evidence,
    created_at
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
    now()
  FROM strategic_memory_nodes sm1
  JOIN strategic_memory_nodes sm2
    ON sm1.id <> sm2.id
  WHERE sm1.updated_at >= now() - interval '1 day'
    AND sm2.updated_at >= now() - interval '1 day'
  ON CONFLICT(source_memory_id, target_memory_id) DO UPDATE SET
    relationship_strength = EXCLUDED.relationship_strength,
    updated_at = now();

  GET DIAGNOSTICS v_edges = ROW_COUNT;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES ('strategic-memory-graph','success','nodes=' || v_nodes || ', edges=' || v_edges);

  RETURN jsonb_build_object(
    'status','success',
    'memory_nodes',v_nodes,
    'memory_edges',v_edges
  );
END;
$$;

CREATE OR REPLACE FUNCTION compute_recursive_trust_scores(
  p_window interval DEFAULT interval '14 days'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_scores integer := 0;
BEGIN
  INSERT INTO recursive_trust_scores (
    signal_id,
    inherited_trust_score,
    recursive_confidence,
    network_reinforcement_score,
    source_lineage,
    trust_explanation,
    calculated_at
  )
  SELECT
    gs.id,
    LEAST(100, ROUND((
      COALESCE(gs.confidence_score,0) * 0.35 +
      COALESCE(gs.corroboration_count,0) * 10 +
      CASE
        WHEN COALESCE(gs.source_trust_tier,'') = 'tier_1' THEN 25
        WHEN COALESCE(gs.source_trust_tier,'') = 'tier_2' THEN 15
        ELSE 5
      END +
      COALESCE(nc.avg_confidence,0) * 0.20
    )::numeric,2)),
    LEAST(100, ROUND((
      COALESCE(gs.predictive_priority,0) * 0.30 +
      COALESCE(gs.anomaly_score,0) * 0.20 +
      COALESCE(gs.confidence_score,0) * 0.30 +
      COALESCE(nc.strategic_importance_score,0) * 0.20
    )::numeric,2)),
    LEAST(100, ROUND((
      COALESCE(gs.corroboration_count,0) * 12 +
      CASE WHEN scl.source_signal_id IS NOT NULL THEN 20 ELSE 0 END
    )::numeric,2)),
    jsonb_build_array(
      jsonb_build_object('trust_tier',COALESCE(gs.source_trust_tier,'unknown')),
      jsonb_build_object('corroboration_count',COALESCE(gs.corroboration_count,0)),
      jsonb_build_object('category',COALESCE(gs.category,'unknown'))
    ),
    jsonb_build_array(
      jsonb_build_object('confidence_score',COALESCE(gs.confidence_score,0)),
      jsonb_build_object('narrative_support',COALESCE(nc.signal_count,0)),
      jsonb_build_object('causal_support',CASE WHEN scl.source_signal_id IS NOT NULL THEN true ELSE false END)
    ),
    now()
  FROM global_signals gs
  LEFT JOIN narrative_cluster_signals ncs
    ON ncs.signal_id = gs.id
  LEFT JOIN narrative_clusters nc
    ON nc.id = ncs.cluster_id
  LEFT JOIN strategic_causal_links scl
    ON scl.target_signal_id = gs.id
  WHERE COALESCE(gs.ingested_at,gs.created_at) >= now() - p_window
  ON CONFLICT(signal_id) DO UPDATE SET
    inherited_trust_score = EXCLUDED.inherited_trust_score,
    recursive_confidence = EXCLUDED.recursive_confidence,
    network_reinforcement_score = EXCLUDED.network_reinforcement_score,
    source_lineage = EXCLUDED.source_lineage,
    trust_explanation = EXCLUDED.trust_explanation,
    calculated_at = now();

  GET DIAGNOSTICS v_scores = ROW_COUNT;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES ('recursive-trust-propagation','success','scores=' || v_scores);

  RETURN jsonb_build_object(
    'status','success',
    'trust_scores_generated',v_scores
  );
END;
$$;

CREATE OR REPLACE FUNCTION detect_false_positive_patterns(
  p_window interval DEFAULT interval '14 days'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_suppressed integer := 0;
BEGIN
  INSERT INTO false_positive_suppression_events (
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
  FROM global_signals gs
  WHERE COALESCE(gs.ingested_at,gs.created_at) >= now() - p_window
    AND (
      COALESCE(gs.confidence_score,0) < 40
      OR (
        COALESCE(gs.corroboration_count,0) = 0
        AND COALESCE(gs.source_trust_tier,'') = 'tier_3'
      )
    )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_suppressed = ROW_COUNT;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES ('false-positive-suppression','success','suppressed=' || v_suppressed);

  RETURN jsonb_build_object(
    'status','success',
    'suppressed_events',v_suppressed
  );
END;
$$;

CREATE OR REPLACE FUNCTION generate_executive_briefing_packet()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_global_risk numeric := 0;
BEGIN
  SELECT ROUND(AVG(COALESCE(impact_score,0))::numeric,2)
  INTO v_global_risk
  FROM global_signals
  WHERE COALESCE(ingested_at,created_at) >= now() - interval '24 hours';

  INSERT INTO executive_briefing_packets (
    briefing_key,
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
    md5(now()::text),
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
    (
      SELECT jsonb_agg(x)
      FROM (
        SELECT narrative_title, strategic_importance_score
        FROM narrative_intelligence_command_view
        LIMIT 5
      ) x
    ),
    (
      SELECT jsonb_agg(x)
      FROM (
        SELECT forecast_title, forecast_probability
        FROM strategic_forecasting_command_view
        LIMIT 5
      ) x
    ),
    (
      SELECT jsonb_agg(x)
      FROM (
        SELECT anomaly_type, anomaly_score
        FROM strategic_anomaly_events
        ORDER BY anomaly_score DESC
        LIMIT 5
      ) x
    ),
    (
      SELECT jsonb_agg(x)
      FROM (
        SELECT recommendation_title, urgency_band
        FROM intervention_command_view
        LIMIT 5
      ) x
    ),
    v_global_risk,
    LEAST(100, ROUND((
      v_global_risk * 0.40 +
      45
    )::numeric,2)),
    '24h',
    now()
  ) ON CONFLICT(briefing_key) DO NOTHING;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES ('executive-briefing-generation','success','global_risk=' || v_global_risk);

  RETURN jsonb_build_object(
    'status','success',
    'global_risk_index',v_global_risk
  );
END;
$$;

CREATE OR REPLACE FUNCTION compute_signal_decay_intelligence(
  p_window interval DEFAULT interval '30 days'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_decay integer := 0;
BEGIN
  INSERT INTO signal_decay_tracking (
    signal_id,
    original_relevance,
    current_relevance,
    decay_velocity,
    persistence_band,
    reinforcement_events,
    last_reinforced_at,
    calculated_at
  )
  SELECT
    gs.id,
    COALESCE(gs.impact_score,0),
    GREATEST(0, ROUND((
      COALESCE(gs.impact_score,0) -
      (EXTRACT(EPOCH FROM (now() - COALESCE(gs.ingested_at,gs.created_at))) / 86400) * 1.5 +
      COALESCE(gs.corroboration_count,0) * 3
    )::numeric,2)),
    ROUND((
      EXTRACT(EPOCH FROM (now() - COALESCE(gs.ingested_at,gs.created_at))) / 86400
    )::numeric,2),
    CASE
      WHEN COALESCE(gs.predictive_priority,0) >= 80 THEN 'persistent'
      WHEN COALESCE(gs.impact_score,0) >= 70 THEN 'strategic'
      ELSE 'transient'
    END,
    COALESCE(gs.corroboration_count,0),
    COALESCE(gs.updated_at,gs.ingested_at,gs.created_at),
    now()
  FROM global_signals gs
  WHERE COALESCE(gs.ingested_at,gs.created_at) >= now() - p_window
  ON CONFLICT(signal_id) DO UPDATE SET
    current_relevance = EXCLUDED.current_relevance,
    decay_velocity = EXCLUDED.decay_velocity,
    persistence_band = EXCLUDED.persistence_band,
    reinforcement_events = EXCLUDED.reinforcement_events,
    last_reinforced_at = EXCLUDED.last_reinforced_at,
    calculated_at = now();

  GET DIAGNOSTICS v_decay = ROW_COUNT;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES ('signal-decay-intelligence','success','tracked=' || v_decay);

  RETURN jsonb_build_object(
    'status','success',
    'tracked_signals',v_decay
  );
END;
$$;

CREATE OR REPLACE VIEW recursive_trust_command_view AS
SELECT
  rts.inherited_trust_score,
  rts.recursive_confidence,
  rts.network_reinforcement_score,
  COALESCE(gs.translated_title, gs.title) AS signal_title,
  gs.category,
  gs.source_trust_tier,
  gs.corroboration_count,
  rts.calculated_at
FROM recursive_trust_scores rts
JOIN global_signals gs
  ON gs.id = rts.signal_id
ORDER BY rts.inherited_trust_score DESC,
         rts.recursive_confidence DESC;

CREATE OR REPLACE VIEW executive_briefing_command_view AS
SELECT
  briefing_title,
  strategic_priority_band,
  global_risk_index,
  executive_confidence,
  generated_at,
  briefing_summary
FROM executive_briefing_packets
ORDER BY generated_at DESC;

CREATE OR REPLACE VIEW strategic_memory_command_view AS
SELECT
  memory_title,
  memory_type,
  strategic_weight,
  persistence_score,
  recurrence_score,
  confidence_score,
  first_observed_at,
  last_observed_at
FROM strategic_memory_nodes
ORDER BY strategic_weight DESC,
         persistence_score DESC;

SELECT build_strategic_memory_graph(interval '30 days');
SELECT compute_recursive_trust_scores(interval '14 days');
SELECT detect_false_positive_patterns(interval '14 days');
SELECT generate_executive_briefing_packet();
SELECT compute_signal_decay_intelligence(interval '30 days');

INSERT INTO automation_logs(job_name,status,message)
VALUES (
  'recursive-intelligence-bootstrap',
  'success',
  'strategic memory, recursive trust propagation, executive briefing, and signal decay intelligence initialized'
);
