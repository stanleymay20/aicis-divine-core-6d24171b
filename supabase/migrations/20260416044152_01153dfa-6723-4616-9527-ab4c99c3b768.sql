
ALTER TABLE public.normalized_events
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS country_iso3 text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS source_name text,
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS raw_data jsonb;

CREATE INDEX IF NOT EXISTS idx_normalized_events_country ON public.normalized_events (country_iso3);
CREATE INDEX IF NOT EXISTS idx_normalized_events_category ON public.normalized_events (category);
CREATE INDEX IF NOT EXISTS idx_normalized_events_occurred ON public.normalized_events (occurred_at DESC);
