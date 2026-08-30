-- AICIS Model Cortex Governed Evidence Writers v7
--
-- Adds narrow, service-role-only database writers for the sealed-target ->
-- canonical-artifact -> external-evidence -> verified-resolution lifecycle.
-- These functions are inert until this migration is deliberately deployed and
-- called; this migration does not enable cron, target writers, promotion, or cutover.
--
-- Invariants:
--   * target issuance time and fingerprint are database-authoritative;
--   * evidence retrieval time and verification time are database-authoritative;
--   * evidence hash comes only from the immutable canonical artifact;
--   * verified resolutions copy the sealed target contract rather than accepting
--     caller-supplied target semantics or resolution rules.

-- -----------------------------------------------------------------------------
-- 1. Seal a target contract for an already-existing Model Cortex prediction.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seal_aicis_model_prediction_target_v7(
  p_prediction_id text,
  p_target_definition text,
  p_target_semantics text,
  p_target_version text,
  p_resolution_rule text,
  p_resolution_rule_version text,
  p_forecast_horizon_at timestamptz DEFAULT NULL
)
RETURNS public.aicis_model_prediction_target_contracts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prediction public.aicis_model_predictions%ROWTYPE;
  v_existing public.aicis_model_prediction_target_contracts%ROWTYPE;
  v_created public.aicis_model_prediction_target_contracts%ROWTYPE;
