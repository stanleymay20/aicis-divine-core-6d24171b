-- AICIS Model Cortex Evidence Workflow Roles v8
--
-- Adds explicit separation-of-duties roles for human evidence verification and
-- outcome resolution. The admin-gated edge workflow requires the corresponding
-- role before invoking the service-role-only evidence writers.
--
-- This migration grants no user a role and activates no writer by itself.

CREATE TABLE IF NOT EXISTS public.aicis_model_evidence_workflow_roles (
  user_id uuid NOT NULL,
  workflow_role text NOT NULL CHECK (workflow_role IN ('evidence_verifier', 'outcome_resolver')),
  active boolean NOT NULL DEFAULT true,
  rationale text NOT NULL CHECK (btrim(rationale) <> ''),
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (user_id, workflow_role),
  CONSTRAINT aicis_model_evidence_workflow_role_revocation CHECK (
    (active = true AND revoked_at IS NULL)
    OR (active = false AND revoked_at IS NOT NULL)
  )
);

ALTER TABLE public.aicis_model_evidence_workflow_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aicis_model_evidence_workflow_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aicis_model_evidence_workflow_roles TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_aicis_model_evidence_workflow_role_separation_v8()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_other_role text;
BEGIN
  IF NEW.active IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  v_other_role := CASE NEW.workflow_role
    WHEN 'evidence_verifier' THEN 'outcome_resolver'
    ELSE 'evidence_verifier'
  END;

  IF EXISTS (
    SELECT 1
    FROM public.aicis_model_evidence_workflow_roles r
    WHERE r.user_id = NEW.user_id
      AND r.workflow_role = v_other_role
      AND r.active = true
  ) THEN
    RAISE EXCEPTION 'separation of duties: one user cannot simultaneously hold evidence_verifier and outcome_resolver';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aicis_model_evidence_workflow_role_separation_v8
  ON public.aicis_model_evidence_workflow_roles;
CREATE TRIGGER trg_aicis_model_evidence_workflow_role_separation_v8
BEFORE INSERT OR UPDATE ON public.aicis_model_evidence_workflow_roles
FOR EACH ROW EXECUTE FUNCTION public.enforce_aicis_model_evidence_workflow_role_separation_v8();

REVOKE ALL ON FUNCTION public.enforce_aicis_model_evidence_workflow_role_separation_v8() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.aicis_user_has_model_evidence_workflow_role_v7(
  p_user_id uuid,
  p_role text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN false
    WHEN p_role NOT IN ('evidence_verifier', 'outcome_resolver') THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.aicis_model_evidence_workflow_roles r
      WHERE r.user_id = p_user_id
        AND r.workflow_role = p_role
        AND r.active = true
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.aicis_user_has_model_evidence_workflow_role_v7(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aicis_user_has_model_evidence_workflow_role_v7(uuid,text)
  TO service_role;

COMMENT ON TABLE public.aicis_model_evidence_workflow_roles IS
  'Explicit human separation-of-duties registry for Model Cortex evidence verification and outcome resolution. No role is granted by migration.';
COMMENT ON FUNCTION public.aicis_user_has_model_evidence_workflow_role_v7(uuid,text) IS
  'Service-only authorization check used by the admin-gated evidence governance edge workflow.';
