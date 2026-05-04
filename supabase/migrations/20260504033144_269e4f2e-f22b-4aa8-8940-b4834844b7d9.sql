create or replace function public.ensure_country_profiles_from_normalized()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count integer := 0;
begin
  with eligible as (
    select crc.iso3,
           coalesce(nullif(crc.display_name, ''), crc.canonical_name, crc.iso3) as country_name
    from public.canonical_reporting_countries crc
    where crc.sovereignty_status in ('sovereign_state','territory','disputed')
      and not exists (
        select 1 from public.country_profiles cp where cp.iso3 = crc.iso3
      )
      and exists (
        select 1 from public.normalized_metrics nm where nm.iso3 = crc.iso3
      )
  ), ranked_metrics as (
    select
      nm.iso3,
      nm.domain,
      nm.metric_name,
      nm.value,
      nm.period,
      nm.provider_name,
      nm.unit,
      nm.confidence,
      row_number() over (
        partition by nm.iso3, nm.domain, nm.metric_name
        order by nm.period desc nulls last, nm.provenance_observed_at desc nulls last, nm.created_at desc nulls last
      ) as rn
    from public.normalized_metrics nm
    join eligible e on e.iso3 = nm.iso3
    where nm.value is not null
      and nm.domain is not null
      and nm.metric_name is not null
      and nm.period is not null
  ), limited_metrics as (
    select * from ranked_metrics where rn <= 24
  ), domain_groups as (
    select
      iso3,
      domain,
      jsonb_agg(
        jsonb_build_object(
          'metric', metric_name,
          'period', period,
          'value', value,
          'unit', unit,
          'source', provider_name,
          'confidence', confidence
        ) order by period
      ) as metrics,
      count(*) as metric_count
    from limited_metrics
    group by iso3, domain
  ), profile_rows as (
    select
      e.iso3,
      e.country_name,
      jsonb_object_agg(
        dg.domain,
        jsonb_build_object(
          'metrics', dg.metrics,
          'completeness', least(1.0, dg.metric_count::numeric / 50.0),
          'source', 'normalized_metrics_self_heal'
        )
      ) as kpis,
      least(1.0, sum(dg.metric_count)::numeric / 250.0) as confidence
    from eligible e
    join domain_groups dg on dg.iso3 = e.iso3
    group by e.iso3, e.country_name
  ), inserted as (
    insert into public.country_profiles (iso3, country_name, compiled_at, kpis, confidence, summary, sources)
    select
      iso3,
      country_name,
      now(),
      kpis,
      confidence,
      jsonb_build_object('generated_by', 'ensure_country_profiles_from_normalized', 'generated_at', now()),
      jsonb_build_array('normalized_metrics')
    from profile_rows
    on conflict (iso3) do nothing
    returning 1
  )
  select count(*) into inserted_count from inserted;

  return inserted_count;
end;
$$;