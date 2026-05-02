-- LRIL v14: Sub-national geo-resolution lift (no immutable index issue)

CREATE OR REPLACE FUNCTION public.lril_extract_place_phrases(p_text text)
RETURNS TABLE(phrase text, kind text, weight numeric)
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  v_text text;
  v_match text[];
BEGIN
  IF p_text IS NULL OR length(p_text) < 6 THEN RETURN; END IF;
  v_text := regexp_replace(p_text, '\s+', ' ', 'g');

  FOR v_match IN
    SELECT regexp_matches(
      v_text,
      '\y(?:in|at|near|outside|inside|around|from|across|to)\s+([A-Z][\p{L}\-]{2,}(?:\s+[A-Z][\p{L}\-]{2,}){0,2})',
      'g'
    )
  LOOP
    phrase := lower(unaccent(v_match[1]));
    kind := 'preposition';
    weight := 1.0;
    RETURN NEXT;
  END LOOP;

  FOR v_match IN
    SELECT regexp_matches(
      v_text,
      '\y([A-Z][\p{L}\-]{2,}(?:\s+[A-Z][\p{L}\-]{2,}){0,2})\s+(district|province|region|county|city|town|village|state|governorate|prefecture|department|municipality)\y',
      'gi'
    )
  LOOP
    phrase := lower(unaccent(v_match[1]));
    kind := 'admin_suffix';
    weight := 1.2;
    RETURN NEXT;
  END LOOP;

  FOR v_match IN
    SELECT regexp_matches(
      v_text,
      '\y([A-Z][\p{L}\-]{3,}\s+[A-Z][\p{L}\-]{3,})\y',
      'g'
    )
  LOOP
    phrase := lower(unaccent(v_match[1]));
    kind := 'proper_bigram';
    weight := 0.5;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.lril_resolve_geo_fuzzy_v2(p_text text, p_iso3 text)
RETURNS TABLE(
  geo_entity_id uuid, locality text, admin_level_1 text,
  lat numeric, lon numeric, geo_confidence numeric,
  match_strength numeric, match_kind text
)
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  v_norm text;
BEGIN
  IF p_text IS NULL OR length(p_text) < 6 OR p_iso3 IS NULL THEN RETURN; END IF;
  v_norm := lower(unaccent(p_text));

  RETURN QUERY
  WITH phrases AS (
    SELECT * FROM public.lril_extract_place_phrases(p_text)
  ),
  matches AS (
    SELECT g.id AS gid, g.locality AS gloc, g.admin_level_1 AS gadm,
           g.lat AS glat, g.lon AS glon,
           CASE
             WHEN p.kind = 'admin_suffix' THEN 0.85::numeric
             WHEN p.kind = 'preposition'  THEN 0.78::numeric
             ELSE                              0.62::numeric
           END AS conf,
           p.weight * (1.0 + COALESCE(LEAST(g.population, 1000000)::numeric / 1000000.0, 0)) AS strength,
           p.kind AS kind
    FROM phrases p
    JOIN public.aicis_geo_entities g ON g.iso3 = p_iso3
    WHERE
         lower(coalesce(g.locality,'')) = p.phrase
      OR lower(coalesce(g.city,''))     = p.phrase
      OR lower(coalesce(g.admin_level_1,'')) = p.phrase
    UNION ALL
    SELECT g.id, g.locality, g.admin_level_1, g.lat, g.lon,
           0.80::numeric, p.weight, 'alias_exact'
    FROM phrases p
    JOIN public.aicis_geo_aliases a ON lower(unaccent(a.alias)) = p.phrase
    JOIN public.aicis_geo_entities g
      ON g.id = a.geo_entity_id AND g.iso3 = p_iso3
  )
  SELECT gid, gloc, gadm, glat, glon, conf, strength, kind
  FROM matches
  ORDER BY strength DESC, conf DESC
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT g.id, g.locality, g.admin_level_1, g.lat, g.lon,
         (0.55 + 0.20 * GREATEST(
            similarity(lower(unaccent(coalesce(g.locality,''))), v_norm),
            similarity(lower(unaccent(coalesce(g.city,''))),     v_norm)
         ))::numeric,
         GREATEST(
            similarity(lower(unaccent(coalesce(g.locality,''))), v_norm),
            similarity(lower(unaccent(coalesce(g.city,''))),     v_norm)
         )::numeric,
         'trigram'::text
  FROM public.aicis_geo_entities g
  WHERE g.iso3 = p_iso3
    AND length(coalesce(g.locality, g.city, '')) >= 4
    AND (
        similarity(lower(unaccent(coalesce(g.locality,''))), v_norm) >= 0.45
     OR similarity(lower(unaccent(coalesce(g.city,'')))    , v_norm) >= 0.45
    )
  ORDER BY 7 DESC
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT g.id, g.locality, g.admin_level_1, g.lat, g.lon,
         0.40::numeric,
         (length(coalesce(g.locality, g.city, g.admin_level_1, ''))::numeric / 50.0),
         'substring'::text
  FROM public.aicis_geo_entities g
  WHERE g.iso3 = p_iso3 AND (
       (length(coalesce(g.locality,'')) >= 4 AND v_norm LIKE '%' || lower(unaccent(g.locality)) || '%')
    OR (length(coalesce(g.city,''))     >= 4 AND v_norm LIKE '%' || lower(unaccent(g.city))     || '%')
    OR (length(coalesce(g.admin_level_1,'')) >= 5 AND v_norm LIKE '%' || lower(unaccent(g.admin_level_1)) || '%'))
  ORDER BY length(coalesce(g.locality, g.city, g.admin_level_1)) DESC
  LIMIT 1;
