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
      'unknown',
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

revoke all on function public.ensure_l0_reporting_anchors() from public;
revoke all on function public.ensure_l0_reporting_anchors() from anon;
revoke all on function public.ensure_l0_reporting_anchors() from authenticated;
grant execute on function public.ensure_l0_reporting_anchors() to service_role;