-- AICIS Event Bus, Graph Intelligence, Forecasting, and Operator Views
-- Adds event-driven orchestration scaffolding, graph relationship scoring,
-- forecast/simulation foundations, and UI-ready operator console views.

create table if not exists public.aicis_event_bus (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  event_key text,
  producer text not null default 'system',
  source_table text,
  source_id text,
  payload jsonb not null default '{}'::jsonb,
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  status text not null default 'queued' check (status in ('queued','processing','completed','failed','dead_letter')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  processed_at timestamptz,
  error text,
  trace_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_type, event_key)
);

create index if not exists idx_aicis_event_bus_status_available on public.aicis_event_bus(status, available_at, priority);
create index if not exists idx_aicis_event_bus_trace on public.aicis_event_bus(trace_id) where trace_id is not null;
create index if not exists idx_aicis_event_bus_source on public.aicis_event_bus(source_table, source_id);

create table if not exists public.graph_relationship_scores (
  id uuid primary key default gen_random_uuid(),
  source_entity_id uuid references public.canonical_entities(id) on delete cascade,
  target_entity_id uuid references public.canonical_entities(id) on delete cascade,
  relationship_type text not null,
  domain text,
  strength_score numeric(6,2) not null default 0 check (strength_score between 0 and 100),
  confidence_score numeric(6,2) not null default 0 check (confidence_score between 0 and 100),
  evidence_count integer not null default 0,
  latest_evidence_at timestamptz,
  decay_score numeric(6,2) not null default 100 check (decay_score between 0 and 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_entity_id, target_entity_id, relationship_type, domain)
);

create index if not exists idx_graph_rel_scores_source on public.graph_relationship_scores(source_entity_id, strength_score desc);
create index if not exists idx_graph_rel_scores_target on public.graph_relationship_scores(target_entity_id, strength_score desc);
create index if not exists idx_graph_rel_scores_domain on public.graph_relationship_scores(domain, strength_score desc);

create table if not exists public.forecast_scenarios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  scenario_type text not null default 'risk' check (scenario_type in ('risk','conflict','supply_chain','macro','climate','cyber','custom')),
  target_entity_id uuid references public.canonical_entities(id),
  target_iso3 text,
  horizon_days integer not null default 30,
  baseline_state jsonb not null default '{}'::jsonb,
  assumptions jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','queued','running','completed','failed','archived')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.forecast_results (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid references public.forecast_scenarios(id) on delete cascade,
  model_name text not null default 'aicis-forecast-baseline-v1',
  forecast_target text not null,
  probability numeric(6,4) check (probability between 0 and 1),
  severity_score numeric(6,2) check (severity_score between 0 and 100),
  confidence_score numeric(6,2) check (confidence_score between 0 and 100),
  explanation text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_forecast_results_scenario on public.forecast_results(scenario_id, created_at desc);
create index if not exists idx_forecast_results_target on public.forecast_results(forecast_target, probability desc);

create or replace function public.enqueue_event(
  p_event_type text,
  p_event_key text default null,
  p_producer text default 'system',
  p_source_table text default null,
  p_source_id text default null,
  p_payload jsonb default '{}'::jsonb,
  p_priority text default 'normal',
  p_available_at timestamptz default now(),
  p_trace_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.aicis_event_bus(event_type, event_key, producer, source_table, source_id, payload, priority, available_at, trace_id)
  values (p_event_type, p_event_key, p_producer, p_source_table, p_source_id, p_payload, p_priority, p_available_at, p_trace_id)
  on conflict (event_type, event_key) do update set
    payload = excluded.payload,
    priority = excluded.priority,
    available_at = least(public.aicis_event_bus.available_at, excluded.available_at),
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.claim_event_bus_batch(p_worker text, p_limit integer default 100)
returns setof public.aicis_event_bus
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select id
    from public.aicis_event_bus
    where status = 'queued'
      and available_at <= now()
      and attempts < max_attempts
    order by
      case priority when 'critical' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,
      created_at
    limit p_limit
    for update skip locked
  )
  update public.aicis_event_bus e
  set status = 'processing',
      locked_at = now(),
      locked_by = p_worker,
      attempts = attempts + 1,
      updated_at = now()
  from picked p
  where e.id = p.id
  returning e.*;
