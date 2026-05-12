-- AICIS Orphan Event Geo-Enrichment Layer
-- Fixes the remaining parsing gap where news/social/crisis events have no ISO3.
-- Adds queueing, deterministic hint extraction, AI-assisted review fields, and dashboard views.

create table if not exists public.event_geo_enrichment_queue (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.normalized_events(id) on delete cascade,
  title text,
  description text,
  source text,
  current_iso3 text,
  inferred_iso3 text,
  inferred_country text,
  method text not null default 'queued' check (method in ('queued','deterministic_hint','ai_geo_enrichment','manual_review','failed')),
  confidence numeric(5,2) not null default 0 check (confidence between 0 and 100),
  status text not null default 'queued' check (status in ('queued','resolved','review','failed','dismissed')),
  evidence jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id)
);

create index if not exists idx_event_geo_enrichment_queue_status_created on public.event_geo_enrichment_queue(status, created_at desc);
create index if not exists idx_event_geo_enrichment_queue_inferred_iso3 on public.event_geo_enrichment_queue(inferred_iso3) where inferred_iso3 is not null;

create table if not exists public.country_text_hints (
  hint text primary key,
  iso3 text not null,
  country_name text not null,
  confidence numeric(5,2) not null default 80,
  created_at timestamptz not null default now()
);

insert into public.country_text_hints(hint, iso3, country_name, confidence) values
  ('united states','USA','United States',90),('u.s.','USA','United States',88),('usa','USA','United States',88),('america','USA','United States',65),
  ('united kingdom','GBR','United Kingdom',90),('uk','GBR','United Kingdom',80),('britain','GBR','United Kingdom',75),
  ('germany','DEU','Germany',90),('berlin','DEU','Germany',80),
  ('france','FRA','France',90),('paris','FRA','France',80),
  ('ghana','GHA','Ghana',90),('accra','GHA','Ghana',80),('kumasi','GHA','Ghana',75),
  ('nigeria','NGA','Nigeria',90),('lagos','NGA','Nigeria',80),('abuja','NGA','Nigeria',80),
  ('south africa','ZAF','South Africa',90),('johannesburg','ZAF','South Africa',75),('cape town','ZAF','South Africa',75),
  ('kenya','KEN','Kenya',90),('nairobi','KEN','Kenya',80),
  ('ethiopia','ETH','Ethiopia',90),('addis ababa','ETH','Ethiopia',80),
  ('sudan','SDN','Sudan',90),('khartoum','SDN','Sudan',80),
  ('south sudan','SSD','South Sudan',90),('juba','SSD','South Sudan',80),
  ('somalia','SOM','Somalia',90),('mogadishu','SOM','Somalia',80),
  ('egypt','EGY','Egypt',90),('cairo','EGY','Egypt',80),
  ('israel','ISR','Israel',90),('jerusalem','ISR','Israel',70),('tel aviv','ISR','Israel',80),
  ('palestine','PSE','Palestine',90),('gaza','PSE','Palestine',85),('west bank','PSE','Palestine',85),
  ('lebanon','LBN','Lebanon',90),('beirut','LBN','Lebanon',80),
  ('syria','SYR','Syria',90),('damascus','SYR','Syria',80),
  ('iraq','IRQ','Iraq',90),('baghdad','IRQ','Iraq',80),
  ('iran','IRN','Iran',90),('tehran','IRN','Iran',80),
  ('yemen','YEM','Yemen',90),('sanaa','YEM','Yemen',75),
  ('ukraine','UKR','Ukraine',90),('kyiv','UKR','Ukraine',80),('donetsk','UKR','Ukraine',75),
  ('russia','RUS','Russia',90),('moscow','RUS','Russia',80),
  ('china','CHN','China',90),('beijing','CHN','China',80),('taiwan','TWN','Taiwan',90),('taipei','TWN','Taiwan',80),
  ('india','IND','India',90),('new delhi','IND','India',80),('mumbai','IND','India',75),
  ('pakistan','PAK','Pakistan',90),('islamabad','PAK','Pakistan',80),('karachi','PAK','Pakistan',75),
  ('afghanistan','AFG','Afghanistan',90),('kabul','AFG','Afghanistan',80),
  ('myanmar','MMR','Myanmar',90),('burma','MMR','Myanmar',85),('yangon','MMR','Myanmar',75),
  ('thailand','THA','Thailand',90),('bangkok','THA','Thailand',80),
  ('vietnam','VNM','Vietnam',90),('hanoi','VNM','Vietnam',80),
  ('japan','JPN','Japan',90),('tokyo','JPN','Japan',80),
  ('south korea','KOR','South Korea',90),('seoul','KOR','South Korea',80),
  ('north korea','PRK','North Korea',90),('pyongyang','PRK','North Korea',80),
  ('mexico','MEX','Mexico',90),('mexico city','MEX','Mexico',80),
  ('brazil','BRA','Brazil',90),('brasilia','BRA','Brazil',80),('rio de janeiro','BRA','Brazil',75),
  ('argentina','ARG','Argentina',90),('buenos aires','ARG','Argentina',80),
  ('colombia','COL','Colombia',90),('bogota','COL','Colombia',80),
  ('venezuela','VEN','Venezuela',90),('caracas','VEN','Venezuela',80),
  ('chile','CHL','Chile',90),('santiago','CHL','Chile',75),
  ('peru','PER','Peru',90),('lima','PER','Peru',75),
  ('canada','CAN','Canada',90),('ottawa','CAN','Canada',75),
  ('australia','AUS','Australia',90),('sydney','AUS','Australia',75),('canberra','AUS','Australia',75)
