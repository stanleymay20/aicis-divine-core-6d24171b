-- AICIS Legacy ML RPC Quarantine
--
-- Repository caller audit (2026-08-27) found infer_risk_probabilities(integer)
-- only in its historical migration definitions; no executable app/function/cron
-- caller is committed. The seeded logistic-baseline-v1 was historically marked
-- active with training_rows = 0 and validation_auc = NULL, while the RPC also
-- manufactured missing feature values with COALESCE defaults.
--
-- Preserve the historical objects for audit/migration compatibility, but prevent
-- them from silently issuing synthetic "ML probabilities".

ALTER TABLE public.ml_model_weights
  ADD COLUMN IF NOT EXISTS model_semantics text NOT NULL DEFAULT 'unspecified',
  ADD COLUMN IF NOT EXISTS training_dataset_version text,
  ADD COLUMN IF NOT EXISTS validation_brier numeric,
  ADD COLUMN IF NOT EXISTS validation_log_loss numeric,
  ADD COLUMN IF NOT EXISTS validation_ece numeric,
  ADD COLUMN IF NOT EXISTS promotion_status text NOT NULL DEFAULT 'unverified'
    CHECK (promotion_status IN ('unverified','candidate','promoted','rejected','quarantined')),
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz,
  ADD COLUMN IF NOT EXISTS promotion_notes jsonb NOT NULL DEFAULT '{}'::jsonb;

-- The historical seed is a fixed heuristic coefficient vector, not a model that
-- has been trained and validated on the AICIS dataset.
UPDATE public.ml_model_weights
SET
  active = false,
  model_semantics = CASE
    WHEN model_version = 'logistic-baseline-v1' THEN 'historical_fixed_logistic_seed_untrained'
    ELSE model_semantics
  END,
  promotion_status = CASE
    WHEN COALESCE(training_rows, 0) <= 0 OR validation_auc IS NULL THEN 'quarantined'
    ELSE promotion_status
  END,
  promotion_notes = promotion_notes || jsonb_build_object(
    'truth_floor_reviewed_at', now(),
    'reason', CASE
      WHEN COALESCE(training_rows, 0) <= 0 THEN 'no_recorded_training_rows'
      WHEN validation_auc IS NULL THEN 'no_recorded_validation_auc'
      ELSE 'not_promoted_under_truth_floor'
    END,
    'automatic_activation_disabled', true
  )
WHERE active = true
   OR model_version = 'logistic-baseline-v1';

-- A future active model must be explicitly promoted and carry basic validation
-- evidence. More demanding promotion policy belongs in the candidate trainer;
-- this constraint is the minimum database-level integrity boundary.
ALTER TABLE public.ml_model_weights
  DROP CONSTRAINT IF EXISTS ml_model_weights_active_requires_validation;
ALTER TABLE public.ml_model_weights
  ADD CONSTRAINT ml_model_weights_active_requires_validation
  CHECK (
    NOT active
    OR (
      promotion_status = 'promoted'
      AND COALESCE(training_rows, 0) > 0
      AND validation_auc IS NOT NULL
      AND validation_brier IS NOT NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ml_model_weights_active
  ON public.ml_model_weights(active)
  WHERE active = true;

COMMENT ON COLUMN public.ml_model_weights.active IS
  'True only for an explicitly promoted model with recorded training rows and validation evidence. Historical fixed seeds are quarantined.';
COMMENT ON COLUMN public.ml_model_weights.promotion_status IS
  'Lifecycle state. Database integrity prevents active=true unless status=promoted and minimum validation evidence exists.';

-- Keep the signature for compatibility but make the legacy path fail closed.
-- The supported inference surface is the hardened run-ml-inference Edge Function,
-- which records abstentions, feature completeness, calibration semantics and
-- audit hashes. If a genuine external legacy caller still exists outside the
-- repository, it receives a clear migration error instead of synthetic output.
CREATE OR REPLACE FUNCTION public.infer_risk_probabilities(p_horizon_days integer DEFAULT 7)
RETURNS TABLE(batch_id uuid, rows_inserted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eligible_model text;
BEGIN
  IF p_horizon_days IS NULL OR p_horizon_days < 1 OR p_horizon_days > 90 THEN
    RAISE EXCEPTION 'p_horizon_days must be between 1 and 90';
  END IF;

  SELECT model_version
  INTO v_eligible_model
  FROM public.ml_model_weights
  WHERE active = true
    AND promotion_status = 'promoted'
    AND COALESCE(training_rows, 0) > 0
    AND validation_auc IS NOT NULL
    AND validation_brier IS NOT NULL
  ORDER BY promoted_at DESC NULLS LAST, trained_at DESC NULLS LAST
  LIMIT 1;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = CASE
      WHEN v_eligible_model IS NULL
        THEN 'Legacy infer_risk_probabilities is quarantined: no promoted validated model is active.'
      ELSE 'Legacy infer_risk_probabilities is quarantined even with an eligible model; migrate the caller to run-ml-inference so abstention, calibration semantics, provenance, and audit-chain controls are enforced.'
    END,
    HINT = 'Use the run-ml-inference Edge Function through its admin/trusted-worker boundary.';
END;
$$;

REVOKE ALL ON FUNCTION public.infer_risk_probabilities(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.infer_risk_probabilities(integer)
  TO service_role;

COMMENT ON FUNCTION public.infer_risk_probabilities(integer) IS
  'Quarantined historical SECURITY DEFINER inference RPC. It previously coerced missing features into numeric defaults and could use an untrained active seed. Service-only execution now fails closed with migration guidance.';
