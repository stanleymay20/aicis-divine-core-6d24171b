-- AICIS Risk Ranking Truth Floor v2
-- A screening model may be useful without pretending missing evidence is safe
-- or pretending an uncalibrated heuristic is an observed probability.

ALTER TABLE public.risk_ranking_predictions
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'sufficient'
    CHECK (evidence_status IN ('sufficient','insufficient_evidence')),
  ADD COLUMN IF NOT EXISTS probability_semantics text NOT NULL DEFAULT 'legacy_uncalibrated_probability_estimate',
  ADD COLUMN IF NOT EXISTS base_rate_probability numeric
    CHECK (base_rate_probability IS NULL OR (base_rate_probability >= 0 AND base_rate_probability <= 1)),
  ADD COLUMN IF NOT EXISTS calibration_trust numeric
    CHECK (calibration_trust IS NULL OR (calibration_trust >= 0 AND calibration_trust <= 1)),
  ADD COLUMN IF NOT EXISTS calibration_sample_size integer
    CHECK (calibration_sample_size IS NULL OR calibration_sample_size >= 0),
  ADD COLUMN IF NOT EXISTS source_snapshot_date date;

CREATE INDEX IF NOT EXISTS idx_rrp_evidence_status
  ON public.risk_ranking_predictions(evidence_status, generated_at DESC);

