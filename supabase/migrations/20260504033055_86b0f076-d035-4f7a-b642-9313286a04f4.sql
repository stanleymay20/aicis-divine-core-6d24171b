create index if not exists idx_admin_regions_country_level on public.admin_regions(country_iso3, admin_level);
create index if not exists idx_community_metrics_country_captured on public.community_metrics(country_iso3, captured_at desc);
create index if not exists idx_country_profiles_iso3 on public.country_profiles(iso3);
create index if not exists idx_country_performance_snapshots_iso3_date on public.country_performance_snapshots(iso3, snapshot_date desc);
create index if not exists idx_normalized_metrics_iso3_domain_period on public.normalized_metrics(iso3, domain, period desc);

create or replace function public.ensure_l0_reporting_anchors()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count integer := 0;
begin
  with fallback as (
    select * from (values
      ('HKG'::text, 'Hong Kong SAR, China'::text, 22.3193::double precision, 114.1694::double precision, 7491609::bigint, 1106::double precision, 'territory'::text),
      ('MAC', 'Macao SAR, China', 22.1987, 113.5439, 686607, 33, 'territory'),
      ('PSE', 'West Bank and Gaza', 31.9522, 35.2332, 5483450, 6020, 'disputed'),
      ('GIB', 'Gibraltar', 36.1408, -5.3536, 32649, 6.8, 'territory'),
      ('ESH', 'Western Sahara', 24.2155, -12.8858, 587259, 266000, 'disputed')
    ) as f(iso3, name, lat, lon, population_est, area_km2, sovereignty_status)
  ), scoped as (
    select
      crc.iso3,
      coalesce(nullif(crc.display_name, ''), crc.canonical_name, fb.name, crc.iso3) as name,
      coalesce(crc.lat, fb.lat) as lat,
      coalesce(crc.lon, fb.lon) as lon,
      fb.population_est,
      fb.area_km2,
      coalesce(crc.sovereignty_status, fb.sovereignty_status) as sovereignty_status,
      crc.trust_score
    from public.canonical_reporting_countries crc
    left join fallback fb on fb.iso3 = crc.iso3
    where crc.sovereignty_status in ('sovereign_state','territory','disputed')
      and not exists (
        select 1 from public.admin_regions ar
        where ar.country_iso3 = crc.iso3 and ar.admin_level = 0
      )
      and coalesce(crc.lat, fb.lat) is not null
      and coalesce(crc.lon, fb.lon) is not null
      and fb.population_est is not null
  ), inserted as (
    insert into public.admin_regions (
      country_iso3,
      admin_level,
      name,
      population_est,
      area_km2,
      urban_rural,
      lat,
      lon,
      source,
      metadata
    )
    select
      iso3,
      0,
      name,
      population_est,
      area_km2,
      'mixed',
      lat,
      lon,
      'canonical_reporting_anchor',
      jsonb_build_object(
        'sovereignty_status', sovereignty_status,
        'trust_score', trust_score,
        'backfilled_from', 'canonical_reporting_countries',
        'backfilled_at', now()
      )
    from scoped
    returning 1
  )
  select count(*) into inserted_count from inserted;

  return inserted_count;
end;
$$;

create or replace view public.v_local_to_national_freshness with (security_invoker = true) as
with reporting_scope as (
  select iso3, canonical_name, sovereignty_status
  from public.canonical_reporting_countries
  where sovereignty_status in ('sovereign_state','territory','disputed')
), cps as (
  select iso3, max(snapshot_date) as last_national
  from public.country_performance_snapshots
  group by iso3
), vi as (
  select a.country_iso3, max(v.observed_at) as last_l0
  from public.village_indicators v
  join public.admin_regions a on a.id = v.region_id
  group by a.country_iso3
), cm as (
  select country_iso3, max(captured_at) as last_community
  from public.community_metrics
  group by country_iso3
), um as (
  select country_iso3, max(computed_at) as last_urban
  from public.urban_metrics
  group by country_iso3
), ar as (
  select
    country_iso3,
    count(*) as regions,
    count(*) filter (where admin_level = 0) as l0_regions,
    count(*) filter (where population_est > 0) as regions_with_pop,
    count(*) filter (where admin_level = 0 and (lat is null or lon is null)) as l0_missing_geo
  from public.admin_regions
  group by country_iso3
), cp as (
  select iso3, count(*) as profiles
  from public.country_profiles
  group by iso3
)
select
  rs.iso3 as country_iso3,
  cps.last_national,
  vi.last_l0,
  cm.last_community,
  um.last_urban,
  ar.regions,
  ar.regions_with_pop,
  case
    when coalesce(ar.l0_regions, 0) = 0 then 'no_local_anchor'
    when coalesce(ar.regions_with_pop, 0) = 0 then 'no_population_data'
    when coalesce(ar.l0_missing_geo, 0) > 0 then 'missing_local_geo'
    when cm.last_community is null then 'no_community_metrics'
    when vi.last_l0 is null then 'no_village_indicators'
    when coalesce(cp.profiles, 0) = 0 then 'no_country_profile'
    when cps.last_national is null then 'no_national_snapshot'
    when cm.last_community < now() - interval '14 days' then 'community_stale'
    when vi.last_l0 < now() - interval '14 days' then 'village_stale'
    else 'healthy'
  end as chain_status
from reporting_scope rs
left join ar on ar.country_iso3 = rs.iso3
left join vi on vi.country_iso3 = rs.iso3
left join cm on cm.country_iso3 = rs.iso3
left join um on um.country_iso3 = rs.iso3
left join cp on cp.iso3 = rs.iso3
left join cps on cps.iso3 = rs.iso3;