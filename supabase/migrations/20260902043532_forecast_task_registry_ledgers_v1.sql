-- AICIS Forecast Task Registry + Forecast/Resolution Ledgers v1
-- CONTROLLED SCHEMA CANDIDATE — NOT A MIGRATION FILE.
--
-- This SQL is intentionally kept under scripts/sql until it can be generated into
-- a migration through the required Supabase migration workflow. Do not rename it
-- into supabase/migrations by inventing a timestamp.
--
-- Protocol binding: aicis-scientific-forecasting-protocol-v1
-- Production writers remain disabled by this artifact.

-- ---------------------------------------------------------------------------
-- 0. Database-side protocol validator.
--    The registry must reproduce the executable protocol's non-negotiable task
--    invariants rather than trusting a caller to say a JSON task is compliant.
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

  IF p_spec->>'protocol_version' IS DISTINCT FROM 'aicis-scientific-forecasting-protocol-v1'
     OR p_spec->>'knowledge_time_policy' IS DISTINCT FROM 'verified_point_in_time_v1'
     OR p_spec->>'claim_semantics' IS DISTINCT FROM 'predictive_not_causal_without_identification' THEN
    RETURN false;
  END IF;

  IF COALESCE(p_spec->>'task_id', '') !~ '^[a-z0-9]+(?:[-_][a-z0-9]+)*$'
     OR COALESCE(p_spec->>'task_version', '') !~ '^\d+\.\d+\.\d+$'
     OR btrim(COALESCE(p_spec->>'title', '')) = ''
     OR btrim(COALESCE(p_spec->>'domain', '')) = '' THEN
    RETURN false;
  END IF;

  IF COALESCE(p_spec->>'geography_level', '') NOT IN ('grid','city','admin1','country','region','global','entity','network') THEN
    RETURN false;
  END IF;

  v_target_type := p_spec#>>'{target,type}';
  IF COALESCE(v_target_type, '') NOT IN ('binary','count','continuous','time_to_event','event_sequence','graph_link','ranking')
     OR btrim(COALESCE(p_spec#>>'{target,definition}', '')) = ''
     OR btrim(COALESCE(p_spec#>>'{target,outcome_field}', '')) = '' THEN
    RETURN false;
  END IF;

  IF COALESCE(p_spec#>>'{horizon,value}', '') !~ '^[1-9][0-9]*$'
     OR COALESCE(p_spec#>>'{horizon,unit}', '') NOT IN ('hours','days') THEN
    RETURN false;
  END IF;

  IF btrim(COALESCE(p_spec#>>'{resolution,authority}', '')) = ''
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

  v_primary_metric := p_spec#>>'{metrics,primary}';
  IF jsonb_typeof(p_spec#>'{metrics,secondary}') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
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

  IF p_spec#>>'{evaluation,split_policy}' IS DISTINCT FROM 'knowledge_time_bounded_rolling_origin'
     OR p_spec#>>'{evaluation,test_data_policy}' IS DISTINCT FROM 'future_only_after_model_selection'
     OR COALESCE(p_spec#>>'{evaluation,minimum_forecast_origins}', '') !~ '^[1-9][0-9]*$' THEN
    RETURN false;
  END IF;
  v_min_origins := (p_spec#>>'{evaluation,minimum_forecast_origins}')::integer;
  IF v_min_origins < 3 THEN RETURN false; END IF;
  v_modes := p_spec#>'{evaluation,modes}';
  IF jsonb_typeof(v_modes) IS DISTINCT FROM 'array'
     OR NOT (v_modes @> '["retrospective_rolling_origin","prospective_sealed"]'::jsonb) THEN
    RETURN false;
  END IF;

  IF p_spec#>>'{calibration,required}' IS DISTINCT FROM 'true'
     OR btrim(COALESCE(p_spec#>>'{calibration,method_policy}', '')) = ''
     OR COALESCE(p_spec#>>'{calibration,minimum_resolved_forecasts_for_claim}', '') !~ '^[1-9][0-9]*$' THEN
    RETURN false;
  END IF;
  v_calibration_min := (p_spec#>>'{calibration,minimum_resolved_forecasts_for_claim}')::integer;
  IF v_calibration_min < 100 THEN RETURN false; END IF;

  IF p_spec#>>'{abstention,enabled}' IS DISTINCT FROM 'true' THEN RETURN false; END IF;
  v_abstention_triggers := p_spec#>'{abstention,triggers}';
  IF jsonb_typeof(v_abstention_triggers) IS DISTINCT FROM 'array'
     OR NOT (v_abstention_triggers @> '["knowledge_time_unverified","source_coverage_insufficient","calibration_insufficient","severe_distribution_shift","excessive_model_disagreement"]'::jsonb) THEN
    RETURN false;
  END IF;

  IF p_spec#>>'{promotion,no_auto_promotion}' IS DISTINCT FROM 'true'
     OR p_spec#>>'{promotion,requires_positive_skill_vs_mandatory_baselines}' IS DISTINCT FROM 'true'
     OR p_spec#>>'{promotion,requires_prospective_evidence_for_operational_use}' IS DISTINCT FROM 'true'
     OR COALESCE(p_spec#>>'{promotion,minimum_resolved_forecasts_for_operational_use}', '') !~ '^[1-9][0-9]*$' THEN
    RETURN false;
  END IF;
  v_promotion_min := (p_spec#>>'{promotion,minimum_resolved_forecasts_for_operational_use}')::integer;
  IF v_promotion_min < 100 THEN RETURN false; END IF;

  IF p_spec#>>'{ledger,immutable_after_seal}' IS DISTINCT FROM 'true'
     OR p_spec#>>'{ledger,seal_before_target_period_evidence}' IS DISTINCT FROM 'true' THEN
    RETURN false;
  END IF;
  v_ledger_hashes := p_spec#>'{ledger,required_hashes}';
  IF jsonb_typeof(v_ledger_hashes) IS DISTINCT FROM 'array'
     OR NOT (v_ledger_hashes @> '["data_manifest_hash","feature_manifest_hash","model_artifact_hash","git_commit_sha"]'::jsonb) THEN
    RETURN false;
  END IF;

  RETURN true;
EXCEPTION
  WHEN OTHERS THEN
    -- Malformed or unexpectedly typed JSON fails closed.
    RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_scientific_forecast_task_spec_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Forecast task registry
-- ---------------------------------------------------------------------------
CREATE TABLE public.scientific_forecast_tasks_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id text NOT NULL CHECK (task_id ~ '^[a-z0-9]+(?:[-_][a-z0-9]+)*$'),
  task_version text NOT NULL CHECK (task_version ~ '^\d+\.\d+\.\d+$'),
  protocol_version text NOT NULL
    CHECK (protocol_version = 'aicis-scientific-forecasting-protocol-v1'),
  task_status text NOT NULL DEFAULT 'draft'
    CHECK (task_status IN ('draft', 'approved', 'retired')),
  title text NOT NULL CHECK (btrim(title) <> ''),
  domain text NOT NULL CHECK (btrim(domain) <> ''),
  geography_level text NOT NULL
    CHECK (geography_level IN ('grid','city','admin1','country','region','global','entity','network')),
  target_type text NOT NULL
    CHECK (target_type IN ('binary','count','continuous','time_to_event','event_sequence','graph_link','ranking')),
  horizon_value integer NOT NULL CHECK (horizon_value > 0),
  horizon_unit text NOT NULL CHECK (horizon_unit IN ('hours','days')),
  resolution_authority text NOT NULL CHECK (btrim(resolution_authority) <> ''),
  resolution_authority_class text NOT NULL
    CHECK (resolution_authority_class IN (
      'official_statistics',
      'governed_event_dataset',
      'primary_source',
      'independently_adjudicated',
      'registered_operational_outcome'
    )),
  resolution_revision_policy text NOT NULL
    CHECK (resolution_revision_policy IN (
      'first_release',
      'latest_available',
      'final_vintage',
      'versioned_as_of_resolution'
    )),
  knowledge_time_policy text NOT NULL
    CHECK (knowledge_time_policy = 'verified_point_in_time_v1'),
  claim_semantics text NOT NULL
    CHECK (claim_semantics = 'predictive_not_causal_without_identification'),
  task_spec jsonb NOT NULL
    CHECK (jsonb_typeof(task_spec) = 'object' AND task_spec <> '{}'::jsonb),
  task_spec_sha256 text NOT NULL CHECK (task_spec_sha256 ~ '^[0-9a-f]{64}$'),
  task_spec_hash_semantics text NOT NULL DEFAULT 'externally_computed_sha256_bound_to_immutable_task_spec_v1'
    CHECK (task_spec_hash_semantics = 'externally_computed_sha256_bound_to_immutable_task_spec_v1'),
  registered_by uuid,
  approved_by uuid,
  registered_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  retired_at timestamptz,
  CONSTRAINT scientific_forecast_tasks_v1_identity_uq UNIQUE (task_id, task_version),
  CONSTRAINT scientific_forecast_tasks_v1_spec_identity_ck CHECK (
    task_spec->>'protocol_version' = protocol_version
    AND task_spec->>'task_id' = task_id
    AND task_spec->>'task_version' = task_version
    AND task_spec->>'title' = title
    AND task_spec->>'domain' = domain
    AND task_spec->>'geography_level' = geography_level
    AND task_spec#>>'{target,type}' = target_type
    AND task_spec#>>'{horizon,value}' = horizon_value::text
    AND task_spec#>>'{horizon,unit}' = horizon_unit
    AND task_spec#>>'{resolution,authority}' = resolution_authority
    AND task_spec#>>'{resolution,authority_class}' = resolution_authority_class
    AND task_spec#>>'{resolution,revision_policy}' = resolution_revision_policy
    AND task_spec->>'knowledge_time_policy' = knowledge_time_policy
    AND task_spec->>'claim_semantics' = claim_semantics
    AND public.validate_scientific_forecast_task_spec_v1(task_spec)
  ),
  CONSTRAINT scientific_forecast_tasks_v1_approval_ck CHECK (
    (task_status = 'draft' AND approved_at IS NULL AND approved_by IS NULL AND retired_at IS NULL)
    OR (task_status = 'approved' AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND retired_at IS NULL)
    OR (task_status = 'retired' AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND retired_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.scientific_forecast_tasks_v1 IS
  'Versioned scientific forecast-task registry bound to AICIS Scientific Forecasting Protocol v1. Approval does not activate a production writer or promote a model.';
COMMENT ON COLUMN public.scientific_forecast_tasks_v1.task_spec_sha256 IS
  'Externally computed digest used to bind the immutable task specification. Database protocol validity is independently enforced by validate_scientific_forecast_task_spec_v1; digest correctness must be verified by the future registration service before insert.';

-- ---------------------------------------------------------------------------
-- 2. Immutable forecast ledger
-- ---------------------------------------------------------------------------
CREATE TABLE public.scientific_forecast_ledger_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_registry_id uuid NOT NULL
    REFERENCES public.scientific_forecast_tasks_v1(id) ON DELETE RESTRICT,
  evidence_class text NOT NULL
    CHECK (evidence_class IN ('retrospective_backtest','prospective_shadow','prospective_operational')),
  forecast_origin timestamptz NOT NULL,
  knowledge_cutoff timestamptz NOT NULL,
  target_window_start timestamptz NOT NULL,
  target_window_end timestamptz NOT NULL,
  entity_key text NOT NULL CHECK (btrim(entity_key) <> ''),
  geography_level text NOT NULL
    CHECK (geography_level IN ('grid','city','admin1','country','region','global','entity','network')),
  geography_key text,
  domain text NOT NULL CHECK (btrim(domain) <> ''),
  model_version text NOT NULL CHECK (btrim(model_version) <> ''),
  ensemble_version text,
  calibration_version text,
  forecast_payload jsonb NOT NULL
    CHECK (jsonb_typeof(forecast_payload) = 'object' AND forecast_payload <> '{}'::jsonb),
  data_manifest_hash text NOT NULL CHECK (data_manifest_hash ~ '^[0-9a-f]{64}$'),
  feature_manifest_hash text NOT NULL CHECK (feature_manifest_hash ~ '^[0-9a-f]{64}$'),
  model_artifact_hash text NOT NULL CHECK (model_artifact_hash ~ '^[0-9a-f]{64}$'),
  git_commit_sha text NOT NULL CHECK (git_commit_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  seal_proof_version text NOT NULL CHECK (btrim(seal_proof_version) <> ''),
  seal_proof_sha256 text NOT NULL CHECK (seal_proof_sha256 ~ '^[0-9a-f]{64}$'),
  generated_at timestamptz NOT NULL,
  sealed_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT scientific_forecast_ledger_v1_time_ck CHECK (
    knowledge_cutoff <= forecast_origin
    AND forecast_origin <= generated_at
    AND generated_at <= sealed_at
    AND target_window_start >= forecast_origin
    AND target_window_end > target_window_start
  )
);

CREATE INDEX scientific_forecast_ledger_v1_task_origin_idx
  ON public.scientific_forecast_ledger_v1(task_registry_id, forecast_origin DESC);
CREATE INDEX scientific_forecast_ledger_v1_entity_origin_idx
  ON public.scientific_forecast_ledger_v1(entity_key, forecast_origin DESC);
CREATE INDEX scientific_forecast_ledger_v1_resolution_due_idx
  ON public.scientific_forecast_ledger_v1(target_window_end, evidence_class);

COMMENT ON TABLE public.scientific_forecast_ledger_v1 IS
  'Append-only sealed forecast ledger. Retrospective and prospective evidence classes remain explicit and must never be silently pooled.';
COMMENT ON COLUMN public.scientific_forecast_ledger_v1.evidence_class IS
  'retrospective_backtest is historical reconstruction; prospective_shadow is sealed real-future evidence without operational authority. prospective_operational is reserved but quarantined in schema candidate v1 until a separate operational-promotion control is implemented.';
COMMENT ON COLUMN public.scientific_forecast_ledger_v1.seal_proof_sha256 IS
  'Digest of the immutable seal evidence package binding forecast origin, knowledge cutoff and reproducibility manifests. Presence alone is not proof of model skill.';

-- ---------------------------------------------------------------------------
-- 3. Append-only resolution ledger
-- ---------------------------------------------------------------------------
CREATE TABLE public.scientific_forecast_resolution_ledger_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id uuid NOT NULL
    REFERENCES public.scientific_forecast_ledger_v1(id) ON DELETE RESTRICT,
  resolution_version integer NOT NULL CHECK (resolution_version > 0),
  resolution_status text NOT NULL CHECK (resolution_status IN ('provisional','final','revised')),
  outcome_payload jsonb NOT NULL
    CHECK (jsonb_typeof(outcome_payload) = 'object' AND outcome_payload <> '{}'::jsonb),
  ground_truth_authority text NOT NULL CHECK (btrim(ground_truth_authority) <> ''),
  ground_truth_authority_class text NOT NULL
    CHECK (ground_truth_authority_class IN (
      'official_statistics',
      'governed_event_dataset',
      'primary_source',
      'independently_adjudicated',
      'registered_operational_outcome'
    )),
  ground_truth_source_version text,
  revision_policy text NOT NULL
    CHECK (revision_policy IN ('first_release','latest_available','final_vintage','versioned_as_of_resolution')),
  outcome_observed_at timestamptz NOT NULL,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  resolution_evidence_sha256 text NOT NULL CHECK (resolution_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  adjudication_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(adjudication_metadata) = 'object'),
  created_by uuid,
  CONSTRAINT scientific_forecast_resolution_ledger_v1_version_uq UNIQUE (forecast_id, resolution_version),
  CONSTRAINT scientific_forecast_resolution_ledger_v1_time_ck CHECK (resolved_at >= outcome_observed_at)
);

CREATE INDEX scientific_forecast_resolution_ledger_v1_forecast_idx
  ON public.scientific_forecast_resolution_ledger_v1(forecast_id, resolution_version DESC);

COMMENT ON TABLE public.scientific_forecast_resolution_ledger_v1 IS
  'Append-only versioned ground-truth resolutions. Revisions create new rows; they never rewrite earlier resolution evidence.';

-- ---------------------------------------------------------------------------
-- 4. Integrity triggers. These use default SECURITY INVOKER semantics and are
--    deliberately not SECURITY DEFINER.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_scientific_forecast_task_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.task_status <> 'draft'
       OR NEW.approved_by IS NOT NULL
       OR NEW.approved_at IS NOT NULL
       OR NEW.retired_at IS NOT NULL THEN
      RAISE EXCEPTION 'scientific forecast tasks must be inserted as unapproved drafts';
    END IF;
    NEW.registered_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'scientific forecast tasks are versioned records; retire instead of delete';
  END IF;

  IF NEW.registered_by IS DISTINCT FROM OLD.registered_by
     OR NEW.registered_at IS DISTINCT FROM OLD.registered_at THEN
    RAISE EXCEPTION 'scientific forecast task registration identity/time are immutable';
  END IF;

  IF OLD.task_status IN ('approved','retired') THEN
    IF NEW.task_id IS DISTINCT FROM OLD.task_id
       OR NEW.task_version IS DISTINCT FROM OLD.task_version
       OR NEW.protocol_version IS DISTINCT FROM OLD.protocol_version
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.domain IS DISTINCT FROM OLD.domain
       OR NEW.geography_level IS DISTINCT FROM OLD.geography_level
       OR NEW.target_type IS DISTINCT FROM OLD.target_type
       OR NEW.horizon_value IS DISTINCT FROM OLD.horizon_value
       OR NEW.horizon_unit IS DISTINCT FROM OLD.horizon_unit
       OR NEW.resolution_authority IS DISTINCT FROM OLD.resolution_authority
       OR NEW.resolution_authority_class IS DISTINCT FROM OLD.resolution_authority_class
       OR NEW.resolution_revision_policy IS DISTINCT FROM OLD.resolution_revision_policy
       OR NEW.knowledge_time_policy IS DISTINCT FROM OLD.knowledge_time_policy
       OR NEW.claim_semantics IS DISTINCT FROM OLD.claim_semantics
       OR NEW.task_spec IS DISTINCT FROM OLD.task_spec
       OR NEW.task_spec_sha256 IS DISTINCT FROM OLD.task_spec_sha256
       OR NEW.task_spec_hash_semantics IS DISTINCT FROM OLD.task_spec_hash_semantics
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      RAISE EXCEPTION 'approved/retired scientific forecast task definitions and approval evidence are immutable; create a new task version';
    END IF;
  END IF;

  IF OLD.task_status = 'draft' THEN
    IF NEW.task_status = 'draft' THEN
      NEW.approved_by := NULL;
      NEW.approved_at := NULL;
      NEW.retired_at := NULL;
    ELSIF NEW.task_status = 'approved' THEN
      IF NEW.approved_by IS NULL THEN
        RAISE EXCEPTION 'approving a scientific forecast task requires approved_by';
      END IF;
      NEW.approved_at := clock_timestamp();
      NEW.retired_at := NULL;
    ELSE
      RAISE EXCEPTION 'invalid task transition from draft to %', NEW.task_status;
    END IF;
  ELSIF OLD.task_status = 'approved' THEN
    IF NEW.task_status = 'approved' THEN
      NEW.retired_at := NULL;
    ELSIF NEW.task_status = 'retired' THEN
      NEW.retired_at := clock_timestamp();
    ELSE
      RAISE EXCEPTION 'invalid task transition from approved to %', NEW.task_status;
    END IF;
  ELSIF OLD.task_status = 'retired' THEN
    IF NEW.task_status <> 'retired'
       OR NEW.retired_at IS DISTINCT FROM OLD.retired_at THEN
      RAISE EXCEPTION 'retired scientific forecast tasks are immutable and cannot be reactivated';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_scientific_forecast_ledger_insert_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_task public.scientific_forecast_tasks_v1%ROWTYPE;
  v_expected_end timestamptz;
BEGIN
  SELECT * INTO v_task
  FROM public.scientific_forecast_tasks_v1
  WHERE id = NEW.task_registry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'registered forecast task % does not exist', NEW.task_registry_id;
  END IF;
  IF v_task.task_status <> 'approved' THEN
    RAISE EXCEPTION 'forecast task % is not approved', NEW.task_registry_id;
  END IF;
  IF v_task.protocol_version <> 'aicis-scientific-forecasting-protocol-v1' THEN
    RAISE EXCEPTION 'forecast task % is not bound to protocol v1', NEW.task_registry_id;
  END IF;
  IF NEW.domain <> v_task.domain OR NEW.geography_level <> v_task.geography_level THEN
    RAISE EXCEPTION 'forecast domain/geography do not match registered task';
  END IF;

  v_expected_end := CASE v_task.horizon_unit
    WHEN 'hours' THEN NEW.target_window_start + make_interval(hours => v_task.horizon_value)
    WHEN 'days' THEN NEW.target_window_start + make_interval(days => v_task.horizon_value)
    ELSE NULL
  END;

  IF v_expected_end IS NULL OR NEW.target_window_end IS DISTINCT FROM v_expected_end THEN
    RAISE EXCEPTION 'forecast target window does not exactly match registered task horizon';
  END IF;

  -- The database owns seal time. A caller cannot backdate the seal to make a
  -- forecast look prospective after target-period information has appeared.
  NEW.sealed_at := clock_timestamp();

  IF NEW.evidence_class = 'retrospective_backtest' THEN
    IF NEW.target_window_end > NEW.sealed_at THEN
      RAISE EXCEPTION 'retrospective backtests require a target window that has already ended';
    END IF;
  ELSIF NEW.evidence_class = 'prospective_shadow' THEN
    IF NEW.sealed_at > NEW.target_window_start THEN
      RAISE EXCEPTION 'prospective forecasts must be sealed before the target window starts';
    END IF;
  ELSIF NEW.evidence_class = 'prospective_operational' THEN
    RAISE EXCEPTION 'prospective operational evidence is quarantined until a separate operational-promotion control is implemented';
  ELSE
    RAISE EXCEPTION 'unsupported evidence class %', NEW.evidence_class;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_scientific_forecast_ledger_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'sealed scientific forecasts are append-only and cannot be updated or deleted';
END;
$$;

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
  -- Lock the forecast row so concurrent resolution inserts for the same forecast
  -- serialize before the version check.
  SELECT * INTO v_forecast
  FROM public.scientific_forecast_ledger_v1
  WHERE id = NEW.forecast_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'forecast % does not exist', NEW.forecast_id;
  END IF;

  SELECT * INTO v_task
  FROM public.scientific_forecast_tasks_v1
  WHERE id = v_forecast.task_registry_id;

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

CREATE OR REPLACE FUNCTION public.prevent_scientific_forecast_resolution_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'scientific forecast resolutions are append-only; create a new resolution version';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_scientific_forecast_task_v1
  ON public.scientific_forecast_tasks_v1;
CREATE TRIGGER trg_guard_scientific_forecast_task_v1
BEFORE INSERT OR UPDATE OR DELETE ON public.scientific_forecast_tasks_v1
FOR EACH ROW EXECUTE FUNCTION public.guard_scientific_forecast_task_v1();

DROP TRIGGER IF EXISTS trg_guard_scientific_forecast_ledger_insert_v1
  ON public.scientific_forecast_ledger_v1;
CREATE TRIGGER trg_guard_scientific_forecast_ledger_insert_v1
BEFORE INSERT ON public.scientific_forecast_ledger_v1
FOR EACH ROW EXECUTE FUNCTION public.guard_scientific_forecast_ledger_insert_v1();

DROP TRIGGER IF EXISTS trg_prevent_scientific_forecast_ledger_mutation_v1
  ON public.scientific_forecast_ledger_v1;
CREATE TRIGGER trg_prevent_scientific_forecast_ledger_mutation_v1
BEFORE UPDATE OR DELETE ON public.scientific_forecast_ledger_v1
FOR EACH ROW EXECUTE FUNCTION public.prevent_scientific_forecast_ledger_mutation_v1();

DROP TRIGGER IF EXISTS trg_guard_scientific_forecast_resolution_insert_v1
  ON public.scientific_forecast_resolution_ledger_v1;
CREATE TRIGGER trg_guard_scientific_forecast_resolution_insert_v1
BEFORE INSERT ON public.scientific_forecast_resolution_ledger_v1
FOR EACH ROW EXECUTE FUNCTION public.guard_scientific_forecast_resolution_insert_v1();

DROP TRIGGER IF EXISTS trg_prevent_scientific_forecast_resolution_mutation_v1
  ON public.scientific_forecast_resolution_ledger_v1;
CREATE TRIGGER trg_prevent_scientific_forecast_resolution_mutation_v1
BEFORE UPDATE OR DELETE ON public.scientific_forecast_resolution_ledger_v1
FOR EACH ROW EXECUTE FUNCTION public.prevent_scientific_forecast_resolution_mutation_v1();

-- Trigger/validator functions are internal database machinery, not callable APIs.
REVOKE ALL ON FUNCTION public.guard_scientific_forecast_task_v1() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_scientific_forecast_ledger_insert_v1() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prevent_scientific_forecast_ledger_mutation_v1() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_scientific_forecast_resolution_insert_v1() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prevent_scientific_forecast_resolution_mutation_v1() FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Data API / RLS boundary.
--    These governance ledgers are service-side only in v1. No anon/authenticated
--    policy is created. Explicit grants avoid relying on changing Supabase defaults.
-- ---------------------------------------------------------------------------
ALTER TABLE public.scientific_forecast_tasks_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scientific_forecast_ledger_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scientific_forecast_resolution_ledger_v1 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.scientific_forecast_tasks_v1 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.scientific_forecast_ledger_v1 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.scientific_forecast_resolution_ledger_v1 FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.scientific_forecast_tasks_v1 TO service_role;
GRANT SELECT, INSERT ON TABLE public.scientific_forecast_ledger_v1 TO service_role;
GRANT SELECT, INSERT ON TABLE public.scientific_forecast_resolution_ledger_v1 TO service_role;
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
