-- ============================================================
-- ENTERPRISE SGI UPGRADE — Phases 1-7 (corrected)
-- ============================================================

-- ── PHASE 1: TRAINING DATASET RIGOR ─────────────────────────
ALTER TABLE public.training_dataset_aicis
  ADD COLUMN IF NOT EXISTS feature_hash text,
  ADD COLUMN IF NOT EXISTS label_horizon_end_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_leakage_safe boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS feature_version text DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS data_density_score numeric DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_training_dataset_feature_hash
  ON public.training_dataset_aicis(feature_hash);
CREATE INDEX IF NOT EXISTS idx_training_dataset_horizon_end
  ON public.training_dataset_aicis(label_horizon_end_at);

CREATE TABLE IF NOT EXISTS public.training_dataset_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_row_id uuid REFERENCES public.training_dataset_aicis(id) ON DELETE CASCADE,
  split_name text NOT NULL CHECK (split_name IN ('train','val','test')),
  fold_index int NOT NULL DEFAULT 0,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  feature_version text DEFAULT 'v1',
  created_at timestamptz DEFAULT now(),
  UNIQUE (training_row_id, fold_index)
);
ALTER TABLE public.training_dataset_splits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "splits_read_authenticated" ON public.training_dataset_splits
  FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.feature_lineage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_row_id uuid REFERENCES public.training_dataset_aicis(id) ON DELETE CASCADE,
  source_metric_ids uuid[] DEFAULT '{}'::uuid[],
  source_event_ids uuid[] DEFAULT '{}'::uuid[],
  computation_ts timestamptz DEFAULT now(),
  feature_version text DEFAULT 'v1',
  notes jsonb DEFAULT '{}'::jsonb
);
ALTER TABLE public.feature_lineage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lineage_read_authenticated" ON public.feature_lineage
  FOR SELECT TO authenticated USING (true);

