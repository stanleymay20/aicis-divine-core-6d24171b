-- AICIS Forecast Epistemics v1
-- Separates observed evidence, base rates, model estimates, uncertainty,
-- graph support, counterfactuals, and abstention. No synthetic outcome
-- generation is permitted in the calibration path.

ALTER TABLE public.risk_predictions
  ADD COLUMN IF NOT EXISTS base_rate_probability numeric
    CHECK (base_rate_probability IS NULL OR (base_rate_probability >= 0 AND base_rate_probability <= 100)),
  ADD COLUMN IF NOT EXISTS calibration_trust numeric
    CHECK (calibration_trust IS NULL OR (calibration_trust >= 0 AND calibration_trust <= 100)),
  ADD COLUMN IF NOT EXISTS calibration_sample_size integer
    CHECK (calibration_sample_size IS NULL OR calibration_sample_size >= 0),
  ADD COLUMN IF NOT EXISTS evidence_sufficiency numeric
    CHECK (evidence_sufficiency IS NULL OR (evidence_sufficiency >= 0 AND evidence_sufficiency <= 100)),
  ADD COLUMN IF NOT EXISTS uncertainty_low numeric
    CHECK (uncertainty_low IS NULL OR (uncertainty_low >= 0 AND uncertainty_low <= 100)),
  ADD COLUMN IF NOT EXISTS uncertainty_high numeric
    CHECK (uncertainty_high IS NULL OR (uncertainty_high >= 0 AND uncertainty_high <= 100)),
  ADD COLUMN IF NOT EXISTS forecast_horizon_at timestamptz,
  ADD COLUMN IF NOT EXISTS regime_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS graph_pathways jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS counterfactuals jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS assumptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS trigger_conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_independence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS forecast_status text NOT NULL DEFAULT 'issued'
    CHECK (forecast_status IN ('issued','abstained','superseded','resolved')),
  ADD COLUMN IF NOT EXISTS outcome_tracking_id uuid
    REFERENCES public.aicis_prediction_outcomes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_risk_predictions_forecast_status
  ON public.risk_predictions(forecast_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_predictions_horizon
  ON public.risk_predictions(forecast_horizon_at)
  WHERE forecast_horizon_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_risk_predictions_outcome_tracking
  ON public.risk_predictions(outcome_tracking_id)
  WHERE outcome_tracking_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.forecast_abstentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  affected_divisions text[] NOT NULL DEFAULT '{}',
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  evidence_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_sufficiency numeric
    CHECK (evidence_sufficiency IS NULL OR (evidence_sufficiency >= 0 AND evidence_sufficiency <= 100)),
  source_independence jsonb NOT NULL DEFAULT '{}'::jsonb,
  calibration_context jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_provider text,
  model_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forecast_abstentions_user_time
  ON public.forecast_abstentions(requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forecast_abstentions_time
  ON public.forecast_abstentions(created_at DESC);

ALTER TABLE public.forecast_abstentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own forecast abstentions" ON public.forecast_abstentions;
CREATE POLICY "Users read own forecast abstentions"
  ON public.forecast_abstentions FOR SELECT TO authenticated
  USING (requested_by = auth.uid());

DROP POLICY IF EXISTS "Service role manages forecast abstentions" ON public.forecast_abstentions;
CREATE POLICY "Service role manages forecast abstentions"
  ON public.forecast_abstentions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.forecast_abstentions TO authenticated;
GRANT ALL ON public.forecast_abstentions TO service_role;

-- Observed base rates only. These labels are produced after the forecast horizon
-- from country_performance_snapshots; no random/simulated outcome is admitted.
CREATE OR REPLACE VIEW public.forecast_domain_base_rates
WITH (security_invoker = true)
AS
SELECT
  r.domain,
  COUNT(*)::integer AS observed_count,
  AVG(r.actual_label::numeric) AS observed_positive_rate,
  AVG(r.brier_score) AS mean_brier_score,
  MIN(r.realized_at) AS window_start,
  MAX(r.realized_at) AS last_realized_at
FROM public.risk_prediction_realizations r
WHERE r.realized_at >= now() - interval '180 days'
GROUP BY r.domain;

CREATE OR REPLACE VIEW public.forecast_calibration_context
WITH (security_invoker = true)
AS
SELECT
  COALESCE(b.domain, d.domain) AS domain,
  COALESCE(b.observed_count, 0) AS observed_count,
  b.observed_positive_rate,
  b.mean_brier_score,
  b.window_start,
  b.last_realized_at,
  d.trust_score,
  d.brier_score AS latest_brier_score,
  d.accuracy AS latest_accuracy,
  d.calibration_error,
  COALESCE(d.sample_size, 0) AS calibration_sample_size,
  d.model_version AS calibration_model_version,
  d.updated_at AS calibration_updated_at
FROM public.forecast_domain_base_rates b
FULL OUTER JOIN public.domain_trust_scores d
  ON d.domain = b.domain;

GRANT SELECT ON public.forecast_domain_base_rates TO authenticated, service_role;
GRANT SELECT ON public.forecast_calibration_context TO authenticated, service_role;

-- The legacy calibration cycle generated "realized" values with random().
-- Preserve historical rows for audit, but permanently stop that write path.
CREATE OR REPLACE FUNCTION public.run_adaptive_calibration_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.automation_logs(job_name, status, message)
  VALUES (
    'adaptive-reinforcement-calibration-engine',
    'warning',
    'disabled: synthetic/random realized outcomes are prohibited; use observed realization pipelines'
  );

  RETURN jsonb_build_object(
    'status', 'disabled',
    'reason', 'synthetic_outcomes_prohibited',
    'replacement', 'risk_prediction_realizations + forecast_calibration_context',
    'disabled_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_adaptive_calibration_cycle() FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.run_adaptive_calibration_cycle() TO service_role;

COMMENT ON FUNCTION public.run_adaptive_calibration_cycle() IS
  'Disabled compatibility stub. Legacy implementation generated synthetic realized outcomes using random(); AICIS calibration must use observed outcomes only.';

COMMENT ON VIEW public.forecast_domain_base_rates IS
  'Observed 180-day realized deterioration base rates by domain; excludes synthetic calibration tables.';
COMMENT ON VIEW public.forecast_calibration_context IS
  'Observed base rates joined to empirically measured model trust/calibration context.';
