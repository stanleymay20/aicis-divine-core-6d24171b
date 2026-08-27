-- AICIS Learning Loop Truth Floor v1
--
-- Purpose:
-- 1. Never resolve a forecast from a fabricated standard deviation or a missing
--    performance value coerced to zero.
-- 2. Resolve outcomes against a bounded observation window around the forecast
--    horizon, not against whatever the latest snapshot happens to be today.
-- 3. Record abstentions/insufficient evidence as resolution attempts so the
--    system can distinguish "not yet measurable" from "forecast was wrong".
-- 4. Evaluate probability surfaces by their real model/version/semantics and
--    use Brier skill versus sample climatology instead of the historical
--    arbitrary 1 - 4*Brier "trust" formula.
-- 5. Keep the existing realize_risk_predictions(integer) return contract for
--    caller compatibility while removing direct authenticated execution.

ALTER TABLE public.risk_prediction_realizations
  ADD COLUMN IF NOT EXISTS model_version text,
  ADD COLUMN IF NOT EXISTS probability_semantics text,
  ADD COLUMN IF NOT EXISTS target_horizon_date date,
  ADD COLUMN IF NOT EXISTS outcome_snapshot_date date,
  ADD COLUMN IF NOT EXISTS outcome_lag_days integer,
  ADD COLUMN IF NOT EXISTS baseline_sample_size integer,
  ADD COLUMN IF NOT EXISTS baseline_std numeric,
  ADD COLUMN IF NOT EXISTS resolution_method text NOT NULL DEFAULT 'legacy_unverified_resolution',
  ADD COLUMN IF NOT EXISTS resolution_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_rpr_model_domain_time
  ON public.risk_prediction_realizations(model_version, domain, realized_at DESC);
CREATE INDEX IF NOT EXISTS idx_rpr_resolution_method
  ON public.risk_prediction_realizations(resolution_method, realized_at DESC);

CREATE TABLE IF NOT EXISTS public.risk_prediction_resolution_attempts (
  prediction_id uuid PRIMARY KEY REFERENCES public.risk_ranking_predictions(id) ON DELETE CASCADE,
  country_iso3 text NOT NULL,
  domain text NOT NULL,
  model_version text,
  probability_semantics text,
  horizon_days integer NOT NULL,
  target_horizon_date date NOT NULL,
  prediction_snapshot_date date,
  outcome_snapshot_date date,
  outcome_lag_days integer,
  baseline_sample_size integer,
  baseline_std numeric,
  status text NOT NULL CHECK (status IN (
    'resolved',
    'missing_prediction_snapshot',
    'missing_horizon_observation',
    'insufficient_baseline_history',
    'unmeasurable_baseline_variance'
  )),
  resolution_method text NOT NULL DEFAULT 'performance_index_change_gt_1_pre_prediction_sd_v1',
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  first_attempted_at timestamptz NOT NULL DEFAULT now(),
  last_attempted_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_resolution_attempts_status
  ON public.risk_prediction_resolution_attempts(status, last_attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_resolution_attempts_model
  ON public.risk_prediction_resolution_attempts(model_version, domain, last_attempted_at DESC);

ALTER TABLE public.risk_prediction_resolution_attempts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.risk_prediction_resolution_attempts TO authenticated;
GRANT ALL ON public.risk_prediction_resolution_attempts TO service_role;

DROP POLICY IF EXISTS "Operators inspect prediction resolution attempts"
  ON public.risk_prediction_resolution_attempts;
CREATE POLICY "Operators inspect prediction resolution attempts"
  ON public.risk_prediction_resolution_attempts FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'operator'::app_role)
  );

DROP POLICY IF EXISTS "Service role manages prediction resolution attempts"
  ON public.risk_prediction_resolution_attempts;
CREATE POLICY "Service role manages prediction resolution attempts"
  ON public.risk_prediction_resolution_attempts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

ALTER TABLE public.model_performance_log
  ADD COLUMN IF NOT EXISTS horizon_days integer,
  ADD COLUMN IF NOT EXISTS probability_semantics text,
  ADD COLUMN IF NOT EXISTS baseline_brier_score numeric,
  ADD COLUMN IF NOT EXISTS brier_skill_score numeric,
  ADD COLUMN IF NOT EXISTS evaluation_method text,
  ADD COLUMN IF NOT EXISTS calibration_metric text;

