CREATE TABLE IF NOT EXISTS public.signal_source_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name text NOT NULL UNIQUE,
  source_type text NOT NULL,
  parser_type text NOT NULL DEFAULT 'rss',
  urls text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  official_source boolean NOT NULL DEFAULT false,
  trust_weight integer NOT NULL DEFAULT 50,
  geo_scope text NOT NULL DEFAULT 'global',
  thematic_scope text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.signal_source_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read signal source registry" ON public.signal_source_registry;
CREATE POLICY "Authenticated users can read signal source registry"
ON public.signal_source_registry
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Service role manages signal source registry" ON public.signal_source_registry;
CREATE POLICY "Service role manages signal source registry"
ON public.signal_source_registry
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_signal_source_registry_enabled_priority
  ON public.signal_source_registry (enabled, priority, source_type);

CREATE TABLE IF NOT EXISTS public.signal_detection_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_key text NOT NULL UNIQUE,
  event_title text NOT NULL,
  event_summary text,
  source_url text,
  source_name text,
  event_occurred_at timestamptz,
  expected_countries text[] NOT NULL DEFAULT '{}',
  expected_categories text[] NOT NULL DEFAULT '{}',
  severity_hint text,
  detected boolean NOT NULL DEFAULT false,
  detected_signal_id uuid,
  detected_at timestamptz,
  detection_latency_minutes integer,
  validation_status text NOT NULL DEFAULT 'pending',
  validation_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_detection_benchmarks_status_check CHECK (validation_status IN ('pending','detected','missed','false_positive','needs_review'))
);

ALTER TABLE public.signal_detection_benchmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read signal detection benchmarks" ON public.signal_detection_benchmarks;
CREATE POLICY "Authenticated users can read signal detection benchmarks"
ON public.signal_detection_benchmarks
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Service role manages signal detection benchmarks" ON public.signal_detection_benchmarks;
CREATE POLICY "Service role manages signal detection benchmarks"
ON public.signal_detection_benchmarks
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_signal_detection_benchmarks_status_time
  ON public.signal_detection_benchmarks (validation_status, event_occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_detection_benchmarks_detected
  ON public.signal_detection_benchmarks (detected, detected_at DESC);

CREATE TABLE IF NOT EXISTS public.signal_coverage_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL DEFAULT current_date,
  total_sources integer NOT NULL DEFAULT 0,
  active_sources integer NOT NULL DEFAULT 0,
  official_sources integer NOT NULL DEFAULT 0,
  total_runs_24h integer NOT NULL DEFAULT 0,
  failed_runs_24h integer NOT NULL DEFAULT 0,
  new_signals_24h integer NOT NULL DEFAULT 0,
  unique_sources_24h integer NOT NULL DEFAULT 0,
  benchmarks_total integer NOT NULL DEFAULT 0,
  benchmarks_detected integer NOT NULL DEFAULT 0,
  benchmarks_missed integer NOT NULL DEFAULT 0,
  avg_detection_latency_minutes numeric(10,2),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date)
);

ALTER TABLE public.signal_coverage_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read signal coverage snapshots" ON public.signal_coverage_snapshots;
CREATE POLICY "Authenticated users can read signal coverage snapshots"
ON public.signal_coverage_snapshots
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Service role manages signal coverage snapshots" ON public.signal_coverage_snapshots;
CREATE POLICY "Service role manages signal coverage snapshots"
ON public.signal_coverage_snapshots
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_signal_coverage_snapshots_date
  ON public.signal_coverage_snapshots (snapshot_date DESC);

CREATE OR REPLACE FUNCTION public.update_signal_coverage_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_source_registry_updated_at ON public.signal_source_registry;
CREATE TRIGGER trg_signal_source_registry_updated_at
BEFORE UPDATE ON public.signal_source_registry
FOR EACH ROW
EXECUTE FUNCTION public.update_signal_coverage_updated_at();

