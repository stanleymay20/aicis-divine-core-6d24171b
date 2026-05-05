-- =========================================================
-- Phase 2.5: Signal Canonicalization & Confidence Engine
-- =========================================================

-- 1. Governance columns on global_signals
ALTER TABLE public.global_signals
  ADD COLUMN IF NOT EXISTS canonical_event_id uuid,
  ADD COLUMN IF NOT EXISTS duplicate_of_signal_id uuid REFERENCES public.global_signals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS canonical_event_status text,
  ADD COLUMN IF NOT EXISTS canonicalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_credibility_score smallint,
  ADD COLUMN IF NOT EXISTS corroboration_count smallint DEFAULT 1,
  ADD COLUMN IF NOT EXISTS novelty_score smallint,
  ADD COLUMN IF NOT EXISTS propaganda_risk_score smallint,
  ADD COLUMN IF NOT EXISTS confidence_explanation jsonb;

COMMENT ON COLUMN public.global_signals.canonical_event_status
  IS 'pending | canonical | duplicate | suppressed';

CREATE INDEX IF NOT EXISTS idx_global_signals_canonical_event
  ON public.global_signals (canonical_event_id);
CREATE INDEX IF NOT EXISTS idx_global_signals_canonical_status
  ON public.global_signals (canonical_event_status)
  WHERE canonical_event_status IS NULL OR canonical_event_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_global_signals_duplicate_of
  ON public.global_signals (duplicate_of_signal_id);

-- pg_trgm for fuzzy title clustering
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_global_signals_title_trgm
  ON public.global_signals USING gin (title gin_trgm_ops);

-- 2. Source trust registry (pattern-based, regex on source name)
CREATE TABLE IF NOT EXISTS public.signal_source_trust_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern text NOT NULL UNIQUE,
  tier text NOT NULL CHECK (tier IN ('tier_1','tier_2','tier_3','tier_4')),
  credibility_score smallint NOT NULL CHECK (credibility_score BETWEEN 0 AND 100),
  propaganda_risk_score smallint NOT NULL DEFAULT 10 CHECK (propaganda_risk_score BETWEEN 0 AND 100),
  is_official boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.signal_source_trust_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trust_registry_public_read" ON public.signal_source_trust_registry;
CREATE POLICY "trust_registry_public_read"
  ON public.signal_source_trust_registry FOR SELECT TO public USING (true);