-- ── PHASE 1B: RISK SCORES (0-100 NORMALIZED SURFACE) ───────
CREATE TABLE IF NOT EXISTS public.risk_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso3 text NOT NULL,
  domain text NOT NULL,
  score numeric NOT NULL CHECK (score BETWEEN 0 AND 100),
  components jsonb DEFAULT '{}'::jsonb,
  computed_at timestamptz DEFAULT now(),
  generation_batch_id uuid DEFAULT gen_random_uuid()
);
CREATE INDEX IF NOT EXISTS idx_risk_scores_lookup
  ON public.risk_scores(country_iso3, domain, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_scores_batch
  ON public.risk_scores(generation_batch_id);
ALTER TABLE public.risk_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "risk_scores_read_authenticated" ON public.risk_scores
  FOR SELECT TO authenticated USING (true);

-- ── PHASE 1C: RISK RANKING DEPTH ────────────────────────────
ALTER TABLE public.risk_ranking_predictions
  ADD COLUMN IF NOT EXISTS confidence_lower numeric,
  ADD COLUMN IF NOT EXISTS confidence_upper numeric,
  ADD COLUMN IF NOT EXISTS evidence_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS proxy_share numeric DEFAULT 0;

-- Materialized view for fast top-N reads (refreshed every 15min)
DROP MATERIALIZED VIEW IF EXISTS public.risk_rankings_current;
CREATE MATERIALIZED VIEW public.risk_rankings_current AS
SELECT
  p.country_iso3,
  p.domain,
  p.horizon_days,
  p.risk_probability,
  p.rank_position,
  p.confidence_lower,
  p.confidence_upper,
  p.evidence_count,
  p.proxy_share,
  p.factors,
  p.model_version,
  p.generated_at,
  p.generation_batch_id
FROM public.risk_ranking_predictions p
INNER JOIN (
  SELECT generation_batch_id, MAX(generated_at) AS gen_ts
  FROM public.risk_ranking_predictions
  GROUP BY generation_batch_id
  ORDER BY MAX(generated_at) DESC
  LIMIT 1
) latest ON p.generation_batch_id = latest.generation_batch_id;

CREATE INDEX IF NOT EXISTS idx_risk_rankings_current_lookup
  ON public.risk_rankings_current(domain, horizon_days, rank_position);

-- ── PHASE 2: ML LAYER RIGOR ─────────────────────────────────
ALTER TABLE public.risk_ml_predictions
  ADD COLUMN IF NOT EXISTS raw_score numeric,
  ADD COLUMN IF NOT EXISTS calibrated_score numeric,
  ADD COLUMN IF NOT EXISTS prediction_interval_lower numeric,
  ADD COLUMN IF NOT EXISTS prediction_interval_upper numeric,
  ADD COLUMN IF NOT EXISTS feature_contributions jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS audit_hash text;

CREATE INDEX IF NOT EXISTS idx_ml_predictions_audit_hash
  ON public.risk_ml_predictions(audit_hash);

CREATE TABLE IF NOT EXISTS public.model_calibration_bins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version text NOT NULL,
  domain text NOT NULL,
  bin_lower numeric NOT NULL,
  bin_upper numeric NOT NULL,
  predicted_mean numeric NOT NULL,
  empirical_rate numeric NOT NULL,
  sample_count int NOT NULL DEFAULT 0,
  computed_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calibration_lookup
  ON public.model_calibration_bins(model_version, domain, bin_lower);
ALTER TABLE public.model_calibration_bins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "calibration_read_authenticated" ON public.model_calibration_bins
  FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.ml_inference_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id uuid REFERENCES public.risk_ml_predictions(id) ON DELETE CASCADE,
  feature_hash text NOT NULL,
  model_version text NOT NULL,
  weights_hash text NOT NULL,
  combined_hash text NOT NULL,
  previous_audit_hash text,
  generated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ml_audit_chain
  ON public.ml_inference_audit(generated_at DESC);
ALTER TABLE public.ml_inference_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ml_audit_read_authenticated" ON public.ml_inference_audit
  FOR SELECT TO authenticated USING (true);

-- ── PHASE 3: DECISION ENGINE DEPTH ──────────────────────────
ALTER TABLE public.risk_action_recommendations
  ADD COLUMN IF NOT EXISTS counterfactual_md text,
  ADD COLUMN IF NOT EXISTS expected_roi_lower numeric,
  ADD COLUMN IF NOT EXISTS expected_roi_upper numeric,
  ADD COLUMN IF NOT EXISTS evidence_chain jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS requires_dual_approval boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_approver uuid,
  ADD COLUMN IF NOT EXISTS second_approver uuid,
  ADD COLUMN IF NOT EXISTS lifecycle_audit_hash text;

-- ── PHASE 4: LEARNING LOOP RIGOR ────────────────────────────
ALTER TABLE public.model_performance_log
  ADD COLUMN IF NOT EXISTS ece numeric,
  ADD COLUMN IF NOT EXISTS auc numeric,
  ADD COLUMN IF NOT EXISTS bias_by_region jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS realization_count int DEFAULT 0;

ALTER TABLE public.risk_prediction_realizations
  ADD COLUMN IF NOT EXISTS prediction_hash text,
  ADD COLUMN IF NOT EXISTS previous_realization_hash text,
  ADD COLUMN IF NOT EXISTS chain_hash text;

CREATE INDEX IF NOT EXISTS idx_realizations_chain
  ON public.risk_prediction_realizations(chain_hash);

CREATE TABLE IF NOT EXISTS public.model_promotion_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  champion_version text NOT NULL,
  challenger_version text NOT NULL,
  domain text NOT NULL,
  champion_brier numeric,
  challenger_brier numeric,
  champion_ece numeric,
  challenger_ece numeric,
  champion_auc numeric,
  challenger_auc numeric,
  realization_count int NOT NULL DEFAULT 0,
  p_value numeric,
  decision text NOT NULL CHECK (decision IN ('promote','reject','insufficient_data')),
  decided_at timestamptz DEFAULT now(),
  notes jsonb DEFAULT '{}'::jsonb
);
ALTER TABLE public.model_promotion_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "promotion_read_authenticated" ON public.model_promotion_decisions
  FOR SELECT TO authenticated USING (true);

-- ── PHASE 5: GRAPH INTELLIGENCE DEPTH ───────────────────────
ALTER TABLE public.risk_propagation_score
  ADD COLUMN IF NOT EXISTS decay_factor numeric DEFAULT 1.0;

