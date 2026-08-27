-- AICIS ML Inference Truth Floor v2
--
-- This migration makes the semantics of operator-facing risk inference explicit.
-- Existing rows are preserved and marked legacy_unknown rather than retrospectively
-- claiming that historical scores were calibrated or evidence-complete.

ALTER TABLE public.risk_ml_predictions
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unknown'
    CHECK (evidence_status IN ('legacy_unknown','sufficient')),
  ADD COLUMN IF NOT EXISTS probability_semantics text NOT NULL DEFAULT 'legacy_unknown'
    CHECK (probability_semantics IN (
      'legacy_unknown',
      'uncalibrated_logistic_screen_score',
      'empirical_bin_calibrated_probability'
    )),
  ADD COLUMN IF NOT EXISTS calibration_status text NOT NULL DEFAULT 'legacy_unknown'
    CHECK (calibration_status IN (
      'legacy_unknown',
      'not_available',
      'insufficient_sample',
      'empirical_bin_sufficient'
    )),
  ADD COLUMN IF NOT EXISTS calibration_sample_size integer
    CHECK (calibration_sample_size IS NULL OR calibration_sample_size >= 0),
  ADD COLUMN IF NOT EXISTS calibration_computed_at timestamptz,
  ADD COLUMN IF NOT EXISTS interval_semantics text
    CHECK (interval_semantics IS NULL OR interval_semantics IN (
      'wilson_95_empirical_calibration_bin_rate'
    )),
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'legacy_unknown'
    CHECK (source_kind IN ('legacy_unknown','training_dataset_aicis')),
  ADD COLUMN IF NOT EXISTS source_snapshot_date date,
  ADD COLUMN IF NOT EXISTS feature_completeness numeric
    CHECK (feature_completeness IS NULL OR (feature_completeness >= 0 AND feature_completeness <= 1)),
  ADD COLUMN IF NOT EXISTS model_semantics text NOT NULL DEFAULT 'legacy_unknown'
    CHECK (model_semantics IN ('legacy_unknown','fixed_logistic_screen'));

CREATE INDEX IF NOT EXISTS idx_risk_ml_predictions_evidence
  ON public.risk_ml_predictions(evidence_status, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_ml_predictions_calibration
  ON public.risk_ml_predictions(calibration_status, generated_at DESC);

CREATE TABLE IF NOT EXISTS public.ml_inference_abstentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_batch_id uuid NOT NULL,
  country_iso3 text,
  domain text,
  horizon_days integer NOT NULL,
  source_kind text NOT NULL,
  source_snapshot_date date,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  missing_features text[] NOT NULL DEFAULT '{}',
  feature_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_version text,
  model_semantics text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ml_inference_abstentions_batch
  ON public.ml_inference_abstentions(generation_batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ml_inference_abstentions_subject
  ON public.ml_inference_abstentions(country_iso3, domain, created_at DESC);

ALTER TABLE public.ml_inference_abstentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read ML inference abstentions"
  ON public.ml_inference_abstentions;
CREATE POLICY "Authenticated read ML inference abstentions"
  ON public.ml_inference_abstentions
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role writes ML inference abstentions"
  ON public.ml_inference_abstentions;
CREATE POLICY "Service role writes ML inference abstentions"
  ON public.ml_inference_abstentions
  FOR INSERT TO service_role
  WITH CHECK (true);

GRANT SELECT ON public.ml_inference_abstentions TO authenticated;
GRANT SELECT, INSERT ON public.ml_inference_abstentions TO service_role;

-- The generic reject_mutation() trigger function already exists in the source
-- schema. Keep abstention evidence append-only so an operator can audit why a
-- score was deliberately not issued.
DROP TRIGGER IF EXISTS trg_ml_inference_abstentions_immutable
  ON public.ml_inference_abstentions;
CREATE TRIGGER trg_ml_inference_abstentions_immutable
  BEFORE UPDATE OR DELETE ON public.ml_inference_abstentions
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

COMMENT ON COLUMN public.risk_ml_predictions.risk_probability IS
  'Compatibility score column. Interpret only through probability_semantics: it may be an uncalibrated screening score rather than a probability.';
COMMENT ON COLUMN public.risk_ml_predictions.calibrated_score IS
  'Populated only when an empirical calibration bin satisfies the configured governance sample threshold; otherwise NULL.';
COMMENT ON COLUMN public.risk_ml_predictions.prediction_interval_lower IS
  'Compatibility interval column. When interval_semantics is set, this is the lower Wilson bound for the empirical calibration-bin event rate, not a per-case prediction interval.';
COMMENT ON COLUMN public.risk_ml_predictions.prediction_interval_upper IS
  'Compatibility interval column. When interval_semantics is set, this is the upper Wilson bound for the empirical calibration-bin event rate, not a per-case prediction interval.';
COMMENT ON COLUMN public.risk_ml_predictions.model_semantics IS
  'Declares whether the scoring function is a fixed screening rule or a validated/trained model. v2 currently permits fixed_logistic_screen only for new rows.';
COMMENT ON TABLE public.ml_inference_abstentions IS
  'Append-only record of cases where AICIS withheld an inference instead of fabricating missing features or certainty.';