end;
$$;

create or replace function public.complete_event_bus_item(p_event_id uuid, p_success boolean, p_error text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.aicis_event_bus
  set status = case
        when p_success then 'completed'
        when attempts >= max_attempts then 'dead_letter'
        else 'queued'
      end,
      processed_at = case when p_success then now() else processed_at end,
      available_at = case when p_success then available_at else now() + make_interval(mins => least(60, attempts * 5)) end,
      error = p_error,
      locked_at = null,
      locked_by = null,
      updated_at = now()
  where id = p_event_id;

  return found;
end;
$$;

create or replace function public.compute_graph_relationship_scores(p_limit integer default 100000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_upserted integer := 0;
begin
  with pairs as (
    select
      e1.entity_id as source_entity_id,
      e2.entity_id as target_entity_id,
      coalesce(ne.category, 'event') as domain,
      count(*)::integer as evidence_count,
      max(ne.created_at) as latest_evidence_at
    from public.entity_event_links e1
    join public.entity_event_links e2 on e2.event_id = e1.event_id and e2.entity_id <> e1.entity_id
    join public.normalized_events ne on ne.id = e1.event_id
    where ne.created_at > now() - interval '90 days'
    group by e1.entity_id, e2.entity_id, coalesce(ne.category, 'event')
    order by count(*) desc
    limit p_limit
  ), scored as (
    select
      source_entity_id,
      target_entity_id,
      'co_occurrence'::text as relationship_type,
      domain,
      least(100, 10 + evidence_count * 5)::numeric(6,2) as strength_score,
      least(100, 40 + evidence_count * 6)::numeric(6,2) as confidence_score,
      evidence_count,
      latest_evidence_at,
      public.compute_freshness_score(latest_evidence_at, 720) as decay_score
    from pairs
  ), upserted as (
    insert into public.graph_relationship_scores(
      source_entity_id, target_entity_id, relationship_type, domain,
      strength_score, confidence_score, evidence_count, latest_evidence_at, decay_score
    )
    select source_entity_id, target_entity_id, relationship_type, domain,
      strength_score, confidence_score, evidence_count, latest_evidence_at, decay_score
    from scored
    on conflict (source_entity_id, target_entity_id, relationship_type, domain) do update set
      strength_score = excluded.strength_score,
      confidence_score = excluded.confidence_score,
      evidence_count = excluded.evidence_count,
      latest_evidence_at = excluded.latest_evidence_at,
      decay_score = excluded.decay_score,
      updated_at = now()
    returning 1
  )
  select count(*) into v_upserted from upserted;

  insert into public.pipeline_health_events(job_name, status, source, inserted_count, message, metadata)
  values ('compute_graph_relationship_scores', 'success', 'database', v_upserted, 'Graph relationship score computation completed', jsonb_build_object('relationships', v_upserted));

  return v_upserted;
end;
$$;

create or replace function public.run_baseline_forecast_scenario(p_scenario_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result_id uuid;
  v_iso3 text;
  v_signal_count integer;
  v_high_conf integer;
  v_open_contradictions integer;
  v_probability numeric;
  v_severity numeric;
  v_confidence numeric;
begin
  update public.forecast_scenarios set status = 'running', updated_at = now() where id = p_scenario_id;

  select target_iso3 into v_iso3 from public.forecast_scenarios where id = p_scenario_id;

  select count(*) into v_signal_count
  from public.global_signals gs
  where v_iso3 is null or v_iso3 = any(gs.affected_countries);

  select count(*) into v_high_conf
  from public.v_signal_provenance_explainability p
  where (v_iso3 is null or v_iso3 = any((select affected_countries from public.global_signals where id = p.signal_id)))
    and coalesce(p.final_confidence, 0) >= 70;

  select count(*) into v_open_contradictions
  from public.contradiction_clusters
  where status in ('open','reviewing')
    and (v_iso3 is null or iso3 = v_iso3);

  v_probability := least(0.95, greatest(0.05, (v_signal_count * 0.005) + (v_high_conf * 0.02) + (v_open_contradictions * 0.03)));
  v_severity := least(100, 20 + v_high_conf * 3 + v_open_contradictions * 5);
  v_confidence := case when v_signal_count >= 50 then 75 when v_signal_count >= 10 then 60 else 40 end;

  insert into public.forecast_results(
    scenario_id, forecast_target, probability, severity_score, confidence_score, explanation, evidence
  ) values (
    p_scenario_id,
    'risk_escalation_' || coalesce(v_iso3, 'global'),
    v_probability,
    v_severity,
    v_confidence,
    'Baseline forecast from recent signal volume, high-confidence signals, and open contradiction clusters. This is a heuristic forecast, not a calibrated ML model.',
    jsonb_build_object('iso3', v_iso3, 'signal_count', v_signal_count, 'high_confidence_signals', v_high_conf, 'open_contradictions', v_open_contradictions)
  ) returning id into v_result_id;

  update public.forecast_scenarios set status = 'completed', updated_at = now() where id = p_scenario_id;

  insert into public.pipeline_health_events(job_name, status, source, inserted_count, message, metadata)
  values ('run_baseline_forecast_scenario', 'success', 'database', 1, 'Baseline forecast scenario completed', jsonb_build_object('scenario_id', p_scenario_id, 'result_id', v_result_id));

  return v_result_id;
exception when others then
  update public.forecast_scenarios set status = 'failed', updated_at = now() where id = p_scenario_id;
  raise;
end;
$$;

create or replace view public.v_event_bus_operations as
select
  event_type,
  priority,
  status,
  count(*)::bigint as rows,
  min(created_at) as oldest_created_at,
  max(updated_at) as latest_updated_at,
  count(*) filter (where status = 'dead_letter')::bigint as dead_letters
from public.aicis_event_bus
group by event_type, priority, status
order by
  case priority when 'critical' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,
  event_type,
  status;

create or replace view public.v_graph_relationship_console as
select
  grs.id,
  src.name as source_entity,
  src.iso3 as source_iso3,
  tgt.name as target_entity,
  tgt.iso3 as target_iso3,
  grs.relationship_type,
  grs.domain,
  grs.strength_score,
  grs.confidence_score,
  grs.evidence_count,
  grs.latest_evidence_at,
  grs.decay_score,
  grs.updated_at
from public.graph_relationship_scores grs
join public.canonical_entities src on src.id = grs.source_entity_id
join public.canonical_entities tgt on tgt.id = grs.target_entity_id
order by grs.strength_score desc, grs.confidence_score desc;

create or replace view public.v_forecast_operations_console as
select
  fs.id as scenario_id,
  fs.name,
  fs.scenario_type,
  fs.target_iso3,
  fs.horizon_days,
  fs.status,
  fs.created_at,
  fr.forecast_target,
  fr.probability,
  fr.severity_score,
  fr.confidence_score,
  fr.explanation,
  fr.created_at as latest_result_at
from public.forecast_scenarios fs
left join lateral (
  select * from public.forecast_results fr
  where fr.scenario_id = fs.id
  order by fr.created_at desc
  limit 1
) fr on true
order by fs.created_at desc;

select cron.schedule('compute_graph_relationship_scores', '*/30 * * * *', $$select public.compute_graph_relationship_scores(100000);$$)
where not exists (select 1 from cron.job where jobname = 'compute_graph_relationship_scores');
