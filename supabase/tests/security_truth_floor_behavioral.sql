\set ON_ERROR_STOP on

-- Behavioral proof for AICIS Security Truth Floor v1.
-- Runs only against a disposable PostgreSQL database in CI.
-- It does not connect to or mutate any AICIS source/target Supabase project.

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition boolean, message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ASSERTION FAILED: %', message;
  END IF;
END;
$$;

-- 1. Missing evidence must fail closed.
SELECT pg_temp.assert_true(
  (SELECT production_security_ready FROM public.aicis_security_production_readiness_v1) = false,
  'production security readiness must be false when required controls have no evidence'
);

SELECT pg_temp.assert_true(
  (SELECT unverified_required_controls FROM public.aicis_security_production_readiness_v1) > 0,
  'missing evidence must surface as unverified required controls'
);

-- 2. Static evidence is useful but cannot earn production readiness.
SET ROLE service_role;
INSERT INTO public.aicis_security_control_evidence (
  control_key, environment, evidence_kind, result, artifact_ref,
  observed_at, verifier_identity, verifier_method
) VALUES (
  'nist-ac-6', 'ci', 'static_test', 'pass', 'ci://security-truth-floor/static/ac-6',
  clock_timestamp(), 'ci-security-test', 'disposable-postgres-behavioral-suite'
);
RESET ROLE;

SELECT pg_temp.assert_true(
  (SELECT effective_status FROM public.aicis_security_control_effective_state_v1 WHERE control_key = 'nist-ac-6') = 'statically_verified',
  'a static pass must produce statically_verified, not behavioral/runtime verification'
);
SELECT pg_temp.assert_true(
  (SELECT production_security_ready FROM public.aicis_security_production_readiness_v1) = false,
  'static evidence alone must never make production security ready'
);

-- 3. Behavioral proof upgrades that control, but one verified control cannot make
-- the entire required catalog ready.
SET ROLE service_role;
INSERT INTO public.aicis_security_control_evidence (
  control_key, environment, evidence_kind, result, artifact_ref,
  observed_at, verifier_identity, verifier_method
) VALUES (
  'nist-ac-6', 'ci', 'behavioral_test', 'pass', 'ci://security-truth-floor/behavioral/ac-6',
  clock_timestamp(), 'ci-security-test', 'disposable-postgres-behavioral-suite'
);
RESET ROLE;

SELECT pg_temp.assert_true(
  (SELECT effective_status FROM public.aicis_security_control_effective_state_v1 WHERE control_key = 'nist-ac-6') = 'behaviorally_verified',
  'behavioral pass must establish behaviorally_verified for the tested control'
);
SELECT pg_temp.assert_true(
  (SELECT production_security_ready FROM public.aicis_security_production_readiness_v1) = false,
  'partial behavioral verification must not manufacture whole-system readiness'
);

-- 4. Any current failure dominates passing evidence.
SET ROLE service_role;
INSERT INTO public.aicis_security_control_evidence (
  control_key, environment, evidence_kind, result, artifact_ref,
  observed_at, verifier_identity, verifier_method
) VALUES (
  'nist-ac-6', 'ci', 'behavioral_test', 'fail', 'ci://security-truth-floor/behavioral/ac-6-failure',
  clock_timestamp(), 'ci-security-test', 'disposable-postgres-behavioral-suite'
);
RESET ROLE;

SELECT pg_temp.assert_true(
  (SELECT effective_status FROM public.aicis_security_control_effective_state_v1 WHERE control_key = 'nist-ac-6') = 'failed',
  'a current failure must dominate current passing evidence'
);

-- 5. Security evidence must be immutable even to the simulated Supabase
-- service_role (BYPASSRLS). The trigger must block UPDATE and DELETE.
DO $$
DECLARE
  evidence_id uuid;
  blocked boolean := false;
BEGIN
  SELECT id INTO evidence_id
  FROM public.aicis_security_control_evidence
  WHERE control_key = 'nist-ac-6'
  ORDER BY created_at
  LIMIT 1;

  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    UPDATE public.aicis_security_control_evidence
      SET details = '{"tampered":true}'::jsonb
      WHERE id = evidence_id;
  EXCEPTION WHEN OTHERS THEN
    blocked := position('append-only' in SQLERRM) > 0;
  END;

  PERFORM pg_temp.assert_true(blocked, 'service_role update of security evidence must be blocked by append-only trigger');
END;
$$;

DO $$
DECLARE
  evidence_id uuid;
  blocked boolean := false;
BEGIN
  SELECT id INTO evidence_id
  FROM public.aicis_security_control_evidence
  WHERE control_key = 'nist-ac-6'
  ORDER BY created_at
  LIMIT 1;

  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    DELETE FROM public.aicis_security_control_evidence WHERE id = evidence_id;
  EXCEPTION WHEN OTHERS THEN
    blocked := position('append-only' in SQLERRM) > 0;
  END;

  PERFORM pg_temp.assert_true(blocked, 'service_role delete of security evidence must be blocked by append-only trigger');
END;
$$;

-- 6. Authenticated users have no evidence-writer policy. A table GRANT must not
-- accidentally become write authority through RLS.
DO $$
DECLARE
  blocked boolean := false;
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO public.aicis_security_control_evidence (
      control_key, environment, evidence_kind, result,
      observed_at, verifier_identity, verifier_method
    ) VALUES (
      'nist-ac-5', 'development', 'behavioral_test', 'pass',
      clock_timestamp(), 'unauthorized-user', 'should-never-succeed'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  WHEN OTHERS THEN
    blocked := position('row-level security' in SQLERRM) > 0 OR position('permission denied' in SQLERRM) > 0;
  END;

  PERFORM pg_temp.assert_true(blocked, 'authenticated user must not be able to insert security evidence');
END;
$$;

-- 7. Human assessment must not change canonical effective state or readiness.
SET ROLE service_role;
INSERT INTO public.aicis_security_control_assessments (
  control_key, declared_status, assessor_identity, rationale
) VALUES (
  'nist-ia-2', 'runtime_verified', 'human-assessor', 'declaration must not count as verification'
);
RESET ROLE;

SELECT pg_temp.assert_true(
  (SELECT effective_status FROM public.aicis_security_control_effective_state_v1 WHERE control_key = 'nist-ia-2') = 'unverified',
  'human declaration must not establish canonical security verification'
);
SELECT pg_temp.assert_true(
  (SELECT production_security_ready FROM public.aicis_security_production_readiness_v1) = false,
  'human declaration must not change production security readiness'
);

SELECT 'AICIS security truth-floor behavioral database tests passed' AS result;
