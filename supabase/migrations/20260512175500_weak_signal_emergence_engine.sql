-- Weak signal emergence engine
-- Detects low-volume anomalies before systemic escalation

CREATE TABLE IF NOT EXISTS weak_signal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid REFERENCES global_signals(id) ON DELETE CASCADE,
  narrative_id uuid REFERENCES signal_narratives(id) ON DELETE CASCADE,
  anomaly_type text,
  anomaly_score numeric DEFAULT 0,
  emergence_probability numeric DEFAULT 0,
  rarity_score numeric DEFAULT 0,
  novelty_score numeric DEFAULT 0,
  propagation_potential numeric DEFAULT 0,
  weak_signal_class text,
  detection_reason jsonb DEFAULT '[]'::jsonb,
  detected_at timestamptz DEFAULT now(),
  promoted_to_major boolean DEFAULT false,
  promoted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_weak_signal_anomaly
ON weak_signal_events(anomaly_score DESC);

CREATE INDEX IF NOT EXISTS idx_weak_signal_probability
ON weak_signal_events(emergence_probability DESC);

CREATE INDEX IF NOT EXISTS idx_weak_signal_detected
ON weak_signal_events(detected_at DESC);

ALTER TABLE global_signals
ADD COLUMN IF NOT EXISTS weak_signal_score numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS anomaly_score numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS emergence_class text,
ADD COLUMN IF NOT EXISTS predictive_priority numeric DEFAULT 0;

CREATE OR REPLACE VIEW weak_signal_intelligence_dashboard AS
WITH signal_context AS (
  SELECT
    w.id,
    w.signal_id,
    w.narrative_id,
    w.anomaly_type,
    w.anomaly_score,
    w.emergence_probability,
    w.rarity_score,
    w.novelty_score,
    w.propagation_potential,
    w.weak_signal_class,
    w.detected_at,
    gs.title,
    gs.category,
    gs.affected_countries,
    gs.urgency_score,
    gs.impact_score,
    n.narrative_title,
    n.narrative_temperature,
    n.cascade_risk_score
  FROM weak_signal_events w
  LEFT JOIN global_signals gs
    ON w.signal_id = gs.id
  LEFT JOIN signal_narratives n
    ON w.narrative_id = n.id
)
SELECT
  *,
  (
    COALESCE(anomaly_score,0) * 0.30 +
    COALESCE(emergence_probability,0) * 0.25 +
    COALESCE(propagation_potential,0) * 0.20 +
    COALESCE(rarity_score,0) * 0.15 +
    COALESCE(novelty_score,0) * 0.10
  ) AS predictive_risk_index,
  CASE
    WHEN emergence_probability >= 85 THEN 'pre-escalation-critical'
    WHEN emergence_probability >= 70 THEN 'high-emergence'
    WHEN emergence_probability >= 50 THEN 'watch'
    ELSE 'background'
  END AS emergence_band
FROM signal_context
ORDER BY predictive_risk_index DESC, detected_at DESC;

CREATE OR REPLACE FUNCTION detect_weak_signal_emergence()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  inserted_count integer := 0;
BEGIN
  INSERT INTO weak_signal_events (
    signal_id,
    narrative_id,
    anomaly_type,
    anomaly_score,
    emergence_probability,
    rarity_score,
    novelty_score,
    propagation_potential,
    weak_signal_class,
    detection_reason
  )
  SELECT
    gs.id,
    snm.narrative_id,
    CASE
      WHEN gs.category IN ('cyber','biosecurity','geopolitics') THEN 'high-risk-domain-anomaly'
      WHEN gs.urgency_score >= 70 AND gs.corroboration_count <= 1 THEN 'isolated-high-impact'
      WHEN array_length(gs.affected_countries,1) >= 3 THEN 'cross-border-emergence'
      ELSE 'rare-pattern-detection'
    END,
    LEAST(100,
      (
        CASE WHEN gs.corroboration_count <= 1 THEN 35 ELSE 0 END +
        CASE WHEN gs.urgency_score >= 70 THEN 25 ELSE 0 END +
        CASE WHEN gs.impact_score >= 70 THEN 20 ELSE 0 END +
        CASE WHEN array_length(gs.affected_countries,1) >= 3 THEN 20 ELSE 0 END
      )
    ) AS anomaly_score,
    LEAST(100,
      (
        COALESCE(gs.urgency_score,0) * 0.35 +
        COALESCE(gs.impact_score,0) * 0.30 +
        CASE WHEN gs.corroboration_count <= 1 THEN 20 ELSE 0 END +
        CASE WHEN sn.cascade_risk_score >= 60 THEN 15 ELSE 0 END
      )
    ) AS emergence_probability,
    LEAST(100,
      (
        CASE WHEN gs.category IN ('biosecurity','cyber','energy') THEN 40 ELSE 15 END +
        CASE WHEN gs.corroboration_count <= 1 THEN 35 ELSE 0 END +
        CASE WHEN gs.source_trust_tier = 'tier_1' THEN 25 ELSE 10 END
      )
    ) AS rarity_score,
    LEAST(100,
      (
        CASE WHEN gs.category IN ('emerging-tech','biosecurity') THEN 50 ELSE 20 END +
        CASE WHEN sn.signal_count <= 3 THEN 25 ELSE 10 END +
        CASE WHEN gs.translated_title IS NOT NULL THEN 15 ELSE 5 END
      )
    ) AS novelty_score,
    LEAST(100,
      (
        COALESCE(sn.propagation_score,0) * 0.40 +
        COALESCE(sn.cascade_risk_score,0) * 0.35 +
        COALESCE(gs.impact_score,0) * 0.25
      )
    ) AS propagation_potential,
    CASE
      WHEN gs.category IN ('biosecurity','cyber') THEN 'strategic-warning'
      WHEN gs.urgency_score >= 80 THEN 'high-priority-watch'
      WHEN gs.corroboration_count <= 1 THEN 'weak-emergence'
      ELSE 'background-anomaly'
    END,
    jsonb_build_array(
      jsonb_build_object(
        'urgency_score', gs.urgency_score,
        'impact_score', gs.impact_score,
        'corroboration_count', gs.corroboration_count,
        'countries', gs.affected_countries
      )
    )
  FROM global_signals gs
  LEFT JOIN signal_narrative_members snm
    ON gs.id = snm.signal_id
  LEFT JOIN signal_narratives sn
    ON snm.narrative_id = sn.id
  WHERE gs.created_at >= now() - interval '48 hours'
    AND NOT EXISTS (
      SELECT 1
      FROM weak_signal_events w
      WHERE w.signal_id = gs.id
    )
    AND (
      gs.urgency_score >= 60
      OR gs.impact_score >= 60
      OR gs.corroboration_count <= 1
      OR gs.category IN ('cyber','biosecurity','energy','geopolitics')
    );

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  UPDATE global_signals gs
  SET
    weak_signal_score = LEAST(100,
      COALESCE(w.emergence_probability,0)
    ),
    anomaly_score = COALESCE(w.anomaly_score,0),
    emergence_class = w.weak_signal_class,
    predictive_priority = LEAST(100,
      (
        COALESCE(w.emergence_probability,0) * 0.50 +
        COALESCE(w.propagation_potential,0) * 0.30 +
        COALESCE(w.rarity_score,0) * 0.20
      )
    )
  FROM weak_signal_events w
  WHERE gs.id = w.signal_id;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES (
    'weak-signal-emergence-engine',
    'success',
    'weak_signals_detected=' || inserted_count
  );

  RETURN jsonb_build_object(
    'weak_signals_detected', inserted_count,
    'executed_at', now()
  );
END;
$$;