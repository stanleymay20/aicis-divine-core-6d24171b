-- AICIS executive console evidence truth floor v1
--
-- The legacy console coerced missing signal/evidence values to zero, assigned fixed
-- confidence to generated insight cards, ranked regions/domains by ungoverned scores,
-- and synthesized a boardroom-readiness grade. Preserve historical UI artifacts for
-- audit, but replace automatic executive scoring with append-only evidence-coverage
-- snapshots whose members are exactly traceable to signal records.

-- -----------------------------------------------------------------------------
-- 1. Legacy profile score thresholds are policy constants, not confidence evidence.
-- -----------------------------------------------------------------------------
ALTER TABLE public.executive_console_profiles
  ALTER COLUMN minimum_confidence DROP DEFAULT,
  ALTER COLUMN minimum_relevance DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_minimum_confidence numeric,
  ADD COLUMN IF NOT EXISTS reported_minimum_relevance numeric,
  ADD COLUMN IF NOT EXISTS threshold_semantics text;

UPDATE public.executive_console_profiles
SET
  reported_minimum_confidence = COALESCE(reported_minimum_confidence, minimum_confidence),
  reported_minimum_relevance = COALESCE(reported_minimum_relevance, minimum_relevance),
  minimum_confidence = NULL,
  minimum_relevance = NULL,
  threshold_semantics = COALESCE(threshold_semantics, 'legacy_console_selection_thresholds_not_calibrated_confidence_or_relevance');

-- -----------------------------------------------------------------------------
-- 2. Legacy KPI/insight/chart/clarity artifacts are audit-only.
-- -----------------------------------------------------------------------------
ALTER TABLE public.executive_kpi_snapshots
  ALTER COLUMN global_risk_index DROP DEFAULT,
  ALTER COLUMN evidence_quality_index DROP DEFAULT,
  ALTER COLUMN forecast_validation_rate DROP DEFAULT,
  ALTER COLUMN institutional_readiness_grade DROP DEFAULT,
  ALTER COLUMN trend_direction DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_legacy_metrics jsonb,
  ADD COLUMN IF NOT EXISTS snapshot_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.executive_kpi_snapshots
SET
  reported_legacy_metrics = COALESCE(
    reported_legacy_metrics,
    jsonb_build_object(
      'global_risk_index',global_risk_index,
      'evidence_quality_index',evidence_quality_index,
      'forecast_validation_rate',forecast_validation_rate,
      'institutional_readiness_grade',institutional_readiness_grade,
      'trend_direction',trend_direction,
      'total_signals',total_signals,
      'high_priority_signals',high_priority_signals,
      'active_narratives',active_narratives,
      'active_forecasts',active_forecasts,
      'critical_anomalies',critical_anomalies,
      'telemetry_connectors_active',telemetry_connectors_active,
      'telemetry_connectors_degraded',telemetry_connectors_degraded,
      'analyst_review_backlog',analyst_review_backlog
    )
  ),
  global_risk_index = NULL,
  evidence_quality_index = NULL,
  forecast_validation_rate = NULL,
  institutional_readiness_grade = NULL,
  trend_direction = NULL,
  snapshot_semantics = COALESCE(snapshot_semantics, 'legacy_executive_kpi_composite_semantics_unverified'),
  evidence_status = 'legacy_unverified';

ALTER TABLE public.executive_insight_cards
  ALTER COLUMN severity DROP DEFAULT,
  ALTER COLUMN confidence_score DROP DEFAULT,
  ALTER COLUMN sort_rank DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_confidence_score numeric,
  ADD COLUMN IF NOT EXISTS reported_action_recommendation text,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS insight_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.executive_insight_cards
SET
  reported_confidence_score = COALESCE(reported_confidence_score, confidence_score),
  reported_action_recommendation = COALESCE(reported_action_recommendation, action_recommendation),
  confidence_score = NULL,
  action_recommendation = NULL,
  confidence_semantics = COALESCE(confidence_semantics, 'withheld_fixed_or_upstream_score_not_epistemic_confidence'),
  insight_semantics = COALESCE(insight_semantics, 'legacy_generated_executive_insight_without_governed_evidence_contract'),
  evidence_status = 'legacy_unverified';