-- Seed registry
INSERT INTO public.signal_source_trust_registry (pattern, tier, credibility_score, propaganda_risk_score, is_official, notes) VALUES
  -- TIER 1: official agencies / IGOs / scientific
  ('USGS%',                'tier_1', 99,  2, true,  'US Geological Survey'),
  ('NOAA%',                'tier_1', 98,  2, true,  'US National Oceanic & Atmospheric'),
  ('NASA%',                'tier_1', 98,  2, true,  'NASA'),
  ('FIRMS%',               'tier_1', 97,  2, true,  'NASA FIRMS'),
  ('UNHCR%',               'tier_1', 96,  3, true,  'UN Refugee Agency'),
  ('UN OCHA%',             'tier_1', 96,  3, true,  'UN OCHA'),
  ('ReliefWeb%',           'tier_1', 95,  3, true,  'UN OCHA ReliefWeb'),
  ('WHO%',                 'tier_1', 96,  3, true,  'World Health Organization'),
  ('World Bank%',          'tier_1', 96,  4, true,  'World Bank'),
  ('IMF%',                 'tier_1', 96,  4, true,  'IMF'),
  ('FAO%',                 'tier_1', 95,  3, true,  'UN FAO'),
  ('UN %',                 'tier_1', 94,  4, true,  'United Nations agencies'),
  ('European Central Bank%','tier_1', 95,  3, true, 'ECB'),
  ('Federal Reserve%',     'tier_1', 95,  3, true,  'US Fed'),
  ('Bank of England%',     'tier_1', 95,  3, true,  'BoE'),
  ('Bank of Japan%',       'tier_1', 95,  3, true,  'BoJ'),
  ('GDELT%',               'tier_1', 88,  5, false, 'GDELT event database'),
  ('ACLED%',               'tier_1', 92,  4, false, 'ACLED conflict data'),
  ('Beehive NZ%',          'tier_1', 90,  5, true,  'NZ government press'),
  ('Government of India PIB%','tier_1', 86, 12, true, 'India PIB'),

  -- TIER 2: trusted international wires & broadcasters
  ('Reuters%',             'tier_2', 92,  6, false, 'Reuters'),
  ('Associated Press%',    'tier_2', 92,  6, false, 'AP'),
  ('AP %',                 'tier_2', 92,  6, false, 'AP'),
  ('AFP%',                 'tier_2', 91,  6, false, 'Agence France-Presse'),
  ('Bloomberg%',           'tier_2', 90,  6, false, 'Bloomberg'),
  ('Financial Times%',     'tier_2', 90,  6, false, 'FT'),
  ('BBC%',                 'tier_2', 90,  6, false, 'BBC'),
  ('Al Jazeera%',          'tier_2', 84, 12, false, 'Al Jazeera'),
  ('NPR%',                 'tier_2', 88,  7, false, 'NPR'),
  ('PBS%',                 'tier_2', 88,  7, false, 'PBS'),
  ('CNBC%',                'tier_2', 80, 10, false, 'CNBC'),
  ('Anadolu Agency%',      'tier_2', 70, 22, false, 'TR state-adjacent wire'),

  -- TIER 3: regional & national press
  ('AllAfrica%',           'tier_3', 70, 12, false, 'Pan-African aggregator'),
  ('Antara News%',         'tier_3', 70, 18, false, 'Indonesia state wire'),
  ('Times of India%',      'tier_3', 70, 14, false, 'India national'),
  ('The Times of India%',  'tier_3', 70, 14, false, 'India national'),
  ('Economic Times%',      'tier_3', 70, 14, false, 'India business'),
  ('Yonhap%',              'tier_3', 78, 10, false, 'Korea wire'),
  ('Kyodo%',               'tier_3', 80,  8, false, 'Japan wire'),

  -- HIGH PROPAGANDA RISK (state-controlled)
  ('TASS%',                'tier_3', 50, 78, false, 'Russian state wire — high propaganda risk'),
  ('RT %',                 'tier_3', 35, 88, false, 'Russia Today — very high propaganda risk'),
  ('Sputnik%',             'tier_3', 35, 88, false, 'Sputnik — very high propaganda risk'),
  ('Xinhua%',              'tier_3', 55, 72, false, 'PRC state wire'),
  ('Global Times%',        'tier_3', 50, 78, false, 'PRC state media'),
  ('Press TV%',            'tier_3', 35, 85, false, 'Iran state — high propaganda risk'),

  -- TIER 4: blogs/aggregators/social
  ('facebook.com%',        'tier_4', 25, 40, false, 'Social platform'),
  ('youtube.com%',         'tier_4', 25, 40, false, 'Social platform'),
  ('twitter.com%',         'tier_4', 30, 40, false, 'Social platform'),
  ('Slickdeals%',          'tier_4', 20, 25, false, 'Commerce/blog'),
  ('Dealnews%',            'tier_4', 20, 25, false, 'Commerce/blog'),
  ('Bringatrailer%',       'tier_4', 20, 20, false, 'Commerce/blog'),
  ('Crypto Briefing%',     'tier_4', 35, 30, false, 'Crypto blog'),
  ('Daily Mail%',          'tier_4', 40, 35, false, 'Tabloid'),
  ('Dailymail%',           'tier_4', 40, 35, false, 'Tabloid'),
  ('New York Post%',       'tier_4', 50, 28, false, 'Tabloid-leaning'),
  ('Freerepublic%',        'tier_4', 25, 60, false, 'Partisan aggregator')
ON CONFLICT (pattern) DO NOTHING;

-- 3. Helper: resolve trust for a source name
CREATE OR REPLACE FUNCTION public.resolve_source_trust(p_source text)
RETURNS TABLE (tier text, credibility_score smallint, propaganda_risk_score smallint, is_official boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.tier, r.credibility_score, r.propaganda_risk_score, r.is_official
  FROM public.signal_source_trust_registry r
  WHERE p_source IS NOT NULL AND p_source ILIKE r.pattern
  ORDER BY length(r.pattern) DESC
  LIMIT 1;
$$;

-- Default fallback row used by canonicalizer if no pattern matches
INSERT INTO public.signal_source_trust_registry (pattern, tier, credibility_score, propaganda_risk_score, is_official, notes)
VALUES ('__default__', 'tier_4', 35, 30, false, 'Fallback when no pattern matches')
ON CONFLICT (pattern) DO NOTHING;