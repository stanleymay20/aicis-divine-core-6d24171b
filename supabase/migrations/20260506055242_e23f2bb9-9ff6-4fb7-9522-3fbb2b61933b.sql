
CREATE TABLE IF NOT EXISTS public.firehose_health (
  firehose_name text PRIMARY KEY,
  trust_tier text NOT NULL DEFAULT 'tier_3',
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_error_message text,
  last_inserted_count integer,
  last_duration_ms integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.firehose_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firehose_health readable by all"
ON public.firehose_health FOR SELECT
USING (true);

INSERT INTO public.firehose_health (firehose_name, trust_tier) VALUES
  ('gdelt-firehose','tier_3'),
  ('reliefweb-firehose','tier_1'),
  ('usgs-quake-firehose','tier_1')
ON CONFLICT (firehose_name) DO NOTHING;