BEGIN
  IF p_prediction_id IS NULL OR btrim(p_prediction_id) = '' THEN
    RAISE EXCEPTION 'prediction_id is required';
  END IF;
  IF p_target_definition IS NULL OR btrim(p_target_definition) = ''
     OR p_target_semantics IS NULL OR btrim(p_target_semantics) = ''
     OR p_target_version IS NULL OR btrim(p_target_version) = ''
     OR p_resolution_rule IS NULL OR btrim(p_resolution_rule) = ''
     OR p_resolution_rule_version IS NULL OR btrim(p_resolution_rule_version) = '' THEN
    RAISE EXCEPTION 'target definition/semantics/version and resolution rule/version are required';
  END IF;

  SELECT * INTO v_prediction
  FROM public.aicis_model_predictions p
  WHERE p.id::text = p_prediction_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Model Cortex prediction % does not exist', p_prediction_id;
  END IF;

  SELECT * INTO v_existing
  FROM public.aicis_model_prediction_target_contracts c
  WHERE c.prediction_id = p_prediction_id;
  IF FOUND THEN
    RAISE EXCEPTION 'Model Cortex prediction % already has a sealed target contract', p_prediction_id;
  END IF;

  INSERT INTO public.aicis_model_prediction_target_contracts (
    prediction_id,
    prediction_system,
    issued_at,
    target_definition,
    target_semantics,
    target_version,
    resolution_rule,
    resolution_rule_version,
    forecast_horizon_at,
    target_fingerprint_sha256,
    created_at
  ) VALUES (
    p_prediction_id,
    'model_cortex',
    clock_timestamp(),
    btrim(p_target_definition),
    btrim(p_target_semantics),
    btrim(p_target_version),
    btrim(p_resolution_rule),
    btrim(p_resolution_rule_version),
    p_forecast_horizon_at,
    repeat('0', 64),
    clock_timestamp()
  )
  RETURNING * INTO v_created;

  -- The BEFORE INSERT trigger replaces issued_at, created_at and fingerprint
  -- with server-authoritative values before constraints are checked.
  RETURN v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.seal_aicis_model_prediction_target_v7(text,text,text,text,text,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seal_aicis_model_prediction_target_v7(text,text,text,text,text,text,timestamptz)
  TO service_role;

-- -----------------------------------------------------------------------------
-- 2. Create or reuse an immutable canonical evidence artifact.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_aicis_prediction_evidence_artifact_v7(
  p_artifact_type text,
  p_media_type text,
  p_canonical_evidence jsonb
)
RETURNS public.aicis_prediction_evidence_artifacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sha text;
  v_row public.aicis_prediction_evidence_artifacts%ROWTYPE;
BEGIN
  IF p_artifact_type IS NULL OR btrim(p_artifact_type) = ''
     OR p_media_type IS NULL OR btrim(p_media_type) = ''
     OR p_canonical_evidence IS NULL THEN
    RAISE EXCEPTION 'artifact_type, media_type and canonical_evidence are required';
  END IF;

  v_sha := public.aicis_prediction_evidence_artifact_sha256(
    btrim(p_artifact_type),
    btrim(p_media_type),
    'jsonb-canonical-text-v1',
    p_canonical_evidence
  );

  INSERT INTO public.aicis_prediction_evidence_artifacts (
    artifact_type,
    media_type,
    canonicalization_version,
    canonical_evidence,
    artifact_sha256
  ) VALUES (
    btrim(p_artifact_type),
    btrim(p_media_type),
    'jsonb-canonical-text-v1',
    p_canonical_evidence,
    v_sha
  )
  ON CONFLICT (artifact_sha256) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    SELECT * INTO v_row
    FROM public.aicis_prediction_evidence_artifacts a
    WHERE a.artifact_sha256 = v_sha;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_aicis_prediction_evidence_artifact_v7(text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_aicis_prediction_evidence_artifact_v7(text,text,jsonb)
  TO service_role;

-- -----------------------------------------------------------------------------
-- 3. Record pending external evidence. Retrieval time is server time, and the
--    evidence payload/hash are copied from the canonical artifact.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_aicis_model_external_evidence_v7(
  p_prediction_id text,
  p_evidence_artifact_id uuid,
  p_event_type text,
  p_observed_at timestamptz,
  p_observation_text text,
  p_source_name text,
  p_source_uri text,
  p_ledger_id text DEFAULT NULL
)
RETURNS public.prediction_external_outcomes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_contract public.aicis_model_prediction_target_contracts%ROWTYPE;
  v_artifact public.aicis_prediction_evidence_artifacts%ROWTYPE;
  v_row public.prediction_external_outcomes%ROWTYPE;
BEGIN
  IF p_prediction_id IS NULL OR btrim(p_prediction_id) = ''
     OR p_evidence_artifact_id IS NULL
     OR p_event_type IS NULL OR btrim(p_event_type) = ''
     OR p_observed_at IS NULL
     OR p_observation_text IS NULL OR btrim(p_observation_text) = ''
     OR p_source_name IS NULL OR btrim(p_source_name) = ''
     OR p_source_uri IS NULL OR btrim(p_source_uri) = '' THEN
    RAISE EXCEPTION 'prediction, artifact, event, observation and source fields are required';
  END IF;

  SELECT * INTO v_contract
  FROM public.aicis_model_prediction_target_contracts c
  WHERE c.prediction_id = p_prediction_id
    AND c.prediction_system = 'model_cortex';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'prediction % has no sealed Model Cortex target contract', p_prediction_id;
  END IF;

  IF p_observed_at < v_contract.issued_at THEN
    RAISE EXCEPTION 'external evidence observed_at cannot precede sealed target issuance';
  END IF;
  IF p_observed_at > v_now THEN
    RAISE EXCEPTION 'external evidence observed_at cannot be in the future relative to retrieval time';
  END IF;

  SELECT * INTO v_artifact
  FROM public.aicis_prediction_evidence_artifacts a
  WHERE a.id = p_evidence_artifact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'canonical evidence artifact % does not exist', p_evidence_artifact_id;
  END IF;

  INSERT INTO public.prediction_external_outcomes (
    prediction_system,
    prediction_id,
    ledger_id,
    event_type,
    observed_at,
    retrieved_at,
    observation_text,
    source_name,
    source_uri,
    evidence_sha256,
    evidence_artifact_id,
    evidence_binding_version,
    verification_status,
    verification_method,
    verified_at,
    evidence,
    created_at,
    updated_at
  ) VALUES (
    'model_cortex',
    p_prediction_id,
    p_ledger_id,
    btrim(p_event_type),
    p_observed_at,
    v_now,
    btrim(p_observation_text),
    btrim(p_source_name),
    btrim(p_source_uri),
    v_artifact.artifact_sha256,
    v_artifact.id,
    'canonical-artifact-v1',
    'pending',
    NULL,
    NULL,
    v_artifact.canonical_evidence,
    v_now,
    v_now
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.record_aicis_model_external_evidence_v7(text,uuid,text,timestamptz,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_aicis_model_external_evidence_v7(text,uuid,text,timestamptz,text,text,text,text)
  TO service_role;

-- -----------------------------------------------------------------------------
-- 4. Verify pending external evidence. Verification time is server time.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_aicis_model_external_evidence_v7(
  p_external_outcome_id uuid,
  p_verification_method text
)
RETURNS public.prediction_external_outcomes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.prediction_external_outcomes%ROWTYPE;
  v_contract public.aicis_model_prediction_target_contracts%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_external_outcome_id IS NULL
     OR p_verification_method IS NULL OR btrim(p_verification_method) = '' THEN
    RAISE EXCEPTION 'external outcome id and verification method are required';
  END IF;

  SELECT * INTO v_row
  FROM public.prediction_external_outcomes e
  WHERE e.id = p_external_outcome_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'external outcome % does not exist', p_external_outcome_id;
  END IF;
  IF v_row.prediction_system <> 'model_cortex' THEN
    RAISE EXCEPTION 'external outcome is not a Model Cortex evidence row';
  END IF;
  IF v_row.verification_status <> 'pending' THEN
    RAISE EXCEPTION 'only pending external evidence can be verified; current status=%', v_row.verification_status;
  END IF;

  SELECT * INTO v_contract
  FROM public.aicis_model_prediction_target_contracts c
  WHERE c.prediction_id = v_row.prediction_id
    AND c.prediction_system = 'model_cortex';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'external outcome prediction has no sealed target contract';
  END IF;

  IF v_row.observed_at < v_contract.issued_at
     OR v_row.retrieved_at IS NULL
     OR v_row.retrieved_at < v_row.observed_at
     OR v_row.retrieved_at < v_contract.issued_at THEN
    RAISE EXCEPTION 'external evidence chronology is not eligible for verification';
  END IF;

  UPDATE public.prediction_external_outcomes
  SET verification_status = 'verified',
      verification_method = btrim(p_verification_method),
      verified_at = v_now,
      updated_at = v_now
  WHERE id = p_external_outcome_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_aicis_model_external_evidence_v7(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_aicis_model_external_evidence_v7(uuid,text)
  TO service_role;

-- -----------------------------------------------------------------------------
-- 5. Resolve a prediction using only the sealed target and verified evidence.
--    Caller supplies the resolved binary label, but never target semantics/rule.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_aicis_model_outcome_v7(
  p_external_outcome_id uuid,
  p_resolved_binary_outcome smallint,
  p_resolver text,
  p_resolution_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS public.aicis_model_outcome_resolutions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_external public.prediction_external_outcomes%ROWTYPE;
  v_contract public.aicis_model_prediction_target_contracts%ROWTYPE;
  v_row public.aicis_model_outcome_resolutions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_external_outcome_id IS NULL
     OR p_resolved_binary_outcome NOT IN (0, 1)
     OR p_resolver IS NULL OR btrim(p_resolver) = '' THEN
    RAISE EXCEPTION 'verified external outcome, binary resolution and resolver are required';
  END IF;

  SELECT * INTO v_external
  FROM public.prediction_external_outcomes e
  WHERE e.id = p_external_outcome_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'external outcome % does not exist', p_external_outcome_id;
  END IF;
  IF v_external.prediction_system <> 'model_cortex'
     OR v_external.verification_status <> 'verified'
     OR v_external.verified_at IS NULL
     OR v_external.retrieved_at IS NULL THEN
    RAISE EXCEPTION 'resolution requires currently verified Model Cortex evidence';
  END IF;

  SELECT * INTO v_contract
  FROM public.aicis_model_prediction_target_contracts c
  WHERE c.prediction_id = v_external.prediction_id
    AND c.prediction_system = 'model_cortex';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'resolution requires a sealed target contract';
  END IF;

  INSERT INTO public.aicis_model_outcome_resolutions (
    prediction_system,
    prediction_id,
    external_outcome_id,
    target_definition,
    target_semantics,
    target_version,
    resolution_rule,
    resolution_rule_version,
    resolved_binary_outcome,
    resolution_status,
    resolver,
    resolved_at,
    resolution_evidence,
    created_at,
    updated_at
  ) VALUES (
    'model_cortex',
    v_external.prediction_id,
    v_external.id,
    v_contract.target_definition,
    v_contract.target_semantics,
    v_contract.target_version,
    v_contract.resolution_rule,
    v_contract.resolution_rule_version,
    p_resolved_binary_outcome,
    'verified',
    btrim(p_resolver),
    v_now,
    COALESCE(p_resolution_evidence, '{}'::jsonb),
    v_now,
    v_now
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_aicis_model_outcome_v7(uuid,smallint,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_aicis_model_outcome_v7(uuid,smallint,text,jsonb)
  TO service_role;

COMMENT ON FUNCTION public.seal_aicis_model_prediction_target_v7(text,text,text,text,text,text,timestamptz) IS
  'Governed service writer: seals target semantics after the prediction exists; issuance time/fingerprint are established by the database trigger.';
COMMENT ON FUNCTION public.record_aicis_model_external_evidence_v7(text,uuid,text,timestamptz,text,text,text,text) IS
  'Governed service writer: records pending post-issuance external evidence using database retrieval time and canonical artifact hash/payload.';
COMMENT ON FUNCTION public.verify_aicis_model_external_evidence_v7(uuid,text) IS
  'Governed service writer: verifies only pending Model Cortex evidence after chronology and sealed-target checks; verification time is database time.';
COMMENT ON FUNCTION public.resolve_aicis_model_outcome_v7(uuid,smallint,text,jsonb) IS
  'Governed service writer: creates a verified binary resolution by copying the immutable sealed target contract; callers cannot redefine the forecast target at resolution time.';