ALTER TABLE public.domain_trust_scores
  ADD COLUMN IF NOT EXISTS horizon_days integer,
  ADD COLUMN IF NOT EXISTS probability_semantics text,
  ADD COLUMN IF NOT EXISTS brier_skill_score numeric,
  ADD COLUMN IF NOT EXISTS ece numeric,
  ADD COLUMN IF NOT EXISTS trust_semantics text;

COMMENT ON COLUMN public.domain_trust_scores.trust_score IS
  'Current probability-skill summary. For truth-floor-v1 rows this is clipped Brier skill versus sample climatology and is only written with >=20 rigorous realizations; inspect trust_semantics and model_version.';
COMMENT ON COLUMN public.model_performance_log.calibration_error IS
  'For truth-floor-v1 evaluation rows this contains 10-bin expected calibration error (ECE), not merely the absolute difference of global means.';

CREATE OR REPLACE FUNCTION public.realize_risk_predictions(p_horizon_days integer DEFAULT 7)
RETURNS TABLE(realized integer, perf_rows integer, trust_rows integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_realized integer := 0;
  v_perf integer := 0;
  v_trust integer := 0;
  v_now timestamptz := now();
  v_window_end timestamptz := now();
  v_window_start timestamptz := now() - INTERVAL '90 days';
  v_min_baseline_observations integer := 10;
  v_max_outcome_lag_days integer := 7;
BEGIN
  IF p_horizon_days IS NULL OR p_horizon_days < 1 OR p_horizon_days > 30 THEN
    RAISE EXCEPTION 'p_horizon_days must be between 1 and 30';
  END IF;

  -- Evaluate each due prediction against:
  --   * the exact source snapshot when source_snapshot_date is known, otherwise
  --     the latest pre-prediction snapshot within 14 days;
  --   * the first outcome snapshot on/after the target horizon, bounded to 7 days;
  --   * at least 10 pre-prediction observations over 90 days;
  --   * non-zero observed historical variance.
  -- Any failed condition is an abstention recorded below, not a realized label.
  WITH due AS (
    SELECT
      p.id,
      p.country_iso3,
      p.domain,
      p.risk_probability,
      p.generated_at,
      p.horizon_days,
      p.model_version,
      p.probability_semantics,
      p.source_snapshot_date,
      (p.generated_at::date + p.horizon_days) AS target_horizon_date
    FROM public.risk_ranking_predictions p
    LEFT JOIN public.risk_prediction_realizations r ON r.prediction_id = p.id
    WHERE r.id IS NULL
      AND p.horizon_days = p_horizon_days
      AND p.generated_at <= v_now - (p.horizon_days || ' days')::interval
      AND p.generated_at >= v_now - INTERVAL '180 days'
    ORDER BY p.generated_at ASC
    LIMIT 5000
  ),
  observed AS (
    SELECT
      d.*,
      ps.snapshot_date AS prediction_snapshot_date,
      ps.performance_index AS performance_index_at_pred,
      os.snapshot_date AS outcome_snapshot_date,
      os.performance_index AS performance_index_at_outcome,
      CASE
        WHEN os.snapshot_date IS NULL THEN NULL
        ELSE os.snapshot_date - d.target_horizon_date
      END AS outcome_lag_days,
      bs.baseline_mean,
      bs.baseline_std,
      bs.baseline_n
    FROM due d
    LEFT JOIN LATERAL (
      SELECT s.snapshot_date, s.performance_index
      FROM public.country_performance_snapshots s
      WHERE s.iso3 = d.country_iso3
        AND s.domain = d.domain
        AND s.performance_index IS NOT NULL
        AND (
          (d.source_snapshot_date IS NOT NULL AND s.snapshot_date = d.source_snapshot_date)
          OR
          (d.source_snapshot_date IS NULL
            AND s.snapshot_date <= d.generated_at::date
            AND s.snapshot_date >= d.generated_at::date - 14)
        )
      ORDER BY s.snapshot_date DESC
      LIMIT 1
    ) ps ON true
    LEFT JOIN LATERAL (
      SELECT s.snapshot_date, s.performance_index
      FROM public.country_performance_snapshots s
      WHERE s.iso3 = d.country_iso3
        AND s.domain = d.domain
        AND s.performance_index IS NOT NULL
        AND s.snapshot_date >= d.target_horizon_date
        AND s.snapshot_date <= d.target_horizon_date + v_max_outcome_lag_days
      ORDER BY s.snapshot_date ASC
      LIMIT 1
    ) os ON true
    LEFT JOIN LATERAL (
      SELECT
        AVG(s.performance_index)::numeric AS baseline_mean,
        STDDEV_SAMP(s.performance_index)::numeric AS baseline_std,
        COUNT(s.performance_index)::integer AS baseline_n
      FROM public.country_performance_snapshots s
      WHERE ps.snapshot_date IS NOT NULL
        AND s.iso3 = d.country_iso3
        AND s.domain = d.domain
        AND s.performance_index IS NOT NULL
        AND s.snapshot_date BETWEEN ps.snapshot_date - 90 AND ps.snapshot_date
    ) bs ON true
  ),
  evaluated AS (
    SELECT
      o.*,
      CASE
        WHEN o.prediction_snapshot_date IS NULL OR o.performance_index_at_pred IS NULL
          THEN 'missing_prediction_snapshot'
        WHEN o.outcome_snapshot_date IS NULL OR o.performance_index_at_outcome IS NULL
          THEN 'missing_horizon_observation'
        WHEN COALESCE(o.baseline_n, 0) < v_min_baseline_observations
          THEN 'insufficient_baseline_history'
        WHEN o.baseline_std IS NULL OR o.baseline_std <= 0
          THEN 'unmeasurable_baseline_variance'
        ELSE 'resolved'
      END AS resolution_status
    FROM observed o
  ),
  inserted_realizations AS (
    INSERT INTO public.risk_prediction_realizations (
      prediction_id,
      country_iso3,
      domain,
      predicted_at,
      realized_at,
      horizon_days,
      predicted_probability,
      actual_label,
      error,
      brier_score,
      surprise,
      performance_index_at_pred,
      performance_index_at_realize,
      delta_performance,
      model_version,
      probability_semantics,
      target_horizon_date,
      outcome_snapshot_date,
      outcome_lag_days,
      baseline_sample_size,
      baseline_std,
      resolution_method,
      resolution_evidence
    )
    SELECT
      e.id,
      e.country_iso3,
      e.domain,
      e.generated_at,
      v_now,
      e.horizon_days,
      e.risk_probability,
      CASE
        WHEN (e.performance_index_at_pred - e.performance_index_at_outcome) > e.baseline_std THEN 1
        ELSE 0
      END,
      e.risk_probability - CASE
        WHEN (e.performance_index_at_pred - e.performance_index_at_outcome) > e.baseline_std THEN 1
        ELSE 0
      END,
      POWER(
        e.risk_probability - CASE
          WHEN (e.performance_index_at_pred - e.performance_index_at_outcome) > e.baseline_std THEN 1
          ELSE 0
        END,
        2
      ),
      ABS(
        e.risk_probability - CASE
          WHEN (e.performance_index_at_pred - e.performance_index_at_outcome) > e.baseline_std THEN 1
          ELSE 0
        END
      ) > 0.5,
      e.performance_index_at_pred,
      e.performance_index_at_outcome,
      e.performance_index_at_outcome - e.performance_index_at_pred,
      e.model_version,
      e.probability_semantics,
      e.target_horizon_date,
      e.outcome_snapshot_date,
      e.outcome_lag_days,
      e.baseline_n,
      e.baseline_std,
      'performance_index_change_gt_1_pre_prediction_sd_v1',
      jsonb_build_object(
        'prediction_snapshot_date', e.prediction_snapshot_date,
        'outcome_snapshot_date', e.outcome_snapshot_date,
        'target_horizon_date', e.target_horizon_date,
        'outcome_lag_days', e.outcome_lag_days,
        'baseline_window_days', 90,
        'baseline_sample_size', e.baseline_n,
        'baseline_std', e.baseline_std,
        'minimum_baseline_observations', v_min_baseline_observations,
        'maximum_outcome_lag_days', v_max_outcome_lag_days,
        'outcome_metric_semantics', 'derived_country_performance_index',
        'label_semantics', 'deterioration_from_prediction_snapshot_exceeds_one_pre_prediction_standard_deviation'
      )
    FROM evaluated e
    WHERE e.resolution_status = 'resolved'
    ON CONFLICT (prediction_id) DO NOTHING
    RETURNING prediction_id
  ),
  upserted_attempts AS (
    INSERT INTO public.risk_prediction_resolution_attempts (
      prediction_id,
      country_iso3,
      domain,
      model_version,
      probability_semantics,
      horizon_days,
      target_horizon_date,
      prediction_snapshot_date,
      outcome_snapshot_date,
      outcome_lag_days,
      baseline_sample_size,
      baseline_std,
      status,
      resolution_method,
      attempt_count,
      first_attempted_at,
      last_attempted_at,
      resolved_at,
      evidence
    )
    SELECT
      e.id,
      e.country_iso3,
      e.domain,
      e.model_version,
      e.probability_semantics,
      e.horizon_days,
      e.target_horizon_date,
      e.prediction_snapshot_date,
      e.outcome_snapshot_date,
      e.outcome_lag_days,
      e.baseline_n,
      e.baseline_std,
      e.resolution_status,
      'performance_index_change_gt_1_pre_prediction_sd_v1',
      1,
      v_now,
      v_now,
      CASE WHEN e.resolution_status = 'resolved' THEN v_now ELSE NULL END,
      jsonb_build_object(
        'minimum_baseline_observations', v_min_baseline_observations,
        'maximum_outcome_lag_days', v_max_outcome_lag_days,
        'performance_index_at_prediction', e.performance_index_at_pred,
        'performance_index_at_outcome', e.performance_index_at_outcome,
        'baseline_mean', e.baseline_mean,
        'baseline_std', e.baseline_std,
        'baseline_sample_size', e.baseline_n,
        'outcome_metric_semantics', 'derived_country_performance_index'
      )
    FROM evaluated e
    ON CONFLICT (prediction_id) DO UPDATE SET
      model_version = EXCLUDED.model_version,
      probability_semantics = EXCLUDED.probability_semantics,
      target_horizon_date = EXCLUDED.target_horizon_date,
      prediction_snapshot_date = EXCLUDED.prediction_snapshot_date,
      outcome_snapshot_date = EXCLUDED.outcome_snapshot_date,
      outcome_lag_days = EXCLUDED.outcome_lag_days,
      baseline_sample_size = EXCLUDED.baseline_sample_size,
      baseline_std = EXCLUDED.baseline_std,
      status = EXCLUDED.status,
      attempt_count = public.risk_prediction_resolution_attempts.attempt_count + 1,
      last_attempted_at = v_now,
      resolved_at = CASE
        WHEN EXCLUDED.status = 'resolved' THEN COALESCE(public.risk_prediction_resolution_attempts.resolved_at, v_now)
        ELSE public.risk_prediction_resolution_attempts.resolved_at
      END,
      evidence = EXCLUDED.evidence
    RETURNING prediction_id, status
  )
  SELECT COUNT(*)::integer
  INTO v_realized
  FROM inserted_realizations;

  -- Evaluate only truth-floor-v1 realizations. Historical legacy resolutions are
  -- deliberately excluded because their outcome timing/variance may be synthetic.
  WITH eval AS (
    SELECT
      r.domain,
      r.model_version,
      COALESCE(r.probability_semantics, 'unspecified') AS probability_semantics,
      r.predicted_probability::numeric AS p,
      r.actual_label::numeric AS y,
      r.brier_score::numeric AS brier,
      r.surprise
    FROM public.risk_prediction_realizations r
    WHERE r.realized_at BETWEEN v_window_start AND v_window_end
      AND r.horizon_days = p_horizon_days
      AND r.resolution_method = 'performance_index_change_gt_1_pre_prediction_sd_v1'
      AND r.model_version IS NOT NULL
  ),
  agg AS (
    SELECT
      domain,
      model_version,
      probability_semantics,
      COUNT(*)::integer AS n,
      AVG(CASE
        WHEN (p >= 0.5 AND y = 1) OR (p < 0.5 AND y = 0) THEN 1.0
        ELSE 0.0
      END)::numeric AS accuracy,
      AVG(brier)::numeric AS brier_score,
      AVG(
        -(y * LN(GREATEST(1e-15::numeric, LEAST(1 - 1e-15::numeric, p)))
          + (1 - y) * LN(GREATEST(1e-15::numeric, LEAST(1 - 1e-15::numeric, 1 - p))))
      )::numeric AS log_loss,
      AVG(p - y)::numeric AS bias,
      AVG(CASE WHEN surprise THEN 1.0 ELSE 0.0 END)::numeric AS surprise_rate,
      AVG(y)::numeric AS positive_rate_actual,
      AVG(p)::numeric AS positive_rate_predicted
    FROM eval
    GROUP BY domain, model_version, probability_semantics
  ),
  bin_stats AS (
    SELECT
      domain,
      model_version,
      probability_semantics,
      FLOOR(LEAST(p, 0.999999::numeric) * 10)::integer AS bin_id,
      COUNT(*)::numeric AS bin_n,
      AVG(p)::numeric AS mean_p,
      AVG(y)::numeric AS mean_y
    FROM eval
    GROUP BY domain, model_version, probability_semantics,
      FLOOR(LEAST(p, 0.999999::numeric) * 10)::integer
  ),
  ece AS (
    SELECT
      b.domain,
      b.model_version,
      b.probability_semantics,
      SUM((b.bin_n / a.n::numeric) * ABS(b.mean_p - b.mean_y))::numeric AS ece
    FROM bin_stats b
    JOIN agg a USING (domain, model_version, probability_semantics)
    GROUP BY b.domain, b.model_version, b.probability_semantics
  ),
  scored AS (
    SELECT
      a.*,
      e.ece,
      (a.positive_rate_actual * (1 - a.positive_rate_actual))::numeric AS baseline_brier_score,
      CASE
        WHEN (a.positive_rate_actual * (1 - a.positive_rate_actual)) > 0
          THEN 1 - (a.brier_score / (a.positive_rate_actual * (1 - a.positive_rate_actual)))
        ELSE NULL
      END::numeric AS brier_skill_score
    FROM agg a
    LEFT JOIN ece e USING (domain, model_version, probability_semantics)
  ),
  inserted_perf AS (
    INSERT INTO public.model_performance_log (
      model_version,
      domain,
      window_start,
      window_end,
      sample_size,
      accuracy,
      brier_score,
      log_loss,
      calibration_error,
      bias,
      trust_score,
      surprise_rate,
      positive_rate_actual,
      positive_rate_predicted,
      ece,
      realization_count,
      horizon_days,
      probability_semantics,
      baseline_brier_score,
      brier_skill_score,
      evaluation_method,
      calibration_metric
    )
    SELECT
      s.model_version,
      s.domain,
      v_window_start,
      v_window_end,
      s.n,
      s.accuracy,
      s.brier_score,
      s.log_loss,
      s.ece,
      s.bias,
      CASE
        WHEN s.n >= 20 AND s.brier_skill_score IS NOT NULL
          THEN GREATEST(0, LEAST(1, s.brier_skill_score))
        ELSE NULL
      END,
      s.surprise_rate,
      s.positive_rate_actual,
      s.positive_rate_predicted,
      s.ece,
      s.n,
      p_horizon_days,
      s.probability_semantics,
      s.baseline_brier_score,
      s.brier_skill_score,
      'truth_floor_v1_horizon_resolved_only',
      'ece_10_equal_width_bins'
    FROM scored s
    WHERE s.n >= 5
    RETURNING 1
  )
  SELECT COUNT(*)::integer INTO v_perf FROM inserted_perf;

  -- The legacy table remains a one-row-per-domain current summary. Only write a
  -- trust summary when there are >=20 rigorous outcomes and climatology has
  -- non-zero variance. Negative Brier skill maps to zero; the raw signed skill
  -- remains available in brier_skill_score.
  WITH eval AS (
    SELECT
      r.domain,
      r.model_version,
      COALESCE(r.probability_semantics, 'unspecified') AS probability_semantics,
      r.predicted_probability::numeric AS p,
      r.actual_label::numeric AS y,
      r.brier_score::numeric AS brier
    FROM public.risk_prediction_realizations r
    WHERE r.realized_at BETWEEN v_window_start AND v_window_end
      AND r.horizon_days = p_horizon_days
      AND r.resolution_method = 'performance_index_change_gt_1_pre_prediction_sd_v1'
      AND r.model_version IS NOT NULL
  ),
  agg AS (
    SELECT
      domain,
      model_version,
      probability_semantics,
      COUNT(*)::integer AS n,
      AVG(CASE
        WHEN (p >= 0.5 AND y = 1) OR (p < 0.5 AND y = 0) THEN 1.0
        ELSE 0.0
      END)::numeric AS accuracy,
      AVG(brier)::numeric AS brier_score,
      AVG(y)::numeric AS actual_rate,
      (AVG(y) * (1 - AVG(y)))::numeric AS baseline_brier
    FROM eval
    GROUP BY domain, model_version, probability_semantics
  ),
  bins AS (
    SELECT
      domain,
      model_version,
      probability_semantics,
      FLOOR(LEAST(p, 0.999999::numeric) * 10)::integer AS bin_id,
      COUNT(*)::numeric AS bin_n,
      AVG(p)::numeric AS mean_p,
      AVG(y)::numeric AS mean_y
    FROM eval
    GROUP BY domain, model_version, probability_semantics,
      FLOOR(LEAST(p, 0.999999::numeric) * 10)::integer
  ),
  scored AS (
    SELECT
      a.*,
      SUM((b.bin_n / a.n::numeric) * ABS(b.mean_p - b.mean_y))::numeric AS ece,
      CASE WHEN a.baseline_brier > 0
        THEN 1 - (a.brier_score / a.baseline_brier)
        ELSE NULL
      END::numeric AS brier_skill
    FROM agg a
    JOIN bins b USING (domain, model_version, probability_semantics)
    GROUP BY
      a.domain,
      a.model_version,
      a.probability_semantics,
      a.n,
      a.accuracy,
      a.brier_score,
      a.actual_rate,
      a.baseline_brier
  ),
  ranked AS (
    SELECT
      s.*,
      ROW_NUMBER() OVER (
        PARTITION BY s.domain
        ORDER BY s.n DESC, s.model_version DESC
      ) AS rn
    FROM scored s
    WHERE s.n >= 20
      AND s.brier_skill IS NOT NULL
  )
  INSERT INTO public.domain_trust_scores (
    domain,
    trust_score,
    brier_score,
    accuracy,
    calibration_error,
    sample_size,
    model_version,
    updated_at,
    horizon_days,
    probability_semantics,
    brier_skill_score,
    ece,
    trust_semantics
  )
  SELECT
    r.domain,
    GREATEST(0, LEAST(1, r.brier_skill)),
    r.brier_score,
    r.accuracy,
    r.ece,
    r.n,
    r.model_version,
    v_now,
    p_horizon_days,
    r.probability_semantics,
    r.brier_skill,
    r.ece,
    'clipped_brier_skill_vs_sample_climatology; raw_signed_skill_in_brier_skill_score'
  FROM ranked r
  WHERE r.rn = 1
  ON CONFLICT (domain) DO UPDATE SET
    trust_score = EXCLUDED.trust_score,
    brier_score = EXCLUDED.brier_score,
    accuracy = EXCLUDED.accuracy,
    calibration_error = EXCLUDED.calibration_error,
    sample_size = EXCLUDED.sample_size,
    model_version = EXCLUDED.model_version,
    updated_at = EXCLUDED.updated_at,
    horizon_days = EXCLUDED.horizon_days,
    probability_semantics = EXCLUDED.probability_semantics,
    brier_skill_score = EXCLUDED.brier_skill_score,
    ece = EXCLUDED.ece,
    trust_semantics = EXCLUDED.trust_semantics;

  GET DIAGNOSTICS v_trust = ROW_COUNT;

  RETURN QUERY SELECT v_realized, v_perf, v_trust;
END;
$$;

-- This SECURITY DEFINER function writes learning-state tables. Ordinary
-- authenticated users must go through the admin/trusted-worker Edge Function,
-- which has an explicit caller boundary and invokes the RPC with service_role.
REVOKE ALL ON FUNCTION public.realize_risk_predictions(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.realize_risk_predictions(integer)
  TO service_role;

COMMENT ON FUNCTION public.realize_risk_predictions(integer) IS
  'Truth-floor resolver: bounded horizon observation, minimum observed baseline history, non-zero measured variance, explicit abstention logging, and model/semantics-specific probability evaluation. Never fabricates missing variance or performance values.';
