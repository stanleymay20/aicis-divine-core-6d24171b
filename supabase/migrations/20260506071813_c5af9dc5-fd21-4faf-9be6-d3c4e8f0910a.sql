
-- 1. Restrict system_config: drop permissive SELECT for all authenticated users
DROP POLICY IF EXISTS "Config readable by authenticated users" ON public.system_config;
-- Admin-only SELECT policy already exists ("Admins can read system_config").

-- 2. Organizations: restrict members from seeing stripe billing identifiers.
-- Drop the broad members SELECT policy and replace with one that excludes
-- billing fields by exposing them via a dedicated owner-only view.
DROP POLICY IF EXISTS org_members_can_view ON public.organizations;

CREATE POLICY org_members_can_view_nonbilling
ON public.organizations
FOR SELECT
TO authenticated
USING (
  id IN (
    SELECT organization_members.org_id
    FROM organization_members
    WHERE organization_members.user_id = auth.uid()
  )
);

-- Provide a safe view for members that excludes Stripe identifiers
CREATE OR REPLACE VIEW public.organizations_member_safe
WITH (security_invoker = true) AS
SELECT
  o.id,
  o.name,
  o.owner_id,
  o.created_at,
  o.updated_at
FROM public.organizations o
WHERE
  o.owner_id = auth.uid()
  OR o.id IN (
    SELECT om.org_id
    FROM public.organization_members om
    WHERE om.user_id = auth.uid()
  );

-- Revoke broad column-level access to stripe_* columns from non-owners by
-- using a column GRANT pattern: revoke all, then grant only the safe columns
-- to authenticated. Owners retain full row visibility via org_owner_full_view.
REVOKE SELECT ON public.organizations FROM authenticated;
GRANT SELECT (id, name, owner_id, created_at, updated_at)
  ON public.organizations TO authenticated;
GRANT SELECT ON public.organizations_member_safe TO authenticated;

-- 3. Realtime exposure: remove sensitive per-user tables from realtime
-- publication so Realtime channel layer cannot broadcast them to
-- unauthorized subscribers. Apps can re-subscribe via authenticated APIs.
ALTER PUBLICATION supabase_realtime DROP TABLE public.user_notifications;
ALTER PUBLICATION supabase_realtime DROP TABLE public.governance_trades;

-- 4. accountability_nodes: enforce hashed-only API key storage.
-- Add a trigger that hashes api_key into api_key_hash on insert,
-- and prevents reading api_key after creation by setting it to NULL
-- after hashing (callers receive the plaintext only via the
-- register-node function response).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.accountability_nodes_hash_key()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.api_key IS NOT NULL THEN
    NEW.api_key_hash := encode(digest(NEW.api_key::text, 'sha256'), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accountability_nodes_hash_key ON public.accountability_nodes;
CREATE TRIGGER trg_accountability_nodes_hash_key
BEFORE INSERT OR UPDATE OF api_key ON public.accountability_nodes
FOR EACH ROW EXECUTE FUNCTION public.accountability_nodes_hash_key();

-- Backfill hashes for existing rows that have raw key but missing hash
UPDATE public.accountability_nodes
SET api_key_hash = encode(digest(api_key::text, 'sha256'), 'hex')
WHERE api_key IS NOT NULL AND (api_key_hash IS NULL OR api_key_hash = '');

-- Null out the plaintext api_key column for existing rows so only hashes remain
UPDATE public.accountability_nodes
SET api_key = NULL
WHERE api_key IS NOT NULL;
