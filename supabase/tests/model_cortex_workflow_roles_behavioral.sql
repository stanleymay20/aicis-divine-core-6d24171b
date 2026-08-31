\set ON_ERROR_STOP on

-- Behavioral proof for Model Cortex v8 separation-of-duties controls.
-- Runs only in disposable CI PostgreSQL with Supabase-compatible roles.

DO $$
DECLARE
  v_seeded_count integer;
BEGIN
  SELECT count(*) INTO v_seeded_count
  FROM public.aicis_model_evidence_workflow_roles;

  IF v_seeded_count <> 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: workflow-role migration must not seed privileged users';
  END IF;

  IF has_table_privilege('anon', 'public.aicis_model_evidence_workflow_roles', 'SELECT')
     OR has_table_privilege('authenticated', 'public.aicis_model_evidence_workflow_roles', 'SELECT') THEN
    RAISE EXCEPTION 'ASSERTION FAILED: anon/authenticated must not read workflow-role registry';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.aicis_model_evidence_workflow_roles', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.aicis_model_evidence_workflow_roles', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.aicis_model_evidence_workflow_roles', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.aicis_model_evidence_workflow_roles', 'DELETE') THEN
    RAISE EXCEPTION 'ASSERTION FAILED: service_role must hold the explicitly governed workflow-role table privileges';
  END IF;

  IF has_function_privilege('anon', 'public.aicis_user_has_model_evidence_workflow_role_v7(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.aicis_user_has_model_evidence_workflow_role_v7(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION FAILED: anon/authenticated must not execute workflow-role authorization check';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.aicis_user_has_model_evidence_workflow_role_v7(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION FAILED: service_role must be able to execute workflow-role authorization check';
  END IF;
END
$$;

-- Use deterministic UUIDs so the test is reproducible.
SET ROLE service_role;

INSERT INTO public.aicis_model_evidence_workflow_roles (
  user_id,
  workflow_role,
  active,
  rationale
) VALUES (
  '11111111-1111-1111-1111-111111111111'::uuid,
  'evidence_verifier',
  true,
  'behavioral-test verifier assignment'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.aicis_model_evidence_workflow_roles (
      user_id,
      workflow_role,
      active,
      rationale
    ) VALUES (
      '11111111-1111-1111-1111-111111111111'::uuid,
      'outcome_resolver',
      true,
      'behavioral-test conflicting resolver assignment'
    );

    RAISE EXCEPTION 'ASSERTION FAILED: same user was allowed to hold verifier and resolver roles simultaneously';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'ASSERTION FAILED:%' THEN
        RAISE;
      END IF;
      IF position('separation of duties' in lower(SQLERRM)) = 0 THEN
        RAISE EXCEPTION 'ASSERTION FAILED: conflicting role assignment failed for unexpected reason: %', SQLERRM;
      END IF;
  END;
END
$$;

UPDATE public.aicis_model_evidence_workflow_roles
SET active = false,
    revoked_at = clock_timestamp()
WHERE user_id = '11111111-1111-1111-1111-111111111111'::uuid
  AND workflow_role = 'evidence_verifier';

INSERT INTO public.aicis_model_evidence_workflow_roles (
  user_id,
  workflow_role,
  active,
  rationale
) VALUES (
  '11111111-1111-1111-1111-111111111111'::uuid,
  'outcome_resolver',
  true,
  'behavioral-test resolver assignment after verifier revocation'
);

DO $$
BEGIN
  IF public.aicis_user_has_model_evidence_workflow_role_v7(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'evidence_verifier'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: revoked evidence_verifier role still authorizes';
  END IF;

  IF NOT public.aicis_user_has_model_evidence_workflow_role_v7(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'outcome_resolver'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: active outcome_resolver role does not authorize';
  END IF;

  IF public.aicis_user_has_model_evidence_workflow_role_v7(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'not-a-real-role'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: unknown workflow role authorized';
  END IF;
END
$$;

DO $$
BEGIN
  BEGIN
    UPDATE public.aicis_model_evidence_workflow_roles
    SET active = true,
        revoked_at = NULL
    WHERE user_id = '11111111-1111-1111-1111-111111111111'::uuid
      AND workflow_role = 'evidence_verifier';

    RAISE EXCEPTION 'ASSERTION FAILED: revoked verifier was reactivated while resolver remained active';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'ASSERTION FAILED:%' THEN
        RAISE;
      END IF;
      IF position('separation of duties' in lower(SQLERRM)) = 0 THEN
        RAISE EXCEPTION 'ASSERTION FAILED: conflicting reactivation failed for unexpected reason: %', SQLERRM;
      END IF;
  END;
END
$$;

RESET ROLE;

DO $$
DECLARE
  v_active_verifier boolean;
  v_active_resolver boolean;
BEGIN
  SELECT active INTO v_active_verifier
  FROM public.aicis_model_evidence_workflow_roles
  WHERE user_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND workflow_role = 'evidence_verifier';

  SELECT active INTO v_active_resolver
  FROM public.aicis_model_evidence_workflow_roles
  WHERE user_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND workflow_role = 'outcome_resolver';

  IF v_active_verifier IS DISTINCT FROM false OR v_active_resolver IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ASSERTION FAILED: failed conflicting mutation changed canonical workflow-role state';
  END IF;
END
$$;
