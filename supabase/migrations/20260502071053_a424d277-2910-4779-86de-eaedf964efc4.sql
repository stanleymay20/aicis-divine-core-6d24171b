CREATE OR REPLACE FUNCTION public.geonames_ingest_chunk(p_offset bigint, p_limit int)
RETURNS TABLE(entities_inserted int, entities_updated int, aliases_inserted int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_ins int := 0; v_upd int := 0; v_alias int := 0;
BEGIN
  CREATE TEMP TABLE _chunk ON COMMIT DROP AS
  SELECT s.geonameid::text AS source_id,
         upper(s.country_code) AS iso2,
         s.name, s.asciiname, s.alternatenames,
         s.latitude::numeric AS lat, s.longitude::numeric AS lon,
         s.feature_class AS fclass, s.feature_code AS fcode,
         s.admin1_code AS admin1, s.admin2_code AS admin2,
         COALESCE(s.population,0) AS population
  FROM public.geonames_staging s
  ORDER BY s.geonameid
  OFFSET p_offset LIMIT p_limit;

  CREATE TEMP TABLE _mapped ON COMMIT DROP AS
  SELECT c.*, m.iso3
  FROM _chunk c
  JOIN public.iso_country_map m ON m.iso2 = c.iso2
  WHERE c.name IS NOT NULL AND length(c.name) BETWEEN 2 AND 200;

  WITH ins AS (
    INSERT INTO public.aicis_geo_entities
      (iso3, locality, city, admin_level_1, admin_level_2, lat, lon, population, geo_confidence, source, source_id)
    SELECT
      iso3,
      CASE WHEN fclass='P' THEN name ELSE NULL END,
      CASE WHEN fclass='P' AND fcode IN ('PPLC','PPLA','PPLA2','PPLA3','PPLA4','PPL') THEN name ELSE NULL END,
      CASE WHEN fclass='A' AND fcode IN ('ADM1','ADM1H') THEN name ELSE NULL END,
      CASE WHEN fclass='A' AND fcode IN ('ADM2','ADM2H') THEN name ELSE NULL END,
      lat, lon, population,
      CASE WHEN population > 100000 THEN 0.92
           WHEN population > 10000  THEN 0.88
           WHEN population > 1000   THEN 0.82
           ELSE 0.75 END,
      'geonames_allcountries', source_id
    FROM _mapped
    ON CONFLICT (source, source_id) WHERE source IS NOT NULL AND source_id IS NOT NULL
    DO UPDATE SET
      population = GREATEST(EXCLUDED.population, public.aicis_geo_entities.population),
      lat = COALESCE(public.aicis_geo_entities.lat, EXCLUDED.lat),
      lon = COALESCE(public.aicis_geo_entities.lon, EXCLUDED.lon)
    RETURNING xmax = 0 AS is_insert
  )
  SELECT count(*) FILTER (WHERE is_insert), count(*) FILTER (WHERE NOT is_insert)
  INTO v_ins, v_upd FROM ins;

  WITH alias_raw AS (
    SELECT g.id AS entity_id,
           btrim(unnest(string_to_array(c.alternatenames, ','))) AS alias
    FROM _mapped c
    JOIN public.aicis_geo_entities g
      ON g.source='geonames_allcountries' AND g.source_id=c.source_id
    WHERE c.alternatenames IS NOT NULL AND length(c.alternatenames) > 0
  ),
  alias_clean AS (
    SELECT entity_id, alias FROM alias_raw
    WHERE alias IS NOT NULL AND length(alias) BETWEEN 3 AND 80
      AND alias !~ '^https?://' AND alias !~ '^[0-9]+$' AND alias NOT LIKE '%@%'
  ),
  alias_capped AS (
    SELECT entity_id, alias FROM (
      SELECT entity_id, alias, row_number() OVER (PARTITION BY entity_id ORDER BY length(alias)) AS rn
      FROM alias_clean
    ) s WHERE rn <= 10
  ),
  ins_a AS (
    INSERT INTO public.aicis_geo_aliases (geo_entity_id, alias)
    SELECT entity_id, alias FROM alias_capped
    ON CONFLICT (geo_entity_id, lower(alias)) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_alias FROM ins_a;

  RETURN QUERY SELECT v_ins, v_upd, v_alias;
END $$;

GRANT EXECUTE ON FUNCTION public.geonames_ingest_chunk(bigint,int) TO sandbox_exec, authenticated;