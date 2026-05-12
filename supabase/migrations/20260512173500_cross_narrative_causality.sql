-- Cross-narrative causality engine
-- Models systemic propagation chains across civilization domains

CREATE TABLE IF NOT EXISTS narrative_causality_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_narrative_id uuid NOT NULL REFERENCES signal_narratives(id) ON DELETE CASCADE,
  target_narrative_id uuid NOT NULL REFERENCES signal_narratives(id) ON DELETE CASCADE,
  causal_strength numeric DEFAULT 0,
  causal_type text,
  propagation_delay_hours numeric,
  confidence_score numeric DEFAULT 0,
  evidence_count integer DEFAULT 0,
  detected_patterns jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(source_narrative_id, target_narrative_id)
);

CREATE INDEX IF NOT EXISTS idx_narrative_causality_source
ON narrative_causality_edges(source_narrative_id);

CREATE INDEX IF NOT EXISTS idx_narrative_causality_target
ON narrative_causality_edges(target_narrative_id);

CREATE INDEX IF NOT EXISTS idx_narrative_causality_strength
ON narrative_causality_edges(causal_strength DESC);

ALTER TABLE signal_narratives
ADD COLUMN IF NOT EXISTS upstream_risk_score numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS downstream_risk_score numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS systemic_influence_score numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS dependency_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS cascade_risk_score numeric DEFAULT 0;

CREATE OR REPLACE VIEW civilization_cascade_dashboard AS
WITH edge_stats AS (
  SELECT
    n.id,
    COUNT(DISTINCT e1.target_narrative_id) AS outgoing_edges,
    COUNT(DISTINCT e2.source_narrative_id) AS incoming_edges,
    AVG(e1.causal_strength) AS avg_out_strength,
    AVG(e2.causal_strength) AS avg_in_strength
  FROM signal_narratives n
  LEFT JOIN narrative_causality_edges e1
    ON n.id = e1.source_narrative_id
  LEFT JOIN narrative_causality_edges e2
    ON n.id = e2.target_narrative_id
  GROUP BY n.id
)
SELECT
  n.id,
  n.narrative_title,
  n.narrative_type,
  n.narrative_temperature,
  n.momentum_score,
  n.propagation_score,
  n.systemic_influence_score,
  n.cascade_risk_score,
  es.outgoing_edges,
  es.incoming_edges,
  (
    COALESCE(n.systemic_influence_score,0) * 0.35 +
    COALESCE(n.cascade_risk_score,0) * 0.30 +
    COALESCE(n.narrative_temperature,0) * 0.20 +
    COALESCE(n.propagation_score,0) * 0.15
  ) AS civilization_risk_index,
  CASE
    WHEN n.cascade_risk_score >= 80 THEN 'cascade-critical'
    WHEN n.cascade_risk_score >= 60 THEN 'cascade-elevated'
    ELSE 'stable'
  END AS cascade_state
FROM signal_narratives n
LEFT JOIN edge_stats es
  ON n.id = es.id
ORDER BY civilization_risk_index DESC;

