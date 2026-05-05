
-- ============== global_signals: multilingual ==============
ALTER TABLE public.global_signals
  ADD COLUMN IF NOT EXISTS source_language text,
  ADD COLUMN IF NOT EXISTS original_title text,
  ADD COLUMN IF NOT EXISTS original_summary text,
  ADD COLUMN IF NOT EXISTS translated_title text,
  ADD COLUMN IF NOT EXISTS translated_summary text,
  ADD COLUMN IF NOT EXISTS translation_status text,
  ADD COLUMN IF NOT EXISTS translation_model text,
  ADD COLUMN IF NOT EXISTS translated_at timestamptz;

COMMENT ON COLUMN public.global_signals.translation_status IS 'pending | translated | not_needed | failed | skipped';

-- ============== global_signals: geo resolution ==============
ALTER TABLE public.global_signals
  ADD COLUMN IF NOT EXISTS geo_admin0_iso3 text,
  ADD COLUMN IF NOT EXISTS geo_admin1 text,
  ADD COLUMN IF NOT EXISTS geo_admin2 text,
  ADD COLUMN IF NOT EXISTS geo_lat double precision,
  ADD COLUMN IF NOT EXISTS geo_lng double precision,
  ADD COLUMN IF NOT EXISTS geo_confidence smallint,
  ADD COLUMN IF NOT EXISTS geo_method text,
  ADD COLUMN IF NOT EXISTS geocoded_at timestamptz;

COMMENT ON COLUMN public.global_signals.geo_method IS 'affected_country | centroid | place_extraction | admin_match | failed';

-- ============== queues ==============
CREATE INDEX IF NOT EXISTS idx_global_signals_translation_pending
  ON public.global_signals (first_detected_at)
  WHERE translation_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_global_signals_geocode_pending
  ON public.global_signals (first_detected_at)
  WHERE geocoded_at IS NULL;

-- ============== sweep registry: language + country + auto-generated ==============
ALTER TABLE public.web_search_sweep_queries
  ADD COLUMN IF NOT EXISTS language text DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS country_iso3 text,
  ADD COLUMN IF NOT EXISTS auto_generated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sweep_country_lang
  ON public.web_search_sweep_queries (country_iso3, language)
  WHERE enabled = true;

-- ============== coverage equity log ==============
CREATE TABLE IF NOT EXISTS public.coverage_equity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  country_iso3 text NOT NULL,
  country_name text,
  signals_7d int NOT NULL DEFAULT 0,
  floor int NOT NULL DEFAULT 3,
  gap int NOT NULL DEFAULT 0,
  language_codes text[] NOT NULL DEFAULT '{}',
  queries_generated int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'logged',
  notes text
);

ALTER TABLE public.coverage_equity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coverage equity log readable by authenticated" ON public.coverage_equity_log;
CREATE POLICY "coverage equity log readable by authenticated"
  ON public.coverage_equity_log
  FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_coverage_equity_log_run_at
  ON public.coverage_equity_log (run_at DESC);

CREATE INDEX IF NOT EXISTS idx_coverage_equity_log_country
  ON public.coverage_equity_log (country_iso3, run_at DESC);
