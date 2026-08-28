-- AICIS executive evidence snapshot admission v1
--
-- Legacy KPI counts were produced inside the same ungoverned ranking cycle as the
-- composite scores, so retain them only in reported_legacy_metrics. Also require a
-- known active profile before a new evidence snapshot can be created.

ALTER TABLE public.executive_kpi_snapshots
  ALTER COLUMN total_signals DROP DEFAULT,
  ALTER COLUMN high_priority_signals DROP DEFAULT,
  ALTER COLUMN active_narratives DROP DEFAULT,
  ALTER COLUMN active_forecasts DROP DEFAULT,
  ALTER COLUMN critical_anomalies DROP DEFAULT,
  ALTER COLUMN telemetry_connectors_active DROP DEFAULT,
  ALTER COLUMN telemetry_connectors_degraded DROP DEFAULT,
  ALTER COLUMN analyst_review_backlog DROP DEFAULT;

UPDATE public.executive_kpi_snapshots
SET
  total_signals = NULL,
  high_priority_signals = NULL,
  active_narratives = NULL,
  active_forecasts = NULL,
  critical_anomalies = NULL,
  telemetry_connectors_active = NULL,
  telemetry_connectors_degraded = NULL,
  analyst_review_backlog = NULL
WHERE evidence_status = 'legacy_unverified';

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
  v_start timestamptz;
  v_end timestamptz;
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

  IF p_profile_key IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.executive_console_profiles p
    WHERE p.profile_key = p_profile_key
      AND p.active IS TRUE
  ) THEN
    RAISE EXCEPTION 'known active executive console profile is required';
  END IF;

  v_end := now();
  v_start := v_end - p_window;

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

REVOKE ALL ON FUNCTION public.generate_executive_evidence_snapshot_v1(text,interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_executive_evidence_snapshot_v1(text,interval) TO service_role;
