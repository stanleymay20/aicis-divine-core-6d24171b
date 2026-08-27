-- AICIS Model Cortex Epistemic Truth Floor v1
--
-- Purpose:
-- * Unknown model quality, confidence, disagreement and latency stay NULL.
-- * Legacy numeric values are preserved but explicitly marked as semantically
--   unverified unless a writer supplied a stronger interpretation.
-- * A model probability is not automatically a calibrated probability.
-- * Ensemble aggregation status and weighting semantics are auditable.

-- ---------------------------------------------------------------------------
-- Model competency: zero must mean measured zero, never "unknown".
-- ---------------------------------------------------------------------------
ALTER TABLE public.aicis_model_competency
  ALTER COLUMN competence DROP DEFAULT,
  ALTER COLUMN competence DROP NOT NULL,
  ALTER COLUMN calibration DROP DEFAULT,
  ALTER COLUMN calibration DROP NOT NULL,
  ALTER COLUMN reliability DROP DEFAULT,
  ALTER COLUMN reliability DROP NOT NULL,
  ALTER COLUMN latency_ms_p95 DROP DEFAULT,
  ALTER COLUMN latency_ms_p95 DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS competence_semantics text,
  ADD COLUMN IF NOT EXISTS calibration_semantics text,
  ADD COLUMN IF NOT EXISTS reliability_semantics text,
  ADD COLUMN IF NOT EXISTS latency_semantics text,
  ADD COLUMN IF NOT EXISTS brier_score_semantics text,
  ADD COLUMN IF NOT EXISTS ece_semantics text,
  ADD COLUMN IF NOT EXISTS evaluation_status text,
  ADD COLUMN IF NOT EXISTS evaluation_method text;

UPDATE public.aicis_model_competency
SET competence_semantics = 'legacy_numeric_semantics_unverified'
WHERE competence IS NOT NULL AND competence_semantics IS NULL;
UPDATE public.aicis_model_competency
SET calibration_semantics = 'legacy_numeric_semantics_unverified'
WHERE calibration IS NOT NULL AND calibration_semantics IS NULL;
UPDATE public.aicis_model_competency
SET reliability_semantics = 'legacy_numeric_semantics_unverified'
WHERE reliability IS NOT NULL AND reliability_semantics IS NULL;
UPDATE public.aicis_model_competency
SET latency_semantics = 'legacy_latency_semantics_unverified'
WHERE latency_ms_p95 IS NOT NULL AND latency_semantics IS NULL;
UPDATE public.aicis_model_competency
SET brier_score_semantics = 'legacy_metric_semantics_unverified'
WHERE brier_score IS NOT NULL AND brier_score_semantics IS NULL;
UPDATE public.aicis_model_competency
SET ece_semantics = 'legacy_metric_semantics_unverified'
WHERE ece IS NOT NULL AND ece_semantics IS NULL;
UPDATE public.aicis_model_competency
SET evaluation_status = 'legacy_evaluation_status_unverified'
WHERE evaluation_status IS NULL;

-- ---------------------------------------------------------------------------
-- Individual model predictions and execution outputs.
-- ---------------------------------------------------------------------------
ALTER TABLE public.aicis_model_predictions
  ALTER COLUMN confidence DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS probability_semantics text,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS calibration_status text,
  ADD COLUMN IF NOT EXISTS evidence_status text;

UPDATE public.aicis_model_predictions
SET probability_semantics = 'legacy_probability_semantics_unverified'
WHERE probability IS NOT NULL AND probability_semantics IS NULL;
UPDATE public.aicis_model_predictions
SET confidence_semantics = 'legacy_numeric_semantics_unverified'
WHERE confidence IS NOT NULL AND confidence_semantics IS NULL;
UPDATE public.aicis_model_predictions
SET calibration_status = 'legacy_calibration_status_unknown'
WHERE calibration_status IS NULL;
UPDATE public.aicis_model_predictions
SET evidence_status = 'legacy_evidence_status_unknown'
WHERE evidence_status IS NULL;

ALTER TABLE public.aicis_model_execution_outputs
  ALTER COLUMN confidence DROP NOT NULL,
  ALTER COLUMN latency_ms DROP DEFAULT,
  ALTER COLUMN latency_ms DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS probability_semantics text,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS latency_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text;

UPDATE public.aicis_model_execution_outputs
SET probability_semantics = 'legacy_probability_semantics_unverified'
WHERE probability IS NOT NULL AND probability_semantics IS NULL;
UPDATE public.aicis_model_execution_outputs
SET confidence_semantics = 'legacy_numeric_semantics_unverified'
WHERE confidence IS NOT NULL AND confidence_semantics IS NULL;
UPDATE public.aicis_model_execution_outputs
SET latency_semantics = 'legacy_latency_semantics_unverified'
WHERE latency_ms IS NOT NULL AND latency_semantics IS NULL;
UPDATE public.aicis_model_execution_outputs
SET evidence_status = 'legacy_evidence_status_unknown'
WHERE evidence_status IS NULL;

-- ---------------------------------------------------------------------------
-- Model outcomes: direct metrics carry their own semantics.
-- ---------------------------------------------------------------------------
ALTER TABLE public.aicis_model_outcomes
  ADD COLUMN IF NOT EXISTS brier_score_semantics text,
  ADD COLUMN IF NOT EXISTS absolute_error_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text;

UPDATE public.aicis_model_outcomes
SET brier_score_semantics = 'legacy_metric_semantics_unverified'
WHERE brier_score IS NOT NULL AND brier_score_semantics IS NULL;
UPDATE public.aicis_model_outcomes
SET absolute_error_semantics = 'legacy_metric_semantics_unverified'
WHERE absolute_error IS NOT NULL AND absolute_error_semantics IS NULL;
UPDATE public.aicis_model_outcomes
SET evidence_status = 'legacy_outcome_evidence_status_unknown'
WHERE evidence_status IS NULL;

