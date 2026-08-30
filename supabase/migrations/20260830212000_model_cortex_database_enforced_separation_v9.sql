-- AICIS Model Cortex Database-Enforced Separation of Duties v9
--
-- The v8 edge workflow checks verifier/resolver roles. This migration moves the
-- same boundary into the database so a service-role caller cannot bypass the
-- human separation-of-duties contract by invoking the v7 verification/resolution
-- writers directly.
--
-- This migration grants no workflow role and performs no verification/resolution.

-- The lower-level v7 verification/resolution primitives become internal-only.
REVOKE EXECUTE ON FUNCTION public.verify_aicis_model_external_evidence_v7(uuid,text)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.resolve_aicis_model_outcome_v7(uuid,smallint,text,jsonb)
  FROM service_role;

CREATE OR REPLACE FUNCTION public.verify_aicis_model_external_evidence_v9(
  p_external_outcome_id uuid,
  p_verification_method text,
  p_actor_user_id uuid
)
RETURNS public.prediction_external_outcomes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.prediction_external_outcomes%ROWTYPE;
BEGIN
  IF NOT public.aicis_user_has_model_evidence_workflow_role_v7(
    p_actor_user_id,
    'evidence_verifier'
  ) THEN
    RAISE EXCEPTION 'actor does not hold active evidence_verifier workflow role';
  END IF;

  v_row := public.verify_aicis_model_external_evidence_v7(
    p_external_outcome_id,
    p_verification_method
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_aicis_model_external_evidence_v9(uuid,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_aicis_model_external_evidence_v9(uuid,text,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_aicis_model_outcome_v9(
  p_external_outcome_id uuid,
  p_resolved_binary_outcome smallint,
  p_actor_user_id uuid,
  p_resolution_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS public.aicis_model_outcome_resolutions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.aicis_model_outcome_resolutions%ROWTYPE;
  v_resolver text;
BEGIN
  IF NOT public.aicis_user_has_model_evidence_workflow_role_v7(
    p_actor_user_id,
    'outcome_resolver'
  ) THEN
    RAISE EXCEPTION 'actor does not hold active outcome_resolver workflow role';
  END IF;

  v_resolver := 'admin-user:' || p_actor_user_id::text;
  v_row := public.resolve_aicis_model_outcome_v7(
    p_external_outcome_id,
    p_resolved_binary_outcome,
    v_resolver,
    COALESCE(p_resolution_evidence, '{}'::jsonb)
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_aicis_model_outcome_v9(uuid,smallint,uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_aicis_model_outcome_v9(uuid,smallint,uuid,jsonb)
  TO service_role;

COMMENT ON FUNCTION public.verify_aicis_model_external_evidence_v9(uuid,text,uuid) IS
  'Database-enforced evidence verification writer. The authenticated actor must hold the active evidence_verifier workflow role.';
COMMENT ON FUNCTION public.resolve_aicis_model_outcome_v9(uuid,smallint,uuid,jsonb) IS
  'Database-enforced outcome resolution writer. The authenticated actor must hold the active outcome_resolver role; resolver identity is derived from actor UUID.';
