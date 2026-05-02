-- ============================================================
-- LRIL v13 — Tier-A Source Registry + scoring upgrades
-- ============================================================

-- 1. Source registry
CREATE TABLE IF NOT EXISTS public.aicis_source_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  source_type TEXT NOT NULL DEFAULT 'news', -- news | ngo | un | sensor | aggregator | gov
  reliability_score NUMERIC NOT NULL DEFAULT 0.6 CHECK (reliability_score >= 0 AND reliability_score <= 1),
  region_focus TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  domains TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  access_type TEXT NOT NULL DEFAULT 'public' CHECK (access_type IN ('public','licensed','manual')),
  feed_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','broken','requires_credential')),
  last_checked_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_registry_status ON public.aicis_source_registry(status);
CREATE INDEX IF NOT EXISTS idx_source_registry_reliability ON public.aicis_source_registry(reliability_score DESC);

ALTER TABLE public.aicis_source_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "source_registry_read_authenticated" ON public.aicis_source_registry;
CREATE POLICY "source_registry_read_authenticated"
  ON public.aicis_source_registry FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "source_registry_admin_write" ON public.aicis_source_registry;
CREATE POLICY "source_registry_admin_write"
  ON public.aicis_source_registry FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_source_registry_updated ON public.aicis_source_registry;
CREATE TRIGGER trg_source_registry_updated
  BEFORE UPDATE ON public.aicis_source_registry
  FOR EACH ROW EXECUTE FUNCTION public.lril_touch_updated_at();

-- 2. Seed tier-A and existing sources
INSERT INTO public.aicis_source_registry
  (source_name, display_name, source_type, reliability_score, region_focus, domains, access_type, feed_url, status, notes)
VALUES
  -- Sensors / canonical
  ('usgs','USGS Earthquakes','sensor',0.98,ARRAY['global'],ARRAY['disaster','seismic'],'public','https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson','active','M4.5+ past 24h'),
  ('gdacs','GDACS','sensor',0.95,ARRAY['global'],ARRAY['disaster','climate'],'public','https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH','active','EU JRC alert system'),
  ('nasa_eonet','NASA EONET','sensor',0.95,ARRAY['global'],ARRAY['disaster','climate','wildfire'],'public','https://eonet.gsfc.nasa.gov/api/v3/events','active','Open events feed'),
  -- UN / institutional
  ('reliefweb','ReliefWeb','un',0.92,ARRAY['global'],ARRAY['disaster','humanitarian','displacement'],'public','https://api.reliefweb.int/v2/reports','requires_credential','Needs RELIEFWEB_APPNAME secret'),
  ('un_news','UN News','un',0.92,ARRAY['global'],ARRAY['governance','human_rights','humanitarian','peace'],'public','https://news.un.org/feed/subscribe/en/news/all/rss.xml','active','UN News Centre top stories'),
  ('ocha_updates','UN OCHA ReliefWeb Updates','un',0.92,ARRAY['global'],ARRAY['humanitarian','disaster','displacement'],'public','https://reliefweb.int/updates/rss.xml','active','OCHA situation updates RSS'),
  ('unhcr_news','UNHCR News','un',0.92,ARRAY['global'],ARRAY['displacement','migration','human_rights'],'public','https://www.unhcr.org/rss/news/en','active','Refugee agency news'),
  ('who_don','WHO Disease Outbreak News','un',0.95,ARRAY['global'],ARRAY['health','epidemic'],'public','https://www.who.int/rss-feeds/news-english.xml','active','WHO English news incl. DON'),
  ('echo_flash','EU ECHO Daily Flash','gov',0.90,ARRAY['global'],ARRAY['disaster','humanitarian'],'public','https://erccportal.jrc.ec.europa.eu/ECHO-Flash/RSS','active','EU Civil Protection daily flash'),
  ('paho_news','PAHO/WHO Americas','un',0.92,ARRAY['americas'],ARRAY['health','epidemic'],'public','https://www.paho.org/en/rss.xml','active','Pan American Health Org'),
  -- Human rights watchdogs
  ('hrw','Human Rights Watch','ngo',0.92,ARRAY['global'],ARRAY['human_rights','political'],'public','https://www.hrw.org/rss/news','active',''),
  ('amnesty','Amnesty International','ngo',0.92,ARRAY['global'],ARRAY['human_rights','political'],'public','https://www.amnesty.org/en/rss/news/','active',''),
  ('rsf','Reporters Without Borders','ngo',0.92,ARRAY['global'],ARRAY['human_rights','press_freedom'],'public','https://rsf.org/en/rss.xml','active',''),
  ('cpj','Committee to Protect Journalists','ngo',0.95,ARRAY['global'],ARRAY['human_rights','press_freedom'],'public','https://cpj.org/feed/','active',''),
  ('frontline_defenders','Frontline Defenders','ngo',0.95,ARRAY['global'],ARRAY['human_rights'],'public','https://www.frontlinedefenders.org/en/rss.xml','active',''),
  -- Wires (open RSS where legally accessible)
  ('ap_topnews','Associated Press Top News','news',0.90,ARRAY['global'],ARRAY['general'],'public','https://feeds.apnews.com/apf-topnews','active','AP public RSS'),
  ('reuters_world','Reuters World','news',0.90,ARRAY['global'],ARRAY['general'],'licensed','https://www.reutersagency.com/feed/?best-topics=political-general','requires_credential','Reuters retired most public RSS feeds — listed but not auto-fetched without licensed credential'),
  ('afp_factcheck','AFP Fact Check','news',0.88,ARRAY['global'],ARRAY['general'],'public','https://factuel.afp.com/list/all/feed','active',''),
  -- Aggregators
  ('gdelt','GDELT DOC API','aggregator',0.6,ARRAY['global'],ARRAY['general'],'public','https://api.gdeltproject.org/api/v2/doc/doc','active','High volume, low per-item reliability')
