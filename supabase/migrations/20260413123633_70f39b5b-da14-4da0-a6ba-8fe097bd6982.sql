
-- Fix views to use security invoker
ALTER VIEW public.country_coverage_full SET (security_invoker = true);
ALTER VIEW public.canonical_reporting_countries SET (security_invoker = true);
ALTER VIEW public.country_reconciliation_audit SET (security_invoker = true);
