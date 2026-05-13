-- Commercial Readiness Relevance & Trust Layer
-- Converts AICIS from broad signal accumulation toward decision-grade commercial intelligence

CREATE TABLE IF NOT EXISTS intelligence_market_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_key text UNIQUE NOT NULL,
  segment_name text NOT NULL,
  segment_description text,
  priority_categories jsonb DEFAULT '[]'::jsonb,
  priority_regions jsonb DEFAULT '[]'::jsonb,
  risk_weights jsonb DEFAULT '{}'::jsonb,
  default_alert_threshold numeric DEFAULT 70,
  default_noise_floor numeric DEFAULT 35,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commercial_signal_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES global_signals(id) ON DELETE CASCADE,
  segment_key text NOT NULL,
  commercial_relevance_score numeric DEFAULT 0,
  decision_value_score numeric DEFAULT 0,
  actionability_score numeric DEFAULT 0,
  novelty_value_score numeric DEFAULT 0,
  trust_adjusted_score numeric DEFAULT 0,
  noise_score numeric DEFAULT 0,
  suppression_recommendation text,
  alert_band text DEFAULT 'monitor',
  score_explanation jsonb DEFAULT '[]'::jsonb,
  scored_at timestamptz DEFAULT now(),
  UNIQUE(signal_id, segment_key)
);

CREATE INDEX IF NOT EXISTS idx_commercial_signal_scores_segment
ON commercial_signal_scores(segment_key, commercial_relevance_score DESC);

CREATE INDEX IF NOT EXISTS idx_commercial_signal_scores_band
ON commercial_signal_scores(alert_band, trust_adjusted_score DESC);

CREATE TABLE IF NOT EXISTS executive_signal_digest_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_key text NOT NULL,
  signal_id uuid REFERENCES global_signals(id) ON DELETE CASCADE,
  digest_rank integer DEFAULT 0,
  digest_title text,
  digest_summary text,
  why_it_matters text,
  recommended_action text,
  evidence_quality text,
  included_at timestamptz DEFAULT now(),
  UNIQUE(segment_key, signal_id)
);

CREATE INDEX IF NOT EXISTS idx_digest_items_segment_rank
ON executive_signal_digest_items(segment_key, digest_rank);

CREATE TABLE IF NOT EXISTS intelligence_quality_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_window text DEFAULT '24h',
  total_signals integer DEFAULT 0,
  canonical_signals integer DEFAULT 0,
  duplicate_signals integer DEFAULT 0,
  suppressed_noise integer DEFAULT 0,
  critical_alerts integer DEFAULT 0,
  strategic_alerts integer DEFAULT 0,
  avg_commercial_relevance numeric DEFAULT 0,
  avg_trust_adjusted_score numeric DEFAULT 0,
  avg_noise_score numeric DEFAULT 0,
  signal_to_noise_ratio numeric DEFAULT 0,
  quality_grade text DEFAULT 'ungraded',
  audit_notes jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quality_audits_created
ON intelligence_quality_audits(created_at DESC);

INSERT INTO intelligence_market_segments (
  segment_key,
  segment_name,
  segment_description,
  priority_categories,
  priority_regions,
  risk_weights,
  default_alert_threshold,
  default_noise_floor
)
VALUES
(
  'executive_global_risk',
  'Executive Global Risk',
  'Board and executive-level global strategic risk monitoring.',
  jsonb_build_array('geopolitics','conflict','economy','energy','supply-chain','cybersecurity','biosecurity','climate_disaster'),
  jsonb_build_array('GLOBAL'),
  jsonb_build_object('urgency',0.22,'impact',0.24,'predictive',0.24,'trust',0.18,'novelty',0.12),
  72,
  38
),
(
  'supply_chain_foresight',
  'Supply Chain Foresight',
  'Logistics, ports, trade, energy, industrial continuity, and disruption monitoring.',
  jsonb_build_array('supply-chain','energy','transport','conflict','climate_disaster','economy','infrastructure'),
  jsonb_build_array('GLOBAL'),
  jsonb_build_object('urgency',0.18,'impact',0.28,'predictive',0.24,'trust',0.18,'novelty',0.12),
  68,
  35
),
(
  'geopolitical_investor',
  'Geopolitical Investor Intelligence',
  'Macro-risk, commodities, sanctions, instability, and market-impact intelligence.',
  jsonb_build_array('geopolitics','economy','energy','conflict','finance','trade','sanctions'),
  jsonb_build_array('GLOBAL'),
  jsonb_build_object('urgency',0.18,'impact',0.26,'predictive',0.28,'trust',0.18,'novelty',0.10),
  70,
  36
),
(
  'humanitarian_ops',
  'Humanitarian Operations',
  'Displacement, disasters, conflict, food insecurity, and public-health response intelligence.',
  jsonb_build_array('migration_displacement','climate_disaster','public_health','food_agriculture','conflict','humanitarian'),
  jsonb_build_array('GLOBAL'),
  jsonb_build_object('urgency',0.30,'impact',0.24,'predictive',0.20,'trust',0.16,'novelty',0.10),
  65,
  34
)
ON CONFLICT(segment_key) DO UPDATE SET
  segment_name = EXCLUDED.segment_name,
  segment_description = EXCLUDED.segment_description,
  priority_categories = EXCLUDED.priority_categories,
  risk_weights = EXCLUDED.risk_weights,
  default_alert_threshold = EXCLUDED.default_alert_threshold,
  default_noise_floor = EXCLUDED.default_noise_floor,
  updated_at = now();