DROP TRIGGER IF EXISTS trg_signal_detection_benchmarks_updated_at ON public.signal_detection_benchmarks;
CREATE TRIGGER trg_signal_detection_benchmarks_updated_at
BEFORE UPDATE ON public.signal_detection_benchmarks
FOR EACH ROW
EXECUTE FUNCTION public.update_signal_coverage_updated_at();

INSERT INTO public.signal_source_registry (source_name, source_type, parser_type, urls, enabled, priority, official_source, trust_weight, geo_scope, thematic_scope)
VALUES
  ('WHO', 'official_feed', 'rss', ARRAY['https://www.who.int/rss-feeds/news-english.xml'], true, 10, true, 90, 'global', ARRAY['public_health']),
  ('UN News', 'official_feed', 'rss', ARRAY['https://news.un.org/feed/subscribe/en/news/all/rss.xml'], true, 10, true, 88, 'global', ARRAY['geopolitical','humanitarian']),
  ('ReliefWeb', 'official_feed', 'rss', ARRAY['https://reliefweb.int/updates/rss.xml'], true, 15, true, 85, 'global', ARRAY['humanitarian','climate_disaster','conflict']),
  ('ECB', 'official_feed', 'rss', ARRAY['https://www.ecb.europa.eu/rss/press.html'], true, 20, true, 88, 'regional', ARRAY['central_banking','financial_markets']),
  ('IMF', 'official_feed', 'rss', ARRAY['https://www.imf.org/en/News/rss?Language=ENG'], true, 20, true, 86, 'global', ARRAY['economic','financial_markets']),
  ('Federal Reserve', 'official_feed', 'rss', ARRAY['https://www.federalreserve.gov/feeds/press_all.xml'], true, 20, true, 88, 'national', ARRAY['central_banking','financial_markets']),
  ('CISA', 'official_feed', 'rss', ARRAY['https://www.cisa.gov/cybersecurity-advisories/all.xml'], true, 20, true, 90, 'national', ARRAY['cybersecurity']),
  ('EIA', 'official_feed', 'rss', ARRAY['https://www.eia.gov/rss/todayinenergy.xml'], true, 20, true, 84, 'global', ARRAY['energy']),
  ('IEA', 'official_feed', 'rss', ARRAY['https://www.iea.org/news/rss'], true, 20, true, 86, 'global', ARRAY['energy']),
  ('WTO', 'official_feed', 'rss', ARRAY['https://www.wto.org/english/news_e/news_e.xml'], true, 20, true, 84, 'global', ARRAY['trade','supply_chain']),
  ('FAO', 'official_feed', 'rss', ARRAY['https://www.fao.org/news/rss/en/'], true, 20, true, 86, 'global', ARRAY['food','agriculture','supply_chain']),
  ('ICAO', 'official_feed', 'rss', ARRAY['https://www.icao.int/Newsroom/RSS/Pages/default.aspx'], true, 30, true, 82, 'global', ARRAY['aviation','infrastructure']),
  ('IMO', 'official_feed', 'rss', ARRAY['https://www.imo.org/en/MediaCentre/PressBriefings/pages/rss.aspx'], true, 30, true, 82, 'global', ARRAY['shipping','supply_chain']),
  ('Beehive NZ', 'official_feed', 'rss', ARRAY['https://www.beehive.govt.nz/rss.xml'], true, 30, true, 83, 'national', ARRAY['geopolitical','energy','trade']),
  ('Singapore MTI', 'official_feed', 'rss', ARRAY['https://www.mti.gov.sg/Newsroom/Press-Releases/rss'], true, 30, true, 83, 'national', ARRAY['economic','trade','energy'])
ON CONFLICT (source_name) DO UPDATE SET
  source_type = EXCLUDED.source_type,
  parser_type = EXCLUDED.parser_type,
  urls = EXCLUDED.urls,
  enabled = EXCLUDED.enabled,
  priority = EXCLUDED.priority,
  official_source = EXCLUDED.official_source,
  trust_weight = EXCLUDED.trust_weight,
  geo_scope = EXCLUDED.geo_scope,
  thematic_scope = EXCLUDED.thematic_scope,
  updated_at = now();