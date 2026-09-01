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
  task_spec jsonb NOT NULL CHECK (jsonb_typeof(task_spec) = 'object'),
  task_spec_sha256 text NOT NULL CHECK (task_spec_sha256 ~ '^[0-9a-f]{64}$'),
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
    AND task_spec->>'domain' = domain
    AND task_spec->>'geography_level' = geography_level
    AND task_spec#>>'{target,type}' = target_type
    AND task_spec->>'knowledge_time_policy' = knowledge_time_policy
    AND task_spec->>'claim_semantics' = claim_semantics
  ),
  CONSTRAINT scientific_forecast_tasks_v1_approval_ck CHECK (
    (task_status = 'draft' AND approved_at IS NULL AND approved_by IS NULL AND retired_at IS NULL)
    OR (task_status = 'approved' AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND retired_at IS NULL)
    OR (task_status = 'retired' AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND retired_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.scientific_forecast_tasks_v1 IS
  'Versioned scientific forecast-task registry bound to AICIS Scientific Forecasting Protocol v1. Approval does not activate a production writer or promote a model.';

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
  forecast_payload jsonb NOT NULL CHECK (jsonb_typeof(forecast_payload) = 'object'),
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

-- ---------------------------------------------------------------------------
-- 3. Append-only resolution ledger
-- ---------------------------------------------------------------------------
CREATE TABLE public.scientific_forecast_resolution_ledger_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id uuid NOT NULL
    REFERENCES public.scientific_forecast_ledger_v1(id) ON DELETE RESTRICT,
  resolution_version integer NOT NULL CHECK (resolution_version > 0),
  resolution_status text NOT NULL CHECK (resolution_status IN ('provisional','final','revised')),
  outcome_payload jsonb NOT NULL CHECK (jsonb_typeof(outcome_payload) = 'object'),
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
  adjudication_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(adjudication_metadata) = 'object'),
  created_by uuid,
  CONSTRAINT scientific_forecast_resolution_ledger_v1_version_uq UNIQUE (forecast_id, resolution_version),
  CONSTRAINT scientific_forecast_resolution_ledger_v1_time_ck CHECK (resolved_at >= outcome_observed_at)
);

CREATE INDEX scientific_forecast_resolution_ledger_v1_forecast_idx
  ON public.scientific_forecast_resolution_ledger_v1(forecast_id, resolution_version DESC);

COMMENT ON TABLE public.scientific_forecast_resolution_ledger_v1 IS
  'Append-only versioned ground-truth resolutions. Revisions create new rows; they never rewrite earlier resolution evidence.';

-- ---------------------------------------------------------------------------
-- 4. Integrity triggers. These are SECURITY INVOKER/default functions and are
--    deliberately not SECURITY DEFINER.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_scientific_forecast_task_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'scientific forecast tasks are versioned records; retire instead of delete';
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
       OR NEW.task_spec_sha256 IS DISTINCT FROM OLD.task_spec_sha256 THEN
      RAISE EXCEPTION 'approved/retired scientific forecast task definitions are immutable; create a new task version';
    END IF;
  END IF;

  IF OLD.task_status = 'draft' AND NEW.task_status NOT IN ('draft','approved') THEN
    RAISE EXCEPTION 'invalid task transition from draft to %', NEW.task_status;
  ELSIF OLD.task_status = 'approved' AND NEW.task_status NOT IN ('approved','retired') THEN
    RAISE EXCEPTION 'invalid task transition from approved to %', NEW.task_status;
  ELSIF OLD.task_status = 'retired' AND NEW.task_status <> 'retired' THEN
    RAISE EXCEPTION 'retired scientific forecast tasks cannot be reactivated';
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
BEGIN
  SELECT * INTO v_forecast
  FROM public.scientific_forecast_ledger_v1
  WHERE id = NEW.forecast_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'forecast % does not exist', NEW.forecast_id;
  END IF;

  SELECT * INTO v_task
  FROM public.scientific_forecast_tasks_v1
  WHERE id = v_forecast.task_registry_id;

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
BEFORE UPDATE OR DELETE ON public.scientific_forecast_tasks_v1
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

-- Trigger functions are internal database machinery, not callable APIs.
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

COMMENT ON COLUMN public.scientific_forecast_ledger_v1.evidence_class IS
  'retrospective_backtest is not prospective evidence; prospective_shadow is sealed real-future evidence without operational authority; prospective_operational is sealed real-future evidence used operationally.';
COMMENT ON COLUMN public.scientific_forecast_ledger_v1.seal_proof_sha256 IS
  'Digest of the immutable seal evidence package binding forecast origin, knowledge cutoff and reproducibility manifests. Presence alone is not proof of model skill.';
