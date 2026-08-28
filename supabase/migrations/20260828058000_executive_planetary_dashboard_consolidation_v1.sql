-- AICIS executive planetary dashboard consolidation v1
--
-- The legacy planetary dashboard duplicated the synthetic executive-console pattern:
-- missing values -> zero, global risk/trust/evidence composites, fixed-confidence
-- insights, generated actions and risk-ranked chart payloads. Consolidate both
-- executive surfaces onto the append-only evidence-coverage snapshot substrate.

-- -----------------------------------------------------------------------------
-- 1. Dashboard preset thresholds are legacy display/filter policy, not confidence.
-- -----------------------------------------------------------------------------
ALTER TABLE public.executive_dashboard_filter_presets
  ALTER COLUMN minimum_confidence DROP DEFAULT,
  ALTER COLUMN minimum_relevance DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_minimum_confidence numeric,
  ADD COLUMN IF NOT EXISTS reported_minimum_relevance numeric,
  ADD COLUMN IF NOT EXISTS preset_semantics text;

UPDATE public.executive_dashboard_filter_presets
SET
  reported_minimum_confidence = COALESCE(reported_minimum_confidence, minimum_confidence),
  reported_minimum_relevance = COALESCE(reported_minimum_relevance, minimum_relevance),
  minimum_confidence = NULL,
  minimum_relevance = NULL,
  preset_semantics = COALESCE(preset_semantics, 'legacy_dashboard_filter_policy_not_calibrated_confidence_or_relevance');

-- Register the four dashboard presets as evidence-console profiles so the legacy
-- cycle can route into one governed snapshot engine without inventing mappings.
INSERT INTO public.executive_console_profiles(
  profile_key,profile_name,audience_type,default_time_window,
  default_regions,default_domains,default_risk_bands,default_source_tiers,
  minimum_confidence,minimum_relevance,layout_config,active,threshold_semantics
)
SELECT
  p.preset_key,
  p.preset_name,
  'evidence_console',
  p.default_time_window,
  p.included_regions,
  p.included_domains,
  p.included_risk_bands,
  p.included_source_tiers,
  NULL,
  NULL,
  jsonb_build_object(
    'legacy_dashboard_preset',true,
    'presentation_only',true,
    'risk_scoring_disabled',true
  ),
  true,
  'evidence_console_profile_no_numeric_confidence_or_relevance_threshold'
FROM public.executive_dashboard_filter_presets p
ON CONFLICT(profile_key) DO UPDATE SET
  profile_name = EXCLUDED.profile_name,
  default_time_window = EXCLUDED.default_time_window,
  default_regions = EXCLUDED.default_regions,
  default_domains = EXCLUDED.default_domains,
  default_risk_bands = EXCLUDED.default_risk_bands,
  default_source_tiers = EXCLUDED.default_source_tiers,
  minimum_confidence = NULL,
  minimum_relevance = NULL,
  threshold_semantics = EXCLUDED.threshold_semantics,
  active = true,
  updated_at = now();

-- -----------------------------------------------------------------------------
-- 2. Quarantine historical KPI snapshots completely.
-- -----------------------------------------------------------------------------
ALTER TABLE public.executive_planetary_kpi_snapshots
  ALTER COLUMN global_risk_index DROP DEFAULT,
  ALTER COLUMN telemetry_coverage_score DROP DEFAULT,
  ALTER COLUMN active_critical_events DROP DEFAULT,
  ALTER COLUMN active_strategic_events DROP DEFAULT,
  ALTER COLUMN forecast_escalation_index DROP DEFAULT,
  ALTER COLUMN institutional_trust_score DROP DEFAULT,
  ALTER COLUMN evidence_quality_score DROP DEFAULT,
  ALTER COLUMN analyst_queue_pressure DROP DEFAULT,
  ALTER COLUMN operational_response_pressure DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_legacy_metrics jsonb,
  ADD COLUMN IF NOT EXISTS snapshot_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.executive_planetary_kpi_snapshots