ALTER TABLE public.executive_chart_datasets
  ADD COLUMN IF NOT EXISTS reported_legacy_data_payload jsonb,
  ADD COLUMN IF NOT EXISTS dataset_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.executive_chart_datasets
SET
  reported_legacy_data_payload = COALESCE(reported_legacy_data_payload, data_payload),
  data_payload = '{}'::jsonb,
  dataset_semantics = COALESCE(dataset_semantics, 'legacy_risk_ranking_payload_with_missing_values_coerced_to_zero'),
  evidence_status = 'legacy_unverified';

ALTER TABLE public.decision_clarity_scorecards
  ALTER COLUMN signal_to_noise_score DROP DEFAULT,
  ALTER COLUMN interpretability_score DROP DEFAULT,
  ALTER COLUMN actionability_score DROP DEFAULT,
  ALTER COLUMN evidence_score DROP DEFAULT,
  ALTER COLUMN timeliness_score DROP DEFAULT,
  ALTER COLUMN overall_clarity_score DROP DEFAULT,
  ALTER COLUMN clarity_grade DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_legacy_scores jsonb,
  ADD COLUMN IF NOT EXISTS clarity_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.decision_clarity_scorecards
SET
  reported_legacy_scores = COALESCE(
    reported_legacy_scores,
    jsonb_build_object(
      'signal_to_noise_score',signal_to_noise_score,
      'interpretability_score',interpretability_score,
      'actionability_score',actionability_score,
      'evidence_score',evidence_score,
      'timeliness_score',timeliness_score,
      'overall_clarity_score',overall_clarity_score,
      'clarity_grade',clarity_grade
    )
  ),
  signal_to_noise_score = NULL,
  interpretability_score = NULL,
  actionability_score = NULL,
  evidence_score = NULL,
  timeliness_score = NULL,
  overall_clarity_score = NULL,
  clarity_grade = NULL,
  improvement_recommendations = '[]'::jsonb,
  clarity_semantics = COALESCE(clarity_semantics, 'withheld_legacy_weighted_readiness_formula_not_validated_decision_quality'),
  evidence_status = 'legacy_unverified';

-- -----------------------------------------------------------------------------
-- 3. Compatibility signal view keeps its existing column contract but removes all
-- synthetic fallback scoring. Derived executive scores are NULL until a governed
-- method exists; source fields remain available with their own table semantics.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.executive_filtered_signal_view AS
SELECT
  gs.id,
  COALESCE(gs.translated_title, gs.title) AS title,
  gs.category,
  gs.affected_countries,
  gs.source_trust_tier,
  gs.urgency_score,
  gs.impact_score,
  gs.confidence_score,
  gs.predictive_priority,
  gs.anomaly_score,
  NULL::numeric AS executive_relevance_score,
  NULL::numeric AS recursive_trust_score,
  NULL::numeric AS evidence_quality_score,
  gs.ingested_at,
  gs.created_at
FROM public.global_signals gs
WHERE gs.canonical_event_status = 'canonical';

-- -----------------------------------------------------------------------------
-- 4. Append-only executive evidence snapshots and exact membership.
-- Window semantics are operational system-record time, never event occurrence time.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.executive_evidence_snapshots_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_key text,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  window_semantics text NOT NULL DEFAULT 'system_ingestion_or_record_time_not_event_occurrence',
  total_signal_records integer NOT NULL,
  governed_impact_count integer NOT NULL,
  governed_urgency_count integer NOT NULL,
  governed_confidence_count integer NOT NULL,
  independent_corroboration_count integer NOT NULL,
  known_occurrence_time_count integer NOT NULL,
  open_review_count integer NOT NULL,
  telemetry_active_connectors integer NOT NULL,
  telemetry_degraded_connectors integer NOT NULL,
  impact_semantics_coverage_pct numeric,
  urgency_semantics_coverage_pct numeric,
  confidence_semantics_coverage_pct numeric,
  source_independence_coverage_pct numeric,
  occurrence_time_coverage_pct numeric,
  snapshot_semantics text NOT NULL DEFAULT 'descriptive_evidence_coverage_no_global_risk_or_confidence_score',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (window_end >= window_start),
  CHECK (total_signal_records >= 0),
  CHECK (governed_impact_count >= 0 AND governed_urgency_count >= 0 AND governed_confidence_count >= 0),
  CHECK (independent_corroboration_count >= 0 AND known_occurrence_time_count >= 0)
);

