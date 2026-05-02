CREATE OR REPLACE FUNCTION public.geonames_bulk_upsert(p_rows jsonb)
RETURNS TABLE(entities_inserted int, entities_updated int, aliases_inserted int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ent_ins int := 0;
  v_ent_upd int := 0;
  v_alias_ins int := 0;
BEGIN
  -- Stage rows into a temp table for set-based ops
  CREATE TEMP TABLE _gn_batch ON COMMIT DROP AS
  SELECT
    (r->>'geonameid')::text AS source_id,
    upper((r->>'iso2')::text) AS iso2,
    (r->>'name')::text AS name,
    (r->>'asciiname')::text AS asciiname,
    (r->>'alternatenames')::text AS alternatenames,
    NULLIF(r->>'lat','')::numeric AS lat,
    NULLIF(r->>'lon','')::numeric AS lon,
    (r->>'feature_class')::text AS fclass,
    (r->>'feature_code')::text AS fcode,
    (r->>'admin1')::text AS admin1,
    (r->>'admin2')::text AS admin2,
    COALESCE(NULLIF(r->>'population','')::bigint,0) AS population
  FROM jsonb_array_elements(p_rows) r;

  -- Map iso2 → iso3
  CREATE TEMP TABLE _gn_mapped ON COMMIT DROP AS
  SELECT b.*, m.iso3
  FROM _gn_batch b
  LEFT JOIN public.iso_country_map m ON m.iso2 = b.iso2
  WHERE m.iso3 IS NOT NULL;

  -- Upsert entities
  WITH ins AS (
    INSERT INTO public.aicis_geo_entities
      (iso3, locality, city, admin_level_1, admin_level_2, lat, lon,
       population, geo_confidence, source, source_id)
    SELECT
      iso3,
      CASE WHEN fclass='P' THEN name ELSE NULL END,                     -- locality only for populated places
      CASE WHEN fclass='P' AND fcode IN ('PPLC','PPLA','PPLA2','PPLA3','PPLA4','PPL') THEN name ELSE NULL END,
      CASE WHEN fclass='A' AND fcode IN ('ADM1','ADM1H') THEN name
           ELSE NULL END,
      CASE WHEN fclass='A' AND fcode IN ('ADM2','ADM2H') THEN name
           ELSE NULL END,
      lat, lon, population,
      CASE WHEN population > 100000 THEN 0.92
           WHEN population > 10000  THEN 0.88
           WHEN population > 1000   THEN 0.82
           ELSE 0.75 END,
      'geonames_allcountries',
      source_id
    FROM _gn_mapped
    WHERE name IS NOT NULL AND length(name) BETWEEN 2 AND 200
    ON CONFLICT (source, source_id) WHERE source IS NOT NULL AND source_id IS NOT NULL
    DO UPDATE SET
      population = GREATEST(EXCLUDED.population, public.aicis_geo_entities.population),
      lat = COALESCE(public.aicis_geo_entities.lat, EXCLUDED.lat),
      lon = COALESCE(public.aicis_geo_entities.lon, EXCLUDED.lon)
    RETURNING xmax = 0 AS is_insert, id, source_id
  )
  SELECT
    count(*) FILTER (WHERE is_insert),
    count(*) FILTER (WHERE NOT is_insert)
  INTO v_ent_ins, v_ent_upd
  FROM ins;

  -- Aliases: parse comma-separated alternatenames, max 10 per entity, length 3..80
  WITH alias_raw AS (
    SELECT g.id AS entity_id,
           trim(unnest(string_to_array(b.alternatenames, ','))) AS alias
    FROM _gn_mapped b
    JOIN public.aicis_geo_entities g
      ON g.source = 'geonames_allcountries' AND g.source_id = b.source_id
    WHERE b.alternatenames IS NOT NULL AND length(b.alternatenames) > 0
  ),
  alias_clean AS (
    SELECT entity_id, alias
    FROM alias_raw
    WHERE alias IS NOT NULL
      AND length(alias) BETWEEN 3 AND 80
      AND alias !~ '^https?://'
      AND alias !~ '^[0-9]+$'
      AND alias NOT LIKE '%@%'
  ),
  alias_capped AS (
    SELECT entity_id, alias
    FROM (
      SELECT entity_id, alias,
             row_number() OVER (PARTITION BY entity_id ORDER BY length(alias)) AS rn
      FROM alias_clean
    ) s
    WHERE rn <= 10
  ),
  ins_a AS (
    INSERT INTO public.aicis_geo_aliases (geo_entity_id, alias)
    SELECT entity_id, alias FROM alias_capped
    ON CONFLICT (geo_entity_id, lower(alias)) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_alias_ins FROM ins_a;

  RETURN QUERY SELECT v_ent_ins, v_ent_upd, v_alias_ins;
END $$;

REVOKE EXECUTE ON FUNCTION public.geonames_bulk_upsert(jsonb) FROM anon, authenticated;