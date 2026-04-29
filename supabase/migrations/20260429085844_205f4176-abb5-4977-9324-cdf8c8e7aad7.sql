
-- ============================================================
-- LRIL: Local Reality Ingestion Layer
-- ============================================================

-- PHASE 1: Raw local signals
CREATE TABLE IF NOT EXISTS public.aicis_raw_local_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL CHECK (source_type IN ('news','gov','ngo','remote','proxy','aggregator','social')),
  source_name TEXT NOT NULL,
  source_reliability NUMERIC DEFAULT 0.6 CHECK (source_reliability BETWEEN 0 AND 1),
  raw_text TEXT,
  raw_payload JSONB DEFAULT '{}'::jsonb,
  language TEXT DEFAULT 'en',
  url TEXT,
  published_at TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  country_hint TEXT,
  region_hint TEXT,
  processed_at TIMESTAMPTZ,
  dedup_key TEXT UNIQUE,
  CONSTRAINT raw_text_or_payload CHECK (raw_text IS NOT NULL OR raw_payload IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_lril_raw_unprocessed ON public.aicis_raw_local_signals (processed_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lril_raw_country ON public.aicis_raw_local_signals (country_hint, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_lril_raw_published ON public.aicis_raw_local_signals (published_at DESC);

-- PHASE 2: Keyword packs
CREATE TABLE IF NOT EXISTS public.aicis_keyword_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  language TEXT NOT NULL DEFAULT 'en',
  country TEXT,                -- NULL = global
  domain TEXT NOT NULL,        -- security, energy, health, climate, governance, food, finance, education, population
  subtype TEXT,                -- xenophobic_attack, protest, blackout, flood, etc.
  keywords JSONB NOT NULL,     -- array of strings/regex tokens
  weight NUMERIC DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lril_keywords_lookup ON public.aicis_keyword_packs (language, country, domain);

-- PHASE 3: Geo entities
CREATE TABLE IF NOT EXISTS public.aicis_geo_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  iso3 TEXT NOT NULL,
  admin_level_1 TEXT,
  admin_level_2 TEXT,
  city TEXT,
  locality TEXT,
  lat NUMERIC,
  lon NUMERIC,
  geo_confidence NUMERIC DEFAULT 0.5 CHECK (geo_confidence BETWEEN 0 AND 1),
  aliases JSONB DEFAULT '[]'::jsonb,
  population BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (iso3, admin_level_1, admin_level_2, city, locality)
);
CREATE INDEX IF NOT EXISTS idx_lril_geo_iso3 ON public.aicis_geo_entities (iso3);
CREATE INDEX IF NOT EXISTS idx_lril_geo_latlon ON public.aicis_geo_entities (lat, lon);
CREATE INDEX IF NOT EXISTS idx_lril_geo_locality ON public.aicis_geo_entities (lower(locality));
CREATE INDEX IF NOT EXISTS idx_lril_geo_city ON public.aicis_geo_entities (lower(city));

-- PHASE 4: Local events (clustered + classified)
CREATE TABLE IF NOT EXISTS public.aicis_local_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,    -- security, energy, health, climate, governance, etc.
  subtype TEXT,                -- xenophobic_attack, protest, outage, flood, etc.
  iso3 TEXT NOT NULL,
  admin_level_1 TEXT,
  locality TEXT,
  geo_entity_id UUID REFERENCES public.aicis_geo_entities(id) ON DELETE SET NULL,
  lat NUMERIC,
  lon NUMERIC,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  severity NUMERIC DEFAULT 0.5 CHECK (severity BETWEEN 0 AND 1),
  confidence NUMERIC DEFAULT 0.3 CHECK (confidence BETWEEN 0 AND 1),
  confidence_tier TEXT GENERATED ALWAYS AS (
    CASE
      WHEN confidence >= 0.7 THEN 'high'
      WHEN confidence >= 0.4 THEN 'medium'
      ELSE 'low'
    END
  ) STORED,
  source_count INT NOT NULL DEFAULT 1,
  raw_signal_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  matched_keywords JSONB DEFAULT '[]'::jsonb,
  title TEXT,
  description TEXT,
  proxy_boost NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved','superseded')),
  bridged_to_normalized BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lril_events_iso3_time ON public.aicis_local_events (iso3, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_lril_events_locality ON public.aicis_local_events (iso3, lower(locality));
CREATE INDEX IF NOT EXISTS idx_lril_events_confidence ON public.aicis_local_events (confidence_tier, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_lril_events_unbridged ON public.aicis_local_events (bridged_to_normalized) WHERE bridged_to_normalized = FALSE;
CREATE INDEX IF NOT EXISTS idx_lril_events_geo ON public.aicis_local_events (lat, lon, start_time);

-- PHASE 7: Proxy signals
CREATE TABLE IF NOT EXISTS public.aicis_proxy_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  iso3 TEXT NOT NULL,
  admin_level_1 TEXT,
  locality TEXT,
  lat NUMERIC,
  lon NUMERIC,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('night_lights','network_outage','social_silence','flight_anomaly','market_anomaly','satellite_thermal')),
  value NUMERIC,
  baseline NUMERIC,
  deviation NUMERIC,         -- z-score or % delta
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_name TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lril_proxy_iso3_time ON public.aicis_proxy_signals (iso3, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_lril_proxy_locality ON public.aicis_proxy_signals (iso3, lower(locality), timestamp DESC);

-- ============================================================
-- RLS: read for authenticated, write for service role only
-- ============================================================
ALTER TABLE public.aicis_raw_local_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_keyword_packs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_geo_entities     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_local_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_proxy_signals    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lril_raw_read"     ON public.aicis_raw_local_signals FOR SELECT TO authenticated USING (true);
CREATE POLICY "lril_keywords_read" ON public.aicis_keyword_packs   FOR SELECT TO authenticated USING (true);
CREATE POLICY "lril_geo_read"     ON public.aicis_geo_entities     FOR SELECT TO authenticated USING (true);
CREATE POLICY "lril_events_read"  ON public.aicis_local_events     FOR SELECT TO authenticated USING (true);
CREATE POLICY "lril_proxy_read"   ON public.aicis_proxy_signals    FOR SELECT TO authenticated USING (true);

-- Public read on confirmed events (for landing/early-warning surface)
CREATE POLICY "lril_events_public_high" ON public.aicis_local_events
  FOR SELECT TO anon USING (confidence_tier IN ('high','medium'));

-- ============================================================
-- HELPERS
-- ============================================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION public.lril_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_lril_events_touch ON public.aicis_local_events;
CREATE TRIGGER trg_lril_events_touch BEFORE UPDATE ON public.aicis_local_events
  FOR EACH ROW EXECUTE FUNCTION public.lril_touch_updated_at();

-- Keyword detection (returns matched terms + best domain/subtype hint)
CREATE OR REPLACE FUNCTION public.lril_detect_keywords(p_text TEXT, p_language TEXT DEFAULT 'en', p_country TEXT DEFAULT NULL)
RETURNS TABLE(matched_terms JSONB, domain TEXT, subtype TEXT, score NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  lc_text TEXT := lower(coalesce(p_text,''));
BEGIN
  RETURN QUERY
  WITH packs AS (
    SELECT kp.domain, kp.subtype, kp.keywords, kp.weight
    FROM public.aicis_keyword_packs kp
    WHERE (kp.language = p_language OR kp.language = 'en')
      AND (kp.country IS NULL OR kp.country = p_country)
  ),
  hits AS (
    SELECT p.domain, p.subtype, p.weight,
           jsonb_agg(kw) FILTER (WHERE position(lower(kw) IN lc_text) > 0) AS matched
    FROM packs p, jsonb_array_elements_text(p.keywords) kw
    GROUP BY p.domain, p.subtype, p.weight
  )
  SELECT
    coalesce(matched, '[]'::jsonb) AS matched_terms,
    h.domain,
    h.subtype,
    (jsonb_array_length(coalesce(matched,'[]'::jsonb)) * h.weight)::numeric AS score
  FROM hits h
  WHERE jsonb_array_length(coalesce(matched,'[]'::jsonb)) > 0
  ORDER BY score DESC
  LIMIT 5;
END $$;

-- Confidence model
CREATE OR REPLACE FUNCTION public.lril_compute_confidence(
  p_source_count INT,
  p_avg_source_reliability NUMERIC,
  p_keyword_strength NUMERIC,
  p_geo_confidence NUMERIC,
  p_temporal_density NUMERIC,
  p_proxy_boost NUMERIC DEFAULT 0
) RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT LEAST(1.0, GREATEST(0.0,
      0.35 * LEAST(1.0, p_source_count / 4.0)
    + 0.20 * coalesce(p_avg_source_reliability, 0.5)
    + 0.20 * LEAST(1.0, coalesce(p_keyword_strength, 0) / 5.0)
    + 0.15 * coalesce(p_geo_confidence, 0.5)
    + 0.10 * LEAST(1.0, coalesce(p_temporal_density, 0))
    + coalesce(p_proxy_boost, 0)
  ))
$$;

-- Bridge LRIL events → normalized_events (idempotent)
CREATE OR REPLACE FUNCTION public.lril_bridge_to_normalized()
RETURNS TABLE(bridged_count INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INT := 0;
BEGIN
  WITH ins AS (
    INSERT INTO public.normalized_events (
      provider_name, event_type, category, title, description,
      country_iso3, iso3, severity, confidence,
      occurred_at, started_at, source_name, source_url,
      raw_data, dedup_key
    )
    SELECT
      'lril',
      le.event_type,
      le.event_type,
      coalesce(le.title, le.subtype || ' in ' || coalesce(le.locality, le.iso3)),
      le.description,
      le.iso3,
      le.iso3,
      (le.severity * 10)::int,    -- normalize 0–1 → 0–10
      le.confidence,
      le.start_time,
      le.start_time,
      'AICIS LRIL',
      NULL,
      jsonb_build_object(
        'lril_event_id', le.id,
        'subtype', le.subtype,
        'locality', le.locality,
        'source_count', le.source_count,
        'matched_keywords', le.matched_keywords,
        'lat', le.lat, 'lon', le.lon,
        'confidence_tier', le.confidence_tier
      ),
      'lril_' || le.id::text
    FROM public.aicis_local_events le
    WHERE le.bridged_to_normalized = FALSE
      AND le.confidence >= 0.4    -- only medium+ confidence cross to AICIS core
      AND le.status = 'active'
    ON CONFLICT (dedup_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM ins;

  UPDATE public.aicis_local_events
  SET bridged_to_normalized = TRUE
  WHERE bridged_to_normalized = FALSE
    AND confidence >= 0.4
    AND status = 'active';

  RETURN QUERY SELECT v_count;
END $$;

-- ============================================================
-- SEED: minimal English keyword packs (global)
-- ============================================================
INSERT INTO public.aicis_keyword_packs (language, country, domain, subtype, keywords, weight) VALUES
('en', NULL, 'security', 'protest',           '["protest","demonstration","march","rally","unrest","riot"]'::jsonb, 1.0),
('en', NULL, 'security', 'violence',          '["attack","killed","wounded","gunmen","armed","ambush","clash","shooting"]'::jsonb, 1.2),
('en', NULL, 'security', 'xenophobic_attack', '["xenophobic","foreigner attacked","mob attack","looting of foreign"]'::jsonb, 1.3),
('en', NULL, 'security', 'terror',            '["terrorist","bombing","explosion","ied","suicide attack"]'::jsonb, 1.4),
('en', NULL, 'energy',   'outage',            '["blackout","power outage","load shedding","load-shedding","dumsor","power cut","grid failure"]'::jsonb, 1.1),
('en', NULL, 'energy',   'fuel_shortage',     '["fuel shortage","petrol shortage","diesel shortage","queues at fuel"]'::jsonb, 1.0),
('en', NULL, 'health',   'outbreak',          '["outbreak","epidemic","cholera","measles","ebola","cases reported","disease spread"]'::jsonb, 1.2),
('en', NULL, 'health',   'hospital_strain',   '["hospital overwhelmed","icu full","no beds","drug shortage"]'::jsonb, 1.0),
('en', NULL, 'climate',  'flood',             '["flood","flooding","flash flood","river burst","inundation"]'::jsonb, 1.1),
('en', NULL, 'climate',  'fire',              '["wildfire","bushfire","forest fire","blaze"]'::jsonb, 1.0),
('en', NULL, 'climate',  'storm',             '["cyclone","hurricane","typhoon","tornado","heavy storm"]'::jsonb, 1.1),
('en', NULL, 'climate',  'drought',           '["drought","water shortage","crops failed","dry spell"]'::jsonb, 0.9),
('en', NULL, 'governance','coup',             '["coup","military takeover","junta","seized power"]'::jsonb, 1.5),
('en', NULL, 'governance','election_dispute', '["election dispute","vote rigging","contested results","electoral violence"]'::jsonb, 1.1),
('en', NULL, 'food',     'food_insecurity',   '["famine","starvation","food shortage","hunger crisis"]'::jsonb, 1.2),
('en', NULL, 'finance',  'currency_collapse', '["currency crash","hyperinflation","bank run","forex shortage"]'::jsonb, 1.2),
('en', NULL, 'population','displacement',     '["displaced","refugees fled","idp","mass exodus"]'::jsonb, 1.1)
ON CONFLICT DO NOTHING;

-- French + Spanish + Arabic + Portuguese minimal packs (global subset)
INSERT INTO public.aicis_keyword_packs (language, country, domain, subtype, keywords, weight) VALUES
('fr', NULL, 'security', 'protest',  '["manifestation","émeute","grève","marche"]'::jsonb, 1.0),
('fr', NULL, 'energy',   'outage',   '["coupure","délestage","panne d''électricité"]'::jsonb, 1.1),
('fr', NULL, 'climate',  'flood',    '["inondation","crue","débordement"]'::jsonb, 1.1),
('es', NULL, 'security', 'protest',  '["protesta","manifestación","disturbios","marcha"]'::jsonb, 1.0),
('es', NULL, 'energy',   'outage',   '["apagón","corte de luz","blackout"]'::jsonb, 1.1),
('es', NULL, 'climate',  'flood',    '["inundación","desborde","crecida"]'::jsonb, 1.1),
('pt', NULL, 'security', 'protest',  '["protesto","manifestação","tumulto"]'::jsonb, 1.0),
('pt', NULL, 'energy',   'outage',   '["apagão","corte de energia","queda de energia"]'::jsonb, 1.1),
('ar', NULL, 'security', 'protest',  '["احتجاج","مظاهرة","اشتباكات"]'::jsonb, 1.0),
('ar', NULL, 'security', 'violence', '["هجوم","اغتيال","انفجار","قتلى"]'::jsonb, 1.2)
ON CONFLICT DO NOTHING;

-- Country-specific seeds
INSERT INTO public.aicis_keyword_packs (language, country, domain, subtype, keywords, weight) VALUES
('en', 'GHA', 'energy', 'outage', '["dumsor","ecg outage","light off"]'::jsonb, 1.4),
('en', 'NGA', 'energy', 'outage', '["nepa","phcn","disco outage","no light"]'::jsonb, 1.3),
('en', 'ZAF', 'energy', 'outage', '["loadshedding","stage 4","stage 6","eskom"]'::jsonb, 1.4),
('en', 'KEN', 'energy', 'outage', '["kplc outage","kenya power blackout"]'::jsonb, 1.2),
('en', 'IND', 'energy', 'outage', '["bijli gul","power cut","load shedding"]'::jsonb, 1.2)
ON CONFLICT DO NOTHING;
