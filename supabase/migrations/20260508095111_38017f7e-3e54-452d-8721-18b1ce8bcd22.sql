GRANT SELECT (id, name, owner_id, tier, status, feature_flags, api_enabled, max_api_keys, monthly_api_quota, created_at, updated_at)
ON public.organizations TO authenticated;

GRANT SELECT (id, org_id, user_id, role, created_at)
ON public.organization_members TO authenticated;

GRANT SELECT (id, org_id, name, key_prefix, created_at, last_used_at, revoked, rate_limit_per_minute, scopes, expires_at)
ON public.api_keys TO authenticated;

GRANT SELECT, DELETE
ON public.webhook_subscriptions TO authenticated;

REVOKE ALL ON FUNCTION public.is_org_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_org_owner(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_owner(uuid, uuid) TO authenticated;