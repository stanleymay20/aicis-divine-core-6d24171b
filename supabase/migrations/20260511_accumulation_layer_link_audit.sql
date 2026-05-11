-- AICIS Accumulation, Layer, and Link Audit Hardening
-- Adds raw intake archive, layer-level health views, link-integrity views,
-- evidence coverage views, and repair functions for accumulation pipeline QA.

create table if not exists public.raw_intake_archive (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  source_url text,
  source_record_id text,
  payload_hash text not null,
  payload jsonb not null,
  observed_at timestamptz,
  ingested_at timestamptz not null default now(),
  normalized_metric_id uuid,
  normalized_event_id uuid,
  canonical_entity_id uuid,
  status text not null default 'raw' check (status in ('raw','normalized','linked','replayed','discarded','failed')),
  error text,
  metadata jsonb not null default '{}'::jsonb,
  unique(provider, payload_hash)
);

create index if not exists idx_raw_intake_archive_provider_ingested on public.raw_intake_archive(provider, ingested_at desc);
create index if not exists idx_raw_intake_archive_status_ingested on public.raw_intake_archive(status, ingested_at desc);
create index if not exists idx_raw_intake_archive_metric on public.raw_intake_archive(normalized_metric_id) where normalized_metric_id is not null;
create index if not exists idx_raw_intake_archive_event on public.raw_intake_archive(normalized_event_id) where normalized_event_id is not null;

