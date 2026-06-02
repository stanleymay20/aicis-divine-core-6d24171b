
CREATE OR REPLACE FUNCTION public.rebuild_adjacency_v3()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count int;
BEGIN
  CREATE TEMP TABLE _country_metrics ON COMMIT DROP AS
    SELECT iso3, array_agg(DISTINCT metric_name) AS metrics
    FROM normalized_metrics
    WHERE iso3 IS NOT NULL AND metric_name IS NOT NULL
    GROUP BY iso3;

  WITH country_geo AS (
    SELECT iso3, lat, lon
    FROM canonical_entities
    WHERE entity_type='country' AND iso3 IS NOT NULL AND lat IS NOT NULL AND lon IS NOT NULL
  ),
  pairs AS (
    SELECT a.iso3 AS origin_iso3, b.iso3 AS target_iso3,
      2*6371*asin(sqrt(
        sin(radians((b.lat-a.lat)/2))^2 +
        cos(radians(a.lat))*cos(radians(b.lat))*sin(radians((b.lon-a.lon)/2))^2
      )) AS distance_km
    FROM country_geo a JOIN country_geo b ON a.iso3 <> b.iso3
  ),
  filtered AS (
    SELECT origin_iso3, target_iso3, distance_km,
           GREATEST(0, 1 - distance_km/2000.0) AS strength
    FROM pairs WHERE distance_km <= 2000
  ),
  enriched AS (
    SELECT f.origin_iso3, f.target_iso3, f.distance_km, f.strength,
      COALESCE(
        (SELECT cardinality(ARRAY(SELECT unnest(cm1.metrics) INTERSECT SELECT unnest(cm2.metrics)))
         FROM _country_metrics cm1, _country_metrics cm2
         WHERE cm1.iso3 = f.origin_iso3 AND cm2.iso3 = f.target_iso3),
        0) AS shared_count
    FROM filtered f
  ),
  ins AS (
    INSERT INTO adjacency_v3 (origin_iso3,target_iso3,distance_km,strength,shared_metrics,trade_link,computed_at)
    SELECT origin_iso3, target_iso3, round(distance_km::numeric,2), round(strength::numeric,4),
           shared_count, shared_count >= 3, now()
    FROM enriched
    ON CONFLICT (origin_iso3,target_iso3) DO UPDATE
      SET distance_km=EXCLUDED.distance_km, strength=EXCLUDED.strength,
          shared_metrics=EXCLUDED.shared_metrics, trade_link=EXCLUDED.trade_link, computed_at=now()
    RETURNING 1
  )
  SELECT count(*) INTO inserted_count FROM ins;

  RETURN jsonb_build_object('ok', true, 'rows', inserted_count, 'computed_at', now());
END $$;
