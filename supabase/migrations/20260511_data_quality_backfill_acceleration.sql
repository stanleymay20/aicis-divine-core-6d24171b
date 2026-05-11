-- AICIS Data Quality Backfill Acceleration
-- Normalizes non-canonical ISO3-like values, accelerates metric→entity linking,
-- improves event geo-link coverage, and exposes data-quality dashboard views.

create table if not exists public.iso3_aliases (
  alias text primary key,
  iso3 text not null,
  reason text,
  created_at timestamptz not null default now()
);

insert into public.iso3_aliases(alias, iso3, reason) values
  ('UK', 'GBR', 'common_alpha2_alias'),
  ('U.K.', 'GBR', 'common_name_alias'),
  ('UNITED KINGDOM', 'GBR', 'country_name_alias'),
  ('US', 'USA', 'common_alpha2_alias'),
  ('U.S.', 'USA', 'common_name_alias'),
  ('UNITED STATES', 'USA', 'country_name_alias'),
  ('USA', 'USA', 'canonical'),
  ('RUSSIA', 'RUS', 'country_name_alias'),
  ('SOUTH KOREA', 'KOR', 'country_name_alias'),
  ('NORTH KOREA', 'PRK', 'country_name_alias'),
  ('IRAN', 'IRN', 'country_name_alias'),
  ('SYRIA', 'SYR', 'country_name_alias'),
  ('VENEZUELA', 'VEN', 'country_name_alias'),
  ('BOLIVIA', 'BOL', 'country_name_alias'),
  ('TANZANIA', 'TZA', 'country_name_alias'),
  ('VIETNAM', 'VNM', 'country_name_alias'),
  ('LAOS', 'LAO', 'country_name_alias'),
  ('MOLDOVA', 'MDA', 'country_name_alias'),
  ('PALESTINE', 'PSE', 'country_name_alias'),
  ('DEMOCRATIC REPUBLIC OF CONGO', 'COD', 'country_name_alias'),
  ('DR CONGO', 'COD', 'country_name_alias'),
  ('CONGO-KINSHASA', 'COD', 'country_name_alias'),
  ('REPUBLIC OF CONGO', 'COG', 'country_name_alias'),
  ('CONGO-BRAZZAVILLE', 'COG', 'country_name_alias'),
  ('COTE DIVOIRE', 'CIV', 'country_name_alias'),
  ('CÔTE DIVOIRE', 'CIV', 'country_name_alias'),
  ('IVORY COAST', 'CIV', 'country_name_alias'),
  ('CABO VERDE', 'CPV', 'country_name_alias'),
  ('CAPE VERDE', 'CPV', 'country_name_alias'),
  ('ESWATINI', 'SWZ', 'country_name_alias'),
  ('SWAZILAND', 'SWZ', 'country_name_alias'),
  ('MYANMAR', 'MMR', 'country_name_alias'),
  ('BURMA', 'MMR', 'country_name_alias'),
  ('KYRGYZSTAN', 'KGZ', 'country_name_alias'),
  ('KYRGYZ REPUBLIC', 'KGZ', 'country_name_alias'),
  ('CZECHIA', 'CZE', 'country_name_alias'),
  ('CZECH REPUBLIC', 'CZE', 'country_name_alias'),
  ('BRUNEI', 'BRN', 'country_name_alias'),
  ('MICRONESIA', 'FSM', 'country_name_alias'),
  ('TIMOR-LESTE', 'TLS', 'country_name_alias'),
  ('EAST TIMOR', 'TLS', 'country_name_alias')
on conflict (alias) do update set iso3 = excluded.iso3, reason = excluded.reason;

