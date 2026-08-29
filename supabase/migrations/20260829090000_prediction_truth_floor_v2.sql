-- AICIS Prediction Truth Floor v2
--
-- Goals:
--   * preserve genuine before-the-fact predictions as immutable evidence;
--   * score outcomes at the declared forecast horizon, never against "latest/now";
--   * treat missing/insufficient evidence as abstention, never as a negative label;
--   * quarantine suspicious boundary discontinuities rather than calling them hits;
--   * separate internal derived-index outcomes from externally verified real-world events;
--   * provide an independent truth-floor evaluator for deterministic prospective forecasts.
--
-- This migration is additive. It does NOT enable cron jobs, writers, cutover, or target activation.

-- -----------------------------------------------------------------------------
-- 1. Preserve sealed risk predictions once they enter the prospective ledger.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_sealed_risk_prediction_truth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.prediction_ledger l
    WHERE l.source_row_id::text = OLD.id::text
      AND l.source_table = 'risk_ranking_predictions'
      AND l.seal_mode = 'prospective'
      AND l.prospective_eligible IS TRUE
  ) AND (
    NEW.generated_at IS DISTINCT FROM OLD.generated_at
    OR NEW.risk_probability IS DISTINCT FROM OLD.risk_probability
    OR NEW.horizon_days IS DISTINCT FROM OLD.horizon_days
    OR NEW.country_iso3 IS DISTINCT FROM OLD.country_iso3
    OR NEW.domain IS DISTINCT FROM OLD.domain
    OR NEW.model_version IS DISTINCT FROM OLD.model_version
    OR NEW.probability_semantics IS DISTINCT FROM OLD.probability_semantics
    OR NEW.source_snapshot_date IS DISTINCT FROM OLD.source_snapshot_date
  ) THEN
    RAISE EXCEPTION 'sealed prospective prediction truth fields are immutable for prediction %', OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_sealed_risk_prediction_truth
  ON public.risk_ranking_predictions;
CREATE TRIGGER trg_protect_sealed_risk_prediction_truth
BEFORE UPDATE ON public.risk_ranking_predictions
FOR EACH ROW
EXECUTE FUNCTION public.protect_sealed_risk_prediction_truth();

REVOKE ALL ON FUNCTION public.protect_sealed_risk_prediction_truth() FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 2. Truth-floor realization surface for deterministic prospective forecasts.
--    This is deliberately independent of historical forecast evaluation rows.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.forecast_truth_floor_realizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_evaluation_id text NOT NULL UNIQUE,
  forecast_id text,
  domain text NOT NULL,
  iso3 text NOT NULL,
  model_version text,
  horizon_days integer NOT NULL CHECK (horizon_days > 0),
  predicted_at timestamptz NOT NULL,
  realization_due_at timestamptz NOT NULL,
  source_snapshot_date date,
  prediction_snapshot_date date,
  outcome_snapshot_date date,
  outcome_lag_days integer,
  predicted_value numeric,
  prediction_value_at_origin numeric,
  outcome_value numeric,
  predicted_direction text,
  actual_direction text,
  direction_hit boolean,
  absolute_error numeric,
  baseline_sample_size integer,
  baseline_std numeric,
  status text NOT NULL CHECK (status IN (
    'resolved',
    'missing_prediction_snapshot',
    'missing_horizon_observation',
    'insufficient_baseline_history',
    'unmeasurable_baseline_variance',
    'suspicious_discontinuity'
  )),
  outcome_semantics text NOT NULL DEFAULT 'derived_country_performance_index',
  direction_semantics text NOT NULL DEFAULT 'change_exceeding_one_pre_prediction_standard_deviation_v1',
  resolution_method text NOT NULL DEFAULT 'target_horizon_first_observation_bounded_lag_v2',
  resolution_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  realized_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forecast_truth_floor_model_domain
  ON public.forecast_truth_floor_realizations(model_version, domain, horizon_days, realized_at DESC);
