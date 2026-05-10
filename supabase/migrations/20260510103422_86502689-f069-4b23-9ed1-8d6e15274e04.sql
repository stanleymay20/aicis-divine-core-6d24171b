-- Drop the overly broad SELECT policy that exposed Stripe IDs to all members
DROP POLICY IF EXISTS org_members_can_view_organizations ON public.organizations;
DROP POLICY IF EXISTS org_members_can_view_nonbilling ON public.organizations;

-- Owner-only SELECT on the base table (owners need full row including billing IDs)
CREATE POLICY "org_owners_can_view_organizations"
ON public.organizations
FOR SELECT
TO authenticated
USING (owner_id = auth.uid());

-- Platform admins retain full visibility
CREATE POLICY "admins_can_view_organizations"
ON public.organizations
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));