ON CONFLICT (source_name) DO UPDATE
SET reliability_score = EXCLUDED.reliability_score,
    source_type = EXCLUDED.source_type,
    region_focus = EXCLUDED.region_focus,
    domains = EXCLUDED.domains,
    access_type = EXCLUDED.access_type,
    feed_url = EXCLUDED.feed_url,
    status = EXCLUDED.status,
    notes = EXCLUDED.notes,
    updated_at = now();

-- 3. Registry-aware source tier function
CREATE OR REPLACE FUNCTION public.lril_source_tier(p_source text, p_url text)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_score numeric;
BEGIN
  -- 1. Registry exact match wins
  SELECT reliability_score INTO v_score
  FROM public.aicis_source_registry
  WHERE source_name = p_source AND status IN ('active','requires_credential')
  LIMIT 1;
  IF v_score IS NOT NULL THEN
    RETURN v_score;
  END IF;

  -- 2. Registry prefix match (e.g. gnews_NG_premiumtimes inherits from premium_times_ng pattern)
  SELECT reliability_score INTO v_score
  FROM public.aicis_source_registry
  WHERE p_source ILIKE '%' || source_name || '%'
  ORDER BY length(source_name) DESC
  LIMIT 1;
  IF v_score IS NOT NULL THEN
    RETURN v_score;
  END IF;

  -- 3. URL pattern fallback (legacy heuristic)
  RETURN CASE
    WHEN coalesce(p_url,'') ~* '(un\.org|reliefweb|unhcr|who\.int|paho\.org|europa\.eu|ochaonline)' THEN 0.92
    WHEN coalesce(p_url,'') ~* '(hrw\.org|amnesty\.org|rsf\.org|cpj\.org|frontlinedefenders)' THEN 0.92
    WHEN coalesce(p_url,'') ~* '(reuters|apnews|afp\.com|bbc\.|aljazeera|bloomberg|nytimes|wsj\.|ft\.com|economist|theguardian|washingtonpost|cnn\.com|dw\.com|france24|rfi\.fr|npr\.org)' THEN 0.85
    WHEN coalesce(p_url,'') ~* '(\.gov\.|\.gov/|nato\.int|imf\.org|worldbank)' THEN 0.88
    WHEN coalesce(p_url,'') ~* '(allafrica|africanews|punchng|saharareporters|theeastafrican|nation\.africa|standardmedia|premiumtimes|dailytrust|vanguard)' THEN 0.75
    WHEN coalesce(p_url,'') ~* '(thehindu|indianexpress|timesofindia|ndtv|dawn\.com|geo\.tv|tribune\.com\.pk|prothomalo|thedailystar)' THEN 0.75
    WHEN coalesce(p_url,'') ~* '(scmp\.com|chinadaily|globaltimes|kyodo|asahi|mainichi|koreatimes|koreaherald|yonhap|straitstimes|jakartapost|bangkokpost|manilatimes|inquirer)' THEN 0.75
    WHEN coalesce(p_url,'') ~* '(clarin|lanacion|infobae|globo|folha|estadao|eluniversal|elcomercio|elmercurio|larepublica)' THEN 0.75
    ELSE 0.5
  END;
END;
$function$;

