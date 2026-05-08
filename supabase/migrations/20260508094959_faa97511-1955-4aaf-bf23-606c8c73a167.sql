CREATE OR REPLACE FUNCTION public.is_org_member(_org_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.org_id = _org_id
      AND om.user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_owner(_org_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = _org_id
      AND o.owner_id = _user_id
  );
$$;

DROP POLICY IF EXISTS "org_members_can_view_nonbilling" ON public.organizations;
DROP POLICY IF EXISTS "org_owner_full_view" ON public.organizations;
DROP POLICY IF EXISTS "org_owners_can_update" ON public.organizations;
DROP POLICY IF EXISTS "members_can_view_own_orgs" ON public.organization_members;
DROP POLICY IF EXISTS "owners_can_manage_members" ON public.organization_members;

CREATE POLICY "org_members_can_view_organizations"
ON public.organizations
FOR SELECT
TO authenticated
USING (
  owner_id = auth.uid()
  OR public.is_org_member(id, auth.uid())
);

CREATE POLICY "org_owners_can_update_organizations"
ON public.organizations
FOR UPDATE
TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "org_members_can_view_memberships"
ON public.organization_members
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_org_owner(org_id, auth.uid())
);

CREATE POLICY "org_owners_can_manage_memberships"
ON public.organization_members
FOR ALL
TO authenticated
USING (public.is_org_owner(org_id, auth.uid()))
WITH CHECK (public.is_org_owner(org_id, auth.uid()));