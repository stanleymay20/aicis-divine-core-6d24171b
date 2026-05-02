-- LRIL v17 Precision Upgrade

-- Phase 1: Country correction log
CREATE TABLE IF NOT EXISTS public.lril_country_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid,
  original_country_hint text,
  detected_iso3 text NOT NULL,
  raw_text_excerpt text,
  source_name text,
  confidence_penalty numeric DEFAULT -0.05,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lril_country_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages corrections" ON public.lril_country_corrections
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Authenticated read corrections" ON public.lril_country_corrections
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_lril_country_corr_signal ON public.lril_country_corrections(signal_id);
CREATE INDEX IF NOT EXISTS idx_lril_country_corr_created ON public.lril_country_corrections(created_at DESC);

-- Phase 2: Signal-linked v3 resolver
CREATE OR REPLACE FUNCTION public.lril_resolve_geo_fuzzy_v3(
  p_text text, p_iso3 text, p_signal_id uuid
)
RETURNS TABLE(geo_entity_id uuid, locality text, admin_level_1 text, lat numeric, lon numeric,
              geo_confidence numeric, match_strength numeric, match_kind text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_norm text;
  v_top_phrase text;
  v_found boolean := false;
  v_src_name text;
  v_lang text;
BEGIN
  IF p_text IS NULL OR length(p_text) < 6 OR p_iso3 IS NULL THEN RETURN; END IF;
  v_norm := lower(unaccent(p_text));

  IF p_signal_id IS NOT NULL THEN
    SELECT source_name, language INTO v_src_name, v_lang
    FROM public.aicis_global_signals WHERE id = p_signal_id;
  END IF;

  SELECT phrase INTO v_top_phrase
  FROM public.lril_extract_place_phrases(p_text)
  ORDER BY weight DESC LIMIT 1;

  RETURN QUERY
  WITH phrases AS (SELECT * FROM public.lril_extract_place_phrases(p_text)),
  matches AS (
    SELECT g.id AS gid, g.locality AS gloc, g.admin_level_1 AS gadm,
           g.lat AS glat, g.lon AS glon,
           CASE WHEN p.kind='admin_suffix' THEN 0.85::numeric
                WHEN p.kind='preposition'  THEN 0.78::numeric
                ELSE 0.62::numeric END AS conf,
           p.weight*(1.0+COALESCE(LEAST(g.population,1000000)::numeric/1000000.0,0)) AS strength,
           p.kind AS kind
    FROM phrases p JOIN public.aicis_geo_entities g ON g.iso3=p_iso3
    WHERE lower(coalesce(g.locality,''))=p.phrase
       OR lower(coalesce(g.city,''))=p.phrase
       OR lower(coalesce(g.admin_level_1,''))=p.phrase
    UNION ALL
    SELECT g.id, g.locality, g.admin_level_1, g.lat, g.lon, 0.80::numeric, p.weight, 'alias_exact'
    FROM phrases p
    JOIN public.aicis_geo_aliases a ON lower(unaccent(a.alias))=p.phrase
    JOIN public.aicis_geo_entities g ON g.id=a.geo_entity_id AND g.iso3=p_iso3
  )
  SELECT gid, gloc, gadm, glat, glon, conf, strength, kind FROM matches
  ORDER BY strength DESC, conf DESC LIMIT 1;
  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF v_found THEN RETURN; END IF;

  RETURN QUERY
  SELECT g.id, g.locality, g.admin_level_1, g.lat, g.lon,
    (0.55+0.20*GREATEST(similarity(lower(unaccent(coalesce(g.locality,''))),v_norm),
                        similarity(lower(unaccent(coalesce(g.city,''))),v_norm)))::numeric,
    GREATEST(similarity(lower(unaccent(coalesce(g.locality,''))),v_norm),
             similarity(lower(unaccent(coalesce(g.city,''))),v_norm))::numeric,
    'trigram'::text
  FROM public.aicis_geo_entities g
  WHERE g.iso3=p_iso3 AND length(coalesce(g.locality,g.city,''))>=4
    AND (similarity(lower(unaccent(coalesce(g.locality,''))),v_norm)>=0.45
      OR similarity(lower(unaccent(coalesce(g.city,'')))    ,v_norm)>=0.45)
  ORDER BY 7 DESC LIMIT 1;
  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF v_found THEN RETURN; END IF;

  RETURN QUERY
  SELECT g.id, g.locality, g.admin_level_1, g.lat, g.lon,
    0.40::numeric, (length(coalesce(g.locality,g.city,g.admin_level_1,''))::numeric/50.0),
    'substring'::text
  FROM public.aicis_geo_entities g
  WHERE g.iso3=p_iso3 AND (
    (length(coalesce(g.locality,''))>=4 AND v_norm LIKE '%'||lower(unaccent(g.locality))||'%')
 OR (length(coalesce(g.city,''))    >=4 AND v_norm LIKE '%'||lower(unaccent(g.city))    ||'%')
 OR (length(coalesce(g.admin_level_1,''))>=5 AND v_norm LIKE '%'||lower(unaccent(g.admin_level_1))||'%'))
  ORDER BY length(coalesce(g.locality,g.city,g.admin_level_1)) DESC LIMIT 1;
  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF v_found THEN RETURN; END IF;

  IF v_top_phrase IS NOT NULL
     AND length(v_top_phrase) >= 3
     AND NOT public.lril_is_negative_phrase(v_top_phrase)
  THEN
    INSERT INTO public.aicis_geo_resolution_audit
      (signal_id, extracted_place, source_name, language, country_hint, attempted_match, match_score, reason_unresolved)
    VALUES
      (p_signal_id, v_top_phrase, v_src_name, v_lang, p_iso3, v_top_phrase, 0, 'no_match_in_gazetteer');
  END IF;
END;
$$;

-- Phase 3: Virtual region entities + aliases (region_virtual)
-- Use source='region_virtual' to mark them clearly. Locality stores canonical region name.
INSERT INTO public.aicis_geo_entities (iso3, admin_level_1, locality, lat, lon, geo_confidence, source, source_id, population)
SELECT 'XMR','Middle East','Middle East', 29.0, 41.0, 0.50,'region_virtual','region:middle_east',0
WHERE NOT EXISTS (SELECT 1 FROM public.aicis_geo_entities WHERE source='region_virtual' AND source_id='region:middle_east');
INSERT INTO public.aicis_geo_entities (iso3, admin_level_1, locality, lat, lon, geo_confidence, source, source_id, population)
SELECT 'XWA','West Africa','West Africa', 12.0, -4.0, 0.50,'region_virtual','region:west_africa',0
WHERE NOT EXISTS (SELECT 1 FROM public.aicis_geo_entities WHERE source='region_virtual' AND source_id='region:west_africa');
INSERT INTO public.aicis_geo_entities (iso3, admin_level_1, locality, lat, lon, geo_confidence, source, source_id, population)
SELECT 'XEA','East Africa','East Africa', 1.0, 38.0, 0.50,'region_virtual','region:east_africa',0
WHERE NOT EXISTS (SELECT 1 FROM public.aicis_geo_entities WHERE source='region_virtual' AND source_id='region:east_africa');
INSERT INTO public.aicis_geo_entities (iso3, admin_level_1, locality, lat, lon, geo_confidence, source, source_id, population)
SELECT 'XSA','Southern Africa','Southern Africa', -22.0, 24.0, 0.50,'region_virtual','region:southern_africa',0
WHERE NOT EXISTS (SELECT 1 FROM public.aicis_geo_entities WHERE source='region_virtual' AND source_id='region:southern_africa');
INSERT INTO public.aicis_geo_entities (iso3, admin_level_1, locality, lat, lon, geo_confidence, source, source_id, population)
SELECT 'XCF','Central Africa','Central Africa', 4.0, 18.0, 0.50,'region_virtual','region:central_africa',0
WHERE NOT EXISTS (SELECT 1 FROM public.aicis_geo_entities WHERE source='region_virtual' AND source_id='region:central_africa');
INSERT INTO public.aicis_geo_entities (iso3, admin_level_1, locality, lat, lon, geo_confidence, source, source_id, population)
SELECT 'XCM','Central America','Central America', 13.0, -86.0, 0.50,'region_virtual','region:central_america',0
WHERE NOT EXISTS (SELECT 1 FROM public.aicis_geo_entities WHERE source='region_virtual' AND source_id='region:central_america');
INSERT INTO public.aicis_geo_entities (iso3, admin_level_1, locality, lat, lon, geo_confidence, source, source_id, population)
SELECT 'XLA','Latin America','Latin America', -10.0, -60.0, 0.50,'region_virtual','region:latin_america',0
WHERE NOT EXISTS (SELECT 1 FROM public.aicis_geo_entities WHERE source='region_virtual' AND source_id='region:latin_america');
INSERT INTO public.aicis_geo_entities (iso3, admin_level_1, locality, lat, lon, geo_confidence, source, source_id, population)
SELECT 'XCB','Caribbean','Caribbean', 18.0, -75.0, 0.50,'region_virtual','region:caribbean',0
WHERE NOT EXISTS (SELECT 1 FROM public.aicis_geo_entities WHERE source='region_virtual' AND source_id='region:caribbean');
INSERT INTO public.aicis_geo_entities (iso3, admin_level_1, locality, lat, lon, geo_confidence, source, source_id, population)
SELECT 'XSH','Sahel','Sahel', 14.0, 5.0, 0.50,'region_virtual','region:sahel',0
WHERE NOT EXISTS (SELECT 1 FROM public.aicis_geo_entities WHERE source='region_virtual' AND source_id='region:sahel');
INSERT INTO public.aicis_geo_entities (iso3, admin_level_1, locality, lat, lon, geo_confidence, source, source_id, population)
SELECT 'XHA','Horn of Africa','Horn of Africa', 8.0, 47.0, 0.50,'region_virtual','region:horn_of_africa',0
WHERE NOT EXISTS (SELECT 1 FROM public.aicis_geo_entities WHERE source='region_virtual' AND source_id='region:horn_of_africa');
INSERT INTO public.aicis_geo_entities (iso3, admin_level_1, locality, lat, lon, geo_confidence, source, source_id, population)
SELECT 'XGS','Gulf States','Gulf States', 25.0, 51.0, 0.50,'region_virtual','region:gulf_states',0
WHERE NOT EXISTS (SELECT 1 FROM public.aicis_geo_entities WHERE source='region_virtual' AND source_id='region:gulf_states');

-- Aliases for virtual regions
WITH src AS (
  SELECT id, source_id FROM public.aicis_geo_entities WHERE source='region_virtual'
), alias_seed(source_id, alias) AS (
  VALUES
    ('region:middle_east','middle east'),('region:middle_east','mideast'),('region:middle_east','near east'),
    ('region:west_africa','west africa'),('region:west_africa','western africa'),('region:west_africa','ecowas'),
    ('region:east_africa','east africa'),('region:east_africa','eastern africa'),
    ('region:southern_africa','southern africa'),('region:southern_africa','sadc region'),
    ('region:central_africa','central africa'),('region:central_africa','middle africa'),
    ('region:central_america','central america'),
    ('region:latin_america','latin america'),('region:latin_america','latam'),
    ('region:caribbean','caribbean'),('region:caribbean','west indies'),
    ('region:sahel','sahel'),('region:sahel','sahel region'),
    ('region:horn_of_africa','horn of africa'),
    ('region:gulf_states','gulf states'),('region:gulf_states','persian gulf'),('region:gulf_states','arabian gulf'),('region:gulf_states','gcc')
)
INSERT INTO public.aicis_geo_aliases (geo_entity_id, alias, language)
SELECT s.id, a.alias, 'en'
FROM src s JOIN alias_seed a ON a.source_id = s.source_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.aicis_geo_aliases x
  WHERE x.geo_entity_id = s.id AND lower(x.alias) = lower(a.alias)
);