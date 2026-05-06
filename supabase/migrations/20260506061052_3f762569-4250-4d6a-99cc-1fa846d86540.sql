
ALTER TABLE public.firehose_health
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS backoff_seconds integer NOT NULL DEFAULT 0;

INSERT INTO public.firehose_health (firehose_name, trust_tier, consecutive_failures, last_error_message)
VALUES
  ('newsapi-firehose', 'tier_2', 0, 'not_configured'),
  ('firecrawl-firehose', 'tier_2', 0, 'not_configured')
ON CONFLICT (firehose_name) DO NOTHING;