create or replace function public.normalize_iso3_value(raw text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with cleaned as (
    select nullif(upper(trim(regexp_replace(coalesce(raw, ''), '[^A-Za-z0-9 ._\-]', '', 'g'))), '') as v
  ),
  direct_entity as (
    select ce.iso3
    from cleaned c
    join public.canonical_entities ce on ce.iso3 = c.v
    where c.v ~ '^[A-Z]{3}$'
    limit 1
  ),
  alias_hit as (
    select a.iso3
    from cleaned c
    join public.iso3_aliases a on upper(a.alias) = c.v
    limit 1
  ),
  extracted as (
    select substring(v from '([A-Z]{3})') as possible_iso3 from cleaned
  ),
  extracted_entity as (
    select ce.iso3
    from extracted e
    join public.canonical_entities ce on ce.iso3 = e.possible_iso3
    limit 1
  )
  select coalesce(
    (select iso3 from direct_entity),
    (select iso3 from alias_hit),
    (select iso3 from extracted_entity)
  );
$$;

create or replace function public.backfill_metric_entity_iso3_fast(batch_size integer default 50000)
returns table(updated_rows integer, linked_rows integer, normalized_rows integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_normalized integer := 0;
  v_updated integer := 0;
  v_linked integer := 0;
begin
  with candidates as (
    select id, iso3, public.normalize_iso3_value(iso3) as normalized_iso3
    from public.normalized_metrics
    where entity_id is null
      and iso3 is not null
    limit batch_size
  ),
  normalized as (
    update public.normalized_metrics nm
    set iso3 = c.normalized_iso3
    from candidates c
    where nm.id = c.id
      and c.normalized_iso3 is not null
      and nm.iso3 is distinct from c.normalized_iso3
    returning nm.id
  )
  select count(*) into v_normalized from normalized;

  with candidates as (
    select nm.id, ce.id as entity_id
    from public.normalized_metrics nm
    join public.canonical_entities ce on ce.iso3 = nm.iso3
    where nm.entity_id is null
      and nm.iso3 is not null
    limit batch_size
  ),
  updated as (
    update public.normalized_metrics nm
    set entity_id = c.entity_id
    from candidates c
    where nm.id = c.id
    returning nm.id, nm.entity_id
  ),
  linked as (
    insert into public.entity_metric_links(entity_id, metric_id, created_at)
    select u.entity_id, u.id, now()
    from updated u
    on conflict do nothing
    returning 1
  )
  select (select count(*) from updated), (select count(*) from linked)
  into v_updated, v_linked;

  insert into public.pipeline_health_events(job_name, status, source, inserted_count, skipped_count, error_count, message, metadata)
  values (
    'backfill_metric_entity_iso3_fast',
    case when v_updated > 0 or v_normalized > 0 then 'success' else 'degraded' end,
    'database',
    v_linked,
    greatest(batch_size - v_updated, 0),
    0,
    'Metric ISO3 normalization and entity backfill pass completed',
    jsonb_build_object('updated_rows', v_updated, 'linked_rows', v_linked, 'normalized_rows', v_normalized)
  );

  return query select v_updated, v_linked, v_normalized;
end;
$$;

create or replace function public.backfill_event_entity_geo_links(batch_size integer default 50000)
returns table(linked_rows integer, unresolved_rows integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linked integer := 0;
  v_unresolved integer := 0;
begin
  with event_candidates as (
    select ne.id, coalesce(ne.iso3, public.normalize_iso3_value(ne.country), public.normalize_iso3_value(ne.location)) as inferred_iso3
    from public.normalized_events ne
    where not exists (
      select 1 from public.entity_event_links eel where eel.event_id = ne.id
    )
    limit batch_size
  ),
  linkable as (
    select ec.id as event_id, ce.id as entity_id
    from event_candidates ec
    join public.canonical_entities ce on ce.iso3 = ec.inferred_iso3
  ),
  inserted as (
    insert into public.entity_event_links(entity_id, event_id, created_at)
    select entity_id, event_id, now()
    from linkable
    on conflict do nothing
    returning 1
  )
  select count(*) into v_linked from inserted;

  select count(*) into v_unresolved
  from public.normalized_events ne
  where not exists (
    select 1 from public.entity_event_links eel where eel.event_id = ne.id
  )
  and ne.created_at > now() - interval '7 days';

  insert into public.pipeline_health_events(job_name, status, source, inserted_count, skipped_count, error_count, message, metadata)
  values (
    'backfill_event_entity_geo_links',
    case when v_unresolved < 10000 then 'success' else 'partial' end,
    'database',
    v_linked,
    v_unresolved,
    0,
    'Event geo-link coverage pass completed',
    jsonb_build_object('linked_rows', v_linked, 'unresolved_rows_7d', v_unresolved)
  );

  return query select v_linked, v_unresolved;
end;
$$;

create or replace view public.v_data_quality_command_center as
select * from (
  select
    'normalized_metrics'::text as layer,
    count(*)::bigint as total_rows,
    count(*) filter (where created_at > now() - interval '1 hour')::bigint as last_1h,
    count(*) filter (where created_at > now() - interval '24 hours')::bigint as last_24h,
    count(*) filter (where entity_id is null)::bigint as unresolved_rows,
    count(*) filter (where entity_id is null and iso3 is not null)::bigint as unresolved_with_geo,
    round((100.0 * count(*) filter (where entity_id is not null) / greatest(count(*), 1))::numeric, 2) as coverage_pct
  from public.normalized_metrics
  union all
  select
    'normalized_events', count(*),
    count(*) filter (where created_at > now() - interval '1 hour'),
    count(*) filter (where created_at > now() - interval '24 hours'),
    count(*) filter (where iso3 is null),
    count(*) filter (where iso3 is null and (country is not null or location is not null)),
    round((100.0 * count(*) filter (where iso3 is not null) / greatest(count(*), 1))::numeric, 2)
  from public.normalized_events
  union all
  select
    'entity_metric_links', count(*),
    count(*) filter (where created_at > now() - interval '1 hour'),
    count(*) filter (where created_at > now() - interval '24 hours'),
    0, 0, 100.00
  from public.entity_metric_links
  union all
  select
    'entity_event_links', count(*),
    count(*) filter (where created_at > now() - interval '1 hour'),
    count(*) filter (where created_at > now() - interval '24 hours'),
    0, 0, 100.00
  from public.entity_event_links
  union all
  select
    'satellite_observations', count(*),
    count(*) filter (where created_at > now() - interval '1 hour'),
    count(*) filter (where created_at > now() - interval '24 hours'),
    0, 0, 100.00
  from public.satellite_observations
  union all
  select
    'economic_indicators', count(*),
    count(*) filter (where created_at > now() - interval '1 hour'),
    count(*) filter (where created_at > now() - interval '24 hours'),
    0, 0, 100.00
  from public.economic_indicators
) q;

create or replace view public.v_geo_link_coverage_gaps as
select
  coalesce(iso3, public.normalize_iso3_value(country), public.normalize_iso3_value(location), 'UNKNOWN') as inferred_iso3,
  count(*)::bigint as event_count,
  count(*) filter (where iso3 is null)::bigint as null_iso3_count,
  max(created_at) as latest_event_at
from public.normalized_events ne
where not exists (
  select 1 from public.entity_event_links eel where eel.event_id = ne.id
)
group by 1
order by event_count desc;

select cron.unschedule('backfill_metric_entity_iso3') where exists (select 1 from cron.job where jobname = 'backfill_metric_entity_iso3');
select cron.schedule('backfill_metric_entity_iso3_fast', '*/2 * * * *', $$select * from public.backfill_metric_entity_iso3_fast(50000);$$)
where not exists (select 1 from cron.job where jobname = 'backfill_metric_entity_iso3_fast');

select cron.schedule('backfill_event_entity_geo_links', '*/5 * * * *', $$select * from public.backfill_event_entity_geo_links(50000);$$)
where not exists (select 1 from cron.job where jobname = 'backfill_event_entity_geo_links');