create table if not exists public.accumulation_layer_snapshots (
  id uuid primary key default gen_random_uuid(),
  layer text not null,
  total_rows bigint not null default 0,
  last_1h bigint not null default 0,
  last_24h bigint not null default 0,
  unresolved_rows bigint not null default 0,
  unresolved_with_geo bigint not null default 0,
  coverage_pct numeric(8,2),
  status text not null default 'unknown' check (status in ('healthy','degraded','critical','unknown')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_accumulation_layer_snapshots_layer_created on public.accumulation_layer_snapshots(layer, created_at desc);
create index if not exists idx_accumulation_layer_snapshots_status_created on public.accumulation_layer_snapshots(status, created_at desc);

create or replace view public.v_accumulation_layer_audit as
with base as (
  select * from public.v_data_quality_command_center
), scored as (
  select
    layer,
    total_rows,
    last_1h,
    last_24h,
    unresolved_rows,
    unresolved_with_geo,
    coverage_pct,
    case
      when total_rows = 0 then 'critical'
      when layer in ('normalized_metrics','normalized_events') and coverage_pct < 80 then 'critical'
      when layer in ('normalized_metrics','normalized_events') and coverage_pct < 95 then 'degraded'
      when last_24h = 0 and layer in ('normalized_metrics','normalized_events','economic_indicators','satellite_observations') then 'degraded'
      else 'healthy'
    end as status,
    now() as audited_at
  from base
)
select * from scored;

create or replace view public.v_entity_link_integrity as
select
  'metric_links_without_metric'::text as check_name,
  count(*)::bigint as issue_count
from public.entity_metric_links eml
left join public.normalized_metrics nm on nm.id = eml.metric_id
where nm.id is null
union all
select
  'metric_links_without_entity',
  count(*)
from public.entity_metric_links eml
left join public.canonical_entities ce on ce.id = eml.entity_id
where ce.id is null
union all
select
  'event_links_without_event',
  count(*)
from public.entity_event_links eel
left join public.normalized_events ne on ne.id = eel.event_id
where ne.id is null
union all
select
  'event_links_without_entity',
  count(*)
from public.entity_event_links eel
left join public.canonical_entities ce on ce.id = eel.entity_id
where ce.id is null
union all
select
  'metrics_entity_id_without_link',
  count(*)
from public.normalized_metrics nm
where nm.entity_id is not null
  and not exists (
    select 1 from public.entity_metric_links eml
    where eml.metric_id = nm.id and eml.entity_id = nm.entity_id
  )
union all
select
  'events_with_iso3_without_link',
  count(*)
from public.normalized_events ne
where ne.iso3 is not null
  and not exists (
    select 1 from public.entity_event_links eel
    where eel.event_id = ne.id
  );

create or replace view public.v_provider_accumulation_health as
select
  provider,
  count(*)::bigint as raw_rows,
  count(*) filter (where ingested_at > now() - interval '1 hour')::bigint as last_1h,
  count(*) filter (where ingested_at > now() - interval '24 hours')::bigint as last_24h,
  count(*) filter (where status = 'failed')::bigint as failed_rows,
  count(*) filter (where status in ('normalized','linked','replayed'))::bigint as processed_rows,
  round((100.0 * count(*) filter (where status in ('normalized','linked','replayed')) / greatest(count(*), 1))::numeric, 2) as processed_pct,
  max(ingested_at) as latest_ingested_at
from public.raw_intake_archive
group by provider
order by latest_ingested_at desc nulls last;

create or replace view public.v_evidence_coverage_audit as
select
  'global_signals'::text as layer,
  count(*)::bigint as total_rows,
  count(*) filter (where evidence_hash is not null)::bigint as with_evidence_hash,
  count(*) filter (where source_references is not null and jsonb_array_length(coalesce(source_references, '[]'::jsonb)) > 0)::bigint as with_sources,
  round((100.0 * count(*) filter (where evidence_hash is not null) / greatest(count(*), 1))::numeric, 2) as evidence_hash_pct,
  round((100.0 * count(*) filter (where source_references is not null and jsonb_array_length(coalesce(source_references, '[]'::jsonb)) > 0) / greatest(count(*), 1))::numeric, 2) as source_reference_pct
from public.global_signals;

create or replace function public.snapshot_accumulation_layers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  insert into public.accumulation_layer_snapshots(
    layer,
    total_rows,
    last_1h,
    last_24h,
    unresolved_rows,
    unresolved_with_geo,
    coverage_pct,
    status,
    metadata
  )
  select
    layer,
    total_rows,
    last_1h,
    last_24h,
    unresolved_rows,
    unresolved_with_geo,
    coverage_pct,
    status,
    jsonb_build_object('audited_at', audited_at)
  from public.v_accumulation_layer_audit;

  get diagnostics v_inserted = row_count;

  insert into public.pipeline_health_events(job_name, status, source, inserted_count, message, metadata)
  values (
    'snapshot_accumulation_layers',
    'success',
    'database',
    v_inserted,
    'Accumulation layer snapshot captured',
    jsonb_build_object('snapshot_rows', v_inserted)
  );

  return v_inserted;
end;
$$;

create or replace function public.repair_entity_metric_link_consistency(batch_size integer default 100000)
returns table(inserted_links integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  with candidates as (
    select nm.entity_id, nm.id as metric_id
    from public.normalized_metrics nm
    where nm.entity_id is not null
      and not exists (
        select 1 from public.entity_metric_links eml
        where eml.metric_id = nm.id and eml.entity_id = nm.entity_id
      )
    limit batch_size
  ), inserted as (
    insert into public.entity_metric_links(entity_id, metric_id, created_at)
    select entity_id, metric_id, now()
    from candidates
    on conflict do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  insert into public.pipeline_health_events(job_name, status, source, inserted_count, message, metadata)
  values (
    'repair_entity_metric_link_consistency',
    case when v_inserted > 0 then 'success' else 'degraded' end,
    'database',
    v_inserted,
    'Metric link consistency repair completed',
    jsonb_build_object('inserted_links', v_inserted)
  );

  return query select v_inserted;
end;
$$;

create or replace function public.repair_normalized_event_iso3_from_links(batch_size integer default 100000)
returns table(updated_events integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  with candidates as (
    select ne.id, ce.iso3
    from public.normalized_events ne
    join public.entity_event_links eel on eel.event_id = ne.id
    join public.canonical_entities ce on ce.id = eel.entity_id
    where ne.iso3 is null
      and ce.iso3 is not null
    limit batch_size
  ), updated as (
    update public.normalized_events ne
    set iso3 = c.iso3
    from candidates c
    where ne.id = c.id
    returning ne.id
  )
  select count(*) into v_updated from updated;

  insert into public.pipeline_health_events(job_name, status, source, inserted_count, message, metadata)
  values (
    'repair_normalized_event_iso3_from_links',
    case when v_updated > 0 then 'success' else 'degraded' end,
    'database',
    v_updated,
    'Event ISO3 repair from entity links completed',
    jsonb_build_object('updated_events', v_updated)
  );

  return query select v_updated;
end;
$$;

select cron.schedule('snapshot_accumulation_layers', '*/15 * * * *', $$select public.snapshot_accumulation_layers();$$)
where not exists (select 1 from cron.job where jobname = 'snapshot_accumulation_layers');

select cron.schedule('repair_entity_metric_link_consistency', '*/10 * * * *', $$select * from public.repair_entity_metric_link_consistency(100000);$$)
where not exists (select 1 from cron.job where jobname = 'repair_entity_metric_link_consistency');

select cron.schedule('repair_normalized_event_iso3_from_links', '*/10 * * * *', $$select * from public.repair_normalized_event_iso3_from_links(100000);$$)
where not exists (select 1 from cron.job where jobname = 'repair_normalized_event_iso3_from_links');