CREATE OR REPLACE FUNCTION compute_commercial_signal_scores(
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_scored integer := 0;
BEGIN
  INSERT INTO commercial_signal_scores (
    signal_id,
    segment_key,
    commercial_relevance_score,
    decision_value_score,
    actionability_score,
    novelty_value_score,
    trust_adjusted_score,
    noise_score,
    suppression_recommendation,
    alert_band,
    score_explanation,
    scored_at
  )
  SELECT
    gs.id,
    ims.segment_key,
    LEAST(100, ROUND((
      COALESCE(gs.urgency_score,0) * COALESCE((ims.risk_weights->>'urgency')::numeric,0.2) +
      COALESCE(gs.impact_score,0) * COALESCE((ims.risk_weights->>'impact')::numeric,0.25) +
      COALESCE(gs.predictive_priority,0) * COALESCE((ims.risk_weights->>'predictive')::numeric,0.25) +
      COALESCE(gs.confidence_score,0) * COALESCE((ims.risk_weights->>'trust')::numeric,0.15) +
      COALESCE(gs.anomaly_score,0) * COALESCE((ims.risk_weights->>'novelty')::numeric,0.15) +
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(ims.priority_categories) c
          WHERE lower(c.value) = lower(COALESCE(gs.category,''))
        ) THEN 18 ELSE 0
      END +
      CASE
        WHEN COALESCE(gs.corroboration_count,0) >= 2 THEN 8 ELSE 0
      END
    )::numeric,2)) AS commercial_relevance_score,
    LEAST(100, ROUND((
      COALESCE(gs.impact_score,0) * 0.35 +
      COALESCE(gs.predictive_priority,0) * 0.35 +
      COALESCE(gs.urgency_score,0) * 0.20 +
      CASE WHEN COALESCE(gs.affected_countries,'{}') <> '{}' THEN 10 ELSE 0 END
    )::numeric,2)) AS decision_value_score,
    LEAST(100, ROUND((
      COALESCE(gs.urgency_score,0) * 0.35 +
      COALESCE(gs.confidence_score,0) * 0.25 +
      CASE WHEN COALESCE(gs.source_trust_tier,'') IN ('tier_1','tier_2') THEN 20 ELSE 5 END +
      CASE WHEN COALESCE(gs.affected_countries,'{}') <> '{}' THEN 15 ELSE 0 END
    )::numeric,2)) AS actionability_score,
    LEAST(100, ROUND((
      COALESCE(gs.anomaly_score,0) * 0.45 +
      COALESCE(gs.weak_signal_score,0) * 0.35 +
      CASE WHEN COALESCE(gs.corroboration_count,0) <= 1 THEN 15 ELSE 5 END
    )::numeric,2)) AS novelty_value_score,
    LEAST(100, ROUND((
      COALESCE(gs.confidence_score,0) * 0.30 +
      COALESCE(gs.impact_score,0) * 0.25 +
      COALESCE(gs.urgency_score,0) * 0.20 +
      COALESCE(gs.predictive_priority,0) * 0.20 +
      CASE WHEN COALESCE(gs.source_trust_tier,'') = 'tier_1' THEN 10
           WHEN COALESCE(gs.source_trust_tier,'') = 'tier_2' THEN 6
           ELSE 0 END
    )::numeric,2)) AS trust_adjusted_score,
    LEAST(100, ROUND((
      CASE WHEN COALESCE(gs.confidence_score,0) < 45 THEN 25 ELSE 0 END +
      CASE WHEN COALESCE(gs.impact_score,0) < 35 THEN 20 ELSE 0 END +
      CASE WHEN COALESCE(gs.urgency_score,0) < 35 THEN 20 ELSE 0 END +
      CASE WHEN COALESCE(gs.affected_countries,'{}') = '{}' THEN 15 ELSE 0 END +
      CASE WHEN COALESCE(gs.canonical_event_status,'') = 'duplicate' THEN 20 ELSE 0 END
    )::numeric,2)) AS noise_score,
    CASE
      WHEN COALESCE(gs.canonical_event_status,'') = 'duplicate' THEN 'suppress_duplicate'
      WHEN COALESCE(gs.confidence_score,0) < 40 AND COALESCE(gs.impact_score,0) < 40 THEN 'suppress_low_confidence_low_impact'
      WHEN COALESCE(gs.affected_countries,'{}') = '{}' AND COALESCE(gs.impact_score,0) < 55 THEN 'suppress_unlocalized_low_impact'
      ELSE NULL
    END AS suppression_recommendation,
    CASE
      WHEN COALESCE(gs.canonical_event_status,'') = 'duplicate' THEN 'suppressed'
      WHEN (
        COALESCE(gs.urgency_score,0) >= 80
        OR COALESCE(gs.impact_score,0) >= 80
        OR COALESCE(gs.predictive_priority,0) >= 80
      ) AND COALESCE(gs.confidence_score,0) >= 55 THEN 'critical'
      WHEN (
        COALESCE(gs.urgency_score,0) >= ims.default_alert_threshold
        OR COALESCE(gs.impact_score,0) >= ims.default_alert_threshold
        OR COALESCE(gs.predictive_priority,0) >= ims.default_alert_threshold
      ) THEN 'strategic'
      WHEN COALESCE(gs.impact_score,0) < ims.default_noise_floor THEN 'suppressed'
      ELSE 'monitor'
    END AS alert_band,
    jsonb_build_array(
      jsonb_build_object('factor','urgency','value',COALESCE(gs.urgency_score,0)),
      jsonb_build_object('factor','impact','value',COALESCE(gs.impact_score,0)),
      jsonb_build_object('factor','predictive_priority','value',COALESCE(gs.predictive_priority,0)),
      jsonb_build_object('factor','confidence','value',COALESCE(gs.confidence_score,0)),
      jsonb_build_object('factor','source_tier','value',COALESCE(gs.source_trust_tier,'unknown')),
      jsonb_build_object('factor','category','value',COALESCE(gs.category,'unknown'))
    ),
    now()
  FROM global_signals gs
  CROSS JOIN intelligence_market_segments ims
  WHERE COALESCE(gs.ingested_at, gs.created_at) >= now() - p_window
  ON CONFLICT(signal_id, segment_key) DO UPDATE SET
    commercial_relevance_score = EXCLUDED.commercial_relevance_score,
    decision_value_score = EXCLUDED.decision_value_score,
    actionability_score = EXCLUDED.actionability_score,
    novelty_value_score = EXCLUDED.novelty_value_score,
    trust_adjusted_score = EXCLUDED.trust_adjusted_score,
    noise_score = EXCLUDED.noise_score,
    suppression_recommendation = EXCLUDED.suppression_recommendation,
    alert_band = EXCLUDED.alert_band,
    score_explanation = EXCLUDED.score_explanation,
    scored_at = now();

  GET DIAGNOSTICS v_scored = ROW_COUNT;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES ('commercial-relevance-scoring','success','scores_upserted=' || v_scored);

  RETURN jsonb_build_object('status','success','scores_upserted',v_scored,'generated_at',now());
