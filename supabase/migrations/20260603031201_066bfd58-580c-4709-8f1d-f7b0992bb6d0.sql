
CREATE TABLE IF NOT EXISTS public.federation_signing_keys (
  key_id text PRIMARY KEY,
  public_key text NOT NULL,
  algorithm text NOT NULL DEFAULT 'Ed25519',
  key_status text NOT NULL DEFAULT 'active' CHECK (key_status IN ('active','rotating','revoked','compromised')),
  is_active boolean NOT NULL DEFAULT false,
  rotation_policy_days int NOT NULL DEFAULT 180,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  notes text
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_one_active_fed_key ON public.federation_signing_keys (is_active) WHERE is_active = true;
GRANT SELECT ON public.federation_signing_keys TO anon, authenticated;
GRANT ALL ON public.federation_signing_keys TO service_role;
ALTER TABLE public.federation_signing_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fsk_public_read" ON public.federation_signing_keys FOR SELECT USING (true);
CREATE POLICY "fsk_service_all" ON public.federation_signing_keys FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE VIEW public.federation_active_key
WITH (security_invoker = true) AS
SELECT key_id, public_key, algorithm, rotation_policy_days, created_at, expires_at
FROM public.federation_signing_keys WHERE is_active = true AND key_status = 'active';
GRANT SELECT ON public.federation_active_key TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rotate_federation_key(
  p_new_key_id text, p_new_public_key text, p_rotation_days int DEFAULT 180
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  UPDATE public.federation_signing_keys
    SET is_active = false, key_status = 'rotating', rotated_at = now()
    WHERE is_active = true;
  INSERT INTO public.federation_signing_keys(key_id, public_key, key_status, is_active, rotation_policy_days, expires_at)
    VALUES (p_new_key_id, p_new_public_key, 'active', true, p_rotation_days, now() + (p_rotation_days || ' days')::interval);
  PERFORM public.ledger_append('federation_key_rotation', jsonb_build_object('new_key_id', p_new_key_id, 'ts', now()));
END;$fn$;
REVOKE EXECUTE ON FUNCTION public.rotate_federation_key(text,text,int) FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.federation_signed_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_hash text NOT NULL,
  key_id text NOT NULL REFERENCES public.federation_signing_keys(key_id),
  signature text NOT NULL,
  algorithm text NOT NULL DEFAULT 'Ed25519',
  payload_size_bytes int,
  signed_at timestamptz NOT NULL DEFAULT now(),
  verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_fsb_hash ON public.federation_signed_bundles (bundle_hash);
GRANT SELECT ON public.federation_signed_bundles TO anon, authenticated;
GRANT ALL ON public.federation_signed_bundles TO service_role;
ALTER TABLE public.federation_signed_bundles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fsb_public_read" ON public.federation_signed_bundles FOR SELECT USING (true);
CREATE POLICY "fsb_service_all" ON public.federation_signed_bundles FOR ALL TO service_role USING (true) WITH CHECK (true);
