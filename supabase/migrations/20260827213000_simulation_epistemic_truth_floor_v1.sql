-- AICIS Simulation Epistemic Truth Floor v1
--
-- Simulations are counterfactual/sensitivity calculations, not observations.
-- Synthetic Monte Carlo draws from operator/system-specified distributions do not
-- create epistemic confidence or real-world prediction intervals.

ALTER TABLE public.simulation_runs
  ALTER COLUMN confidence DROP DEFAULT,
  ALTER COLUMN n_iterations DROP DEFAULT,
  ALTER COLUMN cascade_depth DROP DEFAULT;

ALTER TABLE public.simulation_runs
  ADD COLUMN IF NOT EXISTS reported_legacy_confidence numeric,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS reported_legacy_estimated_global_impact numeric,
  ADD COLUMN IF NOT EXISTS impact_semantics text,
  ADD COLUMN IF NOT EXISTS simulated_aggregate_impact numeric
    CHECK (simulated_aggregate_impact IS NULL OR simulated_aggregate_impact >= 0),
  ADD COLUMN IF NOT EXISTS reported_legacy_p10 numeric,
  ADD COLUMN IF NOT EXISTS reported_legacy_p50 numeric,
  ADD COLUMN IF NOT EXISTS reported_legacy_p90 numeric,
  ADD COLUMN IF NOT EXISTS uncertainty_semantics text,
  ADD COLUMN IF NOT EXISTS simulation_semantics text NOT NULL DEFAULT 'legacy_unverified_simulation',
  ADD COLUMN IF NOT EXISTS baseline_semantics text,
  ADD COLUMN IF NOT EXISTS baseline_snapshot_min_date date,
  ADD COLUMN IF NOT EXISTS baseline_snapshot_max_date date,
  ADD COLUMN IF NOT EXISTS baseline_target_count integer
    CHECK (baseline_target_count IS NULL OR baseline_target_count >= 0),
  ADD COLUMN IF NOT EXISTS baseline_excluded_count integer
    CHECK (baseline_excluded_count IS NULL OR baseline_excluded_count >= 0),
  ADD COLUMN IF NOT EXISTS baseline_coverage_status text,
  ADD COLUMN IF NOT EXISTS iteration_count_semantics text,
  ADD COLUMN IF NOT EXISTS cascade_semantics text,
  ADD COLUMN IF NOT EXISTS distribution_semantics text,
  ADD COLUMN IF NOT EXISTS affected_countries_semantics text,
  ADD COLUMN IF NOT EXISTS assumptions jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Historical rows are preserved, but legacy numbers are moved out of canonical
-- confidence/impact/quantile fields where their semantics cannot be established.
UPDATE public.simulation_runs
SET
  reported_legacy_confidence = COALESCE(reported_legacy_confidence, confidence),
  confidence = NULL,
  confidence_semantics = COALESCE(confidence_semantics, 'withheld_legacy_simulation_confidence_semantics_unverified')
WHERE confidence IS NOT NULL;

UPDATE public.simulation_runs
SET
  reported_legacy_estimated_global_impact = COALESCE(reported_legacy_estimated_global_impact, estimated_global_impact),
  estimated_global_impact = NULL,
  impact_semantics = COALESCE(impact_semantics, 'withheld_legacy_global_impact_semantics_unverified')
WHERE estimated_global_impact IS NOT NULL;

UPDATE public.simulation_runs
SET
  reported_legacy_p10 = COALESCE(reported_legacy_p10, p10),
  reported_legacy_p50 = COALESCE(reported_legacy_p50, p50),
  reported_legacy_p90 = COALESCE(reported_legacy_p90, p90),
  p10 = NULL,
  p50 = NULL,
  p90 = NULL,
  uncertainty_semantics = COALESCE(uncertainty_semantics, 'withheld_legacy_simulation_quantile_semantics_unverified')
WHERE p10 IS NOT NULL OR p50 IS NOT NULL OR p90 IS NOT NULL;

UPDATE public.simulation_runs
SET
  iteration_count_semantics = COALESCE(iteration_count_semantics, 'legacy_iteration_count_semantics_unverified'),
  cascade_semantics = COALESCE(cascade_semantics, 'legacy_cascade_semantics_unverified'),
  distribution_semantics = COALESCE(distribution_semantics, 'legacy_distribution_semantics_unverified'),
  affected_countries_semantics = COALESCE(affected_countries_semantics, 'legacy_affected_country_semantics_unverified'),
  baseline_semantics = COALESCE(baseline_semantics, 'legacy_baseline_semantics_unverified')
WHERE simulation_semantics = 'legacy_unverified_simulation';

CREATE TABLE IF NOT EXISTS public.simulation_abstentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_name text,
  shock_domain text,
  shock_iso3 text,
  requested_input jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  baseline_candidates integer CHECK (baseline_candidates IS NULL OR baseline_candidates >= 0),
  baseline_usable integer CHECK (baseline_usable IS NULL OR baseline_usable >= 0),
  baseline_excluded integer CHECK (baseline_excluded IS NULL OR baseline_excluded >= 0),
  evidence_semantics text NOT NULL DEFAULT 'simulation_withheld_no_result_issued',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_simulation_abstentions_created
  ON public.simulation_abstentions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_simulation_abstentions_subject
  ON public.simulation_abstentions(shock_domain, shock_iso3, created_at DESC);

