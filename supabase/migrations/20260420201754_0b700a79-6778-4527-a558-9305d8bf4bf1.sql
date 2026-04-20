-- ============================================================
-- PHASE 4 — LEARNING LOOP TABLES
-- ============================================================

-- 1) Per-prediction realization
CREATE TABLE IF NOT EXISTS public.risk_prediction_realizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id uuid NOT NULL REFERENCES public.risk_ranking_predictions(id) ON DELETE CASCADE,
  country_iso3 text NOT NULL,
  domain text NOT NULL,
  predicted_at timestamptz NOT NULL,
  realized_at timestamptz NOT NULL DEFAULT now(),
  horizon_days integer NOT NULL DEFAULT 7,

  predicted_probability numeric NOT NULL,
  actual_label integer NOT NULL,            -- 1 = deteriorated, 0 = stable/improved
  error numeric NOT NULL,                   -- predicted - actual_label
  brier_score numeric NOT NULL,             -- (predicted - actual)^2
  surprise boolean NOT NULL DEFAULT false,  -- big miss (>0.5 abs error)

  performance_index_at_pred numeric,
  performance_index_at_realize numeric,
  delta_performance numeric,

  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(prediction_id)
);

CREATE INDEX IF NOT EXISTS idx_rpr_country_domain ON public.risk_prediction_realizations(country_iso3, domain);
CREATE INDEX IF NOT EXISTS idx_rpr_realized ON public.risk_prediction_realizations(realized_at DESC);
CREATE INDEX IF NOT EXISTS idx_rpr_domain ON public.risk_prediction_realizations(domain);

ALTER TABLE public.risk_prediction_realizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read realizations"
  ON public.risk_prediction_realizations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manages realizations"
  ON public.risk_prediction_realizations FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2) Per-domain performance log (one row per evaluation run)
CREATE TABLE IF NOT EXISTS public.model_performance_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version text NOT NULL,
  domain text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  sample_size integer NOT NULL,

  accuracy numeric,                  -- threshold @ 0.5
  brier_score numeric,               -- mean (p-y)^2
  log_loss numeric,
  calibration_error numeric,         -- |mean(p) - mean(y)|
  bias numeric,                      -- mean(p - y)
  trust_score numeric,               -- 1 - clipped(brier*4)
  surprise_rate numeric,             -- fraction of |error|>0.5

  positive_rate_actual numeric,
  positive_rate_predicted numeric,

  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mpl_domain_time ON public.model_performance_log(domain, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_mpl_version ON public.model_performance_log(model_version, computed_at DESC);

ALTER TABLE public.model_performance_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read performance log"
  ON public.model_performance_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manages performance log"
  ON public.model_performance_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3) Latest trust score per domain (used to weight future predictions)
