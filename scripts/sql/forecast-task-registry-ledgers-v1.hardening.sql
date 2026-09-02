-- AICIS Forecast Task Registry + Forecast/Resolution Ledgers v1
-- CONTROLLED HARDENING FRAGMENT — MUST BE APPLIED AFTER
-- forecast-task-registry-ledgers-v1.candidate.sql.
--
-- This fragment is mandatory. It tightens JSON type fidelity, restores only the
-- validator EXECUTE privilege required by the service-side registry writer, and
-- replaces resolution serialization based on SELECT ... FOR UPDATE with a
-- transaction-scoped advisory lock so the immutable forecast ledger needs no
-- UPDATE privilege.

-- ---------------------------------------------------------------------------
-- 1. Strict database protocol validator override.
--    JSON scalar types must match the executable scientific protocol; textual
--    lookalikes such as "30" or "true" fail closed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_scientific_forecast_task_spec_v1(p_spec jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_type text;
  v_primary_metric text;
  v_baselines jsonb;
  v_modes jsonb;
  v_abstention_triggers jsonb;
  v_ledger_hashes jsonb;
  v_min_origins integer;
  v_calibration_min integer;
  v_promotion_min integer;
BEGIN
  IF p_spec IS NULL OR jsonb_typeof(p_spec) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;

  -- String-valued top-level fields must be genuine JSON strings.
  IF jsonb_typeof(p_spec->'protocol_version') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_spec->'knowledge_time_policy') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_spec->'claim_semantics') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_spec->'task_id') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_spec->'task_version') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_spec->'title') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_spec->'domain') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_spec->'geography_level') IS DISTINCT FROM 'string' THEN
    RETURN false;
  END IF;

  IF p_spec->>'protocol_version' IS DISTINCT FROM 'aicis-scientific-forecasting-protocol-v1'
     OR p_spec->>'knowledge_time_policy' IS DISTINCT FROM 'verified_point_in_time_v1'
     OR p_spec->>'claim_semantics' IS DISTINCT FROM 'predictive_not_causal_without_identification' THEN
    RETURN false;
  END IF;

  IF COALESCE(p_spec->>'task_id', '') !~ '^[a-z0-9]+(?:[-_][a-z0-9]+)*$'
     OR COALESCE(p_spec->>'task_version', '') !~ '^\d+\.\d+\.\d+$'
     OR btrim(COALESCE(p_spec->>'title', '')) = ''
     OR btrim(COALESCE(p_spec->>'domain', '')) = ''
     OR COALESCE(p_spec->>'geography_level', '') NOT IN ('grid','city','admin1','country','region','global','entity','network') THEN
    RETURN false;
  END IF;

  -- Target fields are strings and target must be an object.
  IF jsonb_typeof(p_spec->'target') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_spec#>'{target,type}') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_spec#>'{target,definition}') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_spec#>'{target,outcome_field}') IS DISTINCT FROM 'string' THEN
    RETURN false;
  END IF;
  v_target_type := p_spec#>>'{target,type}';
  IF COALESCE(v_target_type, '') NOT IN ('binary','count','continuous','time_to_event','event_sequence','graph_link','ranking')
     OR btrim(COALESCE(p_spec#>>'{target,definition}', '')) = ''
     OR btrim(COALESCE(p_spec#>>'{target,outcome_field}', '')) = '' THEN
    RETURN false;
  END IF;

  -- Horizon value must be a JSON number that is also a positive integer.
  IF jsonb_typeof(p_spec->'horizon') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_spec#>'{horizon,value}') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_spec#>'{horizon,unit}') IS DISTINCT FROM 'string'
     OR COALESCE(p_spec#>>'{horizon,value}', '') !~ '^[1-9][0-9]*$'
     OR COALESCE(p_spec#>>'{horizon,unit}', '') NOT IN ('hours','days') THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(p_spec->'resolution') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_spec#>'{resolution,authority}') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_spec#>'{resolution,outcome_query}') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_spec#>'{resolution,authority_class}') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_spec#>'{resolution,revision_policy}') IS DISTINCT FROM 'string'
     OR btrim(COALESCE(p_spec#>>'{resolution,authority}', '')) = ''
     OR btrim(COALESCE(p_spec#>>'{resolution,outcome_query}', '')) = ''
     OR COALESCE(p_spec#>>'{resolution,authority_class}', '') NOT IN (
       'official_statistics',
       'governed_event_dataset',
       'primary_source',
       'independently_adjudicated',
       'registered_operational_outcome'
     )
     OR COALESCE(p_spec#>>'{resolution,revision_policy}', '') NOT IN (
       'first_release',
       'latest_available',
       'final_vintage',
       'versioned_as_of_resolution'
     ) THEN
    RETURN false;
  END IF;

  v_baselines := p_spec->'baseline_suite';
  IF jsonb_typeof(v_baselines) IS DISTINCT FROM 'array' OR jsonb_array_length(v_baselines) = 0 THEN
    RETURN false;
  END IF;
  CASE v_target_type
    WHEN 'binary' THEN
      IF NOT (v_baselines @> '["base_rate","persistence"]'::jsonb) THEN RETURN false; END IF;
    WHEN 'count' THEN
      IF NOT (v_baselines @> '["historical_rate","persistence"]'::jsonb) THEN RETURN false; END IF;
    WHEN 'continuous' THEN
      IF NOT (v_baselines @> '["persistence","seasonal_naive"]'::jsonb) THEN RETURN false; END IF;
    WHEN 'time_to_event' THEN
      IF NOT (v_baselines @> '["historical_intensity"]'::jsonb) THEN RETURN false; END IF;
    WHEN 'event_sequence' THEN
      IF NOT (v_baselines @> '["historical_intensity"]'::jsonb) THEN RETURN false; END IF;
    WHEN 'graph_link' THEN
      IF NOT (v_baselines @> '["recurrence","frequency"]'::jsonb) THEN RETURN false; END IF;
    WHEN 'ranking' THEN
      IF NOT (v_baselines @> '["prior_rank","frequency"]'::jsonb) THEN RETURN false; END IF;
    ELSE
      RETURN false;
  END CASE;

  IF jsonb_typeof(p_spec->'metrics') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_spec#>'{metrics,primary}') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_spec#>'{metrics,secondary}') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  v_primary_metric := p_spec#>>'{metrics,primary}';
  CASE v_target_type
    WHEN 'binary' THEN
      IF COALESCE(v_primary_metric, '') NOT IN ('brier','log_loss') THEN RETURN false; END IF;
    WHEN 'count' THEN
      IF COALESCE(v_primary_metric, '') NOT IN ('crps','log_score') THEN RETURN false; END IF;
    WHEN 'continuous' THEN
      IF COALESCE(v_primary_metric, '') NOT IN ('crps','log_score') THEN RETURN false; END IF;
    WHEN 'time_to_event' THEN
      IF COALESCE(v_primary_metric, '') NOT IN ('log_score','negative_log_likelihood') THEN RETURN false; END IF;
    WHEN 'event_sequence' THEN
      IF COALESCE(v_primary_metric, '') NOT IN ('log_score','negative_log_likelihood') THEN RETURN false; END IF;
    WHEN 'graph_link' THEN
      IF COALESCE(v_primary_metric, '') NOT IN ('brier','log_loss') THEN RETURN false; END IF;
    WHEN 'ranking' THEN
      IF COALESCE(v_primary_metric, '') NOT IN ('log_loss','brier') THEN RETURN false; END IF;
    ELSE
      RETURN false;
  END CASE;

  IF jsonb_typeof(p_spec->'evaluation') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_spec#>'{evaluation,split_policy}') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_spec#>'{evaluation,test_data_policy}') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_spec#>'{evaluation,minimum_forecast_origins}') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_spec#>'{evaluation,modes}') IS DISTINCT FROM 'array'
     OR p_spec#>>'{evaluation,split_policy}' IS DISTINCT FROM 'knowledge_time_bounded_rolling_origin'
     OR p_spec#>>'{evaluation,test_data_policy}' IS DISTINCT FROM 'future_only_after_model_selection'
     OR COALESCE(p_spec#>>'{evaluation,minimum_forecast_origins}', '') !~ '^[1-9][0-9]*$' THEN
    RETURN false;
  END IF;
  v_min_origins := (p_spec#>>'{evaluation,minimum_forecast_origins}')::integer;
  IF v_min_origins < 3 THEN RETURN false; END IF;
  v_modes := p_spec#>'{evaluation,modes}';
  IF NOT (v_modes @> '["retrospective_rolling_origin","prospective_sealed"]'::jsonb) THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(p_spec->'calibration') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_spec#>'{calibration,required}') IS DISTINCT FROM 'boolean'
     OR p_spec#>'{calibration,required}' IS DISTINCT FROM 'true'::jsonb
     OR jsonb_typeof(p_spec#>'{calibration,method_policy}') IS DISTINCT FROM 'string'
     OR btrim(COALESCE(p_spec#>>'{calibration,method_policy}', '')) = ''
     OR jsonb_typeof(p_spec#>'{calibration,minimum_resolved_forecasts_for_claim}') IS DISTINCT FROM 'number'
     OR COALESCE(p_spec#>>'{calibration,minimum_resolved_forecasts_for_claim}', '') !~ '^[1-9][0-9]*$' THEN
    RETURN false;
  END IF;
  v_calibration_min := (p_spec#>>'{calibration,minimum_resolved_forecasts_for_claim}')::integer;
  IF v_calibration_min < 100 THEN RETURN false; END IF;

  IF jsonb_typeof(p_spec->'abstention') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_spec#>'{abstention,enabled}') IS DISTINCT FROM 'boolean'
     OR p_spec#>'{abstention,enabled}' IS DISTINCT FROM 'true'::jsonb
     OR jsonb_typeof(p_spec#>'{abstention,triggers}') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  v_abstention_triggers := p_spec#>'{abstention,triggers}';
  IF NOT (v_abstention_triggers @> '["knowledge_time_unverified","source_coverage_insufficient","calibration_insufficient","severe_distribution_shift","excessive_model_disagreement"]'::jsonb) THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(p_spec->'promotion') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_spec#>'{promotion,no_auto_promotion}') IS DISTINCT FROM 'boolean'
     OR p_spec#>'{promotion,no_auto_promotion}' IS DISTINCT FROM 'true'::jsonb
     OR jsonb_typeof(p_spec#>'{promotion,requires_positive_skill_vs_mandatory_baselines}') IS DISTINCT FROM 'boolean'
     OR p_spec#>'{promotion,requires_positive_skill_vs_mandatory_baselines}' IS DISTINCT FROM 'true'::jsonb
     OR jsonb_typeof(p_spec#>'{promotion,requires_prospective_evidence_for_operational_use}') IS DISTINCT FROM 'boolean'
     OR p_spec#>'{promotion,requires_prospective_evidence_for_operational_use}' IS DISTINCT FROM 'true'::jsonb
     OR jsonb_typeof(p_spec#>'{promotion,minimum_resolved_forecasts_for_operational_use}') IS DISTINCT FROM 'number'
     OR COALESCE(p_spec#>>'{promotion,minimum_resolved_forecasts_for_operational_use}', '') !~ '^[1-9][0-9]*$' THEN
    RETURN false;
  END IF;
  v_promotion_min := (p_spec#>>'{promotion,minimum_resolved_forecasts_for_operational_use}')::integer;
  IF v_promotion_min < 100 THEN RETURN false; END IF;

  IF jsonb_typeof(p_spec->'ledger') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_spec#>'{ledger,immutable_after_seal}') IS DISTINCT FROM 'boolean'
     OR p_spec#>'{ledger,immutable_after_seal}' IS DISTINCT FROM 'true'::jsonb
     OR jsonb_typeof(p_spec#>'{ledger,seal_before_target_period_evidence}') IS DISTINCT FROM 'boolean'
     OR p_spec#>'{ledger,seal_before_target_period_evidence}' IS DISTINCT FROM 'true'::jsonb
     OR jsonb_typeof(p_spec#>'{ledger,required_hashes}') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  v_ledger_hashes := p_spec#>'{ledger,required_hashes}';
  IF NOT (v_ledger_hashes @> '["data_manifest_hash","feature_manifest_hash","model_artifact_hash","git_commit_sha"]'::jsonb) THEN
    RETURN false;
  END IF;

  RETURN true;
EXCEPTION
  WHEN OTHERS THEN
    -- Malformed, unexpectedly typed or overflowing JSON fails closed.
    RETURN false;
END;
$$;

-- A CHECK constraint invokes this validator as the inserting role. Keep the
-- service writer's minimum required EXECUTE while denying public/API callers.
REVOKE ALL ON FUNCTION public.validate_scientific_forecast_task_spec_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_scientific_forecast_task_spec_v1(jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Least-privilege resolution serialization override.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_scientific_forecast_resolution_insert_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_forecast public.scientific_forecast_ledger_v1%ROWTYPE;
  v_task public.scientific_forecast_tasks_v1%ROWTYPE;
  v_last_version integer := 0;
  v_last_status text;
BEGIN
  -- Serialize resolution inserts for the same forecast without requiring UPDATE
  -- privilege on the immutable forecast ledger. Hash collisions can only serialize
  -- unrelated forecasts; they cannot weaken correctness.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.forecast_id::text, 0));

  SELECT * INTO v_forecast
  FROM public.scientific_forecast_ledger_v1
  WHERE id = NEW.forecast_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'forecast % does not exist', NEW.forecast_id;
  END IF;

  SELECT * INTO v_task
  FROM public.scientific_forecast_tasks_v1
  WHERE id = v_forecast.task_registry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'registered forecast task for forecast % does not exist', NEW.forecast_id;
  END IF;

  SELECT r.resolution_version, r.resolution_status
  INTO v_last_version, v_last_status
  FROM public.scientific_forecast_resolution_ledger_v1 r
  WHERE r.forecast_id = NEW.forecast_id
  ORDER BY r.resolution_version DESC
  LIMIT 1;

  v_last_version := COALESCE(v_last_version, 0);
  IF NEW.resolution_version <> v_last_version + 1 THEN
    RAISE EXCEPTION 'resolution version must advance consecutively from % to %', v_last_version, v_last_version + 1;
  END IF;
  IF v_last_version = 0 AND NEW.resolution_status = 'revised' THEN
    RAISE EXCEPTION 'first resolution version cannot be revised';
  END IF;
  IF v_last_version > 0 AND v_last_status IN ('final','revised') AND NEW.resolution_status <> 'revised' THEN
    RAISE EXCEPTION 'a final/revised resolution can only be superseded by a revised resolution';
  END IF;

  -- The database owns resolution time. A caller cannot submit an outcome early
  -- while forging a future resolved_at that falls after the target window.
  NEW.resolved_at := clock_timestamp();

  IF NEW.resolved_at < v_forecast.target_window_end THEN
    RAISE EXCEPTION 'forecast % cannot resolve before its target window closes', NEW.forecast_id;
  END IF;
  IF NEW.ground_truth_authority <> v_task.resolution_authority
     OR NEW.ground_truth_authority_class <> v_task.resolution_authority_class
     OR NEW.revision_policy <> v_task.resolution_revision_policy THEN
    RAISE EXCEPTION 'resolution authority/policy do not match the registered forecast task';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_scientific_forecast_resolution_insert_v1()
  FROM PUBLIC, anon, authenticated, service_role;