ALTER TABLE public.simulation_abstentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read simulation abstentions"
  ON public.simulation_abstentions;
CREATE POLICY "Authenticated read simulation abstentions"
  ON public.simulation_abstentions
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role writes simulation abstentions"
  ON public.simulation_abstentions;
CREATE POLICY "Service role writes simulation abstentions"
  ON public.simulation_abstentions
  FOR INSERT TO service_role
  WITH CHECK (true);

GRANT SELECT ON public.simulation_abstentions TO authenticated;
GRANT SELECT, INSERT ON public.simulation_abstentions TO service_role;

DROP TRIGGER IF EXISTS trg_simulation_abstentions_immutable
  ON public.simulation_abstentions;
CREATE TRIGGER trg_simulation_abstentions_immutable
  BEFORE UPDATE OR DELETE ON public.simulation_abstentions
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

-- No simulation output currently qualifies as epistemic confidence. If an old or
-- future writer attempts to populate confidence, preserve the raw value but
-- withhold it from the canonical field until a separately governed contract is
-- introduced.
CREATE OR REPLACE FUNCTION public.guard_simulation_truth_floor_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.confidence IS NOT NULL THEN
    NEW.reported_legacy_confidence := COALESCE(NEW.reported_legacy_confidence, NEW.confidence);
    NEW.confidence := NULL;
    NEW.confidence_semantics := 'withheld_simulation_numeric_confidence_not_empirical_confidence';
  END IF;

  IF NEW.estimated_global_impact IS NOT NULL THEN
    NEW.reported_legacy_estimated_global_impact := COALESCE(
      NEW.reported_legacy_estimated_global_impact,
      NEW.estimated_global_impact
    );
    NEW.estimated_global_impact := NULL;
    NEW.impact_semantics := CASE
      WHEN NEW.impact_semantics IS NULL OR btrim(NEW.impact_semantics) = ''
        THEN 'withheld_unlabeled_global_impact'
      ELSE NEW.impact_semantics
    END;
  END IF;

  IF (NEW.p10 IS NOT NULL OR NEW.p50 IS NOT NULL OR NEW.p90 IS NOT NULL)
     AND (NEW.uncertainty_semantics IS NULL OR btrim(NEW.uncertainty_semantics) = '') THEN
    NEW.reported_legacy_p10 := COALESCE(NEW.reported_legacy_p10, NEW.p10);
    NEW.reported_legacy_p50 := COALESCE(NEW.reported_legacy_p50, NEW.p50);
    NEW.reported_legacy_p90 := COALESCE(NEW.reported_legacy_p90, NEW.p90);
    NEW.p10 := NULL;
    NEW.p50 := NULL;
    NEW.p90 := NULL;
    NEW.uncertainty_semantics := 'withheld_unlabeled_simulation_quantiles';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_simulation_truth_floor_v1
  ON public.simulation_runs;
CREATE TRIGGER trg_guard_simulation_truth_floor_v1
  BEFORE INSERT OR UPDATE ON public.simulation_runs
  FOR EACH ROW EXECUTE FUNCTION public.guard_simulation_truth_floor_v1();

-- The historical SQL RPC used arbitrary fallbacks (including intensity=0.3 and
-- affected-count=1). No committed executable caller exists. Quarantine it so the
-- governed Edge Function is the sole supported simulation execution path.
CREATE OR REPLACE FUNCTION public.run_simulation(
  p_name text,
  p_domain text,
  p_magnitude numeric,
  p_iso3 text DEFAULT NULL,
  p_direction text DEFAULT 'down'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'legacy_unsafe_simulation_rpc_quarantined_use_run_simulation_edge_function';
END;
$$;

REVOKE ALL ON FUNCTION public.run_simulation(text, text, numeric, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON COLUMN public.simulation_runs.confidence IS
  'Reserved canonical epistemic confidence. v1 simulation outputs do not populate this field.';
COMMENT ON COLUMN public.simulation_runs.simulated_aggregate_impact IS
  'Aggregate magnitude produced by the declared synthetic sensitivity transform over included baseline targets. Not observed global impact.';
COMMENT ON COLUMN public.simulation_runs.p10 IS
  '10th percentile of the declared synthetic simulation output distribution when uncertainty_semantics is populated. Not a real-world prediction interval.';
COMMENT ON COLUMN public.simulation_runs.p50 IS
  'Median of the declared synthetic simulation output distribution when uncertainty_semantics is populated. Not a real-world prediction interval.';
COMMENT ON COLUMN public.simulation_runs.p90 IS
  '90th percentile of the declared synthetic simulation output distribution when uncertainty_semantics is populated. Not a real-world prediction interval.';
COMMENT ON TABLE public.simulation_abstentions IS
  'Append-only audit of requested simulations for which AICIS withheld output because required baseline evidence or valid inputs were unavailable.';
