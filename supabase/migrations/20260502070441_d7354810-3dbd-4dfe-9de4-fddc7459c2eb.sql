CREATE OR REPLACE FUNCTION public.lril_resolve_geo_fuzzy_v2(p_text text, p_iso3 text)
 RETURNS TABLE(geo_entity_id uuid, locality text, admin_level_1 text, lat numeric, lon numeric, geo_confidence numeric, match_strength numeric, match_kind text)
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text;
  v_top_phrase text;
  v_found boolean := false;
BEGIN
  IF p_text IS NULL OR length(p_text) < 6 OR p_iso3 IS NULL THEN RETURN; END IF;
  v_norm := lower(unaccent(p_text));

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

  -- LOG FAILURE only when we actually extracted a phrase and it isn't junk
  IF v_top_phrase IS NOT NULL
     AND length(v_top_phrase) >= 3
     AND NOT public.lril_is_negative_phrase(v_top_phrase)
  THEN
    INSERT INTO public.aicis_geo_resolution_audit
      (signal_id, extracted_place, source_name, language, country_hint, attempted_match, match_score, reason_unresolved)
    VALUES
      (NULL, v_top_phrase, NULL, NULL, p_iso3, v_top_phrase, 0, 'no_match_in_gazetteer');
  END IF;
END;
$function$;