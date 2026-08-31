\set ON_ERROR_STOP on

DO $$
DECLARE
  v_verifier uuid := '11111111-1111-4111-8111-111111111111';
  v_resolver uuid := '22222222-2222-4222-8222-222222222222';
  v_unauthorized uuid := '33333333-3333-4333-8333-333333333333';
  v_external uuid;
  v_verified public.prediction_external_outcomes%ROWTYPE;
  v_resolution public.aicis_model_outcome_resolutions%ROWTYPE;
  v_error text;
BEGIN
  -- v9 must remove service_role's ability to invoke the lower-level v7 truth
  -- mutations directly. The wrapper remains able to call them as its owner.
  IF has_function_privilege(
    'service_role',
    'public.verify_aicis_model_external_evidence_v7(uuid,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: service_role still has direct v7 verify EXECUTE';
  END IF;

  IF has_function_privilege(
    'service_role',
    'public.resolve_aicis_model_outcome_v7(uuid,smallint,text,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: service_role still has direct v7 resolve EXECUTE';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.verify_aicis_model_external_evidence_v9(uuid,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: service_role lacks governed v9 verify wrapper';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.resolve_aicis_model_outcome_v9(uuid,smallint,uuid,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: service_role lacks governed v9 resolve wrapper';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.verify_aicis_model_external_evidence_v9(uuid,text,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.resolve_aicis_model_outcome_v9(uuid,smallint,uuid,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: authenticated can execute governed v9 truth writers';
  END IF;

  INSERT INTO public.prediction_external_outcomes DEFAULT VALUES
  RETURNING id INTO v_external;

  -- No role => governed verification must fail closed.
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.verify_aicis_model_external_evidence_v9(
      v_external,
      'fixture-method',
      v_unauthorized
    );
    RAISE EXCEPTION 'ASSERTION FAILED: unauthorized actor verified evidence';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error NOT ILIKE '%does not hold active evidence_verifier%' THEN
      RAISE;
    END IF;
  END;

  IF (SELECT verification_status FROM public.prediction_external_outcomes WHERE id = v_external) <> 'pending' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: failed verification mutated evidence state';
  END IF;

  INSERT INTO public.aicis_model_evidence_workflow_roles (
    user_id, workflow_role, active, rationale
  ) VALUES (
    v_verifier, 'evidence_verifier', true, 'behavioral verifier fixture'
  );

  INSERT INTO public.aicis_model_evidence_workflow_roles (
    user_id, workflow_role, active, rationale
  ) VALUES (
    v_resolver, 'outcome_resolver', true, 'behavioral resolver fixture'
  );

  -- Authorized verifier succeeds through v9 despite service_role's direct v7
  -- EXECUTE having been revoked. This proves the intended SECURITY DEFINER path.
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT * INTO v_verified
  FROM public.verify_aicis_model_external_evidence_v9(
    v_external,
    'fixture-method',
    v_verifier
  );
  EXECUTE 'RESET ROLE';

  IF v_verified.verification_status <> 'verified'
     OR v_verified.verification_method <> 'fixture-method' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: authorized v9 verification did not reach v7 primitive';
  END IF;

  -- A verifier cannot act as resolver.
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.resolve_aicis_model_outcome_v9(
      v_external,
      1,
      v_verifier,
      '{"source":"behavioral"}'::jsonb
    );
    RAISE EXCEPTION 'ASSERTION FAILED: evidence verifier resolved outcome';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error NOT ILIKE '%does not hold active outcome_resolver%' THEN
      RAISE;
    END IF;
  END;

  -- Authorized resolver succeeds, and resolver identity must be DB-derived from
  -- the actor UUID; there is no caller-supplied resolver parameter in v9.
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT * INTO v_resolution
  FROM public.resolve_aicis_model_outcome_v9(
    v_external,
    1,
    v_resolver,
    '{"source":"behavioral"}'::jsonb
  );
  EXECUTE 'RESET ROLE';

  IF v_resolution.resolver <> 'admin-user:' || v_resolver::text THEN
    RAISE EXCEPTION 'ASSERTION FAILED: resolver identity was not derived from actor UUID';
  END IF;

  IF v_resolution.resolved_binary_outcome <> 1
     OR v_resolution.resolution_evidence <> '{"source":"behavioral"}'::jsonb THEN
    RAISE EXCEPTION 'ASSERTION FAILED: governed resolution payload was not preserved';
  END IF;

  RAISE NOTICE 'PASS: Model Cortex v9 database-enforced separation behavioral assertions';
END
$$;
