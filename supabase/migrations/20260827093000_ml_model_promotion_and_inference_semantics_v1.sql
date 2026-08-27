-- AICIS Human-Gated Model Promotion + Trained Inference Semantics v1
--
-- Training does not imply activation. A candidate may be promoted only through
-- an explicit admin-facing operation after temporal validation/test evidence is
-- present and both held-out splits beat the train-base-rate Brier reference.

-- Extend the model lifecycle with an explicit retired champion state.
ALTER TABLE public.ml_model_weights
  DROP CONSTRAINT IF EXISTS ml_model_weights_promotion_status_check;
ALTER TABLE public.ml_model_weights
  ADD CONSTRAINT ml_model_weights_promotion_status_check
  CHECK (promotion_status IN (
    'unverified','candidate','promoted','retired','rejected','quarantined'
  ));

-- New trained-model predictions need semantics distinct from both a fixed
-- screening score and an empirically recalibrated bin probability.
ALTER TABLE public.risk_ml_predictions
  DROP CONSTRAINT IF EXISTS risk_ml_predictions_probability_semantics_check;
ALTER TABLE public.risk_ml_predictions
  ADD CONSTRAINT risk_ml_predictions_probability_semantics_check
  CHECK (probability_semantics IN (
    'legacy_unknown',
    'uncalibrated_logistic_screen_score',
    'empirical_bin_calibrated_probability',
    'trained_logistic_probability_estimate'
  ));

ALTER TABLE public.risk_ml_predictions
  DROP CONSTRAINT IF EXISTS risk_ml_predictions_calibration_status_check;
ALTER TABLE public.risk_ml_predictions
  ADD CONSTRAINT risk_ml_predictions_calibration_status_check
  CHECK (calibration_status IN (
    'legacy_unknown',
    'not_available',
    'insufficient_sample',
    'empirical_bin_sufficient',
    'model_level_validation_only'
  ));

ALTER TABLE public.risk_ml_predictions
  DROP CONSTRAINT IF EXISTS risk_ml_predictions_model_semantics_check;
ALTER TABLE public.risk_ml_predictions
  ADD CONSTRAINT risk_ml_predictions_model_semantics_check
  CHECK (model_semantics IN (
    'legacy_unknown',
    'fixed_logistic_screen',
    'trained_logistic_temporal_holdout_v1'
  ));

ALTER TABLE public.risk_ml_predictions
  ADD COLUMN IF NOT EXISTS training_run_id uuid
    REFERENCES public.ml_model_training_runs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_risk_ml_predictions_training_run
  ON public.risk_ml_predictions(training_run_id, generated_at DESC);

COMMENT ON COLUMN public.risk_ml_predictions.probability_semantics IS
  'trained_logistic_probability_estimate means a genuine held-out-evaluated logistic probability estimate; it is not called empirically calibrated unless a separate calibration layer is actually applied.';
COMMENT ON COLUMN public.risk_ml_predictions.training_run_id IS
  'For trained models, links the prediction to the immutable training manifest and held-out evaluation that produced the promoted weights.';

CREATE TABLE IF NOT EXISTS public.ml_model_promotion_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version text NOT NULL,
  training_run_id uuid REFERENCES public.ml_model_training_runs(id) ON DELETE SET NULL,
  previous_active_model_version text,
  decision text NOT NULL CHECK (decision IN ('promote','reject')),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  manifest_checksum text NOT NULL,
  evidence jsonb NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ml_model_promotion_audit_model
  ON public.ml_model_promotion_audit(model_version, decided_at DESC);

ALTER TABLE public.ml_model_promotion_audit ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.ml_model_promotion_audit TO authenticated;
GRANT ALL ON public.ml_model_promotion_audit TO service_role;

DROP POLICY IF EXISTS "Operators inspect ML promotion audit"
  ON public.ml_model_promotion_audit;
CREATE POLICY "Operators inspect ML promotion audit"
  ON public.ml_model_promotion_audit FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'operator'::app_role)
  );