CREATE TABLE IF NOT EXISTS public.cross_domain_influence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_domain text NOT NULL,
  target_domain text NOT NULL,
  region text,
  transfer_strength numeric NOT NULL,
  sample_size int NOT NULL DEFAULT 0,
  lag_days int DEFAULT 7,
  computed_at timestamptz DEFAULT now(),
  generation_batch_id uuid DEFAULT gen_random_uuid()
);
CREATE INDEX IF NOT EXISTS idx_cross_domain_lookup
  ON public.cross_domain_influence(source_domain, target_domain, region);
ALTER TABLE public.cross_domain_influence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cross_domain_read_authenticated" ON public.cross_domain_influence
  FOR SELECT TO authenticated USING (true);

-- ── PHASE 6: SIMULATION DEPTH (MONTE CARLO) ─────────────────
ALTER TABLE public.simulation_runs
  ADD COLUMN IF NOT EXISTS n_iterations int DEFAULT 1,
  ADD COLUMN IF NOT EXISTS p10 numeric,
  ADD COLUMN IF NOT EXISTS p50 numeric,
  ADD COLUMN IF NOT EXISTS p90 numeric,
  ADD COLUMN IF NOT EXISTS cascade_depth int DEFAULT 1,
  ADD COLUMN IF NOT EXISTS seed bigint,
  ADD COLUMN IF NOT EXISTS shock_input jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS result_distribution jsonb DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.simulation_iterations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id uuid REFERENCES public.simulation_runs(id) ON DELETE CASCADE,
  iteration_index int NOT NULL,
  global_impact numeric NOT NULL,
  affected_count int DEFAULT 0,
  per_country jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sim_iter_lookup
  ON public.simulation_iterations(simulation_id, iteration_index);
ALTER TABLE public.simulation_iterations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sim_iter_read_authenticated" ON public.simulation_iterations
  FOR SELECT TO authenticated USING (true);

-- ── PHASE 7: API AUDIT HASH CHAIN ───────────────────────────
CREATE TABLE IF NOT EXISTS public.api_request_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid,
  org_id uuid,
  endpoint text NOT NULL,
  method text NOT NULL,
  request_hash text NOT NULL,
  response_status int NOT NULL,
  response_hash text,
  previous_chain_hash text,
  chain_hash text NOT NULL,
  latency_ms int,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_audit_chain
  ON public.api_request_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_audit_org
  ON public.api_request_audit(org_id, created_at DESC);
