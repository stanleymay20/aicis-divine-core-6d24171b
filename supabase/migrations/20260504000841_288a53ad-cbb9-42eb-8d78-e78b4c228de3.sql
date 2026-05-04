CREATE OR REPLACE VIEW public.v_local_to_national_freshness
WITH (security_invoker = true) AS
WITH cps AS (
  SELECT iso3, max(snapshot_date) AS last_national
  FROM country_performance_snapshots GROUP BY iso3
), vi AS (
  SELECT a.country_iso3, max(v.observed_at) AS last_l0
  FROM village_indicators v JOIN admin_regions a ON a.id = v.region_id
  GROUP BY a.country_iso3
), cm AS (
  SELECT country_iso3, max(captured_at) AS last_community
  FROM community_metrics GROUP BY country_iso3
), um AS (
  SELECT country_iso3, max(computed_at) AS last_urban
  FROM urban_metrics GROUP BY country_iso3
), ar AS (
  SELECT country_iso3, count(*) AS regions,
         count(*) FILTER (WHERE population_est > 0) AS regions_with_pop
  FROM admin_regions GROUP BY country_iso3
)
SELECT COALESCE(cps.iso3, ar.country_iso3) AS country_iso3,
       cps.last_national, vi.last_l0, cm.last_community, um.last_urban,
       ar.regions, ar.regions_with_pop,
       CASE
         WHEN ar.regions IS NULL THEN 'no_local_anchor'
         WHEN ar.regions_with_pop = 0 THEN 'no_population_data'
         WHEN cm.last_community IS NULL THEN 'no_community_metrics'
         WHEN vi.last_l0 IS NULL THEN 'no_village_indicators'
         WHEN cps.last_national IS NULL THEN 'no_national_snapshot'
         WHEN cm.last_community < (now() - interval '14 days') THEN 'community_stale'
         WHEN vi.last_l0 < (now() - interval '14 days') THEN 'village_stale'
         ELSE 'healthy'
       END AS chain_status
FROM cps
FULL JOIN ar ON ar.country_iso3 = cps.iso3
LEFT JOIN vi ON vi.country_iso3 = COALESCE(cps.iso3, ar.country_iso3)
LEFT JOIN cm ON cm.country_iso3 = COALESCE(cps.iso3, ar.country_iso3)
LEFT JOIN um ON um.country_iso3 = COALESCE(cps.iso3, ar.country_iso3);

CREATE INDEX IF NOT EXISTS idx_village_indicators_region_observed
  ON public.village_indicators (region_id, observed_at DESC);