CREATE OR REPLACE FUNCTION public.promote_ml_model_candidate(
  p_model_version text,
  p_actor_user_id uuid,
  p_expected_manifest_checksum text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_model public.ml_model_weights%ROWTYPE;
  v_run public.ml_model_training_runs%ROWTYPE;
  v_previous text;
  v_val_skill numeric;
  v_test_skill numeric;
  v_val_auc numeric;
  v_test_auc numeric;
BEGIN
  IF p_model_version IS NULL OR length(trim(p_model_version)) = 0 THEN
    RAISE EXCEPTION 'p_model_version is required';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'human admin actor is required';
  END IF;
  IF p_expected_manifest_checksum IS NULL OR length(trim(p_expected_manifest_checksum)) = 0 THEN
    RAISE EXCEPTION 'expected manifest checksum is required';
  END IF;

  SELECT * INTO v_model
  FROM public.ml_model_weights
  WHERE model_version = p_model_version
  FOR UPDATE;

  IF v_model.id IS NULL THEN
    RAISE EXCEPTION 'model % does not exist', p_model_version;
  END IF;
  IF v_model.active THEN
    RAISE EXCEPTION 'model % is already active', p_model_version;
  END IF;
  IF v_model.promotion_status <> 'candidate' THEN
    RAISE EXCEPTION 'model % is %, not candidate', p_model_version, v_model.promotion_status;
  END IF;
  IF v_model.training_run_id IS NULL THEN
    RAISE EXCEPTION 'model % has no training-run lineage', p_model_version;
  END IF;

  SELECT * INTO v_run
  FROM public.ml_model_training_runs
  WHERE id = v_model.training_run_id
  FOR UPDATE;

  IF v_run.id IS NULL OR v_run.status <> 'completed' THEN
    RAISE EXCEPTION 'candidate training run is not completed';
  END IF;
  IF v_run.model_version <> p_model_version THEN
    RAISE EXCEPTION 'training run/model version mismatch';
  END IF;
  IF v_run.manifest_checksum IS NULL OR v_run.manifest_checksum <> p_expected_manifest_checksum THEN
    RAISE EXCEPTION 'training manifest checksum mismatch';
  END IF;
  IF v_run.train_rows < 200 OR v_run.validation_rows < 50 OR v_run.test_rows < 50 THEN
    RAISE EXCEPTION 'held-out split sizes do not meet promotion floor';
  END IF;

  v_val_skill := NULLIF(v_run.validation_metrics->>'brier_skill_vs_train_base_rate', '')::numeric;
  v_test_skill := NULLIF(v_run.test_metrics->>'brier_skill_vs_train_base_rate', '')::numeric;
  v_val_auc := NULLIF(v_run.validation_metrics->>'auc', '')::numeric;
  v_test_auc := NULLIF(v_run.test_metrics->>'auc', '')::numeric;

  IF v_val_skill IS NULL OR v_val_skill <= 0 THEN
    RAISE EXCEPTION 'validation Brier skill must be positive versus train base rate';
  END IF;
  IF v_test_skill IS NULL OR v_test_skill <= 0 THEN
    RAISE EXCEPTION 'test Brier skill must be positive versus train base rate';
  END IF;
  IF v_val_auc IS NULL OR v_val_auc <= 0.5 THEN
    RAISE EXCEPTION 'validation AUC must exceed chance';
  END IF;
  IF v_test_auc IS NULL OR v_test_auc <= 0.5 THEN
    RAISE EXCEPTION 'test AUC must exceed chance';
  END IF;
  IF v_model.validation_brier IS NULL OR v_model.validation_auc IS NULL THEN
    RAISE EXCEPTION 'model registry is missing validation evidence';
  END IF;

  SELECT model_version INTO v_previous
  FROM public.ml_model_weights
  WHERE active = true
  ORDER BY promoted_at DESC NULLS LAST, trained_at DESC NULLS LAST
  LIMIT 1
  FOR UPDATE;

  IF v_previous IS NOT NULL THEN
    UPDATE public.ml_model_weights
    SET
      active = false,
      promotion_status = 'retired',
      promotion_notes = promotion_notes || jsonb_build_object(
        'retired_at', now(),
        'replaced_by', p_model_version
      )
    WHERE model_version = v_previous;
  END IF;

  UPDATE public.ml_model_weights
  SET
    active = true,
    promotion_status = 'promoted',
    promoted_at = now(),
    promotion_notes = promotion_notes || jsonb_build_object(
      'promoted_at', now(),
      'promoted_by', p_actor_user_id,
      'manifest_checksum_verified', p_expected_manifest_checksum,
      'validation_brier_skill', v_val_skill,
      'test_brier_skill', v_test_skill,
      'validation_auc', v_val_auc,
      'test_auc', v_test_auc,
      'automatic_promotion', false
    )
  WHERE model_version = p_model_version;

  INSERT INTO public.ml_model_promotion_audit (
    model_version,
    training_run_id,
    previous_active_model_version,
    decision,
    actor_user_id,
    manifest_checksum,
    evidence
  ) VALUES (
    p_model_version,
    v_model.training_run_id,
    v_previous,
    'promote',
    p_actor_user_id,
    p_expected_manifest_checksum,
    jsonb_build_object(
      'validation_metrics', v_run.validation_metrics,
      'test_metrics', v_run.test_metrics,
      'train_rows', v_run.train_rows,
      'validation_rows', v_run.validation_rows,
      'test_rows', v_run.test_rows,
      'feature_version', v_run.feature_version,
      'split_strategy', v_run.split_strategy,
      'model_semantics', v_model.model_semantics,
      'manual_human_gate', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'model_version', p_model_version,
    'promotion_status', 'promoted',
    'active', true,
    'previous_active_model_version', v_previous,
    'training_run_id', v_model.training_run_id,
    'manifest_checksum', p_expected_manifest_checksum,
    'validation_brier_skill', v_val_skill,
    'test_brier_skill', v_test_skill,
    'validation_auc', v_val_auc,
    'test_auc', v_test_auc
  );
END;
$$;

REVOKE ALL ON FUNCTION public.promote_ml_model_candidate(text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_ml_model_candidate(text, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.promote_ml_model_candidate(text, uuid, text) IS
  'Atomic service-only promotion primitive intended behind a human-admin Edge Function. Requires completed immutable lineage, checksum match, minimum temporal split sizes, positive held-out Brier skill versus train base rate, and AUC above chance. Never scheduled automatically.';
