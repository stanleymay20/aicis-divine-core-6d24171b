
WITH child_pops AS (
  SELECT country_iso3, sum(population_est)::bigint AS total_pop, sum(area_km2) AS total_area
  FROM public.admin_regions WHERE admin_level = 4 AND population_est > 0 GROUP BY country_iso3
)
UPDATE public.admin_regions a
SET population_est = c.total_pop,
    area_km2 = COALESCE(a.area_km2, c.total_area),
    metadata = COALESCE(a.metadata,'{}'::jsonb) || jsonb_build_object('pop_backfilled_from','l4_children','backfilled_at', now())
FROM child_pops c
WHERE a.country_iso3 = c.country_iso3 AND a.admin_level IN (0,1)
  AND (a.population_est IS NULL OR a.population_est = 0);

INSERT INTO public.admin_regions (country_iso3, admin_level, name, population_est, urban_rural, source, metadata)
SELECT DISTINCT c.iso3, 0, c.iso3, 1000000, 'unknown', 'orphan_bootstrap_v1',
       jsonb_build_object('reason','national_snapshot_without_admin_region','bootstrapped_at', now())
FROM public.country_performance_snapshots c
WHERE NOT EXISTS (SELECT 1 FROM public.admin_regions a WHERE a.country_iso3 = c.iso3)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE VIEW public.v_local_to_national_freshness
WITH (security_invoker = true) AS
WITH cps AS (SELECT iso3, max(snapshot_date) AS last_national FROM public.country_performance_snapshots GROUP BY iso3),
vi AS (SELECT a.country_iso3, max(v.observed_at) AS last_l0 FROM public.village_indicators v JOIN public.admin_regions a ON a.id=v.region_id GROUP BY a.country_iso3),
cm AS (SELECT country_iso3, max(captured_at) AS last_community FROM public.community_metrics GROUP BY country_iso3),
um AS (SELECT country_iso3, max(computed_at) AS last_urban FROM public.urban_metrics GROUP BY country_iso3),
ar AS (SELECT country_iso3, count(*) regions, count(*) filter (where population_est>0) regions_with_pop FROM public.admin_regions GROUP BY country_iso3)
SELECT COALESCE(cps.iso3, ar.country_iso3) AS country_iso3,
  cps.last_national, vi.last_l0, cm.last_community, um.last_urban,
  ar.regions, ar.regions_with_pop,
  CASE
    WHEN ar.regions IS NULL THEN 'no_local_anchor'
    WHEN ar.regions_with_pop = 0 THEN 'no_population_data'
    WHEN cm.last_community IS NULL THEN 'no_community_metrics'
    WHEN vi.last_l0 IS NULL THEN 'no_village_indicators'
    WHEN cps.last_national IS NULL THEN 'no_national_snapshot'
    WHEN cm.last_community < now() - interval '48 hours' THEN 'community_stale'
    WHEN vi.last_l0 < now() - interval '48 hours' THEN 'village_stale'
    ELSE 'healthy'
  END AS chain_status
FROM cps FULL OUTER JOIN ar ON ar.country_iso3 = cps.iso3
LEFT JOIN vi ON vi.country_iso3 = COALESCE(cps.iso3, ar.country_iso3)
LEFT JOIN cm ON cm.country_iso3 = COALESCE(cps.iso3, ar.country_iso3)
LEFT JOIN um ON um.country_iso3 = COALESCE(cps.iso3, ar.country_iso3);

GRANT SELECT ON public.v_local_to_national_freshness TO authenticated, anon;
