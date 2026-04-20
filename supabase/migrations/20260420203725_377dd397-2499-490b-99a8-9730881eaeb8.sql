-- Tighten search_path on helper functions
ALTER FUNCTION public.refresh_risk_rankings_current() SET search_path = public;
ALTER FUNCTION public.wilson_interval(numeric, numeric, numeric) SET search_path = public;
ALTER FUNCTION public.compute_risk_scores() SET search_path = public;
ALTER FUNCTION public.compute_cross_domain_influence() SET search_path = public;
ALTER FUNCTION public.timeout_zombie_jobs() SET search_path = public;

-- Revoke direct API access to materialized view; expose via security_invoker view
REVOKE ALL ON public.risk_rankings_current FROM anon, authenticated;

CREATE OR REPLACE VIEW public.risk_rankings_current_v
WITH (security_invoker = true) AS
SELECT * FROM public.risk_rankings_current;

GRANT SELECT ON public.risk_rankings_current_v TO authenticated;