-- AICIS Audit #2 P0 remediation
-- 1) Protect the public intelligence cache from anonymous/authenticated writes.
-- 2) Prevent organization owners from self-escalating billing/access fields.
-- Service-role workers continue to bypass RLS and retain their server-side privileges.

DO $$
BEGIN
  IF to_regclass('public.public_intelligence_cache') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.public_intelligence_cache ENABLE ROW LEVEL SECURITY';

    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.public_intelligence_cache FROM anon';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.public_intelligence_cache FROM authenticated';

    EXECUTE 'DROP POLICY IF EXISTS "public_intelligence_cache_read" ON public.public_intelligence_cache';
    EXECUTE 'CREATE POLICY "public_intelligence_cache_read"
      ON public.public_intelligence_cache
      FOR SELECT
      TO anon, authenticated
      USING (true)';
  END IF;
END
$$;

-- RLS decides WHICH organization rows an owner may update, but a table-level
-- UPDATE grant previously allowed the owner to alter privileged billing/access
-- columns on that row. Replace it with a narrow column grant.
REVOKE UPDATE ON TABLE public.organizations FROM authenticated;

-- The only direct owner-editable organization field currently required by the
-- client is the workspace name. Billing/access mutations are server-side.
GRANT UPDATE (name) ON TABLE public.organizations TO authenticated;

-- Defense in depth: even if a broad UPDATE grant is accidentally restored,
-- reject client-role changes to access/billing authority fields.
CREATE OR REPLACE FUNCTION public.guard_organization_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     OR COALESCE(current_setting('request.jwt.claim.role', true), '') IN ('anon', 'authenticated') THEN
    IF NEW.tier IS DISTINCT FROM OLD.tier
       OR NEW.billing_status IS DISTINCT FROM OLD.billing_status
       OR NEW.monthly_api_quota IS DISTINCT FROM OLD.monthly_api_quota
       OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
       OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
       OR NEW.api_enabled IS DISTINCT FROM OLD.api_enabled
       OR NEW.max_api_keys IS DISTINCT FROM OLD.max_api_keys
       OR NEW.white_label_enabled IS DISTINCT FROM OLD.white_label_enabled THEN
      RAISE EXCEPTION 'privileged organization fields may only be changed by trusted server-side billing/access workflows'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_organization_privileged_fields
  ON public.organizations;

CREATE TRIGGER guard_organization_privileged_fields
BEFORE UPDATE ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.guard_organization_privileged_fields();

REVOKE ALL ON FUNCTION public.guard_organization_privileged_fields() FROM PUBLIC;