-- 4. Improved confidence model: tier-A corroboration accelerates trust
CREATE OR REPLACE FUNCTION public.lril_compute_confidence(
  p_source_count integer,
  p_avg_source_reliability numeric,
  p_keyword_strength numeric,
  p_geo_confidence numeric,
  p_temporal_density numeric,
  p_proxy_boost numeric DEFAULT 0,
  p_fatality_count integer DEFAULT 0
) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE src_score numeric; base numeric;
BEGIN
  src_score := LEAST(1.0, 0.40 + 0.25 * ln(GREATEST(p_source_count,1)));
  base := 0.30 * src_score
        + 0.25 * GREATEST(0.4, COALESCE(p_avg_source_reliability,0.5))
        + 0.25 * GREATEST(0, COALESCE(p_keyword_strength,0))
        + 0.15 * GREATEST(0.35, COALESCE(p_geo_confidence,0.35))
        + 0.05 * LEAST(1.0, COALESCE(p_temporal_density,0))
        + LEAST(0.2, COALESCE(p_proxy_boost,0));
  -- Floors
  IF COALESCE(p_keyword_strength,0) >= 1.0 THEN base := GREATEST(base, 0.42); END IF;
  -- v13: single tier-A (≥0.90) with strong keywords ⇒ ≥0.55
  IF p_source_count >= 1 AND COALESCE(p_avg_source_reliability,0) >= 0.90 AND COALESCE(p_keyword_strength,0) >= 0.8 THEN
    base := GREATEST(base, 0.55);
  END IF;
  IF p_source_count >= 1 AND COALESCE(p_avg_source_reliability,0) >= 0.85 AND COALESCE(p_keyword_strength,0) >= 1.0 THEN
    base := GREATEST(base, 0.55);
  END IF;
  IF p_source_count >= 2 THEN base := GREATEST(base, 0.52); END IF;
  -- v13: 2 independent tier-A sources ⇒ ≥0.78
  IF p_source_count >= 2 AND COALESCE(p_avg_source_reliability,0) >= 0.90 THEN
    base := GREATEST(base, 0.78);
  END IF;
  IF p_source_count >= 3 AND COALESCE(p_avg_source_reliability,0) >= 0.6 THEN base := GREATEST(base, 0.70); END IF;
  IF COALESCE(p_fatality_count,0) >= 3 AND COALESCE(p_geo_confidence,0) >= 0.5 THEN base := GREATEST(base, 0.55); END IF;
  IF COALESCE(p_fatality_count,0) >= 10 THEN base := GREATEST(base, 0.72); END IF;
  RETURN LEAST(1.0, base);
END;
$function$;

-- 5. Severity model — keyword + domain driven
CREATE OR REPLACE FUNCTION public.lril_compute_severity(
  p_domain text,
  p_subtype text,
  p_text text,
  p_matched_keywords jsonb,
  p_source_reliability numeric DEFAULT 0.5
) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  s numeric := 0.30;
  t text := lower(coalesce(p_text,''));
  kw_count int := COALESCE(jsonb_array_length(p_matched_keywords), 0);
BEGIN
  -- Domain base
  IF p_domain IN ('security','human_rights','health','climate') THEN s := 0.45;
  ELSIF p_domain IN ('political','governance','migration','food','water','energy','infrastructure') THEN s := 0.40;
  ELSE s := 0.30;
  END IF;

  -- Keyword breadth boost
  s := s + LEAST(0.15, 0.025 * kw_count);

  -- High-severity verb/noun cues
  IF t ~* '(killed|dead|fatalities|massacre|slaughter|atrocity|genocide|war crime)' THEN s := s + 0.18; END IF;
  IF t ~* '(mass(\s|-)?killing|extrajudicial|summary execution|burnt alive|necklacing|lynched)' THEN s := s + 0.15; END IF;
  IF t ~* '(displaced|fled|exodus|refugees|idps|internally displaced)' THEN s := s + 0.12; END IF;
  IF t ~* '(outbreak|epidemic|pandemic|ebola|cholera|marburg|nipah|polio|mpox|measles surge)' THEN s := s + 0.15; END IF;
  IF t ~* '(famine|starvation|ipc phase 4|ipc phase 5|acute hunger|catastrophic food)' THEN s := s + 0.18; END IF;
  IF t ~* '(blackout|grid collapse|nationwide outage|telecom blackout|internet shutdown)' THEN s := s + 0.12; END IF;
  IF t ~* '(cyclone|hurricane|typhoon|earthquake|tsunami|wildfire|landslide|major flood)' THEN s := s + 0.10; END IF;
  IF t ~* '(human rights abuse|torture|enforced disappearance|crackdown|mass arrests)' THEN s := s + 0.12; END IF;
  IF t ~* '(critical infrastructure|hospital attacked|school attacked|airport closed|port closed)' THEN s := s + 0.10; END IF;

  -- Affected population magnitude
  IF t ~* '(thousands killed|tens of thousands|hundreds of thousands|millions affected|million displaced)' THEN s := s + 0.15;
  ELSIF t ~* '(hundreds (killed|dead|injured)|hundreds displaced|hundreds affected)' THEN s := s + 0.10;
  ELSIF t ~* '(dozens (killed|dead|injured))' THEN s := s + 0.06;
  END IF;

  -- Tier-A source amplifies confidence in the severity signal (small)
  IF COALESCE(p_source_reliability,0.5) >= 0.90 THEN s := s + 0.04; END IF;

  RETURN LEAST(1.0, GREATEST(0.0, s));
END;
$function$;