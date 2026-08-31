-- Minimal disposable-DB fixture for the v8/v9 separation-of-duties contract.
--
-- This deliberately does NOT claim to reproduce the full Model Cortex schema or
-- evidence lifecycle. It supplies only the composite return types and v7 writer
-- signatures needed to execute the real v8 and v9 authorization migrations.
-- Full v1-v9 lifecycle behavior remains a separate proof obligation.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.prediction_external_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_status text NOT NULL DEFAULT 'pending',
  verification_method text
);

CREATE TABLE public.aicis_model_outcome_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_outcome_id uuid NOT NULL REFERENCES public.prediction_external_outcomes(id),
  resolved_binary_outcome smallint NOT NULL CHECK (resolved_binary_outcome IN (0, 1)),
  resolver text NOT NULL,
  resolution_evidence jsonb NOT NULL DEFAULT '{}'::jsonb
);

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
BEGIN
  UPDATE public.prediction_external_outcomes
  SET verification_status = 'verified',
      verification_method = p_verification_method
  WHERE id = p_external_outcome_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'fixture external outcome does not exist';
  END IF;

  RETURN v_row;
END;
$$;

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
  v_row public.aicis_model_outcome_resolutions%ROWTYPE;
BEGIN
  INSERT INTO public.aicis_model_outcome_resolutions (
    external_outcome_id,
    resolved_binary_outcome,
    resolver,
    resolution_evidence
  ) VALUES (
    p_external_outcome_id,
    p_resolved_binary_outcome,
    p_resolver,
    COALESCE(p_resolution_evidence, '{}'::jsonb)
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_aicis_model_external_evidence_v7(uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_aicis_model_outcome_v7(uuid,smallint,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_aicis_model_external_evidence_v7(uuid,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_aicis_model_outcome_v7(uuid,smallint,text,jsonb)
  TO service_role;
