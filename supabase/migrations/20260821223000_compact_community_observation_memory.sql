-- Preserve repeated unchanged observations in compact form.
CREATE TABLE IF NOT EXISTS public.community_metric_observation_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id UUID NOT NULL REFERENCES public.admin_regions(id) ON DELETE CASCADE,
  indicator_key TEXT NOT NULL,
  source TEXT NOT NULL,
  value NUMERIC NOT NULL,
  domain TEXT NOT NULL,
  unit TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_observed_at TIMESTAMPTZ NOT NULL,
  last_observed_at TIMESTAMPTZ NOT NULL,
  observation_count BIGINT NOT NULL DEFAULT 1 CHECK (observation_count > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cm_observation_segments_metric
  ON public.community_metric_observation_segments
  (region_id, indicator_key, source, first_observed_at DESC);

ALTER TABLE public.community_metric_state
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmation_count BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS change_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_segment_id UUID REFERENCES public.community_metric_observation_segments(id) ON DELETE SET NULL;

UPDATE public.community_metric_state
SET first_seen_at = COALESCE(first_seen_at, last_changed_at, updated_at, now()),
    last_confirmed_at = COALESCE(last_confirmed_at, updated_at, last_changed_at, now())
WHERE first_seen_at IS NULL OR last_confirmed_at IS NULL;

ALTER TABLE public.community_metric_state
  ALTER COLUMN first_seen_at SET DEFAULT now(),
  ALTER COLUMN first_seen_at SET NOT NULL,
  ALTER COLUMN last_confirmed_at SET DEFAULT now(),
  ALTER COLUMN last_confirmed_at SET NOT NULL;

WITH seeded AS (
  INSERT INTO public.community_metric_observation_segments (
    region_id, indicator_key, source, value, domain, unit, metadata,
    first_observed_at, last_observed_at, observation_count
  )
  SELECT
    cms.region_id, cms.indicator_key, cms.source, cms.value, cms.domain, cms.unit, cms.metadata,
    COALESCE(cms.first_seen_at, cms.last_changed_at, cms.updated_at, now()),
    COALESCE(cms.last_confirmed_at, cms.updated_at, cms.last_changed_at, now()),
    GREATEST(cms.confirmation_count, 1)
  FROM public.community_metric_state cms
  WHERE cms.current_segment_id IS NULL
  RETURNING id, region_id, indicator_key, source
)
UPDATE public.community_metric_state cms
SET current_segment_id = seeded.id
FROM seeded
WHERE cms.region_id = seeded.region_id
  AND cms.indicator_key = seeded.indicator_key
  AND cms.source = seeded.source;