CREATE INDEX IF NOT EXISTS idx_forecast_truth_floor_status
  ON public.forecast_truth_floor_realizations(status, realized_at DESC);
CREATE INDEX IF NOT EXISTS idx_forecast_truth_floor_outcome_date
  ON public.forecast_truth_floor_realizations(outcome_snapshot_date DESC);

ALTER TABLE public.forecast_truth_floor_realizations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.forecast_truth_floor_realizations TO authenticated;
GRANT ALL ON public.forecast_truth_floor_realizations TO service_role;

DROP POLICY IF EXISTS "Operators inspect forecast truth floor"
  ON public.forecast_truth_floor_realizations;
CREATE POLICY "Operators inspect forecast truth floor"
  ON public.forecast_truth_floor_realizations
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'operator'::app_role)
  );

DROP POLICY IF EXISTS "Service role manages forecast truth floor"
  ON public.forecast_truth_floor_realizations;
CREATE POLICY "Service role manages forecast truth floor"
  ON public.forecast_truth_floor_realizations
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.realize_forecast_truth_floor(
  p_limit integer DEFAULT 5000,
  p_max_outcome_lag_days integer DEFAULT 7,
  p_min_baseline_observations integer DEFAULT 10
)
RETURNS TABLE(resolved integer, abstained integer, quarantined integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 5000';
  END IF;
  IF p_max_outcome_lag_days IS NULL OR p_max_outcome_lag_days < 0 OR p_max_outcome_lag_days > 30 THEN
    RAISE EXCEPTION 'p_max_outcome_lag_days must be between 0 and 30';
  END IF;
  IF p_min_baseline_observations IS NULL OR p_min_baseline_observations < 2 THEN
    RAISE EXCEPTION 'p_min_baseline_observations must be >= 2';
  END IF;

  WITH due AS (
    SELECT
      e.id::text AS source_evaluation_id,
      e.forecast_id::text AS forecast_id,
      e.domain,
      e.iso3,
      e.model_version,
      e.horizon_days,
      e.predicted_value::numeric AS predicted_value,
      e.predicted_direction,
      e.predicted_at,
      e.realization_due_at,
      NULLIF(e.metadata ->> 'source_snapshot_date', '')::date AS source_snapshot_date
    FROM public.forecast_prospective_evaluations e
    LEFT JOIN public.forecast_truth_floor_realizations r
      ON r.source_evaluation_id = e.id::text
    WHERE r.id IS NULL
      AND e.predicted_at IS NOT NULL
      AND e.realization_due_at IS NOT NULL
      AND e.predicted_at < e.realization_due_at
      AND e.realization_due_at <= v_now
    ORDER BY e.realization_due_at ASC
    LIMIT p_limit
  ),
  observed AS (
    SELECT
      d.*,
      ps.snapshot_date AS prediction_snapshot_date,
      ps.performance_index::numeric AS prediction_value_at_origin,
      os.snapshot_date AS outcome_snapshot_date,
      os.performance_index::numeric AS outcome_value,
      CASE WHEN os.snapshot_date IS NULL THEN NULL
           ELSE os.snapshot_date - d.realization_due_at::date END AS outcome_lag_days,
      bs.baseline_n,
      bs.baseline_std
    FROM due d
    LEFT JOIN LATERAL (
      SELECT s.snapshot_date, s.performance_index
      FROM public.country_performance_snapshots s
      WHERE s.iso3 = d.iso3
        AND s.domain = d.domain
        AND s.performance_index IS NOT NULL
        AND (
          (d.source_snapshot_date IS NOT NULL AND s.snapshot_date = d.source_snapshot_date)
          OR
          (d.source_snapshot_date IS NULL
            AND s.snapshot_date <= d.predicted_at::date
            AND s.snapshot_date >= d.predicted_at::date - 14)
        )
      ORDER BY s.snapshot_date DESC
      LIMIT 1
    ) ps ON true
    LEFT JOIN LATERAL (
      SELECT s.snapshot_date, s.performance_index
      FROM public.country_performance_snapshots s
      WHERE s.iso3 = d.iso3
        AND s.domain = d.domain
        AND s.performance_index IS NOT NULL
        AND s.snapshot_date >= d.realization_due_at::date
        AND s.snapshot_date <= d.realization_due_at::date + p_max_outcome_lag_days
      ORDER BY s.snapshot_date ASC
      LIMIT 1
    ) os ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(s.performance_index)::integer AS baseline_n,
        STDDEV_SAMP(s.performance_index)::numeric AS baseline_std
      FROM public.country_performance_snapshots s
      WHERE ps.snapshot_date IS NOT NULL
        AND s.iso3 = d.iso3
        AND s.domain = d.domain
        AND s.performance_index IS NOT NULL
        AND s.snapshot_date BETWEEN ps.snapshot_date - 90 AND ps.snapshot_date
    ) bs ON true
  ),
  classified AS (
    SELECT
      o.*,
      CASE
        WHEN o.prediction_snapshot_date IS NULL OR o.prediction_value_at_origin IS NULL
          THEN 'missing_prediction_snapshot'
        WHEN o.outcome_snapshot_date IS NULL OR o.outcome_value IS NULL
          THEN 'missing_horizon_observation'
        WHEN COALESCE(o.baseline_n, 0) < p_min_baseline_observations
          THEN 'insufficient_baseline_history'
        WHEN o.baseline_std IS NULL OR o.baseline_std <= 0
          THEN 'unmeasurable_baseline_variance'
        WHEN ABS(o.outcome_value - o.prediction_value_at_origin) >= 95
          AND (
            o.prediction_value_at_origin IN (0, 100)
            OR o.outcome_value IN (0, 100)
          )
          THEN 'suspicious_discontinuity'
        ELSE 'resolved'
      END AS resolution_status
    FROM observed o
  ),
  inserted AS (
    INSERT INTO public.forecast_truth_floor_realizations (
      source_evaluation_id,
      forecast_id,
      domain,
      iso3,
      model_version,
      horizon_days,
      predicted_at,
      realization_due_at,
      source_snapshot_date,
      prediction_snapshot_date,
      outcome_snapshot_date,
      outcome_lag_days,
      predicted_value,
      prediction_value_at_origin,
      outcome_value,
      predicted_direction,
      actual_direction,
      direction_hit,
      absolute_error,
      baseline_sample_size,
      baseline_std,
      status,
      outcome_semantics,
      direction_semantics,
      resolution_method,
      resolution_evidence,
      realized_at
    )
    SELECT
      c.source_evaluation_id,
      c.forecast_id,
      c.domain,
      c.iso3,
      c.model_version,
      c.horizon_days,
      c.predicted_at,
      c.realization_due_at,
      c.source_snapshot_date,
      c.prediction_snapshot_date,
      c.outcome_snapshot_date,
      c.outcome_lag_days,
      c.predicted_value,
      c.prediction_value_at_origin,
      c.outcome_value,
      c.predicted_direction,
      CASE
        WHEN c.resolution_status <> 'resolved' THEN NULL
        WHEN (c.outcome_value - c.prediction_value_at_origin) > c.baseline_std THEN 'increasing'
        WHEN (c.outcome_value - c.prediction_value_at_origin) < -c.baseline_std THEN 'decreasing'
        ELSE 'stable'
      END,
      CASE
        WHEN c.resolution_status <> 'resolved' THEN NULL
        ELSE c.predicted_direction = CASE
          WHEN (c.outcome_value - c.prediction_value_at_origin) > c.baseline_std THEN 'increasing'
          WHEN (c.outcome_value - c.prediction_value_at_origin) < -c.baseline_std THEN 'decreasing'
          ELSE 'stable'
        END
      END,
      CASE
        WHEN c.resolution_status = 'resolved' AND c.predicted_value IS NOT NULL
          THEN ABS(c.outcome_value - c.predicted_value)
        ELSE NULL
      END,
      c.baseline_n,
      c.baseline_std,
      c.resolution_status,
      'derived_country_performance_index',
      'observed_change_classified_by_one_pre_prediction_standard_deviation_v1',
      'target_horizon_first_observation_bounded_lag_v2',
      jsonb_build_object(
        'prediction_snapshot_date', c.prediction_snapshot_date,
        'target_horizon_at', c.realization_due_at,
        'outcome_snapshot_date', c.outcome_snapshot_date,
        'outcome_lag_days', c.outcome_lag_days,
        'maximum_outcome_lag_days', p_max_outcome_lag_days,
        'baseline_window_days', 90,
        'baseline_sample_size', c.baseline_n,
        'baseline_std', c.baseline_std,
        'minimum_baseline_observations', p_min_baseline_observations,
        'outcome_metric_semantics', 'derived_country_performance_index',
        'external_real_world_event_verified', false,
        'suspicious_discontinuity_rule', 'abs_delta_gte_95_with_0_or_100_boundary_requires_source_verification'
      ),
      v_now
    FROM classified c
    ON CONFLICT (source_evaluation_id) DO NOTHING
    RETURNING status
  )
  SELECT
    COUNT(*) FILTER (WHERE status = 'resolved')::integer,
    COUNT(*) FILTER (WHERE status IN (
      'missing_prediction_snapshot',
      'missing_horizon_observation',
      'insufficient_baseline_history',
      'unmeasurable_baseline_variance'
    ))::integer,
    COUNT(*) FILTER (WHERE status = 'suspicious_discontinuity')::integer
  INTO resolved, abstained, quarantined
  FROM inserted;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.realize_forecast_truth_floor(integer, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.realize_forecast_truth_floor(integer, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.realize_forecast_truth_floor(integer, integer, integer) TO service_role;

-- -----------------------------------------------------------------------------
-- 3. External outcome verification ledger.
--    A derived AICIS index is NOT an externally verified event. Concrete claims
--    require a row here with verification_status='verified'.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.prediction_external_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_system text NOT NULL,
  prediction_id text NOT NULL,
  ledger_id text,
  event_type text NOT NULL,
  observed_at timestamptz NOT NULL,
  observation_text text NOT NULL,
  source_name text NOT NULL,
  source_uri text NOT NULL,
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-fA-F]{64}$'),
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN (
    'pending', 'verified', 'rejected', 'superseded'
  )),
  verification_method text,
  verified_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prediction_external_outcomes_verified_requirements CHECK (
    verification_status <> 'verified'
    OR (verified_at IS NOT NULL AND verification_method IS NOT NULL)
  ),
  UNIQUE (prediction_system, prediction_id, source_uri, evidence_sha256)
);