SET
  reported_legacy_metrics = COALESCE(
    reported_legacy_metrics,
    jsonb_build_object(
      'global_risk_index',global_risk_index,
      'telemetry_coverage_score',telemetry_coverage_score,
      'active_critical_events',active_critical_events,
      'active_strategic_events',active_strategic_events,
      'forecast_escalation_index',forecast_escalation_index,
      'institutional_trust_score',institutional_trust_score,
      'evidence_quality_score',evidence_quality_score,
      'analyst_queue_pressure',analyst_queue_pressure,
      'operational_response_pressure',operational_response_pressure,
      'top_risk_domain',top_risk_domain,
      'top_risk_region',top_risk_region,
      'kpi_payload',kpi_payload
    )
  ),
  global_risk_index = NULL,
  telemetry_coverage_score = NULL,
  active_critical_events = NULL,
  active_strategic_events = NULL,
  forecast_escalation_index = NULL,
  institutional_trust_score = NULL,
  evidence_quality_score = NULL,
  analyst_queue_pressure = NULL,
  operational_response_pressure = NULL,
  top_risk_domain = NULL,
  top_risk_region = NULL,
  kpi_payload = '{}'::jsonb,
  snapshot_semantics = COALESCE(snapshot_semantics, 'legacy_executive_planetary_composite_metrics_unverified'),
  evidence_status = 'legacy_unverified';

-- -----------------------------------------------------------------------------
-- 3. Generated insights/charts/actions remain audit artifacts only.
-- -----------------------------------------------------------------------------
ALTER TABLE public.executive_dynamic_insights
  ALTER COLUMN insight_type DROP DEFAULT,
  ALTER COLUMN severity_band DROP DEFAULT,
  ALTER COLUMN evidence_score DROP DEFAULT,
  ALTER COLUMN confidence_score DROP DEFAULT,
  ALTER COLUMN display_rank DROP DEFAULT,
  ALTER COLUMN active DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_evidence_score numeric,
  ADD COLUMN IF NOT EXISTS reported_confidence_score numeric,
  ADD COLUMN IF NOT EXISTS reported_recommended_action text,
  ADD COLUMN IF NOT EXISTS insight_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.executive_dynamic_insights
SET
  reported_evidence_score = COALESCE(reported_evidence_score, evidence_score),
  reported_confidence_score = COALESCE(reported_confidence_score, confidence_score),
  reported_recommended_action = COALESCE(reported_recommended_action, recommended_action),
  evidence_score = NULL,
  confidence_score = NULL,
  recommended_action = NULL,
  active = false,
  insight_semantics = COALESCE(insight_semantics, 'legacy_generated_dashboard_insight_without_governed_evidence_contract'),
  evidence_status = 'legacy_unverified';

ALTER TABLE public.executive_chart_data_cache
  ADD COLUMN IF NOT EXISTS reported_legacy_data_payload jsonb,
  ADD COLUMN IF NOT EXISTS dataset_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.executive_chart_data_cache
SET
  reported_legacy_data_payload = COALESCE(reported_legacy_data_payload, data_payload),
  data_payload = '[]'::jsonb,
  dataset_semantics = COALESCE(dataset_semantics, 'legacy_dashboard_risk_ranking_payload_semantics_unverified'),
  evidence_status = 'legacy_unverified';

ALTER TABLE public.executive_action_register
  ALTER COLUMN urgency_band DROP DEFAULT,
  ALTER COLUMN owner_type DROP DEFAULT,
  ALTER COLUMN action_status DROP DEFAULT,
  ALTER COLUMN expected_effectiveness DROP DEFAULT,
  ALTER COLUMN evidence_quality_score DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_urgency_band text,
  ADD COLUMN IF NOT EXISTS reported_owner_type text,
  ADD COLUMN IF NOT EXISTS reported_action_status text,
  ADD COLUMN IF NOT EXISTS reported_expected_effectiveness numeric,
  ADD COLUMN IF NOT EXISTS reported_evidence_quality_score numeric,
  ADD COLUMN IF NOT EXISTS action_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE public.executive_action_register
