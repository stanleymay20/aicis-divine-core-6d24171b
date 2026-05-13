-- Validation + Explainability + Analyst Workflow Layer
-- Converts AICIS outputs into institutionally reviewable intelligence products.

-- =====================================================
-- 1. Evidence lineage packets
-- =====================================================
CREATE TABLE IF NOT EXISTS public.intelligence_evidence_packets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_key text UNIQUE NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid,
  evidence_quality_score numeric DEFAULT 0,
  source_count integer DEFAULT 0,
  authoritative_source_count integer DEFAULT 0,
  corroborating_signal_count integer DEFAULT 0,
  contradiction_count integer DEFAULT 0,
  evidence_summary text,
  evidence_items jsonb DEFAULT '[]'::jsonb,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_packets_subject
ON public.intelligence_evidence_packets(subject_type, subject_id);

CREATE INDEX IF NOT EXISTS idx_evidence_packets_quality
ON public.intelligence_evidence_packets(evidence_quality_score DESC);

-- =====================================================
-- 2. Explainability traces
-- =====================================================
CREATE TABLE IF NOT EXISTS public.intelligence_explainability_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_key text UNIQUE NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid,
  explanation_title text,
  explanation_summary text,
  primary_drivers jsonb DEFAULT '[]'::jsonb,
  risk_factors jsonb DEFAULT '[]'::jsonb,
  confidence_factors jsonb DEFAULT '[]'::jsonb,
  uncertainty_factors jsonb DEFAULT '[]'::jsonb,
  causal_chain jsonb DEFAULT '[]'::jsonb,
  recommended_human_review boolean DEFAULT false,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_explainability_subject
ON public.intelligence_explainability_traces(subject_type, subject_id);

-- =====================================================
-- 3. Analyst review queues
-- =====================================================
CREATE TABLE IF NOT EXISTS public.analyst_review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_key text UNIQUE NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid,
  review_priority text DEFAULT 'normal',
  review_reason text,
  assigned_team text,
  review_status text DEFAULT 'open',
  reviewer_id uuid,
  reviewer_notes text,
  ai_confidence numeric DEFAULT 0,
  human_confidence numeric,
  created_at timestamptz DEFAULT now(),
  reviewed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_review_queue_status_priority
ON public.analyst_review_queue(review_status, review_priority, created_at DESC);

-- =====================================================
-- 4. Analyst annotations
-- =====================================================
CREATE TABLE IF NOT EXISTS public.intelligence_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL,
  subject_id uuid,
  analyst_id uuid,
  annotation_type text,
  annotation_text text,
  confidence_adjustment numeric DEFAULT 0,
  relevance_adjustment numeric DEFAULT 0,
  annotation_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_annotations_subject
ON public.intelligence_annotations(subject_type, subject_id, created_at DESC);

-- =====================================================
-- 5. Forecast validation queue
-- =====================================================
CREATE TABLE IF NOT EXISTS public.forecast_validation_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id uuid REFERENCES public.predictive_forecasts(id) ON DELETE CASCADE,
  validation_due_at timestamptz,
  validation_status text DEFAULT 'pending',
  validation_priority text DEFAULT 'normal',
  expected_regions jsonb DEFAULT '[]'::jsonb,
  expected_categories jsonb DEFAULT '[]'::jsonb,
  matched_signal_count integer DEFAULT 0,
  auto_validation_score numeric DEFAULT 0,
  validation_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(forecast_id)
);

CREATE INDEX IF NOT EXISTS idx_forecast_validation_due
ON public.forecast_validation_queue(validation_status, validation_due_at);

-- =====================================================
-- 6. Institutional trust scorecards
-- =====================================================
CREATE TABLE IF NOT EXISTS public.institutional_trust_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scorecard_key text UNIQUE NOT NULL,
  scorecard_window text DEFAULT '7d',
  intelligence_accuracy_score numeric DEFAULT 0,
  evidence_quality_score numeric DEFAULT 0,
  explainability_score numeric DEFAULT 0,
  analyst_review_completion_rate numeric DEFAULT 0,
  false_positive_pressure numeric DEFAULT 0,
  forecast_validation_rate numeric DEFAULT 0,
  institutional_readiness_grade text DEFAULT 'ungraded',
  generated_at timestamptz DEFAULT now()
);