CREATE INDEX IF NOT EXISTS idx_prediction_external_outcomes_prediction
  ON public.prediction_external_outcomes(prediction_system, prediction_id, verification_status);
CREATE INDEX IF NOT EXISTS idx_prediction_external_outcomes_observed
  ON public.prediction_external_outcomes(observed_at DESC);

ALTER TABLE public.prediction_external_outcomes ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.prediction_external_outcomes TO authenticated;
GRANT ALL ON public.prediction_external_outcomes TO service_role;

DROP POLICY IF EXISTS "Operators inspect external prediction outcomes"
  ON public.prediction_external_outcomes;
CREATE POLICY "Operators inspect external prediction outcomes"
  ON public.prediction_external_outcomes
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'operator'::app_role)
  );

DROP POLICY IF EXISTS "Service role manages external prediction outcomes"
  ON public.prediction_external_outcomes;
CREATE POLICY "Service role manages external prediction outcomes"
  ON public.prediction_external_outcomes
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 4. Evidence views. Historical legacy rows remain visible for audit but cannot
--    become rigorous proof merely by being present in the database.
-- -----------------------------------------------------------------------------

DROP VIEW IF EXISTS public.risk_prediction_evidence_report_v1;
CREATE VIEW public.risk_prediction_evidence_report_v1 AS
SELECT
  r.prediction_id,
  r.country_iso3,
  r.domain,
  r.predicted_at,
  r.target_horizon_date,
  r.outcome_snapshot_date,
  r.outcome_lag_days,
  r.horizon_days,
  r.predicted_probability,
  r.actual_label,
  r.brier_score,
  r.model_version,
  r.probability_semantics,
  r.performance_index_at_pred,
  r.performance_index_at_realize,
  r.delta_performance,
  r.baseline_sample_size,
  r.baseline_std,
  r.resolution_method,
  r.resolution_evidence,
  (r.resolution_method = 'performance_index_change_gt_1_pre_prediction_sd_v1') AS rigorous_internal_resolution,
  EXISTS (
    SELECT 1
    FROM public.prediction_external_outcomes x
    WHERE x.prediction_system = 'risk_ranking_predictions'
      AND x.prediction_id = r.prediction_id::text
      AND x.verification_status = 'verified'
      AND x.observed_at >= r.predicted_at
  ) AS externally_verified_real_world_outcome,
  CASE
    WHEN r.resolution_method <> 'performance_index_change_gt_1_pre_prediction_sd_v1'
      THEN 'legacy_or_unverified'
    WHEN EXISTS (
      SELECT 1
      FROM public.prediction_external_outcomes x
      WHERE x.prediction_system = 'risk_ranking_predictions'
        AND x.prediction_id = r.prediction_id::text
        AND x.verification_status = 'verified'
        AND x.observed_at >= r.predicted_at
    ) THEN 'externally_verified_event'
    ELSE 'internal_derived_metric_only'
  END AS claim_strength