on conflict (hint) do update set iso3 = excluded.iso3, country_name = excluded.country_name, confidence = excluded.confidence;

create or replace function public.enqueue_orphan_event_geo_enrichment(batch_size integer default 5000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  with candidates as (
    select id, title, description, source, iso3
    from public.normalized_events
    where iso3 is null
      and created_at > now() - interval '30 days'
      and not exists (
        select 1 from public.event_geo_enrichment_queue q where q.event_id = normalized_events.id
      )
    order by created_at desc
    limit batch_size
  ), inserted as (
    insert into public.event_geo_enrichment_queue(event_id, title, description, source, current_iso3, status, method)
    select id, title, description, source, iso3, 'queued', 'queued'
    from candidates
    on conflict do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  insert into public.pipeline_health_events(job_name, status, source, inserted_count, message, metadata)
  values ('enqueue_orphan_event_geo_enrichment', case when v_inserted > 0 then 'success' else 'degraded' end, 'database', v_inserted, 'Queued orphan events for geo enrichment', jsonb_build_object('queued', v_inserted));

  return v_inserted;
end;
$$;

create or replace function public.resolve_orphan_events_by_text_hints(batch_size integer default 10000)
returns table(resolved_rows integer, review_rows integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resolved integer := 0;
  v_review integer := 0;
begin
  with queued as (
    select q.id, q.event_id, lower(coalesce(q.title,'') || ' ' || coalesce(q.description,'')) as text
    from public.event_geo_enrichment_queue q
    where q.status = 'queued'
    limit batch_size
  ), matches as (
    select distinct on (q.id)
      q.id as queue_id,
      q.event_id,
      h.iso3,
      h.country_name,
      h.confidence,
      h.hint
    from queued q
    join public.country_text_hints h on q.text like '%' || lower(h.hint) || '%'
    order by q.id, h.confidence desc, length(h.hint) desc
  ), update_queue as (
    update public.event_geo_enrichment_queue q
    set inferred_iso3 = m.iso3,
        inferred_country = m.country_name,
        confidence = m.confidence,
        method = 'deterministic_hint',
        status = case when m.confidence >= 80 then 'resolved' else 'review' end,
        evidence = jsonb_build_object('hint', m.hint, 'method', 'country_text_hints'),
        updated_at = now()
    from matches m
    where q.id = m.queue_id
    returning q.event_id, q.inferred_iso3, q.status
  ), update_events as (
    update public.normalized_events ne
    set iso3 = uq.inferred_iso3
    from update_queue uq
    where ne.id = uq.event_id
      and uq.status = 'resolved'
      and ne.iso3 is null
    returning ne.id
  ), link_events as (
    insert into public.entity_event_links(entity_id, event_id, created_at)
    select ce.id, uq.event_id, now()
    from update_queue uq
    join public.canonical_entities ce on ce.iso3 = uq.inferred_iso3 and ce.entity_type = 'country'
    where uq.status = 'resolved'
    on conflict do nothing
    returning 1
  )
  select
    (select count(*) from update_events),
    (select count(*) from update_queue where status = 'review')
  into v_resolved, v_review;

  insert into public.pipeline_health_events(job_name, status, source, inserted_count, skipped_count, message, metadata)
  values ('resolve_orphan_events_by_text_hints', case when v_resolved > 0 then 'success' else 'degraded' end, 'database', v_resolved, v_review, 'Deterministic orphan event geo enrichment completed', jsonb_build_object('resolved', v_resolved, 'review', v_review));

  return query select v_resolved, v_review;
end;
$$;

create or replace view public.v_orphan_event_geo_enrichment_status as
select
  status,
  method,
  count(*)::bigint as rows,
  count(*) filter (where created_at > now() - interval '1 hour')::bigint as queued_1h,
  count(*) filter (where created_at > now() - interval '24 hours')::bigint as queued_24h,
  max(updated_at) as latest_update
from public.event_geo_enrichment_queue
group by status, method
order by rows desc;

create or replace view public.v_recent_orphan_events_for_ai_geo as
select
  q.id as queue_id,
  q.event_id,
  q.title,
  q.description,
  q.source,
  q.confidence,
  q.status,
  q.created_at
from public.event_geo_enrichment_queue q
where q.status in ('queued','review')
order by q.created_at desc
limit 1000;

select cron.schedule('enqueue_orphan_event_geo_enrichment', '*/5 * * * *', $$select public.enqueue_orphan_event_geo_enrichment(5000);$$)
where not exists (select 1 from cron.job where jobname = 'enqueue_orphan_event_geo_enrichment');

select cron.schedule('resolve_orphan_events_by_text_hints', '*/5 * * * *', $$select * from public.resolve_orphan_events_by_text_hints(10000);$$)
where not exists (select 1 from cron.job where jobname = 'resolve_orphan_events_by_text_hints');