-- =====================================================
-- 7. Evidence packet generation
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_signal_evidence_packets(
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  INSERT INTO public.intelligence_evidence_packets (
    packet_key,
    subject_type,
    subject_id,
    evidence_quality_score,
    source_count,
    authoritative_source_count,
    corroborating_signal_count,
    contradiction_count,
    evidence_summary,
    evidence_items,
    generated_at
  )
  SELECT
    md5('signal|' || gs.id::text),
    'signal',
    gs.id,
    LEAST(100, ROUND((
      COALESCE(gs.confidence_score,0) * 0.35 +
      COALESCE(gs.corroboration_count,0) * 12 +
      CASE WHEN COALESCE(gs.source_trust_tier,'') = 'tier_1' THEN 25
           WHEN COALESCE(gs.source_trust_tier,'') = 'tier_2' THEN 15
           ELSE 5 END
    )::numeric,2)),
    GREATEST(1, COALESCE(gs.corroboration_count,1)),
    CASE WHEN COALESCE(gs.source_trust_tier,'') = 'tier_1' THEN 1 ELSE 0 END,
    COALESCE(gs.corroboration_count,0),
    0,
    CONCAT(
      'Evidence packet for ', COALESCE(gs.category,'unknown'),
      ' signal with confidence ', COALESCE(gs.confidence_score,0),
      ' and corroboration count ', COALESCE(gs.corroboration_count,0), '.'
    ),
    jsonb_build_array(
      jsonb_build_object('title', COALESCE(gs.translated_title, gs.title)),
      jsonb_build_object('category', COALESCE(gs.category,'unknown')),
      jsonb_build_object('source_tier', COALESCE(gs.source_trust_tier,'unknown')),
      jsonb_build_object('affected_countries', COALESCE(gs.affected_countries,'{}')),
      jsonb_build_object('confidence_score', COALESCE(gs.confidence_score,0))
    ),
    now()
  FROM public.global_signals gs
  WHERE COALESCE(gs.ingested_at,gs.created_at) >= now() - p_window
    AND COALESCE(gs.canonical_event_status,'canonical') = 'canonical'
  ON CONFLICT(packet_key) DO UPDATE SET
    evidence_quality_score = EXCLUDED.evidence_quality_score,
    source_count = EXCLUDED.source_count,
    authoritative_source_count = EXCLUDED.authoritative_source_count,
    corroborating_signal_count = EXCLUDED.corroborating_signal_count,
    evidence_summary = EXCLUDED.evidence_summary,
    evidence_items = EXCLUDED.evidence_items,
    generated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('evidence-packet-generation','success','packets=' || v_rows);

  RETURN jsonb_build_object('status','success','evidence_packets',v_rows);
END;
$$;

-- =====================================================
-- 8. Explainability generation
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_explainability_traces(
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  INSERT INTO public.intelligence_explainability_traces (
    trace_key,
    subject_type,
    subject_id,
    explanation_title,
    explanation_summary,
    primary_drivers,
    risk_factors,
    confidence_factors,
    uncertainty_factors,
    causal_chain,
    recommended_human_review,
    generated_at
  )
  SELECT
    md5('signal-explain|' || gs.id::text),
    'signal',
    gs.id,
    CONCAT('Why this signal matters: ', LEFT(COALESCE(gs.translated_title, gs.title, 'Untitled'), 120)),
    CONCAT(
      'This signal was prioritized because of impact=', COALESCE(gs.impact_score,0),
      ', urgency=', COALESCE(gs.urgency_score,0),
      ', confidence=', COALESCE(gs.confidence_score,0),
      ', predictive priority=', COALESCE(gs.predictive_priority,0), '.'
    ),
    jsonb_build_array(
      jsonb_build_object('driver','impact_score','value',COALESCE(gs.impact_score,0)),
      jsonb_build_object('driver','urgency_score','value',COALESCE(gs.urgency_score,0)),
      jsonb_build_object('driver','predictive_priority','value',COALESCE(gs.predictive_priority,0)),
      jsonb_build_object('driver','category','value',COALESCE(gs.category,'unknown'))
    ),
    jsonb_build_array(
      jsonb_build_object('risk','geographic_scope','value',COALESCE(gs.affected_countries,'{}')),
      jsonb_build_object('risk','anomaly_score','value',COALESCE(gs.anomaly_score,0))
    ),
    jsonb_build_array(
      jsonb_build_object('factor','source_trust_tier','value',COALESCE(gs.source_trust_tier,'unknown')),
      jsonb_build_object('factor','corroboration_count','value',COALESCE(gs.corroboration_count,0)),
      jsonb_build_object('factor','confidence_score','value',COALESCE(gs.confidence_score,0))
    ),
    jsonb_build_array(
      jsonb_build_object('uncertainty','low_corroboration','value',COALESCE(gs.corroboration_count,0) < 2),
      jsonb_build_object('uncertainty','low_confidence','value',COALESCE(gs.confidence_score,0) < 55)
    ),
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'causal_type', scl.causal_type,
          'confidence', scl.causal_confidence
        )
      )
      FROM public.strategic_causal_links scl
      WHERE scl.source_signal_id = gs.id OR scl.target_signal_id = gs.id
      LIMIT 10
    ), '[]'::jsonb),
    (
      COALESCE(gs.confidence_score,0) < 55
      OR COALESCE(gs.corroboration_count,0) < 2
      OR COALESCE(gs.anomaly_score,0) >= 80
    ),
    now()
  FROM public.global_signals gs
  WHERE COALESCE(gs.ingested_at,gs.created_at) >= now() - p_window
    AND COALESCE(gs.canonical_event_status,'canonical') = 'canonical'
  ON CONFLICT(trace_key) DO UPDATE SET
    explanation_summary = EXCLUDED.explanation_summary,
    primary_drivers = EXCLUDED.primary_drivers,
    risk_factors = EXCLUDED.risk_factors,
    confidence_factors = EXCLUDED.confidence_factors,
    uncertainty_factors = EXCLUDED.uncertainty_factors,
    causal_chain = EXCLUDED.causal_chain,
    recommended_human_review = EXCLUDED.recommended_human_review,
    generated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('explainability-generation','success','traces=' || v_rows);

  RETURN jsonb_build_object('status','success','explainability_traces',v_rows);