SET
  reported_urgency_band = COALESCE(reported_urgency_band, urgency_band),
  reported_owner_type = COALESCE(reported_owner_type, owner_type),
  reported_action_status = COALESCE(reported_action_status, action_status),
  reported_expected_effectiveness = COALESCE(reported_expected_effectiveness, expected_effectiveness),
  reported_evidence_quality_score = COALESCE(reported_evidence_quality_score, evidence_quality_score),
  urgency_band = NULL,
  owner_type = NULL,
  action_status = 'legacy_quarantined',
  expected_effectiveness = NULL,
  evidence_quality_score = NULL,
  action_semantics = COALESCE(action_semantics, 'legacy_insight_promoted_action_not_human_authorized_intervention'),
  evidence_status = 'legacy_unverified';

-- -----------------------------------------------------------------------------
-- 4. Disable every synthetic sub-generator. The dashboard master cycle routes to
-- the single executive evidence snapshot engine created in 20260828057000.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_executive_planetary_kpis(
  p_preset_key text DEFAULT 'global_executive_overview',
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
    'reason','legacy_global_risk_trust_evidence_composites_disabled',
    'preset_key',p_preset_key,
    'window',p_window::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_executive_dynamic_insights(
  p_preset_key text DEFAULT 'global_executive_overview',
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
    'reason','legacy_fixed_confidence_and_generated_action_insights_disabled',
    'preset_key',p_preset_key,
    'window',p_window::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_executive_chart_cache(
  p_preset_key text DEFAULT 'global_executive_overview',
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
    'reason','legacy_risk_ranked_chart_cache_disabled',
    'preset_key',p_preset_key,
    'window',p_window::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_executive_action_register(
  p_preset_key text DEFAULT 'global_executive_overview'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'status','quarantined',
    'reason','generated_insights_cannot_auto_promote_to_executive_actions',
    'preset_key',p_preset_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.run_executive_dashboard_cycle(
  p_preset_key text DEFAULT 'global_executive_overview',
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
  v_snapshot_id := public.generate_executive_evidence_snapshot_v1(p_preset_key,p_window);

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES (
    'executive-dashboard-cycle',
    'success',
    'legacy planetary dashboard consolidated onto descriptive executive evidence snapshot'
  );

  RETURN jsonb_build_object(
    'status','success',
    'preset_key',p_preset_key,
    'evidence_snapshot_id',v_snapshot_id,
    'global_risk_index',NULL,
    'institutional_trust_score',NULL,
    'recommended_actions_generated',0,
    'semantics','descriptive_evidence_coverage_only'
  );
END;
$$;

CREATE OR REPLACE VIEW public.executive_planetary_evidence_dashboard_v1 AS
SELECT
  e.*
FROM public.executive_evidence_console_v1 e
WHERE e.profile_key IN (
  SELECT p.preset_key FROM public.executive_dashboard_filter_presets p
)
ORDER BY e.created_at DESC;

REVOKE ALL ON FUNCTION public.generate_executive_planetary_kpis(text,interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_executive_dynamic_insights(text,interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_executive_chart_cache(text,interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_executive_action_register(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_executive_dashboard_cycle(text,interval) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.generate_executive_planetary_kpis(text,interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_executive_dynamic_insights(text,interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_executive_chart_cache(text,interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_executive_action_register(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_executive_dashboard_cycle(text,interval) TO service_role;

COMMENT ON FUNCTION public.run_executive_dashboard_cycle(text,interval) IS
  'Compatibility dashboard cycle consolidated onto append-only descriptive executive evidence snapshots; issues no global risk/trust/readiness score.';