CREATE OR REPLACE FUNCTION detect_cross_narrative_causality()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  edge_count integer := 0;
BEGIN
  INSERT INTO narrative_causality_edges (
    source_narrative_id,
    target_narrative_id,
    causal_strength,
    causal_type,
    propagation_delay_hours,
    confidence_score,
    evidence_count,
    detected_patterns,
    updated_at
  )
  SELECT
    a.id,
    b.id,
    LEAST(100,
      (
        CASE WHEN a.narrative_type = b.narrative_type THEN 30 ELSE 0 END +
        CASE WHEN a.canonical_countries && b.canonical_countries THEN 25 ELSE 0 END +
        CASE WHEN ABS(COALESCE(a.narrative_temperature,0) - COALESCE(b.narrative_temperature,0)) <= 20 THEN 20 ELSE 0 END +
        CASE WHEN a.last_signal_at <= b.last_signal_at THEN 15 ELSE 0 END +
        CASE WHEN a.propagation_score >= 50 AND b.propagation_score >= 50 THEN 10 ELSE 0 END
      )
    ) AS causal_strength,
    CASE
      WHEN a.narrative_type = 'climate' AND b.narrative_type = 'food' THEN 'resource_stress'
      WHEN a.narrative_type = 'food' AND b.narrative_type = 'migration' THEN 'population_displacement'
      WHEN a.narrative_type = 'cyber' AND b.narrative_type = 'finance' THEN 'digital_contagion'
      WHEN a.narrative_type = 'energy' AND b.narrative_type = 'economy' THEN 'economic_pressure'
      ELSE 'correlated_propagation'
    END,
    EXTRACT(EPOCH FROM (b.last_signal_at - a.last_signal_at))/3600,
    LEAST(100,
      (
        COALESCE(a.momentum_score,0) * 0.4 +
        COALESCE(b.momentum_score,0) * 0.3 +
        COALESCE(a.propagation_score,0) * 0.3
      )
    ),
    GREATEST(a.signal_count, b.signal_count),
    jsonb_build_array(
      jsonb_build_object(
        'shared_countries',
        (
          SELECT jsonb_agg(x)
          FROM (
            SELECT unnest(a.canonical_countries)
            INTERSECT
            SELECT unnest(b.canonical_countries)
          ) t(x)
        )
      )
    ),
    now()
  FROM signal_narratives a
  CROSS JOIN signal_narratives b
  WHERE a.id <> b.id
    AND a.last_signal_at <= b.last_signal_at
    AND (
      a.canonical_countries && b.canonical_countries
      OR a.narrative_type = b.narrative_type
    )
    AND NOT EXISTS (
      SELECT 1
      FROM narrative_causality_edges e
      WHERE e.source_narrative_id = a.id
        AND e.target_narrative_id = b.id
    )
  ON CONFLICT (source_narrative_id, target_narrative_id)
  DO UPDATE SET
    causal_strength = EXCLUDED.causal_strength,
    confidence_score = EXCLUDED.confidence_score,
    updated_at = now();

  GET DIAGNOSTICS edge_count = ROW_COUNT;

  UPDATE signal_narratives n
  SET
    upstream_risk_score = COALESCE(src.avg_strength,0),
    downstream_risk_score = COALESCE(dst.avg_strength,0),
    systemic_influence_score = LEAST(100,
      COALESCE(src.edge_count,0) * 8 +
      COALESCE(dst.edge_count,0) * 6
    ),
    dependency_count = COALESCE(src.edge_count,0) + COALESCE(dst.edge_count,0),
    cascade_risk_score = LEAST(100,
      (
        COALESCE(src.avg_strength,0) * 0.35 +
        COALESCE(dst.avg_strength,0) * 0.25 +
        COALESCE(n.narrative_temperature,0) * 0.25 +
        COALESCE(n.propagation_score,0) * 0.15
      )
    )
  FROM (
    SELECT
      source_narrative_id,
      COUNT(*) AS edge_count,
      AVG(causal_strength) AS avg_strength
    FROM narrative_causality_edges
    GROUP BY source_narrative_id
  ) src
  FULL OUTER JOIN (
    SELECT
      target_narrative_id,
      COUNT(*) AS edge_count,
      AVG(causal_strength) AS avg_strength
    FROM narrative_causality_edges
    GROUP BY target_narrative_id
  ) dst
  ON src.source_narrative_id = dst.target_narrative_id
  WHERE n.id = COALESCE(src.source_narrative_id, dst.target_narrative_id);

  INSERT INTO automation_logs(job_name,status,message)
  VALUES (
    'cross-narrative-causality',
    'success',
    'edges_detected=' || edge_count
  );

  RETURN jsonb_build_object(
    'edges_detected', edge_count,
    'executed_at', now()
  );
END;
$$;