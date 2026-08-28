-- Signed webhook replay guard v1
-- One-time webhook IDs provide replay protection for provider push integrations.

CREATE TABLE IF NOT EXISTS public.webhook_replay_nonces (
  provider TEXT NOT NULL,
  nonce TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  request_timestamp TIMESTAMPTZ,
  PRIMARY KEY (provider, nonce)
);

CREATE INDEX IF NOT EXISTS idx_webhook_replay_nonces_expires
  ON public.webhook_replay_nonces (expires_at);

ALTER TABLE public.webhook_replay_nonces ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.webhook_replay_nonces FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_webhook_nonce(
  _provider TEXT,
  _nonce TEXT,
  _request_timestamp TIMESTAMPTZ,
  _ttl_seconds INTEGER DEFAULT 600
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  IF _provider IS NULL OR btrim(_provider) = '' OR _nonce IS NULL OR btrim(_nonce) = '' THEN
    RETURN FALSE;
  END IF;

  DELETE FROM public.webhook_replay_nonces
  WHERE expires_at < now();

  INSERT INTO public.webhook_replay_nonces (
    provider,
    nonce,
    expires_at,
    request_timestamp
  ) VALUES (
    _provider,
    _nonce,
    now() + make_interval(secs => GREATEST(60, LEAST(COALESCE(_ttl_seconds, 600), 3600))),
    _request_timestamp
  )
  ON CONFLICT (provider, nonce) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_webhook_nonce(TEXT, TEXT, TIMESTAMPTZ, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_webhook_nonce(TEXT, TEXT, TIMESTAMPTZ, INTEGER) TO service_role;

COMMENT ON FUNCTION public.claim_webhook_nonce(TEXT, TEXT, TIMESTAMPTZ, INTEGER) IS
  'Atomically claims a signed webhook nonce. Returns false when the nonce was already used within its TTL.';

INSERT INTO public.audit_log (action, resource_type, resource_id, severity, metadata)
VALUES (
  'admin.settings_change',
  'security-hardening',
  'webhook-replay-guard-v1',
  'info',
  jsonb_build_object(
    'change', 'webhook-replay-guard-v1',
    'nonce_storage', 'webhook_replay_nonces',
    'claim_semantics', 'single_use_per_provider',
    'default_ttl_seconds', 600
  )
);