END;
$$;

-- =====================================================
-- 9. Analyst queue generation
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_analyst_review_queue(
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  INSERT INTO public.analyst_review_queue (
    review_key,
    subject_type,
    subject_id,
    review_priority,
    review_reason,
    assigned_team,
    review_status,
    ai_confidence,
    created_at
  )
  SELECT
    md5('signal-review|' || gs.id::text),
    'signal',
    gs.id,
    CASE
      WHEN COALESCE(gs.anomaly_score,0) >= 85 OR COALESCE(gs.predictive_priority,0) >= 85 THEN 'urgent'
      WHEN COALESCE(gs.confidence_score,0) < 55 THEN 'high'
      ELSE 'normal'
    END,
    CASE
      WHEN COALESCE(gs.anomaly_score,0) >= 85 THEN 'extreme anomaly requires analyst validation'
      WHEN COALESCE(gs.predictive_priority,0) >= 85 THEN 'high predictive priority requires analyst validation'
      WHEN COALESCE(gs.confidence_score,0) < 55 THEN 'low confidence high-impact signal requires review'
      ELSE 'routine quality review'
    END,
    CASE
      WHEN COALESCE(gs.category,'') IN ('conflict','geopolitics') THEN 'geopolitical-analysis'
      WHEN COALESCE(gs.category,'') IN ('cybersecurity') THEN 'cyber-analysis'
      WHEN COALESCE(gs.category,'') IN ('health','migration','food-security') THEN 'humanitarian-analysis'
      ELSE 'strategic-intelligence'
    END,
    'open',
    COALESCE(gs.confidence_score,0),
    now()
  FROM public.global_signals gs
  WHERE COALESCE(gs.ingested_at,gs.created_at) >= now() - p_window
    AND COALESCE(gs.canonical_event_status,'canonical') = 'canonical'
    AND (
      COALESCE(gs.anomaly_score,0) >= 75
      OR COALESCE(gs.predictive_priority,0) >= 80
      OR (COALESCE(gs.impact_score,0) >= 75 AND COALESCE(gs.confidence_score,0) < 60)
    )
  ON CONFLICT(review_key) DO UPDATE SET
    review_priority = EXCLUDED.review_priority,
    review_reason = EXCLUDED.review_reason,
    assigned_team = EXCLUDED.assigned_team,
    ai_confidence = EXCLUDED.ai_confidence;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('analyst-review-queue-generation','success','reviews=' || v_rows);

  RETURN jsonb_build_object('status','success','review_items',v_rows);
END;
$$;

-- =====================================================
-- 10. Forecast validation queue + auto-matching
-- =====================================================
CREATE OR REPLACE FUNCTION public.prepare_forecast_validation_queue()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  INSERT INTO public.forecast_validation_queue (
    forecast_id,
    validation_due_at,
    validation_status,
    validation_priority,
    expected_regions,
    expected_categories,
    created_at,
    updated_at
  )
  SELECT
    pf.id,
    COALESCE(pf.expires_at, pf.created_at + make_interval(hours => pf.forecast_window_hours)),
    'pending',
    CASE WHEN pf.forecast_probability >= 80 THEN 'high' ELSE 'normal' END,
    pf.expected_regions,
    pf.expected_categories,
    now(),
    now()
  FROM public.predictive_forecasts pf
  WHERE pf.status = 'active'
  ON CONFLICT(forecast_id) DO UPDATE SET
    validation_due_at = EXCLUDED.validation_due_at,
    validation_priority = EXCLUDED.validation_priority,
    expected_regions = EXCLUDED.expected_regions,
    expected_categories = EXCLUDED.expected_categories,
    updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('forecast-validation-queue','success','queued=' || v_rows);

  RETURN jsonb_build_object('status','success','queued_forecasts',v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_validate_due_forecasts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  WITH due AS (
    SELECT fvq.*, pf.forecast_probability, pf.forecast_domain
    FROM public.forecast_validation_queue fvq
    JOIN public.predictive_forecasts pf ON pf.id = fvq.forecast_id
    WHERE fvq.validation_status = 'pending'
      AND fvq.validation_due_at <= now()
  ), matches AS (
    SELECT
      due.forecast_id,
      COUNT(gs.id) AS matched_count,
      ROUND(AVG(COALESCE(gs.impact_score,0))::numeric,2) AS avg_realized_impact
    FROM due
    LEFT JOIN public.global_signals gs
      ON COALESCE(gs.ingested_at,gs.created_at) >= due.validation_due_at - interval '7 days'
     AND COALESCE(gs.ingested_at,gs.created_at) <= due.validation_due_at + interval '2 days'
     AND (
       lower(COALESCE(gs.category,'')) = lower(COALESCE(due.forecast_domain,''))
       OR to_jsonb(COALESCE(gs.affected_countries, ARRAY['GLOBAL'])) ?| ARRAY(
         SELECT jsonb_array_elements_text(due.expected_regions)
       )
     )
    GROUP BY due.forecast_id
  )
  UPDATE public.forecast_validation_queue fvq
  SET
    matched_signal_count = matches.matched_count,
    auto_validation_score = LEAST(100, matches.matched_count * 20 + COALESCE(matches.avg_realized_impact,0) * 0.4),
    validation_status = CASE WHEN matches.matched_count > 0 THEN 'auto_validated' ELSE 'needs_human_review' END,
    validation_notes = CASE WHEN matches.matched_count > 0 THEN 'auto-matched against later signals' ELSE 'no clear matching signal found' END,
    updated_at = now()
  FROM matches
  WHERE fvq.forecast_id = matches.forecast_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('forecast-auto-validation','success','validated=' || v_rows);

  RETURN jsonb_build_object('status','success','validated_forecasts',v_rows);
END;
$$;

-- =====================================================
-- 11. Institutional readiness scorecard
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_institutional_trust_scorecard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_evidence numeric := 0;
  v_explainability numeric := 0;
  v_review_rate numeric := 0;
  v_validation_rate numeric := 0;
  v_false_positive numeric := 0;
  v_accuracy numeric := 0;
  v_grade text := 'ungraded';
BEGIN
  SELECT COALESCE(AVG(evidence_quality_score),0)
  INTO v_evidence
  FROM public.intelligence_evidence_packets
  WHERE generated_at >= now() - interval '7 days';

  SELECT COALESCE(AVG(CASE WHEN recommended_human_review THEN 80 ELSE 90 END),0)
  INTO v_explainability
  FROM public.intelligence_explainability_traces
  WHERE generated_at >= now() - interval '7 days';

  SELECT CASE WHEN COUNT(*) = 0 THEN 100 ELSE ROUND((COUNT(*) FILTER (WHERE review_status IN ('reviewed','closed'))::numeric / COUNT(*)::numeric) * 100,2) END
  INTO v_review_rate
  FROM public.analyst_review_queue
  WHERE created_at >= now() - interval '7 days';

  SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE ROUND((COUNT(*) FILTER (WHERE validation_status IN ('auto_validated','human_validated'))::numeric / COUNT(*)::numeric) * 100,2) END
  INTO v_validation_rate
  FROM public.forecast_validation_queue
  WHERE created_at >= now() - interval '30 days';

  SELECT COALESCE(AVG(suppression_score),0)
  INTO v_false_positive
  FROM public.false_positive_suppression_events
  WHERE created_at >= now() - interval '7 days';

  v_accuracy := ROUND((v_evidence * 0.30 + v_explainability * 0.25 + v_review_rate * 0.15 + v_validation_rate * 0.20 + GREATEST(0,100 - v_false_positive) * 0.10)::numeric,2);

  v_grade := CASE
    WHEN v_accuracy >= 85 THEN 'institution-ready'
    WHEN v_accuracy >= 72 THEN 'pilot-ready'
    WHEN v_accuracy >= 60 THEN 'needs-human-review-layer'
    ELSE 'not-ready'
  END;

  INSERT INTO public.institutional_trust_scorecards (
    scorecard_key,
    scorecard_window,
    intelligence_accuracy_score,
    evidence_quality_score,
    explainability_score,
    analyst_review_completion_rate,
    false_positive_pressure,
    forecast_validation_rate,
    institutional_readiness_grade,
    generated_at
  ) VALUES (
    md5(current_date::text || '|7d|institutional-trust'),
    '7d',
    v_accuracy,
    ROUND(v_evidence::numeric,2),
    ROUND(v_explainability::numeric,2),
    ROUND(v_review_rate::numeric,2),
    ROUND(v_false_positive::numeric,2),
    ROUND(v_validation_rate::numeric,2),
    v_grade,
    now()
  )
  ON CONFLICT(scorecard_key) DO UPDATE SET
    intelligence_accuracy_score = EXCLUDED.intelligence_accuracy_score,
    evidence_quality_score = EXCLUDED.evidence_quality_score,
    explainability_score = EXCLUDED.explainability_score,
    analyst_review_completion_rate = EXCLUDED.analyst_review_completion_rate,
    false_positive_pressure = EXCLUDED.false_positive_pressure,
    forecast_validation_rate = EXCLUDED.forecast_validation_rate,
    institutional_readiness_grade = EXCLUDED.institutional_readiness_grade,
    generated_at = now();

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('institutional-trust-scorecard','success','grade=' || v_grade || ', score=' || v_accuracy);

  RETURN jsonb_build_object('status','success','grade',v_grade,'score',v_accuracy);
END;
$$;

-- =====================================================
-- 12. Command views
-- =====================================================
CREATE OR REPLACE VIEW public.explainability_command_view AS
SELECT
  iet.subject_type,
  iet.subject_id,
  iet.explanation_title,
  iet.explanation_summary,
  iet.recommended_human_review,
  iep.evidence_quality_score,
  iep.source_count,
  iep.authoritative_source_count,
  iet.generated_at
FROM public.intelligence_explainability_traces iet
LEFT JOIN public.intelligence_evidence_packets iep
  ON iep.subject_type = iet.subject_type
 AND iep.subject_id = iet.subject_id
ORDER BY iet.recommended_human_review DESC,
         iep.evidence_quality_score DESC NULLS LAST;

CREATE OR REPLACE VIEW public.analyst_review_command_view AS
SELECT
  arq.review_priority,
  arq.review_status,
  arq.review_reason,
  arq.assigned_team,
  arq.ai_confidence,
  arq.human_confidence,
  arq.created_at,
  arq.reviewed_at
FROM public.analyst_review_queue arq
ORDER BY
  CASE arq.review_priority
    WHEN 'urgent' THEN 1
    WHEN 'high' THEN 2
    WHEN 'normal' THEN 3
    ELSE 4
  END,
  arq.created_at DESC;

CREATE OR REPLACE VIEW public.institutional_trust_command_view AS
SELECT
  scorecard_window,
  intelligence_accuracy_score,
  evidence_quality_score,
  explainability_score,
  analyst_review_completion_rate,
  false_positive_pressure,
  forecast_validation_rate,
  institutional_readiness_grade,
  generated_at
FROM public.institutional_trust_scorecards
ORDER BY generated_at DESC;

-- =====================================================
-- 13. Orchestrator
-- =====================================================
CREATE OR REPLACE FUNCTION public.run_validation_explainability_cycle(
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r1 jsonb;
  r2 jsonb;
  r3 jsonb;
  r4 jsonb;
  r5 jsonb;
  r6 jsonb;
BEGIN
  r1 := public.generate_signal_evidence_packets(p_window);
  r2 := public.generate_explainability_traces(p_window);
  r3 := public.generate_analyst_review_queue(p_window);
  r4 := public.prepare_forecast_validation_queue();
  r5 := public.auto_validate_due_forecasts();
  r6 := public.generate_institutional_trust_scorecard();

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('validation-explainability-cycle','success','cycle completed');

  RETURN jsonb_build_object(
    'status','success',
    'evidence_packets',r1,
    'explainability_traces',r2,
    'analyst_queue',r3,
    'forecast_queue',r4,
    'forecast_validation',r5,
    'institutional_scorecard',r6
  );
END;
$$;

INSERT INTO public.automation_logs(job_name,status,message)
VALUES (
  'validation-explainability-analyst-workflow',
  'success',
  'evidence lineage, explainability traces, analyst review queues, forecast validation, and institutional trust scorecards initialized'
);
