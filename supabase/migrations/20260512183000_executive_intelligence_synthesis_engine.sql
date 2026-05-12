-- Executive Intelligence Synthesis Engine
-- Converts raw signals into executive-grade strategic briefings

CREATE TABLE IF NOT EXISTS executive_intelligence_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_type text NOT NULL,
  briefing_scope text DEFAULT 'global',
  title text NOT NULL,
  executive_summary text,
  strategic_assessment text,
  key_risks jsonb DEFAULT '[]'::jsonb,
  emerging_opportunities jsonb DEFAULT '[]'::jsonb,
  critical_regions jsonb DEFAULT '[]'::jsonb,
  narrative_clusters jsonb DEFAULT '[]'::jsonb,
  escalation_alerts jsonb DEFAULT '[]'::jsonb,
  confidence_score numeric DEFAULT 0,
  civilization_stress_index numeric DEFAULT 0,
  systemic_risk_index numeric DEFAULT 0,
  geopolitical_temperature numeric DEFAULT 0,
  economic_disruption_index numeric DEFAULT 0,
  predictive_outlook jsonb DEFAULT '{}'::jsonb,
  generated_from_signal_count integer DEFAULT 0,
  generated_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  generation_method text DEFAULT 'aicis_exec_synthesis_v1'
);

CREATE INDEX IF NOT EXISTS idx_exec_briefings_generated
ON executive_intelligence_briefings(generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_briefings_scope
ON executive_intelligence_briefings(briefing_scope);

CREATE INDEX IF NOT EXISTS idx_exec_briefings_type
ON executive_intelligence_briefings(briefing_type);

CREATE OR REPLACE VIEW executive_global_command_view AS
WITH active_signals AS (
  SELECT
    gs.id,
    gs.category,
    gs.urgency_score,
    gs.impact_score,
    gs.predictive_priority,
    gs.anomaly_score,
    gs.affected_countries,
    gs.title,
    gs.created_at
  FROM global_signals gs
  WHERE gs.created_at >= now() - interval '72 hours'
),
category_pressure AS (
  SELECT
    category,
    COUNT(*) AS signal_volume,
    AVG(urgency_score) AS avg_urgency,
    AVG(impact_score) AS avg_impact,
    AVG(predictive_priority) AS avg_predictive_priority
  FROM active_signals
  GROUP BY category
),
regional_pressure AS (
  SELECT
    unnest(affected_countries) AS country,
    COUNT(*) AS signal_count,
    AVG(urgency_score) AS avg_urgency,
    AVG(impact_score) AS avg_impact
  FROM active_signals
  WHERE affected_countries IS NOT NULL
  GROUP BY country
)
SELECT
  cp.category,
  cp.signal_volume,
  ROUND(cp.avg_urgency::numeric,2) AS avg_urgency,
  ROUND(cp.avg_impact::numeric,2) AS avg_impact,
  ROUND(cp.avg_predictive_priority::numeric,2) AS avg_predictive_priority,
  (
    cp.signal_volume * 0.25 +
    cp.avg_urgency * 0.35 +
    cp.avg_impact * 0.25 +
    cp.avg_predictive_priority * 0.15
  ) AS systemic_pressure_score,
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'country', rp.country,
        'signal_count', rp.signal_count,
        'avg_urgency', ROUND(rp.avg_urgency::numeric,2)
      )
    )
    FROM regional_pressure rp
    WHERE rp.avg_urgency >= 50
  ) AS regional_hotspots
FROM category_pressure cp
ORDER BY systemic_pressure_score DESC;