CREATE TABLE IF NOT EXISTS public.domain_trust_scores (
  domain text PRIMARY KEY,
  trust_score numeric NOT NULL DEFAULT 0.5,
  brier_score numeric,
  accuracy numeric,
  calibration_error numeric,
  sample_size integer NOT NULL DEFAULT 0,
  model_version text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.domain_trust_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read trust scores"
  ON public.domain_trust_scores FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manages trust scores"
  ON public.domain_trust_scores FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- REALIZATION FUNCTION
-- For every prediction older than horizon_days that has not yet
-- been realized, look up the current snapshot to determine the
-- actual deterioration label, then upsert into realizations and
-- refresh model_performance_log + domain_trust_scores.
-- ============================================================
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
  v_window_start timestamptz := now() - INTERVAL '30 days';
BEGIN
  -- Insert realizations for predictions that have aged past the horizon
  WITH due AS (
    SELECT
      p.id, p.country_iso3, p.domain, p.risk_probability, p.generated_at,
      (p.factors->>'performance_index')::numeric AS pi_at_pred
    FROM public.risk_ranking_predictions p
    LEFT JOIN public.risk_prediction_realizations r ON r.prediction_id = p.id
    WHERE r.id IS NULL
      AND p.generated_at <= v_now - (p_horizon_days || ' days')::interval
      AND p.generated_at >= v_now - INTERVAL '60 days'  -- don't backfill too far
    LIMIT 5000
  ),
  current_snap AS (
    SELECT DISTINCT ON (s.iso3, s.domain) s.iso3, s.domain, s.performance_index, s.snapshot_date
    FROM public.country_performance_snapshots s
    WHERE s.snapshot_date >= (v_now - INTERVAL '14 days')::date
    ORDER BY s.iso3, s.domain, s.snapshot_date DESC
  ),
  baseline_snap AS (
    -- 90d rolling mean per (country, domain) ending at prediction time
    SELECT d.id AS prediction_id,
           AVG(s.performance_index) AS baseline_mean,
           STDDEV_SAMP(s.performance_index) AS baseline_std
    FROM due d
    JOIN public.country_performance_snapshots s
      ON s.iso3 = d.country_iso3 AND s.domain = d.domain
     AND s.snapshot_date BETWEEN (d.generated_at - INTERVAL '90 days')::date AND d.generated_at::date
    GROUP BY d.id
  ),
  scored AS (
    SELECT
      d.id AS prediction_id,
      d.country_iso3,
      d.domain,
      d.generated_at AS predicted_at,
      d.risk_probability AS predicted_probability,
      d.pi_at_pred AS performance_index_at_pred,
      cs.performance_index AS performance_index_at_realize,
      bs.baseline_mean,
      COALESCE(NULLIF(bs.baseline_std, 0), 1) AS baseline_std,
      -- deteriorated = current PI is >1 std worse (lower) than 90d mean
      CASE
        WHEN cs.performance_index IS NULL THEN NULL
        WHEN bs.baseline_mean IS NULL THEN NULL
        WHEN (bs.baseline_mean - cs.performance_index) > COALESCE(NULLIF(bs.baseline_std,0),1)
          THEN 1 ELSE 0
      END AS actual_label
    FROM due d
    LEFT JOIN current_snap cs ON cs.iso3 = d.country_iso3 AND cs.domain = d.domain
    LEFT JOIN baseline_snap bs ON bs.prediction_id = d.id
  )
  INSERT INTO public.risk_prediction_realizations
    (prediction_id, country_iso3, domain, predicted_at, horizon_days,
     predicted_probability, actual_label, error, brier_score, surprise,
     performance_index_at_pred, performance_index_at_realize, delta_performance)
  SELECT
    s.prediction_id, s.country_iso3, s.domain, s.predicted_at, p_horizon_days,
    s.predicted_probability, s.actual_label,
    (s.predicted_probability - s.actual_label),
    POWER(s.predicted_probability - s.actual_label, 2),
    ABS(s.predicted_probability - s.actual_label) > 0.5,
    s.performance_index_at_pred, s.performance_index_at_realize,
    (COALESCE(s.performance_index_at_realize,0) - COALESCE(s.performance_index_at_pred,0))
  FROM scored s
  WHERE s.actual_label IS NOT NULL
  ON CONFLICT (prediction_id) DO NOTHING;

  GET DIAGNOSTICS v_realized = ROW_COUNT;

  -- Recompute per-domain performance over last 30 days
  WITH agg AS (
    SELECT
      r.domain,
      COUNT(*) AS n,
      AVG(CASE WHEN (r.predicted_probability >= 0.5 AND r.actual_label = 1)
                  OR (r.predicted_probability < 0.5  AND r.actual_label = 0)
               THEN 1.0 ELSE 0.0 END) AS accuracy,
      AVG(r.brier_score) AS brier,
      ABS(AVG(r.predicted_probability) - AVG(r.actual_label)) AS calibration_error,
      AVG(r.predicted_probability - r.actual_label) AS bias,
      AVG(CASE WHEN r.surprise THEN 1.0 ELSE 0.0 END) AS surprise_rate,
      AVG(r.actual_label::numeric) AS positive_rate_actual,
      AVG(r.predicted_probability) AS positive_rate_predicted
    FROM public.risk_prediction_realizations r
    WHERE r.realized_at BETWEEN v_window_start AND v_window_end
    GROUP BY r.domain
    HAVING COUNT(*) >= 5
  ),
  ins AS (
    INSERT INTO public.model_performance_log
      (model_version, domain, window_start, window_end, sample_size,
       accuracy, brier_score, calibration_error, bias, trust_score, surprise_rate,
       positive_rate_actual, positive_rate_predicted)
    SELECT 'baseline-v1', a.domain, v_window_start, v_window_end, a.n,
           a.accuracy, a.brier, a.calibration_error, a.bias,
           GREATEST(0, LEAST(1, 1 - (a.brier * 4))),
           a.surprise_rate, a.positive_rate_actual, a.positive_rate_predicted
    FROM agg a
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_perf FROM ins;

  -- Refresh latest domain trust snapshot
  WITH latest AS (
    SELECT DISTINCT ON (mpl.domain) mpl.*
    FROM public.model_performance_log mpl
    WHERE mpl.computed_at >= v_now - INTERVAL '7 days'
    ORDER BY mpl.domain, mpl.computed_at DESC
  )
  INSERT INTO public.domain_trust_scores
    (domain, trust_score, brier_score, accuracy, calibration_error, sample_size, model_version, updated_at)
  SELECT l.domain, l.trust_score, l.brier_score, l.accuracy, l.calibration_error,
         l.sample_size, l.model_version, v_now
  FROM latest l
  ON CONFLICT (domain) DO UPDATE
    SET trust_score = EXCLUDED.trust_score,
        brier_score = EXCLUDED.brier_score,
        accuracy = EXCLUDED.accuracy,
        calibration_error = EXCLUDED.calibration_error,
        sample_size = EXCLUDED.sample_size,
        model_version = EXCLUDED.model_version,
        updated_at = EXCLUDED.updated_at;

  GET DIAGNOSTICS v_trust = ROW_COUNT;

  RETURN QUERY SELECT v_realized, v_perf, v_trust;
END;
$$;

GRANT EXECUTE ON FUNCTION public.realize_risk_predictions(integer) TO authenticated, service_role;