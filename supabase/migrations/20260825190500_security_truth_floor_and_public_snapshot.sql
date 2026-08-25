-- AICIS security truth floor + public intelligence least-privilege snapshot.
--
-- 1) Security incident/alert mutations are backend-only. Historical migrations
--    created broad INSERT policies; service_role already bypasses RLS, so client
--    INSERT access is unnecessary and unsafe.
-- 2) The public landing-page intelligence preview is exposed through one fixed,
--    argument-free SECURITY DEFINER function instead of giving the Edge Function
--    a service-role database client.

DROP POLICY IF EXISTS "w_si_sys" ON public.security_incidents;
DROP POLICY IF EXISTS "w_ca_sys" ON public.critical_alerts;
DROP POLICY IF EXISTS "Service role can insert security incidents" ON public.security_incidents;
DROP POLICY IF EXISTS "Service role can insert critical alerts" ON public.critical_alerts;

CREATE POLICY "Service role can insert security incidents"
  ON public.security_incidents
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can insert critical alerts"
  ON public.critical_alerts
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.public_intelligence_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'generated_at', now(),
    'stats', jsonb_build_object(
      'countries_tracked', (
        SELECT count(DISTINCT iso3)
        FROM public.country_performance_snapshots
        WHERE iso3 IS NOT NULL
      ),
      'snapshots', (SELECT count(*) FROM public.country_performance_snapshots),
      'ml_predictions', (SELECT count(*) FROM public.risk_ml_predictions),
      'simulations_run', (SELECT count(*) FROM public.simulation_runs),
      'audit_records', (SELECT count(*) FROM public.ml_inference_audit)
    ),
    'top_risks', COALESCE((
      SELECT jsonb_agg(to_jsonb(r))
      FROM (
        SELECT country_iso3, domain, risk_probability, confidence_lower,
               confidence_upper, generated_at, horizon_days, rank_position
        FROM public.risk_ranking_predictions
        ORDER BY risk_probability DESC NULLS LAST
        LIMIT 8
      ) r
    ), '[]'::jsonb),
    'top_predictions', COALESCE((
      SELECT jsonb_agg(to_jsonb(p))
      FROM (
        SELECT country_iso3, domain, calibrated_score, raw_score,
               prediction_interval_lower, prediction_interval_upper,
               horizon_days, audit_hash, model_version
        FROM public.risk_ml_predictions
        ORDER BY calibrated_score DESC NULLS LAST
        LIMIT 8
      ) p
    ), '[]'::jsonb),
    'recent_simulations', COALESCE((
      SELECT jsonb_agg(to_jsonb(s))
      FROM (
        SELECT scenario_name, shock_domain, shock_magnitude, p10, p50, p90,
               n_iterations, cascade_depth, created_at
        FROM public.simulation_runs
        ORDER BY created_at DESC
        LIMIT 3
      ) s
    ), '[]'::jsonb),
    'audit_samples', COALESCE((
      SELECT jsonb_agg(to_jsonb(a))
      FROM (
        SELECT model_version, weights_hash, combined_hash, previous_audit_hash,
               generated_at
        FROM public.ml_inference_audit
        ORDER BY generated_at DESC
        LIMIT 5
      ) a
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.public_intelligence_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_intelligence_snapshot() TO anon, authenticated;

COMMENT ON FUNCTION public.public_intelligence_snapshot() IS
  'Fixed, sanitized, read-only AICIS landing-page intelligence snapshot. No caller-supplied SQL inputs.';