-- Per-pair scoring preserves the historical return contract. NULL now means
-- "insufficient evidence"; it must never be coerced to zero risk.
CREATE OR REPLACE FUNCTION public.score_country_domain_risk(p_iso3 text, p_domain text)
RETURNS TABLE (
  risk_probability numeric,
  trend_score numeric,
  volatility_score numeric,
  momentum_score numeric,
  zscore_recent numeric,
  factors jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perf numeric;
  v_mom numeric;
  v_vol numeric;
  v_dir text;
  v_conf numeric;
  v_snapshot_date date;
  v_z numeric;
  v_prob numeric;
  v_base_rate numeric;
  v_base_n integer := 0;
  v_trust numeric;
  v_cal_n integer := 0;
BEGIN
  SELECT
    performance_index,
    momentum_score,
    volatility_index,
    forecast_direction,
    confidence_score,
    snapshot_date
  INTO
    v_perf,
    v_mom,
    v_vol,
    v_dir,
    v_conf,
    v_snapshot_date
  FROM public.country_performance_snapshots
  WHERE iso3 = upper(p_iso3)
    AND domain = lower(p_domain)
    AND snapshot_date >= current_date - 14
  ORDER BY snapshot_date DESC
  LIMIT 1;

  IF v_perf IS NULL
     OR v_mom IS NULL
     OR v_vol IS NULL
     OR v_dir IS NULL
     OR v_snapshot_date IS NULL THEN
    RETURN QUERY SELECT
      NULL::numeric,
      NULL::numeric,
      NULL::numeric,
      NULL::numeric,
      NULL::numeric,
      jsonb_build_object(
        'evidence_status', 'insufficient_evidence',
        'reason', 'no_recent_complete_snapshot',
        'required_recency_days', 14,
        'probability_semantics', 'no_probability_issued'
      );
    RETURN;
  END IF;

  -- Legacy deterministic screening formulation retained for continuity, but it
  -- is explicitly uncalibrated. It is evaluated later against observed outcomes.
  v_z := (50 - v_perf) / NULLIF(GREATEST(v_vol * 100, 5), 0);
  v_prob := LEAST(1, GREATEST(0,
    0.35 * GREATEST(0, -v_mom)
    + 0.25 * LEAST(1, v_vol)
    + 0.25 * LEAST(1, GREATEST(0, v_z / 3.0))
    + 0.15 * (CASE WHEN v_dir = 'decreasing' THEN 1 WHEN v_dir = 'stable' THEN 0.4 ELSE 0 END)
  ));

  SELECT observed_positive_rate, observed_count
  INTO v_base_rate, v_base_n
  FROM public.forecast_domain_base_rates
  WHERE domain = lower(p_domain)
    AND observed_count >= 5;

  SELECT trust_score, sample_size
  INTO v_trust, v_cal_n
  FROM public.domain_trust_scores
  WHERE domain = lower(p_domain)
    AND sample_size >= 5;

  RETURN QUERY SELECT
    v_prob,
    GREATEST(0, -v_mom)::numeric,
    LEAST(1, v_vol)::numeric,
    v_mom::numeric,
    v_z::numeric,
    jsonb_build_object(
      'evidence_status', 'sufficient',
      'performance_index', v_perf,
      'momentum_score', v_mom,
      'volatility_index', v_vol,
      'forecast_direction', v_dir,
      'snapshot_confidence_score', v_conf,
      'snapshot_date', v_snapshot_date,
      'snapshot_age_days', current_date - v_snapshot_date,
      'heuristic_standardized_deterioration', v_z,
      'model', 'baseline-heuristic-v2',
      'probability_semantics', 'uncalibrated_heuristic_probability_estimate',
      'observed_base_rate_probability', v_base_rate,
      'observed_base_rate_sample_size', COALESCE(v_base_n, 0),
      'calibration_trust', v_trust,
      'calibration_sample_size', COALESCE(v_cal_n, 0),
      'calibration_note', 'Base rate and trust are context only; no arbitrary blending weight is applied.'
    );
END;
$$;

-- Bulk ranking issues rows only where recent complete snapshots exist. Observed
-- base rates/calibration are attached as context, not blended by invented weights.
CREATE OR REPLACE FUNCTION public.compute_risk_ranking_baseline(p_top_n integer DEFAULT 200)
RETURNS TABLE (batch_id uuid, rows_inserted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch uuid := gen_random_uuid();
  v_count integer := 0;
BEGIN
  WITH latest AS (
    SELECT DISTINCT ON (iso3, domain)
      iso3,
      domain,
      performance_index,
      momentum_score,
      volatility_index,
      forecast_direction,
      confidence_score,
      snapshot_date
    FROM public.country_performance_snapshots
    WHERE snapshot_date >= current_date - 14
      AND performance_index IS NOT NULL
      AND momentum_score IS NOT NULL
      AND volatility_index IS NOT NULL
      AND forecast_direction IS NOT NULL
    ORDER BY iso3, domain, snapshot_date DESC
  ),
  scored AS (
    SELECT
      l.*,
      LEAST(1, GREATEST(0,
        0.35 * GREATEST(0, -l.momentum_score)
        + 0.25 * LEAST(1, l.volatility_index)
        + 0.25 * LEAST(1, GREATEST(
            0,
            (((50 - l.performance_index) / NULLIF(GREATEST(l.volatility_index * 100, 5), 0)) / 3.0)
          ))
        + 0.15 * (CASE WHEN l.forecast_direction = 'decreasing' THEN 1 WHEN l.forecast_direction = 'stable' THEN 0.4 ELSE 0 END)
      )) AS prob,
      CASE WHEN b.observed_count >= 5 THEN b.observed_positive_rate ELSE NULL END AS observed_base_rate,
      CASE WHEN b.observed_count >= 5 THEN b.observed_count ELSE NULL END AS observed_base_n,
      CASE WHEN d.sample_size >= 5 THEN d.trust_score ELSE NULL END AS observed_trust,
      CASE WHEN d.sample_size >= 5 THEN d.sample_size ELSE NULL END AS observed_cal_n
    FROM latest l
    LEFT JOIN public.forecast_domain_base_rates b ON b.domain = l.domain
    LEFT JOIN public.domain_trust_scores d ON d.domain = l.domain
  ),
  ranked AS (
    SELECT *, row_number() OVER (ORDER BY prob DESC, iso3, domain) AS rnk
    FROM scored
  )
  INSERT INTO public.risk_ranking_predictions (
    country_iso3,
    domain,
    risk_probability,
    rank_position,
    horizon_days,
    factors,
    model_version,
    generation_batch_id,
    evidence_status,
    probability_semantics,
    base_rate_probability,
    calibration_trust,
    calibration_sample_size,
    source_snapshot_date
  )
  SELECT
    r.iso3,
    r.domain,
    r.prob::numeric,
    r.rnk::integer,
    7,
    jsonb_build_object(
      'performance_index', r.performance_index,
      'momentum_score', r.momentum_score,
      'volatility_index', r.volatility_index,
      'forecast_direction', r.forecast_direction,
      'snapshot_confidence_score', r.confidence_score,
      'snapshot_date', r.snapshot_date,
      'snapshot_age_days', current_date - r.snapshot_date,
      'observed_base_rate_probability', r.observed_base_rate,
      'observed_base_rate_sample_size', r.observed_base_n,
      'calibration_trust', r.observed_trust,
      'calibration_sample_size', r.observed_cal_n,
      'probability_semantics', 'uncalibrated_heuristic_probability_estimate',
      'calibration_note', 'Observed base rate/calibration attached as context only; no arbitrary blend applied.'
    ),
    'baseline-heuristic-v2',
    v_batch,
    'sufficient',
    'uncalibrated_heuristic_probability_estimate',
    r.observed_base_rate,
    r.observed_trust,
    GREATEST(COALESCE(r.observed_base_n, 0), COALESCE(r.observed_cal_n, 0)),
    r.snapshot_date
  FROM ranked r
  WHERE r.rnk <= GREATEST(1, LEAST(p_top_n, 200));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_batch, v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_risk_ranking_baseline(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_risk_ranking_baseline(integer)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.score_country_domain_risk(text, text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.score_country_domain_risk(text, text) IS
  'Returns NULL risk when recent complete evidence is unavailable. Issued values are explicitly uncalibrated heuristic probability estimates with observed base-rate/calibration context.';
COMMENT ON FUNCTION public.compute_risk_ranking_baseline(integer) IS
  'Generates a prioritization ranking only from recent complete snapshots; attaches observed base-rate/calibration context without arbitrary blending.';