FROM public.risk_prediction_realizations r;

DROP VIEW IF EXISTS public.forecast_prediction_evidence_report_v1;
CREATE VIEW public.forecast_prediction_evidence_report_v1 AS
SELECT
  r.*,
  EXISTS (
    SELECT 1
    FROM public.prediction_external_outcomes x
    WHERE x.prediction_system = 'forecast_prospective_evaluations'
      AND x.prediction_id = r.source_evaluation_id
      AND x.verification_status = 'verified'
      AND x.observed_at >= r.predicted_at
  ) AS externally_verified_real_world_outcome,
  CASE
    WHEN r.status <> 'resolved' THEN 'not_resolved'
    WHEN EXISTS (
      SELECT 1
      FROM public.prediction_external_outcomes x
      WHERE x.prediction_system = 'forecast_prospective_evaluations'
        AND x.prediction_id = r.source_evaluation_id
        AND x.verification_status = 'verified'
        AND x.observed_at >= r.predicted_at
    ) THEN 'externally_verified_event'
    ELSE 'internal_derived_metric_only'
  END AS claim_strength
FROM public.forecast_truth_floor_realizations r;

GRANT SELECT ON public.risk_prediction_evidence_report_v1 TO authenticated, service_role;
GRANT SELECT ON public.forecast_prediction_evidence_report_v1 TO authenticated, service_role;

COMMENT ON TABLE public.forecast_truth_floor_realizations IS
  'Independent prospective forecast realizations scored at the declared horizon with bounded lag and explicit abstention/quarantine semantics.';
COMMENT ON TABLE public.prediction_external_outcomes IS
  'Externally sourced outcome evidence. Internal AICIS-derived metrics must not be represented here as real-world event verification.';
COMMENT ON VIEW public.risk_prediction_evidence_report_v1 IS
  'Audit surface separating rigorous internal metric realization from externally verified real-world event evidence.';
COMMENT ON VIEW public.forecast_prediction_evidence_report_v1 IS
  'Audit surface for deterministic prospective forecasts scored under truth-floor-v2.';
