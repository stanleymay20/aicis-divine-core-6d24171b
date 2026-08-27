-- AICIS Legacy Probabilistic Simulation Quarantine v1
--
-- This subsystem has no committed executable writer. Historical defaults made
-- absence look like zero risk and empty JSON look like a confidence interval.
-- Preserve legacy values for audit, withhold them from canonical fields, and
-- restrict future writes to service_role until a governed model is introduced.

ALTER TABLE public.probabilistic_simulation_runs
  ALTER COLUMN run_count DROP DEFAULT,
  ALTER COLUMN baseline_risk DROP DEFAULT,
  ALTER COLUMN mean_projected_risk DROP DEFAULT,
  ALTER COLUMN p05_projected_risk DROP DEFAULT,
  ALTER COLUMN p50_projected_risk DROP DEFAULT,
  ALTER COLUMN p95_projected_risk DROP DEFAULT,
  ALTER COLUMN confidence_interval DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_legacy_baseline_risk numeric,
  ADD COLUMN IF NOT EXISTS reported_legacy_mean_projected_risk numeric,
  ADD COLUMN IF NOT EXISTS reported_legacy_p05_projected_risk numeric,
  ADD COLUMN IF NOT EXISTS reported_legacy_p50_projected_risk numeric,
  ADD COLUMN IF NOT EXISTS reported_legacy_p95_projected_risk numeric,
  ADD COLUMN IF NOT EXISTS reported_legacy_confidence_interval jsonb,
  ADD COLUMN IF NOT EXISTS simulation_semantics text NOT NULL DEFAULT 'legacy_probabilistic_simulation_unverified',
  ADD COLUMN IF NOT EXISTS baseline_risk_semantics text,
  ADD COLUMN IF NOT EXISTS projected_risk_semantics text,
  ADD COLUMN IF NOT EXISTS quantile_semantics text,
  ADD COLUMN IF NOT EXISTS interval_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unknown';

UPDATE public.probabilistic_simulation_runs
SET
  reported_legacy_baseline_risk = COALESCE(reported_legacy_baseline_risk, baseline_risk),
  reported_legacy_mean_projected_risk = COALESCE(reported_legacy_mean_projected_risk, mean_projected_risk),
  reported_legacy_p05_projected_risk = COALESCE(reported_legacy_p05_projected_risk, p05_projected_risk),
  reported_legacy_p50_projected_risk = COALESCE(reported_legacy_p50_projected_risk, p50_projected_risk),
  reported_legacy_p95_projected_risk = COALESCE(reported_legacy_p95_projected_risk, p95_projected_risk),
  reported_legacy_confidence_interval = COALESCE(reported_legacy_confidence_interval, confidence_interval),
  baseline_risk = NULL,
  mean_projected_risk = NULL,
  p05_projected_risk = NULL,
  p50_projected_risk = NULL,
  p95_projected_risk = NULL,
  confidence_interval = NULL,
  baseline_risk_semantics = COALESCE(baseline_risk_semantics, 'withheld_legacy_baseline_risk_semantics_unverified'),
  projected_risk_semantics = COALESCE(projected_risk_semantics, 'withheld_legacy_projected_risk_semantics_unverified'),
  quantile_semantics = COALESCE(quantile_semantics, 'withheld_legacy_quantile_semantics_unverified'),
  interval_semantics = COALESCE(interval_semantics, 'withheld_legacy_confidence_interval_semantics_unverified'),
  evidence_status = 'legacy_unknown'
WHERE simulation_semantics = 'legacy_probabilistic_simulation_unverified';

ALTER TABLE public.probabilistic_simulation_samples
  ALTER COLUMN sampled_risk DROP DEFAULT,
  ALTER COLUMN sampled_impact DROP DEFAULT,
  ALTER COLUMN sampled_escalation DROP DEFAULT,
  ALTER COLUMN sampled_humanitarian_pressure DROP DEFAULT,
  ALTER COLUMN sampled_economic_pressure DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_legacy_sample_values jsonb,
  ADD COLUMN IF NOT EXISTS sample_semantics text NOT NULL DEFAULT 'legacy_sample_semantics_unverified';

UPDATE public.probabilistic_simulation_samples
SET
  reported_legacy_sample_values = COALESCE(
    reported_legacy_sample_values,
    jsonb_build_object(
      'sampled_risk', sampled_risk,
      'sampled_impact', sampled_impact,
      'sampled_escalation', sampled_escalation,
      'sampled_humanitarian_pressure', sampled_humanitarian_pressure,
      'sampled_economic_pressure', sampled_economic_pressure
    )
  ),
  sampled_risk = NULL,
  sampled_impact = NULL,
  sampled_escalation = NULL,
  sampled_humanitarian_pressure = NULL,
  sampled_economic_pressure = NULL,
  sample_semantics = 'withheld_legacy_sample_semantics_unverified';

ALTER TABLE public.probabilistic_simulation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.probabilistic_simulation_samples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read probabilistic simulation runs"
  ON public.probabilistic_simulation_runs;
CREATE POLICY "Authenticated read probabilistic simulation runs"
  ON public.probabilistic_simulation_runs
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role writes probabilistic simulation runs"
  ON public.probabilistic_simulation_runs;
CREATE POLICY "Service role writes probabilistic simulation runs"
  ON public.probabilistic_simulation_runs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read probabilistic simulation samples"
  ON public.probabilistic_simulation_samples;
CREATE POLICY "Authenticated read probabilistic simulation samples"
  ON public.probabilistic_simulation_samples
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role writes probabilistic simulation samples"
  ON public.probabilistic_simulation_samples;
CREATE POLICY "Service role writes probabilistic simulation samples"
  ON public.probabilistic_simulation_samples
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.probabilistic_simulation_runs IS
  'Legacy simulation subsystem retained for audit only. Canonical probability/interval fields are withheld until a governed executable model and evaluation contract exist.';
COMMENT ON TABLE public.probabilistic_simulation_samples IS
  'Legacy simulation samples retained for audit only. Historical default-zero fields are quarantined in reported_legacy_sample_values.';
