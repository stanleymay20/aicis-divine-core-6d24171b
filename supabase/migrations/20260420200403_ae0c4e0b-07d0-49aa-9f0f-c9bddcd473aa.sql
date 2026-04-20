-- Risk ranking predictions table
CREATE TABLE IF NOT EXISTS public.risk_ranking_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso3 TEXT NOT NULL,
  domain TEXT NOT NULL,
  risk_probability NUMERIC NOT NULL CHECK (risk_probability >= 0 AND risk_probability <= 1),
  rank_position INTEGER,
  horizon_days INTEGER NOT NULL DEFAULT 7,
  factors JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_version TEXT NOT NULL DEFAULT 'baseline-v1',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generation_batch_id UUID NOT NULL DEFAULT gen_random_uuid()
);

CREATE INDEX IF NOT EXISTS idx_rrp_generated_at ON public.risk_ranking_predictions(generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rrp_batch ON public.risk_ranking_predictions(generation_batch_id);
CREATE INDEX IF NOT EXISTS idx_rrp_country_domain ON public.risk_ranking_predictions(country_iso3, domain);

ALTER TABLE public.risk_ranking_predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "risk_ranking_public_read" ON public.risk_ranking_predictions;
CREATE POLICY "risk_ranking_public_read" ON public.risk_ranking_predictions
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "risk_ranking_service_write" ON public.risk_ranking_predictions;
CREATE POLICY "risk_ranking_service_write" ON public.risk_ranking_predictions
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Per-pair scorer: returns probability + factors
CREATE OR REPLACE FUNCTION public.score_country_domain_risk(p_iso3 TEXT, p_domain TEXT)
RETURNS TABLE (
  risk_probability NUMERIC,
  trend_score NUMERIC,
  volatility_score NUMERIC,
  momentum_score NUMERIC,
  zscore_recent NUMERIC,
  factors JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perf NUMERIC;
  v_mom NUMERIC;
  v_vol NUMERIC;
  v_dir TEXT;
  v_conf NUMERIC;
  v_z NUMERIC;
  v_prob NUMERIC;
BEGIN
  SELECT performance_index, momentum_score, volatility_index, forecast_direction, confidence_score
  INTO v_perf, v_mom, v_vol, v_dir, v_conf
  FROM country_performance_snapshots
  WHERE iso3 = p_iso3 AND domain = p_domain
  ORDER BY snapshot_date DESC
  LIMIT 1;

  IF v_perf IS NULL THEN
    RETURN QUERY SELECT 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, '{"error":"no_snapshot"}'::JSONB;
    RETURN;
  END IF;

  -- Baseline scoring: convert factors to [0,1] deterioration probability
  -- Negative momentum increases risk; high volatility increases risk; low performance amplifies
  v_z := COALESCE((50 - v_perf) / NULLIF(GREATEST(v_vol * 100, 5), 0), 0);
  v_prob := LEAST(0.99, GREATEST(0.01,
    0.35 * GREATEST(0, -COALESCE(v_mom, 0))    -- negative momentum
    + 0.25 * LEAST(1, COALESCE(v_vol, 0))      -- volatility (already 0..1ish)
    + 0.25 * LEAST(1, GREATEST(0, v_z / 3.0))  -- z-score deterioration vs midpoint
    + 0.15 * (CASE WHEN v_dir = 'decreasing' THEN 1 WHEN v_dir = 'stable' THEN 0.4 ELSE 0 END)
  ));

  RETURN QUERY SELECT
    v_prob,
    GREATEST(0, -COALESCE(v_mom, 0))::NUMERIC,
    LEAST(1, COALESCE(v_vol, 0))::NUMERIC,
    COALESCE(v_mom, 0)::NUMERIC,
    v_z::NUMERIC,
    jsonb_build_object(
      'performance_index', v_perf,
      'momentum_score', v_mom,
      'volatility_index', v_vol,
      'forecast_direction', v_dir,
      'confidence_score', v_conf,
      'z_recent', v_z,
      'model', 'baseline-v1'
    );
END;
$$;

-- Bulk ranking: writes a fresh batch into risk_ranking_predictions
CREATE OR REPLACE FUNCTION public.compute_risk_ranking_baseline(p_top_n INTEGER DEFAULT 200)
RETURNS TABLE (batch_id UUID, rows_inserted INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch UUID := gen_random_uuid();
  v_count INTEGER;
BEGIN
  WITH latest AS (
    SELECT DISTINCT ON (iso3, domain)
      iso3, domain, performance_index, momentum_score, volatility_index,
      forecast_direction, confidence_score, snapshot_date
    FROM country_performance_snapshots
    WHERE snapshot_date >= CURRENT_DATE - INTERVAL '14 days'
    ORDER BY iso3, domain, snapshot_date DESC
  ),
  scored AS (
    SELECT
      iso3,
      domain,
      performance_index,
      momentum_score,
      volatility_index,
      forecast_direction,
      confidence_score,
      LEAST(0.99, GREATEST(0.01,
        0.35 * GREATEST(0, -COALESCE(momentum_score, 0))
        + 0.25 * LEAST(1, COALESCE(volatility_index, 0))
        + 0.25 * LEAST(1, GREATEST(0, ((50 - performance_index) / NULLIF(GREATEST(volatility_index * 100, 5), 0)) / 3.0))
        + 0.15 * (CASE WHEN forecast_direction = 'decreasing' THEN 1 WHEN forecast_direction = 'stable' THEN 0.4 ELSE 0 END)
      )) AS prob
    FROM latest
  ),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY prob DESC) AS rnk
    FROM scored
  )
  INSERT INTO risk_ranking_predictions (
    country_iso3, domain, risk_probability, rank_position, horizon_days,
    factors, model_version, generation_batch_id
  )
  SELECT
    iso3,
    domain,
    prob::NUMERIC,
    rnk::INTEGER,
    7,
    jsonb_build_object(
      'performance_index', performance_index,
      'momentum_score', momentum_score,
      'volatility_index', volatility_index,
      'forecast_direction', forecast_direction,
      'confidence_score', confidence_score
    ),
    'baseline-v1',
    v_batch
  FROM ranked
  WHERE rnk <= p_top_n;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_batch, v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.score_country_domain_risk(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_risk_ranking_baseline(INTEGER) TO authenticated, service_role;