CREATE TABLE IF NOT EXISTS public.executive_evidence_snapshot_members_v1 (
  snapshot_id uuid NOT NULL REFERENCES public.executive_evidence_snapshots_v1(id) ON DELETE CASCADE,
  signal_id uuid NOT NULL REFERENCES public.global_signals(id) ON DELETE RESTRICT,
  impact_semantics_usable boolean NOT NULL,
  urgency_semantics_usable boolean NOT NULL,
  confidence_semantics_usable boolean NOT NULL,
  independent_corroboration_established boolean NOT NULL,
  occurrence_time_usable boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, signal_id)
);

CREATE INDEX IF NOT EXISTS idx_executive_evidence_snapshots_created_v1
ON public.executive_evidence_snapshots_v1(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_executive_evidence_members_signal_v1
ON public.executive_evidence_snapshot_members_v1(signal_id, snapshot_id);

CREATE OR REPLACE FUNCTION public.block_executive_evidence_snapshot_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'executive evidence snapshots are append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_executive_evidence_snapshot_update_v1 ON public.executive_evidence_snapshots_v1;
CREATE TRIGGER trg_block_executive_evidence_snapshot_update_v1
BEFORE UPDATE OR DELETE ON public.executive_evidence_snapshots_v1
FOR EACH ROW EXECUTE FUNCTION public.block_executive_evidence_snapshot_mutation_v1();

DROP TRIGGER IF EXISTS trg_block_executive_evidence_member_update_v1 ON public.executive_evidence_snapshot_members_v1;
CREATE TRIGGER trg_block_executive_evidence_member_update_v1
BEFORE UPDATE OR DELETE ON public.executive_evidence_snapshot_members_v1
FOR EACH ROW EXECUTE FUNCTION public.block_executive_evidence_snapshot_mutation_v1();

CREATE OR REPLACE FUNCTION public.generate_executive_evidence_snapshot_v1(
  p_profile_key text DEFAULT 'global_executive_console',
  p_window interval DEFAULT interval '24 hours'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_start timestamptz := now() - p_window;
  v_end timestamptz := now();
  v_total integer := 0;
  v_impact integer := 0;
  v_urgency integer := 0;
  v_confidence integer := 0;
  v_independent integer := 0;
  v_occurrence integer := 0;
  v_reviews integer := 0;
  v_active_connectors integer := 0;
  v_degraded_connectors integer := 0;
  v_inserted integer := 0;
BEGIN
  IF p_window IS NULL OR p_window <= interval '0 seconds' THEN
    RAISE EXCEPTION 'p_window must be positive';
  END IF;

  WITH eligible AS (
    SELECT
      gs.id,
      gs.impact_score IS NOT NULL
        AND NOT public.aicis_signal_semantics_unusable_v1(gs.impact_score_semantics) AS impact_ok,
      gs.urgency_score IS NOT NULL
        AND NOT public.aicis_signal_semantics_unusable_v1(gs.urgency_score_semantics) AS urgency_ok,
      gs.confidence_score IS NOT NULL
        AND NOT public.aicis_signal_semantics_unusable_v1(gs.confidence_score_semantics) AS confidence_ok,
      gs.source_independence_status = 'established'
        AND gs.independent_origin_count IS NOT NULL
        AND gs.independent_origin_count >= 2 AS independence_ok,
      gs.occurred_at IS NOT NULL
        AND NOT public.aicis_signal_semantics_unusable_v1(gs.occurred_at_semantics) AS occurrence_ok
    FROM public.global_signals gs
    WHERE gs.canonical_event_status = 'canonical'
      AND COALESCE(gs.ingested_at, gs.created_at) >= v_start
      AND COALESCE(gs.ingested_at, gs.created_at) <= v_end
  )
  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE impact_ok)::integer,
    count(*) FILTER (WHERE urgency_ok)::integer,
    count(*) FILTER (WHERE confidence_ok)::integer,
    count(*) FILTER (WHERE independence_ok)::integer,
    count(*) FILTER (WHERE occurrence_ok)::integer
  INTO v_total,v_impact,v_urgency,v_confidence,v_independent,v_occurrence
  FROM eligible;

  SELECT count(*)::integer INTO v_reviews
  FROM public.analyst_review_queue
  WHERE review_status = 'open';

  SELECT
    count(*) FILTER (WHERE operational_status = 'active')::integer,
    count(*) FILTER (WHERE operational_status = 'degraded' OR consecutive_failures >= 3)::integer
  INTO v_active_connectors,v_degraded_connectors
  FROM public.telemetry_connectors;

  INSERT INTO public.executive_evidence_snapshots_v1(
    profile_key,window_start,window_end,total_signal_records,
    governed_impact_count,governed_urgency_count,governed_confidence_count,
    independent_corroboration_count,known_occurrence_time_count,
    open_review_count,telemetry_active_connectors,telemetry_degraded_connectors,
    impact_semantics_coverage_pct,urgency_semantics_coverage_pct,confidence_semantics_coverage_pct,
    source_independence_coverage_pct,occurrence_time_coverage_pct
  ) VALUES (
    p_profile_key,v_start,v_end,v_total,
    v_impact,v_urgency,v_confidence,v_independent,v_occurrence,
    v_reviews,v_active_connectors,v_degraded_connectors,
    CASE WHEN v_total = 0 THEN NULL ELSE round((v_impact::numeric / v_total) * 100,2) END,
    CASE WHEN v_total = 0 THEN NULL ELSE round((v_urgency::numeric / v_total) * 100,2) END,
    CASE WHEN v_total = 0 THEN NULL ELSE round((v_confidence::numeric / v_total) * 100,2) END,
    CASE WHEN v_total = 0 THEN NULL ELSE round((v_independent::numeric / v_total) * 100,2) END,
    CASE WHEN v_total = 0 THEN NULL ELSE round((v_occurrence::numeric / v_total) * 100,2) END
  ) RETURNING id INTO v_id;

  INSERT INTO public.executive_evidence_snapshot_members_v1(
    snapshot_id,signal_id,impact_semantics_usable,urgency_semantics_usable,
    confidence_semantics_usable,independent_corroboration_established,occurrence_time_usable
  )
  SELECT
    v_id,
    gs.id,
    gs.impact_score IS NOT NULL AND NOT public.aicis_signal_semantics_unusable_v1(gs.impact_score_semantics),
    gs.urgency_score IS NOT NULL AND NOT public.aicis_signal_semantics_unusable_v1(gs.urgency_score_semantics),
    gs.confidence_score IS NOT NULL AND NOT public.aicis_signal_semantics_unusable_v1(gs.confidence_score_semantics),
    gs.source_independence_status = 'established' AND gs.independent_origin_count IS NOT NULL AND gs.independent_origin_count >= 2,
    gs.occurred_at IS NOT NULL AND NOT public.aicis_signal_semantics_unusable_v1(gs.occurred_at_semantics)
  FROM public.global_signals gs
  WHERE gs.canonical_event_status = 'canonical'
    AND COALESCE(gs.ingested_at, gs.created_at) >= v_start
    AND COALESCE(gs.ingested_at, gs.created_at) <= v_end;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> v_total THEN
    RAISE EXCEPTION 'executive evidence snapshot membership mismatch expected %, inserted %', v_total, v_inserted;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE VIEW public.executive_evidence_console_v1 AS
SELECT
  s.id,
  s.profile_key,
  s.window_start,
  s.window_end,
  s.total_signal_records,
  s.governed_impact_count,
  s.impact_semantics_coverage_pct,
  s.governed_urgency_count,
  s.urgency_semantics_coverage_pct,
  s.governed_confidence_count,
  s.confidence_semantics_coverage_pct,
  s.independent_corroboration_count,
  s.source_independence_coverage_pct,
  s.known_occurrence_time_count,
  s.occurrence_time_coverage_pct,
  s.open_review_count,
  s.telemetry_active_connectors,
  s.telemetry_degraded_connectors,
  s.snapshot_semantics,
  s.created_at
FROM public.executive_evidence_snapshots_v1 s
ORDER BY s.created_at DESC;

-- -----------------------------------------------------------------------------
-- 5. Disable synthetic executive generators. Existing names remain callable but
-- return explicit quarantine status rather than mutating misleading score tables.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_executive_kpi_snapshot(
  p_profile_key text DEFAULT 'global_executive_console',
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'status','quarantined',
    'reason','legacy_composite_executive_scores_disabled_use_generate_executive_evidence_snapshot_v1',
    'profile_key',p_profile_key,
    'window',p_window::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_executive_insight_cards(
  p_profile_key text DEFAULT 'global_executive_console',
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'status','quarantined',
    'reason','fixed_confidence_generated_insight_cards_disabled',
    'profile_key',p_profile_key,
    'window',p_window::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_executive_chart_datasets(
  p_profile_key text DEFAULT 'global_executive_console',
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'status','quarantined',
    'reason','legacy_risk_ranking_charts_disabled_use_descriptive_evidence_coverage_views',
    'profile_key',p_profile_key,
    'window',p_window::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_decision_clarity_scorecard(
  p_profile_key text DEFAULT 'global_executive_console',
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'status','quarantined',
    'reason','legacy_boardroom_readiness_formula_not_validated_decision_quality',
    'profile_key',p_profile_key,
    'window',p_window::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.run_executive_console_cycle(
  p_profile_key text DEFAULT 'global_executive_console',
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot_id uuid;
BEGIN
  v_snapshot_id := public.generate_executive_evidence_snapshot_v1(p_profile_key,p_window);
  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES (
    'executive-console-cycle',
    'success',
    'generated descriptive evidence-coverage snapshot; no global risk/confidence/readiness score issued'
  );
  RETURN jsonb_build_object(
    'status','success',
    'profile_key',p_profile_key,
    'evidence_snapshot_id',v_snapshot_id,
    'global_risk_index',NULL,
    'decision_clarity_score',NULL,
    'semantics','descriptive_evidence_coverage_only'
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Security. New evidence snapshots are internal/operator evidence products.
-- -----------------------------------------------------------------------------
ALTER TABLE public.executive_evidence_snapshots_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executive_evidence_snapshot_members_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.executive_evidence_snapshots_v1 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.executive_evidence_snapshot_members_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.executive_evidence_snapshots_v1 TO service_role;
GRANT SELECT, INSERT ON TABLE public.executive_evidence_snapshot_members_v1 TO service_role;

REVOKE ALL ON FUNCTION public.generate_executive_evidence_snapshot_v1(text,interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_executive_kpi_snapshot(text,interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_executive_insight_cards(text,interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_executive_chart_datasets(text,interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_decision_clarity_scorecard(text,interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_executive_console_cycle(text,interval) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.generate_executive_evidence_snapshot_v1(text,interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_executive_kpi_snapshot(text,interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_executive_insight_cards(text,interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_executive_chart_datasets(text,interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_decision_clarity_scorecard(text,interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_executive_console_cycle(text,interval) TO service_role;

COMMENT ON TABLE public.executive_evidence_snapshots_v1 IS
  'Append-only descriptive executive evidence-coverage snapshots. Percentages describe semantic/provenance coverage only; no global risk, trust, or confidence score is issued.';
COMMENT ON VIEW public.executive_evidence_console_v1 IS
  'Executive evidence coverage console: governed-score coverage, source independence, event-time coverage, review backlog and connector state.';
