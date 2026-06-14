
-- Normalize an organizations.tier value into the canonical access tier
CREATE OR REPLACE FUNCTION public.normalize_tier(_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(coalesce(_raw, ''))
    WHEN 'enterprise' THEN 'enterprise'
    WHEN 'sovereign'  THEN 'sovereign'
    WHEN 'pro'        THEN 'sovereign'  -- treat legacy 'pro' as sovereign
    ELSE 'free'
  END
$$;

-- Returns the highest tier across the user's org memberships + owned orgs
CREATE OR REPLACE FUNCTION public.get_user_tier(_user_id uuid DEFAULT auth.uid())
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH tiers AS (
    SELECT public.normalize_tier(o.tier) AS t
    FROM public.organizations o
    LEFT JOIN public.organization_members m ON m.org_id = o.id
    WHERE _user_id IS NOT NULL
      AND (o.owner_id = _user_id OR m.user_id = _user_id)
  )
  SELECT COALESCE(
    (SELECT t FROM tiers WHERE t = 'enterprise' LIMIT 1),
    (SELECT t FROM tiers WHERE t = 'sovereign'  LIMIT 1),
    'free'
  )
$$;

GRANT EXECUTE ON FUNCTION public.normalize_tier(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_tier(uuid) TO authenticated, service_role;