CREATE OR REPLACE FUNCTION generate_executive_intelligence_briefing(
  briefing_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_signal_count integer := 0;
  v_global_stress numeric := 0;
  v_systemic_risk numeric := 0;
  v_geo_temp numeric := 0;
  v_economic_disruption numeric := 0;
  v_title text;
BEGIN
  SELECT COUNT(*)
  INTO v_signal_count
  FROM global_signals
  WHERE created_at >= now() - briefing_window;

  SELECT
    ROUND(AVG(COALESCE(urgency_score,0))::numeric,2),
    ROUND(AVG(COALESCE(impact_score,0))::numeric,2),
    ROUND(AVG(COALESCE(predictive_priority,0))::numeric,2),
    ROUND(AVG(
      CASE
        WHEN category IN ('economy','supply-chain','energy') THEN impact_score
        ELSE 0
      END
    )::numeric,2)
  INTO
    v_global_stress,
    v_systemic_risk,
    v_geo_temp,
    v_economic_disruption
  FROM global_signals
  WHERE created_at >= now() - briefing_window;

  v_title := CASE
    WHEN v_global_stress >= 75 THEN 'Critical Global Escalation Watch'
    WHEN v_global_stress >= 60 THEN 'High-Intensity Strategic Briefing'
    WHEN v_global_stress >= 45 THEN 'Elevated Planetary Monitoring Brief'
    ELSE 'Global Stability Monitoring Brief'
  END;

  INSERT INTO executive_intelligence_briefings (
    briefing_type,
    briefing_scope,
    title,
    executive_summary,
    strategic_assessment,
    key_risks,
    emerging_opportunities,
    critical_regions,
    narrative_clusters,
    escalation_alerts,
    confidence_score,
    civilization_stress_index,
    systemic_risk_index,
    geopolitical_temperature,
    economic_disruption_index,
    predictive_outlook,
    generated_from_signal_count,
    expires_at
  )
  SELECT
    'planetary-command-brief',
    'global',
    v_title,
    CONCAT(
      'AICIS analyzed ', v_signal_count,
      ' global signals across geopolitical, economic, cyber, biosecurity, and infrastructure domains. '
    ),
    CASE
      WHEN v_global_stress >= 70 THEN
        'Multiple concurrent stress patterns detected across interconnected global systems. Escalation monitoring recommended.'
      WHEN v_global_stress >= 50 THEN
        'Elevated global narrative pressure detected with moderate cross-domain propagation risk.'
      ELSE
        'Global systems remain stable with localized volatility patterns.'
    END,
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'category', category,
          'pressure_score', systemic_pressure_score,
          'signal_volume', signal_volume
        )
      )
      FROM executive_global_command_view
      WHERE systemic_pressure_score >= 55
      LIMIT 10
    ),
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'category', category,
          'opportunity_index', avg_predictive_priority
        )
      )
      FROM executive_global_command_view
      WHERE avg_predictive_priority >= 60
      LIMIT 10
    ),
    (
      SELECT jsonb_agg(DISTINCT country)
      FROM (
        SELECT unnest(affected_countries) AS country
        FROM global_signals
        WHERE created_at >= now() - briefing_window
          AND urgency_score >= 70
      ) x
    ),
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'narrative', narrative_title,
          'temperature', narrative_temperature,
          'cascade_risk', cascade_risk_score
        )
      )
      FROM signal_narratives
      WHERE updated_at >= now() - briefing_window
      ORDER BY cascade_risk_score DESC
      LIMIT 10
    ),
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'signal', title,
          'predictive_priority', predictive_priority,
          'anomaly_score', anomaly_score
        )
      )
      FROM global_signals
      WHERE predictive_priority >= 70
      ORDER BY predictive_priority DESC
      LIMIT 15
    ),
    LEAST(100, ROUND((v_signal_count * 0.02 + v_systemic_risk * 0.40 + v_geo_temp * 0.30)::numeric,2)),
    COALESCE(v_global_stress,0),
    COALESCE(v_systemic_risk,0),
    COALESCE(v_geo_temp,0),
    COALESCE(v_economic_disruption,0),
    jsonb_build_object(
      'next_24h', CASE
        WHEN v_global_stress >= 70 THEN 'high escalation probability'
        WHEN v_global_stress >= 50 THEN 'moderate instability expected'
        ELSE 'localized volatility expected'
      END,
      'systemic_risk', v_systemic_risk,
      'civilization_stress', v_global_stress
    ),
    v_signal_count,
    now() + interval '6 hours'
  ;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES (
    'executive-intelligence-synthesis-engine',
    'success',
    'signals_analyzed=' || v_signal_count || ', stress=' || COALESCE(v_global_stress,0)
  );

  RETURN jsonb_build_object(
    'status', 'success',
    'signals_analyzed', v_signal_count,
    'civilization_stress_index', v_global_stress,
    'systemic_risk_index', v_systemic_risk,
    'generated_at', now()
  );
END;
$$;