END;
$$;

CREATE OR REPLACE VIEW public.v_lril_geo_audit_unresolved
WITH (security_invoker = true) AS
SELECT
  s.country_hint AS iso3,
  s.source_name,
  s.language,
  COUNT(*) AS unresolved_signals,
  MAX(s.ingested_at) AS last_seen
FROM public.aicis_raw_local_signals s
LEFT JOIN public.aicis_local_events e
  ON e.raw_signal_ids @> to_jsonb(ARRAY[s.id::text])
WHERE s.processed_at > now() - interval '72 hours'
  AND (e.geo_entity_id IS NULL OR e.id IS NULL)
GROUP BY s.country_hint, s.source_name, s.language
ORDER BY unresolved_signals DESC;

CREATE OR REPLACE VIEW public.v_lril_geo_audit_top_unresolved_places
WITH (security_invoker = true) AS
SELECT
  ph.phrase,
  s.country_hint AS iso3,
  COUNT(*) AS mention_count
FROM public.aicis_raw_local_signals s
CROSS JOIN LATERAL public.lril_extract_place_phrases(s.raw_text) ph
LEFT JOIN public.aicis_geo_entities g
  ON g.iso3 = s.country_hint
 AND (lower(coalesce(g.locality,'')) = ph.phrase
   OR lower(coalesce(g.city,''))     = ph.phrase
   OR lower(coalesce(g.admin_level_1,'')) = ph.phrase)
WHERE s.processed_at > now() - interval '72 hours'
  AND s.raw_text IS NOT NULL
  AND g.id IS NULL
GROUP BY ph.phrase, s.country_hint
ORDER BY mention_count DESC
LIMIT 200;

CREATE OR REPLACE VIEW public.v_lril_geo_audit_null_iso3
WITH (security_invoker = true) AS
SELECT
  source_name,
  COUNT(*) AS null_iso3_count
FROM public.aicis_raw_local_signals
WHERE processed_at > now() - interval '72 hours'
  AND country_hint IS NULL
GROUP BY source_name
ORDER BY null_iso3_count DESC;

UPDATE public.aicis_raw_local_signals s
SET processed_at = NULL
FROM public.aicis_local_events e
WHERE e.created_at > now() - interval '72 hours'
  AND (e.geo_entity_id IS NULL OR e.confidence < 0.55)
  AND e.raw_signal_ids @> to_jsonb(ARRAY[s.id::text]);
