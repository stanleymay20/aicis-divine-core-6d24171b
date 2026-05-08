ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS scopes text[] NOT NULL DEFAULT ARRAY['read']::text[];

CREATE TABLE IF NOT EXISTS public.webhook_delivery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.webhook_subscriptions(id) ON DELETE CASCADE,
  org_id uuid NOT NULL,
  event_type text NOT NULL,
  attempt int NOT NULL DEFAULT 1,
  response_status int,
  response_ms int,
  error_message text,
  signature_sha256 text,
  payload_size_bytes int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_delivery_sub ON public.webhook_delivery_log (subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_org ON public.webhook_delivery_log (org_id, created_at DESC);

ALTER TABLE public.webhook_delivery_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view their webhook deliveries" ON public.webhook_delivery_log;
CREATE POLICY "Org members can view their webhook deliveries"
  ON public.webhook_delivery_log
  FOR SELECT
  TO authenticated
  USING (org_id IN (SELECT om.org_id FROM organization_members om WHERE om.user_id = auth.uid()));

DROP POLICY IF EXISTS "Service role inserts webhook deliveries" ON public.webhook_delivery_log;
CREATE POLICY "Service role inserts webhook deliveries"
  ON public.webhook_delivery_log
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.count_api_requests_window(
  _key_id uuid,
  _window_seconds int DEFAULT 60
) RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.api_request_audit
  WHERE api_key_id = _key_id
    AND created_at >= now() - (_window_seconds || ' seconds')::interval;
$$;