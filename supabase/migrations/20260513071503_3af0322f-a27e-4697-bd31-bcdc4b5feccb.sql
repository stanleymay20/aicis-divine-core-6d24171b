
CREATE TABLE IF NOT EXISTS public.cron_job_state (
  state_key text PRIMARY KEY,
  state_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cron_job_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.cron_job_state;
CREATE POLICY "service role only" ON public.cron_job_state FOR ALL USING (false) WITH CHECK (false);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='normalized_metrics_dedup_key_uniq'
  ) THEN
    BEGIN
      ALTER TABLE public.normalized_metrics ADD CONSTRAINT normalized_metrics_dedup_key_uniq UNIQUE (dedup_key);
    EXCEPTION WHEN duplicate_table OR unique_violation THEN NULL;
    END;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='normalized_events_dedup_key_uniq'
  ) THEN
    BEGIN
      ALTER TABLE public.normalized_events ADD CONSTRAINT normalized_events_dedup_key_uniq UNIQUE (dedup_key);
    EXCEPTION WHEN duplicate_table OR unique_violation THEN NULL;
    END;
  END IF;
END $$;

-- Quick backfill: events whose parent global_signals already has geo_admin0_iso3
UPDATE public.normalized_events ne
SET iso3 = gs.geo_admin0_iso3,
    country_iso3 = COALESCE(ne.country_iso3, gs.geo_admin0_iso3)
FROM public.global_signals gs
WHERE ne.iso3 IS NULL
  AND ne.metadata ? 'signal_id'
  AND gs.id = (ne.metadata->>'signal_id')::uuid
  AND gs.geo_admin0_iso3 IS NOT NULL;

-- Backfill from affected_countries first element
UPDATE public.normalized_events ne
SET iso3 = upper(gs.affected_countries[1]),
    country_iso3 = COALESCE(ne.country_iso3, upper(gs.affected_countries[1]))
FROM public.global_signals gs
WHERE ne.iso3 IS NULL
  AND ne.metadata ? 'signal_id'
  AND gs.id = (ne.metadata->>'signal_id')::uuid
  AND gs.affected_countries IS NOT NULL
  AND array_length(gs.affected_countries,1) > 0
  AND length(gs.affected_countries[1]) = 3;

CREATE INDEX IF NOT EXISTS idx_normalized_events_iso3_null
  ON public.normalized_events (created_at DESC)
  WHERE iso3 IS NULL;
