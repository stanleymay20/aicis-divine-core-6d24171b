REVOKE EXECUTE ON FUNCTION public.rollup_provider_runs(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollup_provider_runs(int) TO service_role;