-- ---------------------------------------------------------------------------
-- Ensemble predictions: aggregation may abstain and disagreement may be unknown.
-- ---------------------------------------------------------------------------
ALTER TABLE public.aicis_ensemble_predictions
  ALTER COLUMN confidence DROP NOT NULL,
  ALTER COLUMN disagreement DROP DEFAULT,
  ALTER COLUMN disagreement DROP NOT NULL,
  ALTER COLUMN spread DROP DEFAULT,
  ALTER COLUMN spread DROP NOT NULL,
  ALTER COLUMN high_disagreement DROP DEFAULT,
  ALTER COLUMN high_disagreement DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS probability_semantics text,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS disagreement_semantics text,
  ADD COLUMN IF NOT EXISTS aggregation_status text,
  ADD COLUMN IF NOT EXISTS weight_semantics text,
  ADD COLUMN IF NOT EXISTS calibration_status text,
  ADD COLUMN IF NOT EXISTS evidence_status text;

UPDATE public.aicis_ensemble_predictions
SET probability_semantics = 'legacy_probability_semantics_unverified'
WHERE probability IS NOT NULL AND probability_semantics IS NULL;
UPDATE public.aicis_ensemble_predictions
SET confidence_semantics = 'legacy_numeric_semantics_unverified'
WHERE confidence IS NOT NULL AND confidence_semantics IS NULL;
UPDATE public.aicis_ensemble_predictions
SET disagreement_semantics = 'legacy_disagreement_semantics_unverified'
WHERE (disagreement IS NOT NULL OR spread IS NOT NULL) AND disagreement_semantics IS NULL;
UPDATE public.aicis_ensemble_predictions
SET aggregation_status = 'legacy_aggregation_status_unknown'
WHERE aggregation_status IS NULL;
UPDATE public.aicis_ensemble_predictions
SET weight_semantics = 'legacy_weight_semantics_unverified'
WHERE weight_semantics IS NULL;
UPDATE public.aicis_ensemble_predictions
SET calibration_status = 'legacy_calibration_status_unknown'
WHERE calibration_status IS NULL;
UPDATE public.aicis_ensemble_predictions
SET evidence_status = 'legacy_evidence_status_unknown'
WHERE evidence_status IS NULL;

-- ---------------------------------------------------------------------------
-- Routing decisions need explicit score/evidence semantics.
-- ---------------------------------------------------------------------------
ALTER TABLE public.aicis_model_routing_decisions
  ADD COLUMN IF NOT EXISTS score_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text;

UPDATE public.aicis_model_routing_decisions
SET score_semantics = 'legacy_routing_score_semantics_unverified'
WHERE score_semantics IS NULL;
UPDATE public.aicis_model_routing_decisions
SET evidence_status = 'legacy_evidence_status_unknown'
WHERE evidence_status IS NULL;

COMMENT ON COLUMN public.aicis_model_competency.competence IS
  'Nullable measured or explicitly derived competency metric. NULL means not quantified. Inspect competence_semantics and evaluation_status.';
COMMENT ON COLUMN public.aicis_model_competency.calibration IS
  'Nullable calibration quality metric. NULL means not quantified. A zero value must be an observed/evaluated zero, never a default.';
COMMENT ON COLUMN public.aicis_model_competency.reliability IS
  'Nullable measured reliability metric. NULL means not quantified; inspect reliability_semantics.';
COMMENT ON COLUMN public.aicis_model_competency.brier_score IS
  'Direct mean Brier score when evaluated on realized binary probabilistic outcomes. Inspect brier_score_semantics and sample_size.';
COMMENT ON COLUMN public.aicis_model_competency.ece IS
  'Direct expected calibration error when enough realized probabilistic outcomes exist. Inspect ece_semantics and sample_size.';
COMMENT ON COLUMN public.aicis_model_predictions.probability IS
  'Nullable model output in [0,1]. It is only a calibrated empirical probability when probability_semantics and calibration_status explicitly establish that interpretation.';
COMMENT ON COLUMN public.aicis_model_predictions.confidence IS
  'Nullable analytical/model confidence. NULL means not issued. Never infer confidence from probability magnitude or model agreement.';
COMMENT ON COLUMN public.aicis_model_outcomes.brier_score IS
  'Nullable per-prediction Brier score, computed only when the stored prediction semantics establish a probabilistic output and a binary outcome exists.';
COMMENT ON COLUMN public.aicis_ensemble_predictions.probability IS
  'Nullable ensemble probability-like output. Aggregation alone does not make the ensemble calibrated; inspect probability_semantics and calibration_status.';
COMMENT ON COLUMN public.aicis_ensemble_predictions.confidence IS
  'Nullable ensemble confidence. Truth-floor aggregation does not synthesize confidence from self-reported member confidence.';
COMMENT ON COLUMN public.aicis_ensemble_predictions.disagreement IS
  'Nullable deterministic member-output disagreement statistic. It is not confidence and requires at least two usable comparable probabilistic members.';
COMMENT ON COLUMN public.aicis_ensemble_predictions.spread IS
  'Nullable max-minus-min member probability spread. It is not confidence and requires at least two usable comparable probabilistic members.';
COMMENT ON COLUMN public.aicis_ensemble_predictions.high_disagreement IS
  'Nullable threshold flag. NULL means disagreement was not assessable because fewer than two usable probabilistic members were available.';
