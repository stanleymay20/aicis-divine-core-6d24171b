
-- LRIL v10 — bridge unblock + fuzzy geo (retry without generated column)

DROP FUNCTION IF EXISTS public.lril_compute_confidence(integer, numeric, numeric, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION public.lril_compute_confidence(
  p_source_count integer, p_avg_source_reliability numeric, p_keyword_strength numeric,
  p_geo_confidence numeric, p_temporal_density numeric,
  p_proxy_boost numeric DEFAULT 0, p_fatality_count integer DEFAULT 0
) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $fn$
DECLARE src_score numeric; base numeric;
BEGIN
  src_score := LEAST(1.0, 0.40 + 0.25 * ln(GREATEST(p_source_count,1)));
  base := 0.30 * src_score
        + 0.25 * GREATEST(0.4, COALESCE(p_avg_source_reliability,0.5))
        + 0.25 * GREATEST(0, COALESCE(p_keyword_strength,0))
        + 0.15 * GREATEST(0.35, COALESCE(p_geo_confidence,0.35))
        + 0.05 * LEAST(1.0, COALESCE(p_temporal_density,0))
        + LEAST(0.2, COALESCE(p_proxy_boost,0));
  IF COALESCE(p_keyword_strength,0) >= 1.0 THEN base := GREATEST(base, 0.42); END IF;
  IF p_source_count >= 1 AND COALESCE(p_avg_source_reliability,0) >= 0.85 AND COALESCE(p_keyword_strength,0) >= 1.0 THEN base := GREATEST(base, 0.50); END IF;
  IF p_source_count >= 2 THEN base := GREATEST(base, 0.50); END IF;
  IF p_source_count >= 3 AND COALESCE(p_avg_source_reliability,0) >= 0.6 THEN base := GREATEST(base, 0.70); END IF;
  IF COALESCE(p_fatality_count,0) >= 3 AND COALESCE(p_geo_confidence,0) >= 0.5 THEN base := GREATEST(base, 0.55); END IF;
  IF COALESCE(p_fatality_count,0) >= 10 THEN base := GREATEST(base, 0.70); END IF;
  RETURN LEAST(1.0, ROUND(base::numeric, 4));
END; $fn$;

CREATE OR REPLACE FUNCTION public.lril_bridge_to_normalized()
RETURNS TABLE(bridged_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_count INT := 0;
BEGIN
  WITH ins AS (
    INSERT INTO public.normalized_events (
      provider_name, event_type, category, title, description,
      country_iso3, iso3, severity, confidence,
      occurred_at, started_at, source_name, source_url, raw_data, dedup_key)
    SELECT 'lril', le.event_type, le.event_type,
      coalesce(le.title, le.subtype || ' in ' || coalesce(le.locality, le.iso3_normalized, le.iso3)),
      le.description,
      coalesce(le.iso3_normalized, le.iso3),
      coalesce(le.iso3_normalized, le.iso3),
      (le.severity * 10)::int, le.confidence,
      le.start_time, le.start_time, 'AICIS LRIL', NULL,
      jsonb_build_object('lril_event_id', le.id, 'subtype', le.subtype, 'locality', le.locality,
        'admin_level_1', le.admin_level_1, 'source_count', le.source_count,
        'matched_keywords', le.matched_keywords, 'lat', le.lat, 'lon', le.lon,
        'confidence_tier', le.confidence_tier, 'iso3_raw', le.iso3,
        'iso3_normalized', le.iso3_normalized),
      'lril_' || le.id::text
    FROM public.aicis_local_events le
    WHERE le.bridged_to_normalized = FALSE AND le.confidence >= 0.35 AND le.status = 'active'
      AND coalesce(le.iso3_normalized, le.iso3) IS NOT NULL
    ON CONFLICT (dedup_key) DO NOTHING RETURNING 1)
  SELECT count(*)::int INTO v_count FROM ins;
  UPDATE public.aicis_local_events SET bridged_to_normalized = TRUE
  WHERE bridged_to_normalized = FALSE AND confidence >= 0.35 AND status = 'active'
    AND coalesce(iso3_normalized, iso3) IS NOT NULL;
  RETURN QUERY SELECT v_count;
END $fn$;

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.aicis_geo_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  geo_entity_id uuid REFERENCES public.aicis_geo_entities(id) ON DELETE CASCADE,
  alias text NOT NULL,
  language text DEFAULT 'en',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_geo_aliases_lower ON public.aicis_geo_aliases (lower(alias));
ALTER TABLE public.aicis_geo_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "geo_aliases_read" ON public.aicis_geo_aliases;
CREATE POLICY "geo_aliases_read" ON public.aicis_geo_aliases FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.lril_resolve_geo_fuzzy(p_text text, p_iso3 text)
RETURNS TABLE(geo_entity_id uuid, locality text, admin_level_1 text, lat numeric, lon numeric, geo_confidence numeric, match_strength numeric)
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $fn$
DECLARE v_norm text;
BEGIN
  IF p_text IS NULL OR length(p_text) < 4 OR p_iso3 IS NULL THEN RETURN; END IF;
  v_norm := lower(unaccent(p_text));

  RETURN QUERY
  SELECT g.id, g.locality, g.admin_level_1, g.lat, g.lon, g.geo_confidence, 1.0::numeric
  FROM public.aicis_geo_aliases a
  JOIN public.aicis_geo_entities g ON g.id = a.geo_entity_id
  WHERE g.iso3 = p_iso3 AND length(a.alias) >= 4
    AND v_norm LIKE '%' || lower(unaccent(a.alias)) || '%'
  ORDER BY length(a.alias) DESC LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT g.id, g.locality, g.admin_level_1, g.lat, g.lon, g.geo_confidence,
         (length(coalesce(g.locality, g.city, g.admin_level_1, ''))::numeric / 50.0)
  FROM public.aicis_geo_entities g
  WHERE g.iso3 = p_iso3 AND (
      (length(coalesce(g.locality,'')) >= 4 AND v_norm LIKE '%' || lower(unaccent(g.locality)) || '%')
   OR (length(coalesce(g.city,''))     >= 4 AND v_norm LIKE '%' || lower(unaccent(g.city))     || '%')
   OR (length(coalesce(g.admin_level_1,'')) >= 5 AND v_norm LIKE '%' || lower(unaccent(g.admin_level_1)) || '%'))
  ORDER BY length(coalesce(g.locality, g.city, g.admin_level_1)) DESC LIMIT 1;
END; $fn$;

INSERT INTO public.aicis_geo_aliases (geo_entity_id, alias, language)
SELECT g.id, a.alias, a.language FROM public.aicis_geo_entities g
JOIN (VALUES
  ('IND','Mumbai','Bombay','en'),('IND','Kolkata','Calcutta','en'),('IND','Chennai','Madras','en'),
  ('VNM','Ho Chi Minh','Saigon','en'),('MMR','Yangon','Rangoon','en'),
  ('TUR','Istanbul','Constantinople','en'),('IRN','Tehran','Teheran','en'),
  ('CHN','Beijing','Peking','en'),('UKR','Kyiv','Kiev','en'),
  ('COD','Kinshasa','Leopoldville','en'),('MDG','Antananarivo','Tananarive','fr'),
  ('DZA','Algiers','Alger','fr')
) a(iso3, locality_match, alias, language)
  ON g.iso3 = a.iso3 AND (lower(coalesce(g.locality,'')) LIKE '%'||lower(a.locality_match)||'%' OR lower(coalesce(g.city,'')) LIKE '%'||lower(a.locality_match)||'%')
ON CONFLICT DO NOTHING;
