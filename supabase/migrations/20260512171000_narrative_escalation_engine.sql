-- Narrative escalation engine
-- Computes acceleration, propagation, volatility, and spread metrics

ALTER TABLE signal_narratives
ADD COLUMN IF NOT EXISTS escalation_velocity numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS geographic_spread_score numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS sector_spread_score numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS narrative_volatility numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS propagation_score numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS momentum_score numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS narrative_temperature numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_escalated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_signal_narratives_temperature
ON signal_narratives(narrative_temperature DESC);

CREATE INDEX IF NOT EXISTS idx_signal_narratives_momentum
ON signal_narratives(momentum_score DESC);

CREATE INDEX IF NOT EXISTS idx_signal_narratives_escalation
ON signal_narratives(escalation_velocity DESC);

CREATE OR REPLACE VIEW narrative_escalation_dashboard AS
WITH base AS (
  SELECT
    n.id,
    n.narrative_key,
    n.narrative_title,
    n.narrative_type,
    n.signal_count,
    n.escalation_score,
    n.escalation_velocity,
    n.geographic_spread_score,
    n.sector_spread_score,
    n.narrative_volatility,
    n.propagation_score,
    n.momentum_score,
    n.narrative_temperature,
    n.first_signal_at,
    n.last_signal_at,
    EXTRACT(EPOCH FROM (now() - n.last_signal_at))/3600 AS hours_since_update,
    array_length(n.canonical_countries, 1) AS country_count
  FROM signal_narratives n
)
SELECT
  *,
  (
    COALESCE(escalation_velocity,0) * 0.25 +
    COALESCE(propagation_score,0) * 0.20 +
    COALESCE(momentum_score,0) * 0.20 +
    COALESCE(geographic_spread_score,0) * 0.15 +
    COALESCE(sector_spread_score,0) * 0.10 +
    COALESCE(narrative_volatility,0) * 0.10
  ) AS systemic_risk_score,
  CASE
    WHEN narrative_temperature >= 85 THEN 'critical'
    WHEN narrative_temperature >= 70 THEN 'high'
    WHEN narrative_temperature >= 50 THEN 'elevated'
    ELSE 'normal'
  END AS escalation_band
FROM base
ORDER BY narrative_temperature DESC, momentum_score DESC;

CREATE OR REPLACE FUNCTION compute_narrative_escalation_metrics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_count integer := 0;
BEGIN
  WITH narrative_stats AS (
    SELECT
      n.id,
      COUNT(m.signal_id) AS signal_count,
      COUNT(DISTINCT gs.category) AS sector_count,
      COUNT(DISTINCT unnest(gs.affected_countries)) AS country_count,
      MAX(GREATEST(COALESCE(gs.urgency_score,0), COALESCE(gs.impact_score,0))) AS peak_intensity,
      AVG(GREATEST(COALESCE(gs.urgency_score,0), COALESCE(gs.impact_score,0))) AS avg_intensity,
      STDDEV(GREATEST(COALESCE(gs.urgency_score,0), COALESCE(gs.impact_score,0))) AS volatility,
      COUNT(*) FILTER (
        WHERE gs.created_at >= now() - interval '6 hours'
      ) AS recent_activity,
      COUNT(*) FILTER (
        WHERE gs.created_at >= now() - interval '24 hours'
      ) AS daily_activity
    FROM signal_narratives n
    LEFT JOIN signal_narrative_members m
      ON n.id = m.narrative_id
    LEFT JOIN global_signals gs
      ON gs.id = m.signal_id
    GROUP BY n.id
  )
  UPDATE signal_narratives n
  SET
    escalation_velocity = LEAST(100,
      COALESCE(s.recent_activity * 8,0)
    ),
    geographic_spread_score = LEAST(100,
      COALESCE(s.country_count * 12,0)
    ),
    sector_spread_score = LEAST(100,
      COALESCE(s.sector_count * 18,0)
    ),
    narrative_volatility = LEAST(100,
      COALESCE(s.volatility,0)
    ),
    propagation_score = LEAST(100,
      COALESCE(s.country_count * s.sector_count * 4,0)
    ),
    momentum_score = LEAST(100,
      COALESCE(s.daily_activity * 3,0)
    ),
    narrative_temperature = LEAST(100,
      (
        COALESCE(s.peak_intensity,0) * 0.30 +
        COALESCE(s.recent_activity * 8,0) * 0.25 +
        COALESCE(s.country_count * 10,0) * 0.20 +
        COALESCE(s.sector_count * 15,0) * 0.15 +
        COALESCE(s.volatility,0) * 0.10
      )
    ),
    last_escalated_at = now()
  FROM narrative_stats s
  WHERE n.id = s.id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES (
    'narrative-escalation-engine',
    'success',
    'updated_narratives=' || updated_count
  );

  RETURN jsonb_build_object(
    'updated_narratives', updated_count,
    'executed_at', now()
  );
END;
$$;