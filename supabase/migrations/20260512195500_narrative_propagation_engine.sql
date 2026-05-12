-- Narrative Propagation & Causal Intelligence Engine
-- Tracks narrative spread, escalation chains, and civilization cascades

CREATE TABLE IF NOT EXISTS narrative_propagation_graph (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_signal_id uuid NOT NULL,
  target_signal_id uuid NOT NULL,
  propagation_type text NOT NULL,
  propagation_strength numeric DEFAULT 0,
  propagation_velocity numeric DEFAULT 0,
  narrative_similarity numeric DEFAULT 0,
  causal_confidence numeric DEFAULT 0,
  cross_border boolean DEFAULT false,
  cross_domain boolean DEFAULT false,
  propagation_regions jsonb DEFAULT '[]'::jsonb,
  propagation_path jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_narrative_graph_source
ON narrative_propagation_graph(source_signal_id);

CREATE INDEX IF NOT EXISTS idx_narrative_graph_target
ON narrative_propagation_graph(target_signal_id);

CREATE INDEX IF NOT EXISTS idx_narrative_graph_strength
ON narrative_propagation_graph(propagation_strength DESC);

CREATE TABLE IF NOT EXISTS civilization_cascade_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cascade_type text NOT NULL,
  originating_signal_id uuid,
  cascade_name text NOT NULL,
  affected_domains jsonb DEFAULT '[]'::jsonb,
  affected_regions jsonb DEFAULT '[]'::jsonb,
  cascade_severity numeric DEFAULT 0,
  systemic_impact_score numeric DEFAULT 0,
  propagation_probability numeric DEFAULT 0,
  estimated_duration_hours numeric,
  stabilization_probability numeric DEFAULT 0,
  escalation_stage text DEFAULT 'emerging',
  narrative_summary text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cascade_events_severity
ON civilization_cascade_events(cascade_severity DESC);

CREATE INDEX IF NOT EXISTS idx_cascade_events_stage
ON civilization_cascade_events(escalation_stage);

CREATE TABLE IF NOT EXISTS strategic_narrative_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_name text NOT NULL,
  dominant_narrative text,
  signal_count integer DEFAULT 0,
  narrative_temperature numeric DEFAULT 0,
  geopolitical_pressure numeric DEFAULT 0,
  economic_pressure numeric DEFAULT 0,
  cyber_pressure numeric DEFAULT 0,
  biosecurity_pressure numeric DEFAULT 0,
  propagation_acceleration numeric DEFAULT 0,
  cross_domain_entanglement numeric DEFAULT 0,
  regions jsonb DEFAULT '[]'::jsonb,
  categories jsonb DEFAULT '[]'::jsonb,
  key_entities jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strategic_clusters_temperature
ON strategic_narrative_clusters(narrative_temperature DESC);

CREATE OR REPLACE FUNCTION detect_narrative_propagation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_links integer := 0;
  v_cascades integer := 0;
BEGIN

  INSERT INTO narrative_propagation_graph (
    source_signal_id,
    target_signal_id,
    propagation_type,
    propagation_strength,
    propagation_velocity,
    narrative_similarity,
    causal_confidence,
    cross_border,
    cross_domain,
    propagation_regions,
    propagation_path
  )
  SELECT
    g1.id,
    g2.id,
    CASE
      WHEN g1.category = g2.category THEN 'same-domain-escalation'
      ELSE 'cross-domain-contagion'
    END,
    LEAST(100,
      ROUND(
        (
          COALESCE(g1.impact_score,0) * 0.30 +
          COALESCE(g2.impact_score,0) * 0.30 +
          COALESCE(g1.predictive_priority,0) * 0.20 +
          COALESCE(g2.predictive_priority,0) * 0.20
        )::numeric
      ,2)
    ),
    GREATEST(1,
      EXTRACT(EPOCH FROM ABS(g2.created_at - g1.created_at))/3600
    ),
    CASE
      WHEN g1.category = g2.category THEN 85
      ELSE 55
    END,
    CASE
      WHEN g1.category = g2.category THEN 75
      ELSE 50
    END,
    EXISTS (
      SELECT 1
      FROM unnest(COALESCE(g1.affected_countries,'{}')) c1
      JOIN unnest(COALESCE(g2.affected_countries,'{}')) c2
      ON c1 <> c2
    ),
    g1.category <> g2.category,
    to_jsonb(
      ARRAY(
        SELECT DISTINCT x
        FROM (
          SELECT unnest(COALESCE(g1.affected_countries,'{}')) AS x
          UNION
          SELECT unnest(COALESCE(g2.affected_countries,'{}')) AS x
        ) z
      )
    ),
    jsonb_build_array(g1.id, g2.id)
  FROM global_signals g1
  JOIN global_signals g2
    ON g1.id <> g2.id
   AND g1.created_at >= now() - interval '24 hours'
   AND g2.created_at >= now() - interval '24 hours'
   AND ABS(EXTRACT(EPOCH FROM (g2.created_at - g1.created_at))) <= 21600
   AND (
      g1.category = g2.category
      OR EXISTS (
        SELECT 1
        FROM unnest(COALESCE(g1.affected_countries,'{}')) c1
        JOIN unnest(COALESCE(g2.affected_countries,'{}')) c2
        ON c1 = c2
      )
   )
  WHERE NOT EXISTS (
    SELECT 1
    FROM narrative_propagation_graph npg
    WHERE npg.source_signal_id = g1.id
      AND npg.target_signal_id = g2.id
  )
  LIMIT 2000;

  GET DIAGNOSTICS v_links = ROW_COUNT;

  INSERT INTO civilization_cascade_events (
    cascade_type,
    originating_signal_id,
    cascade_name,
    affected_domains,
    affected_regions,
    cascade_severity,
    systemic_impact_score,
    propagation_probability,
    estimated_duration_hours,
    stabilization_probability,
    escalation_stage,
    narrative_summary
  )
  SELECT
    CASE
      WHEN COUNT(DISTINCT gs.category) >= 4 THEN 'multi-domain-systemic'
      WHEN COUNT(DISTINCT gs.category) >= 2 THEN 'cross-domain-escalation'
      ELSE 'localized-escalation'
    END,
    MIN(gs.id),
    CONCAT(
      'Cascade Cluster — ',
      COALESCE(MIN(gs.category),'global')
    ),
    to_jsonb(array_agg(DISTINCT gs.category)),
    to_jsonb(array_agg(DISTINCT c.country)),
    LEAST(100,
      ROUND(
        (
          AVG(COALESCE(gs.urgency_score,0)) * 0.35 +
          AVG(COALESCE(gs.impact_score,0)) * 0.35 +
          AVG(COALESCE(gs.predictive_priority,0)) * 0.30
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          COUNT(*) * 1.5 +
          COUNT(DISTINCT gs.category) * 8 +
          COUNT(DISTINCT c.country) * 3
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        AVG(COALESCE(gs.predictive_priority,0))::numeric
      ,2)
    ),
    ROUND((COUNT(*) * 1.8)::numeric,2),
    GREATEST(5,
      ROUND(
        (100 - AVG(COALESCE(gs.urgency_score,0)))::numeric
      ,2)
    ),
    CASE
      WHEN AVG(COALESCE(gs.urgency_score,0)) >= 80 THEN 'critical'
      WHEN AVG(COALESCE(gs.urgency_score,0)) >= 60 THEN 'escalating'
      WHEN AVG(COALESCE(gs.urgency_score,0)) >= 40 THEN 'elevated'
      ELSE 'emerging'
    END,
    CONCAT(
      COUNT(*),
      ' interconnected signals detected across ',
      COUNT(DISTINCT gs.category),
      ' domains and ',
      COUNT(DISTINCT c.country),
      ' regions.'
    )
  FROM global_signals gs
  LEFT JOIN LATERAL unnest(COALESCE(gs.affected_countries,'{}')) c(country)
    ON true
  WHERE gs.created_at >= now() - interval '24 hours'
  GROUP BY date_trunc('hour', gs.created_at), gs.category
  HAVING COUNT(*) >= 5
  LIMIT 100;

  GET DIAGNOSTICS v_cascades = ROW_COUNT;

  INSERT INTO strategic_narrative_clusters (
    cluster_name,
    dominant_narrative,
    signal_count,
    narrative_temperature,
    geopolitical_pressure,
    economic_pressure,
    cyber_pressure,
    biosecurity_pressure,
    propagation_acceleration,
    cross_domain_entanglement,
    regions,
    categories,
    key_entities
  )
  SELECT
    CONCAT('Narrative Cluster — ', category),
    category,
    COUNT(*),
    ROUND(AVG(COALESCE(urgency_score,0))::numeric,2),
    ROUND(AVG(
      CASE WHEN category IN ('conflict','geopolitics')
      THEN COALESCE(impact_score,0)
      ELSE 0 END
    )::numeric,2),
    ROUND(AVG(
      CASE WHEN category IN ('economy','energy','supply-chain')
      THEN COALESCE(impact_score,0)
      ELSE 0 END
    )::numeric,2),
    ROUND(AVG(
      CASE WHEN category IN ('cybersecurity','technology')
      THEN COALESCE(anomaly_score,0)
      ELSE 0 END
    )::numeric,2),
    ROUND(AVG(
      CASE WHEN category IN ('health','biosecurity')
      THEN COALESCE(predictive_priority,0)
      ELSE 0 END
    )::numeric,2),
    ROUND(AVG(COALESCE(predictive_priority,0))::numeric,2),
    ROUND((COUNT(DISTINCT category) * 10)::numeric,2),
    to_jsonb(array_agg(DISTINCT ac.country)),
    to_jsonb(array_agg(DISTINCT category)),
    jsonb_build_array(category)
  FROM global_signals gs
  LEFT JOIN LATERAL unnest(COALESCE(gs.affected_countries,'{}')) ac(country)
    ON true
  WHERE gs.created_at >= now() - interval '24 hours'
  GROUP BY category
  HAVING COUNT(*) >= 3;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES (
    'narrative-propagation-engine',
    'success',
    'links=' || v_links || ', cascades=' || v_cascades
  );

  RETURN jsonb_build_object(
    'status','success',
    'propagation_links_created',v_links,
    'cascade_events_created',v_cascades,
    'generated_at',now()
  );
END;
$$;

CREATE OR REPLACE VIEW civilization_cascade_command_view AS
SELECT
  cce.cascade_name,
  cce.cascade_type,
  cce.escalation_stage,
  cce.cascade_severity,
  cce.systemic_impact_score,
  cce.propagation_probability,
  cce.stabilization_probability,
  cce.affected_domains,
  cce.affected_regions,
  cce.estimated_duration_hours,
  cce.created_at,
  CASE
    WHEN cce.cascade_severity >= 85 THEN 'planetary-critical'
    WHEN cce.cascade_severity >= 70 THEN 'systemic-escalation'
    WHEN cce.cascade_severity >= 50 THEN 'strategic-risk'
    ELSE 'localized-instability'
  END AS command_priority
FROM civilization_cascade_events cce
ORDER BY cce.cascade_severity DESC,
         cce.systemic_impact_score DESC;

INSERT INTO automation_logs(job_name,status,message)
VALUES (
  'narrative-propagation-bootstrap',
  'success',
  'narrative propagation intelligence initialized'
);