END;
$$;

CREATE OR REPLACE FUNCTION generate_executive_signal_digest(
  p_segment_key text DEFAULT 'executive_global_risk',
  p_limit integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  DELETE FROM executive_signal_digest_items
  WHERE segment_key = p_segment_key
    AND included_at < now() - interval '24 hours';

  INSERT INTO executive_signal_digest_items (
    segment_key,
    signal_id,
    digest_rank,
    digest_title,
    digest_summary,
    why_it_matters,
    recommended_action,
    evidence_quality
  )
  SELECT
    p_segment_key,
    gs.id,
    ROW_NUMBER() OVER (
      ORDER BY css.trust_adjusted_score DESC,
               css.commercial_relevance_score DESC,
               gs.ingested_at DESC
    ),
    COALESCE(gs.translated_title, gs.title),
    LEFT(COALESCE(gs.translated_summary, gs.summary, ''), 600),
    CONCAT(
      'Relevance ', ROUND(css.commercial_relevance_score,1),
      '/100; trust-adjusted ', ROUND(css.trust_adjusted_score,1),
      '/100; category ', COALESCE(gs.category,'unknown'),
      CASE WHEN COALESCE(gs.affected_countries,'{}') <> '{}'
        THEN CONCAT('; affected ', array_to_string(gs.affected_countries, ','))
        ELSE '' END
    ),
    CASE
      WHEN css.alert_band = 'critical' THEN 'Review immediately and escalate to decision owner.'
      WHEN css.alert_band = 'strategic' THEN 'Monitor for escalation and include in next strategic brief.'
      ELSE 'Track as background intelligence.'
    END,
    CASE
      WHEN COALESCE(gs.source_trust_tier,'') = 'tier_1' THEN 'high — authoritative source'
      WHEN COALESCE(gs.source_trust_tier,'') = 'tier_2' THEN 'moderate-high — reputable source'
      WHEN COALESCE(gs.confidence_score,0) >= 70 THEN 'moderate — confidence supported'
      ELSE 'limited — requires corroboration'
    END
  FROM commercial_signal_scores css
  JOIN global_signals gs
    ON gs.id = css.signal_id
  WHERE css.segment_key = p_segment_key
    AND css.alert_band IN ('critical','strategic')
    AND css.suppression_recommendation IS NULL
  ORDER BY css.trust_adjusted_score DESC,
           css.commercial_relevance_score DESC,
           gs.ingested_at DESC
  LIMIT p_limit
  ON CONFLICT(segment_key, signal_id) DO UPDATE SET
    digest_rank = EXCLUDED.digest_rank,
    digest_title = EXCLUDED.digest_title,
    digest_summary = EXCLUDED.digest_summary,
    why_it_matters = EXCLUDED.why_it_matters,
    recommended_action = EXCLUDED.recommended_action,
    evidence_quality = EXCLUDED.evidence_quality,
    included_at = now();

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES ('executive-signal-digest','success','segment=' || p_segment_key || ', items=' || v_inserted);

  RETURN jsonb_build_object('status','success','segment_key',p_segment_key,'digest_items',v_inserted);
END;
$$;

CREATE OR REPLACE FUNCTION run_intelligence_quality_audit(
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total integer := 0;
  v_canonical integer := 0;
  v_duplicate integer := 0;
  v_suppressed integer := 0;
  v_critical integer := 0;
  v_strategic integer := 0;
  v_avg_rel numeric := 0;
  v_avg_trust numeric := 0;
  v_avg_noise numeric := 0;
  v_snr numeric := 0;
  v_grade text := 'ungraded';
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM global_signals
  WHERE COALESCE(ingested_at, created_at) >= now() - p_window;

  SELECT COUNT(*) INTO v_canonical
  FROM global_signals
  WHERE COALESCE(ingested_at, created_at) >= now() - p_window
    AND canonical_event_status = 'canonical';

  SELECT COUNT(*) INTO v_duplicate
  FROM global_signals
  WHERE COALESCE(ingested_at, created_at) >= now() - p_window
    AND canonical_event_status = 'duplicate';

  SELECT
    COUNT(*) FILTER (WHERE alert_band = 'suppressed'),
    COUNT(*) FILTER (WHERE alert_band = 'critical'),
    COUNT(*) FILTER (WHERE alert_band = 'strategic'),
    COALESCE(AVG(commercial_relevance_score),0),
    COALESCE(AVG(trust_adjusted_score),0),
    COALESCE(AVG(noise_score),0)
  INTO v_suppressed, v_critical, v_strategic, v_avg_rel, v_avg_trust, v_avg_noise
  FROM commercial_signal_scores
  WHERE scored_at >= now() - p_window;

  v_snr := CASE
    WHEN v_suppressed = 0 THEN (v_critical + v_strategic)
    ELSE ROUND(((v_critical + v_strategic)::numeric / NULLIF(v_suppressed,0))::numeric,2)
  END;

  v_grade := CASE
    WHEN v_avg_trust >= 70 AND v_avg_noise <= 30 THEN 'commercial-grade'
    WHEN v_avg_trust >= 60 AND v_avg_noise <= 40 THEN 'near-commercial-grade'
    WHEN v_avg_trust >= 50 THEN 'needs-relevance-refinement'
    ELSE 'prototype-quality'
  END;

  INSERT INTO intelligence_quality_audits (
    audit_window,
    total_signals,
    canonical_signals,
    duplicate_signals,
    suppressed_noise,
    critical_alerts,
    strategic_alerts,
    avg_commercial_relevance,
    avg_trust_adjusted_score,
    avg_noise_score,
    signal_to_noise_ratio,
    quality_grade,
    audit_notes
  ) VALUES (
    p_window::text,
    v_total,
    v_canonical,
    v_duplicate,
    v_suppressed,
    v_critical,
    v_strategic,
    ROUND(v_avg_rel::numeric,2),
    ROUND(v_avg_trust::numeric,2),
    ROUND(v_avg_noise::numeric,2),
    v_snr,
    v_grade,
    jsonb_build_array(
      jsonb_build_object('note','commercial readiness quality audit generated'),
      jsonb_build_object('recommendation', CASE
        WHEN v_avg_noise > 40 THEN 'increase suppression and improve category relevance'
        WHEN v_avg_trust < 60 THEN 'improve source trust and corroboration'
        ELSE 'quality improving toward commercial readiness'
      END)
    )
  );

  INSERT INTO automation_logs(job_name,status,message)
  VALUES ('intelligence-quality-audit','success','grade=' || v_grade || ', snr=' || v_snr);

  RETURN jsonb_build_object(
    'status','success',
    'quality_grade',v_grade,
    'signal_to_noise_ratio',v_snr,
    'avg_trust_adjusted_score',ROUND(v_avg_trust::numeric,2),
    'avg_noise_score',ROUND(v_avg_noise::numeric,2)
  );
END;
$$;

CREATE OR REPLACE VIEW commercial_readiness_command_view AS
SELECT
  iqa.created_at,
  iqa.quality_grade,
  iqa.total_signals,
  iqa.canonical_signals,
  iqa.duplicate_signals,
  iqa.suppressed_noise,
  iqa.critical_alerts,
  iqa.strategic_alerts,
  iqa.avg_commercial_relevance,
  iqa.avg_trust_adjusted_score,
  iqa.avg_noise_score,
  iqa.signal_to_noise_ratio,
  CASE
    WHEN iqa.quality_grade = 'commercial-grade' THEN 'ready-for-controlled-pilot'
    WHEN iqa.quality_grade = 'near-commercial-grade' THEN 'pilot-ready-with-human-review'
    WHEN iqa.quality_grade = 'needs-relevance-refinement' THEN 'continue-quality-hardening'
    ELSE 'not-commercial-ready'
  END AS commercial_status
FROM intelligence_quality_audits iqa
ORDER BY iqa.created_at DESC;

CREATE OR REPLACE VIEW executive_digest_command_view AS
SELECT
  esdi.segment_key,
  esdi.digest_rank,
  esdi.digest_title,
  esdi.digest_summary,
  esdi.why_it_matters,
  esdi.recommended_action,
  esdi.evidence_quality,
  gs.category,
  gs.affected_countries,
  css.commercial_relevance_score,
  css.trust_adjusted_score,
  css.alert_band,
  esdi.included_at
FROM executive_signal_digest_items esdi
JOIN global_signals gs ON gs.id = esdi.signal_id
LEFT JOIN commercial_signal_scores css
  ON css.signal_id = esdi.signal_id
 AND css.segment_key = esdi.segment_key
ORDER BY esdi.segment_key,
         esdi.digest_rank;

SELECT compute_commercial_signal_scores(interval '24 hours');
SELECT generate_executive_signal_digest('executive_global_risk', 15);
SELECT generate_executive_signal_digest('supply_chain_foresight', 15);
SELECT generate_executive_signal_digest('geopolitical_investor', 15);
SELECT generate_executive_signal_digest('humanitarian_ops', 15);
SELECT run_intelligence_quality_audit(interval '24 hours');

INSERT INTO automation_logs(job_name,status,message)
VALUES ('commercial-readiness-bootstrap','success','commercial relevance and trust layer initialized');