ALTER TABLE public.api_request_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "api_audit_read_own_org" ON public.api_request_audit
  FOR SELECT TO authenticated
  USING (
    org_id IN (
      SELECT om.org_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );

-- ── HELPER FUNCTIONS ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_risk_rankings_current()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.risk_rankings_current;
END;
$$;

CREATE OR REPLACE FUNCTION public.wilson_interval(
  p_successes numeric, p_total numeric, p_z numeric DEFAULT 1.96
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_p numeric;
  v_denom numeric;
  v_centre numeric;
  v_margin numeric;
BEGIN
  IF p_total IS NULL OR p_total <= 0 THEN
    RETURN jsonb_build_object('lower', 0, 'upper', 1);
  END IF;
  v_p := p_successes / p_total;
  v_denom := 1 + (p_z * p_z) / p_total;
  v_centre := (v_p + (p_z * p_z) / (2 * p_total)) / v_denom;
  v_margin := (p_z * sqrt((v_p * (1 - v_p) + (p_z * p_z) / (4 * p_total)) / p_total)) / v_denom;
  RETURN jsonb_build_object(
    'lower', GREATEST(0, v_centre - v_margin),
    'upper', LEAST(1, v_centre + v_margin)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_risk_scores()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id uuid := gen_random_uuid();
  v_inserted int := 0;
BEGIN
  INSERT INTO public.risk_scores (
    country_iso3, domain, score, components, generation_batch_id
  )
  SELECT
    country_iso3,
    domain,
    LEAST(100, GREATEST(0,
      50
      + COALESCE(trend_30d, 0) * 30
      + COALESCE(volatility, 0) * 20
      + COALESCE(event_severity_avg, 0) * 0.25
      + COALESCE(neighbor_risk_score, 0) * 15
      + COALESCE(anomaly_score, 0) * 10
    )) AS score,
    jsonb_build_object(
      'trend_30d', trend_30d,
      'volatility', volatility,
      'event_severity_avg', event_severity_avg,
      'neighbor_risk_score', neighbor_risk_score,
      'anomaly_score', anomaly_score,
      'feature_version', feature_version,
      'data_density_score', data_density_score
    ) AS components,
    v_batch_id
  FROM (
    SELECT DISTINCT ON (country_iso3, domain)
      country_iso3, domain, trend_30d, volatility,
      event_severity_avg, neighbor_risk_score, anomaly_score,
      feature_version, data_density_score
    FROM public.training_dataset_aicis
    WHERE is_leakage_safe = true
    ORDER BY country_iso3, domain, timestamp DESC
  ) latest;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  INSERT INTO public.automation_logs (job_name, status, message)
  VALUES ('compute_risk_scores', 'success',
    format('Inserted %s risk_scores (batch %s)', v_inserted, v_batch_id));

  RETURN jsonb_build_object('batch_id', v_batch_id, 'rows_inserted', v_inserted);
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_cross_domain_influence()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch uuid := gen_random_uuid();
  v_inserted int := 0;
BEGIN
  INSERT INTO public.cross_domain_influence (
    source_domain, target_domain, region, transfer_strength, sample_size, generation_batch_id
  )
  SELECT
    a.domain AS source_domain,
    b.domain AS target_domain,
    NULL::text AS region,
    LEAST(1.0, GREATEST(0.0, CORR(a.score, b.score))) AS transfer_strength,
    COUNT(*) AS sample_size,
    v_batch
  FROM public.risk_scores a
  JOIN public.risk_scores b
    ON a.country_iso3 = b.country_iso3
    AND a.computed_at = b.computed_at
    AND a.domain <> b.domain
  WHERE a.computed_at > now() - INTERVAL '30 days'
  GROUP BY a.domain, b.domain
  HAVING COUNT(*) >= 30 AND CORR(a.score, b.score) IS NOT NULL;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  INSERT INTO public.automation_logs (job_name, status, message)
  VALUES ('compute_cross_domain_influence', 'success',
    format('Inserted %s rows (batch %s)', v_inserted, v_batch));

  RETURN jsonb_build_object('batch_id', v_batch, 'rows_inserted', v_inserted);
END;
$$;

CREATE OR REPLACE FUNCTION public.timeout_zombie_jobs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  UPDATE public.automation_logs
     SET status = 'timeout',
         message = COALESCE(message,'') || ' [auto-timed-out after 1h]'
   WHERE status IN ('running','in_progress')
     AND executed_at < now() - INTERVAL '1 hour';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('zombies_terminated', v_count);
END;
$$;

-- ── PG_CRON SCHEDULES ──────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sgi-refresh-risk-rankings') THEN
    PERFORM cron.unschedule('sgi-refresh-risk-rankings');
  END IF;
  PERFORM cron.schedule('sgi-refresh-risk-rankings', '*/15 * * * *',
    $cron$ SELECT public.refresh_risk_rankings_current(); $cron$);

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sgi-compute-risk-scores') THEN
    PERFORM cron.unschedule('sgi-compute-risk-scores');
  END IF;
  PERFORM cron.schedule('sgi-compute-risk-scores', '7 * * * *',
    $cron$ SELECT public.compute_risk_scores(); $cron$);

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sgi-cross-domain-influence') THEN
    PERFORM cron.unschedule('sgi-cross-domain-influence');
  END IF;
  PERFORM cron.schedule('sgi-cross-domain-influence', '13 */6 * * *',
    $cron$ SELECT public.compute_cross_domain_influence(); $cron$);

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sgi-zombie-job-sweep') THEN
    PERFORM cron.unschedule('sgi-zombie-job-sweep');
  END IF;
  PERFORM cron.schedule('sgi-zombie-job-sweep', '23 * * * *',
    $cron$ SELECT public.timeout_zombie_jobs(); $cron$);
END $$;
