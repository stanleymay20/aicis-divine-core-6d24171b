create or replace function public.ensure_admin_region_demographics()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated_count integer := 0;
begin
  with country_root as (
    select distinct on (country_iso3)
      country_iso3,
      nullif(population_est, 0)::numeric as root_pop,
      nullif(area_km2, 0)::numeric as root_area
    from public.admin_regions
    where admin_level = 0
      and population_est > 0
    order by country_iso3, updated_at desc nulls last
  ), level_counts as (
    select country_iso3, admin_level, count(*)::numeric as n
    from public.admin_regions
    where admin_level > 0
    group by country_iso3, admin_level
  ), repair as (
    select
      ar.id,
      greatest(1, round((cr.root_pop * case ar.admin_level when 1 then 0.18 when 2 then 0.08 when 3 then 0.03 else 0.01 end) / greatest(lc.n, 1)))::bigint as est_pop,
      greatest(0.1, (coalesce(cr.root_area, 1000) * case ar.admin_level when 1 then 0.18 when 2 then 0.08 when 3 then 0.03 else 0.01 end) / greatest(lc.n, 1))::double precision as est_area
    from public.admin_regions ar
    join country_root cr on cr.country_iso3 = ar.country_iso3
    join level_counts lc on lc.country_iso3 = ar.country_iso3 and lc.admin_level = ar.admin_level
    where ar.admin_level > 0
      and (ar.population_est is null or ar.population_est <= 0 or ar.area_km2 is null or ar.area_km2 <= 0 or ar.urban_rural is null)
  ), upd as (
    update public.admin_regions ar
    set
      population_est = case when ar.population_est is null or ar.population_est <= 0 then repair.est_pop else ar.population_est end,
      area_km2 = case when ar.area_km2 is null or ar.area_km2 <= 0 then repair.est_area else ar.area_km2 end,
      urban_rural = case
        when ar.urban_rural is not null then ar.urban_rural
        when repair.est_pop / greatest(repair.est_area, 0.1) >= 1000 then 'urban'
        when repair.est_pop / greatest(repair.est_area, 0.1) >= 250 then 'peri-urban'
        else 'rural'
      end,
      metadata = coalesce(ar.metadata, '{}'::jsonb) || jsonb_build_object('demographic_repaired_at', now(), 'demographic_repair_method', 'country_anchor_allocation_v1'),
      updated_at = now()
    from repair
    where ar.id = repair.id
    returning 1
  )
  select count(*) into updated_count from upd;

  return jsonb_build_object('updated_regions', updated_count);
end;
$$;

revoke all on function public.ensure_admin_region_demographics() from public;
revoke all on function public.ensure_admin_region_demographics() from anon;
revoke all on function public.ensure_admin_region_demographics() from authenticated;
grant execute on function public.ensure_admin_region_demographics() to service_role;