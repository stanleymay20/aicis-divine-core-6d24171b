REVOKE EXECUTE ON FUNCTION public.expire_stale_risk_actions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_stale_risk_actions() TO authenticated, service_role;