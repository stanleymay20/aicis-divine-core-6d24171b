-- AICIS Temporal Replay, Distributed Traceability, Automated Anomaly Response, and Analyst Workflows
-- Adds point-in-time graph snapshots, pipeline trace spans, anomaly response actions,
-- and analyst review workflow queues for contradiction/geo/replay/provider operations.

create table if not exists public.intelligence_graph_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_at timestamptz not null default now(),
  snapshot_type text not null default 'scheduled' check (snapshot_type in ('scheduled','manual','pre_replay','post_replay','incident')),
  entity_count bigint not null default 0,
  metric_link_count bigint not null default 0,
  event_link_count bigint not null default 0,
  signal_count bigint not null default 0,
  contradiction_count bigint not null default 0,
  confidence_eval_count bigint not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_graph_snapshots_at on public.intelligence_graph_snapshots(snapshot_at desc);
create index if not exists idx_graph_snapshots_type on public.intelligence_graph_snapshots(snapshot_type, snapshot_at desc);

create table if not exists public.pipeline_traces (
  id uuid primary key default gen_random_uuid(),
  trace_id uuid not null,
  parent_span_id uuid,
  span_id uuid not null default gen_random_uuid(),
  operation_name text not null,
  provider text,
  layer text,
  status text not null default 'started' check (status in ('started','success','failed','degraded','cancelled')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_ms integer,
  rows_in integer not null default 0,
  rows_out integer not null default 0,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  unique(trace_id, span_id)
);

create index if not exists idx_pipeline_traces_trace on public.pipeline_traces(trace_id, started_at);
create index if not exists idx_pipeline_traces_operation on public.pipeline_traces(operation_name, started_at desc);
create index if not exists idx_pipeline_traces_status on public.pipeline_traces(status, started_at desc);

create table if not exists public.anomaly_response_actions (
  id uuid primary key default gen_random_uuid(),
  anomaly_id uuid references public.observability_anomalies(id) on delete cascade,
  action_type text not null check (action_type in ('notify_admin','quarantine_provider','pause_provider','degraded_mode','retry_backoff','open_incident','dismiss','manual_review')),
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),
  provider_key text,
  severity text check (severity in ('low','medium','high','critical')),
  reason text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  executed_at timestamptz,
  executed_by uuid references auth.users(id)
);

create index if not exists idx_anomaly_response_actions_status on public.anomaly_response_actions(status, created_at desc);
create index if not exists idx_anomaly_response_actions_anomaly on public.anomaly_response_actions(anomaly_id, created_at desc);

create table if not exists public.analyst_review_tasks (
  id uuid primary key default gen_random_uuid(),
  task_type text not null check (task_type in ('contradiction_review','geo_enrichment_review','entity_governance_review','replay_review','provider_quality_review','anomaly_triage')),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','assigned','in_review','resolved','dismissed')),
  title text not null,
  description text,
  related_resource_type text,
  related_resource_id text,
  assigned_to uuid references auth.users(id),
  created_by uuid references auth.users(id),
  resolution text,
  evidence jsonb not null default '{}'::jsonb,
  due_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_analyst_review_tasks_status_priority on public.analyst_review_tasks(status, priority, created_at desc);
create index if not exists idx_analyst_review_tasks_type on public.analyst_review_tasks(task_type, created_at desc);
create index if not exists idx_analyst_review_tasks_assignee on public.analyst_review_tasks(assigned_to, status, created_at desc);

create or replace function public.create_graph_snapshot(p_snapshot_type text default 'scheduled')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_entity_count bigint;
  v_metric_links bigint;
  v_event_links bigint;
  v_signal_count bigint;
  v_contradictions bigint;
  v_confidence bigint;
begin
  select count(*) into v_entity_count from public.canonical_entities;
  select count(*) into v_metric_links from public.entity_metric_links;
  select count(*) into v_event_links from public.entity_event_links;
  select count(*) into v_signal_count from public.global_signals;
  select count(*) into v_contradictions from public.contradiction_clusters where status in ('open','reviewing');
  select count(*) into v_confidence from public.signal_confidence_evaluations;

  insert into public.intelligence_graph_snapshots(
    snapshot_type,
    entity_count,
    metric_link_count,
    event_link_count,
    signal_count,
    contradiction_count,
    confidence_eval_count,
    summary,
    created_by
  ) values (
    p_snapshot_type,
    v_entity_count,
    v_metric_links,
    v_event_links,
    v_signal_count,
    v_contradictions,
    v_confidence,
    jsonb_build_object(
      'entity_count', v_entity_count,
      'metric_link_count', v_metric_links,
      'event_link_count', v_event_links,
      'signal_count', v_signal_count,
      'open_contradictions', v_contradictions,
      'confidence_evaluations', v_confidence
    ),
    auth.uid()
  ) returning id into v_id;

  insert into public.pipeline_health_events(job_name, status, source, inserted_count, message, metadata)
  values ('create_graph_snapshot', 'success', 'database', 1, 'Intelligence graph snapshot created', jsonb_build_object('snapshot_id', v_id, 'snapshot_type', p_snapshot_type));

  return v_id;
end;
$$;

create or replace function public.start_pipeline_trace(
  p_operation_name text,
  p_provider text default null,
  p_layer text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_trace_id uuid default gen_random_uuid(),
  p_parent_span_id uuid default null
)
returns table(trace_id uuid, span_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_span uuid := gen_random_uuid();
begin
  insert into public.pipeline_traces(trace_id, parent_span_id, span_id, operation_name, provider, layer, metadata)
  values (p_trace_id, p_parent_span_id, v_span, p_operation_name, p_provider, p_layer, p_metadata);

  return query select p_trace_id, v_span;
end;
$$;

create or replace function public.finish_pipeline_trace(
  p_trace_id uuid,
  p_span_id uuid,
  p_status text,
  p_rows_in integer default 0,
  p_rows_out integer default 0,
  p_error text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pipeline_traces
  set status = p_status,
      ended_at = now(),
      duration_ms = greatest(0, extract(epoch from (now() - started_at))::integer * 1000),
      rows_in = p_rows_in,
      rows_out = p_rows_out,
      error = p_error,
      metadata = metadata || p_metadata
  where trace_id = p_trace_id and span_id = p_span_id;

  return found;
end;
$$;

create or replace function public.plan_anomaly_response_actions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  with open_anomalies as (
    select *
    from public.observability_anomalies oa
    where oa.status = 'open'
      and not exists (
        select 1 from public.anomaly_response_actions ara
        where ara.anomaly_id = oa.id and ara.status in ('queued','running','completed')
      )
  ), planned as (
    select
      id as anomaly_id,
      case
        when severity = 'critical' then 'open_incident'
        when anomaly_type = 'slo_breach' and metric_name like '%last_24h%' then 'degraded_mode'
        when anomaly_type = 'slo_breach' then 'notify_admin'
        else 'manual_review'
      end as action_type,
      severity,
      layer,
      'Automated response action planned for anomaly: ' || description as reason
    from open_anomalies
  ), inserted as (
    insert into public.anomaly_response_actions(anomaly_id, action_type, severity, reason, result)
    select anomaly_id, action_type, severity, reason, jsonb_build_object('planned_from_layer', layer)
    from planned
    returning 1
  )
  select count(*) into v_inserted from inserted;

  insert into public.pipeline_health_events(job_name, status, source, inserted_count, message, metadata)
  values ('plan_anomaly_response_actions', case when v_inserted > 0 then 'partial' else 'success' end, 'database', v_inserted, 'Anomaly response planning completed', jsonb_build_object('planned_actions', v_inserted));

  return v_inserted;
end;
$$;

create or replace function public.materialize_analyst_review_tasks()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  with contradiction_tasks as (
    select
      'contradiction_review'::text as task_type,
      case severity when 'critical' then 'critical' when 'high' then 'high' else 'medium' end as priority,
      'Review contradiction cluster: ' || coalesce(domain,'unknown') as title,
      'Open contradiction requires analyst review before high-confidence routing.' as description,
      'contradiction_cluster' as resource_type,
      id::text as resource_id,
      jsonb_build_object('cluster_key', cluster_key, 'iso3', iso3, 'domain', domain, 'source_count', source_count) as evidence
    from public.contradiction_clusters cc
    where cc.status in ('open','reviewing')
      and not exists (
        select 1 from public.analyst_review_tasks t
        where t.related_resource_type = 'contradiction_cluster'
          and t.related_resource_id = cc.id::text
          and t.status in ('open','assigned','in_review')
      )
    limit 200
  ), geo_tasks as (
    select
      'geo_enrichment_review',
      case when confidence < 50 then 'high' else 'medium' end,
      'Review low-confidence geo enrichment',
      'Event geography could not be confidently resolved automatically.',
      'event_geo_enrichment_queue',
      id::text,
      jsonb_build_object('event_id', event_id, 'title', title, 'inferred_iso3', inferred_iso3, 'confidence', confidence)
    from public.event_geo_enrichment_queue q
    where q.status = 'review'
      and not exists (
        select 1 from public.analyst_review_tasks t
        where t.related_resource_type = 'event_geo_enrichment_queue'
          and t.related_resource_id = q.id::text
          and t.status in ('open','assigned','in_review')
      )
    limit 200
  ), entity_tasks as (
    select
      'entity_governance_review',
      case when confidence < 60 then 'high' else 'medium' end,
      'Review entity governance item: ' || queue_type,
      reason,
      'entity_governance_queue',
      id::text,
      evidence
    from public.entity_governance_queue q
    where q.status = 'open'
      and not exists (
        select 1 from public.analyst_review_tasks t
        where t.related_resource_type = 'entity_governance_queue'
          and t.related_resource_id = q.id::text
          and t.status in ('open','assigned','in_review')
      )
    limit 200
  ), anomaly_tasks as (
    select
      'anomaly_triage',
      case severity when 'critical' then 'critical' when 'high' then 'high' else 'medium' end,
      'Triage observability anomaly: ' || metric_name,
      description,
      'observability_anomaly',
      id::text,
      metadata
    from public.observability_anomalies oa
    where oa.status = 'open'
      and not exists (
        select 1 from public.analyst_review_tasks t
        where t.related_resource_type = 'observability_anomaly'
          and t.related_resource_id = oa.id::text
          and t.status in ('open','assigned','in_review')
      )
    limit 200
  ), all_tasks as (
    select * from contradiction_tasks
    union all select * from geo_tasks
    union all select * from entity_tasks
    union all select * from anomaly_tasks
  ), inserted as (
    insert into public.analyst_review_tasks(task_type, priority, title, description, related_resource_type, related_resource_id, evidence)
    select task_type, priority, title, description, resource_type, resource_id, evidence
    from all_tasks
    returning 1
  )
  select count(*) into v_inserted from inserted;

  insert into public.pipeline_health_events(job_name, status, source, inserted_count, message, metadata)
  values ('materialize_analyst_review_tasks', case when v_inserted > 0 then 'partial' else 'success' end, 'database', v_inserted, 'Analyst review task materialization completed', jsonb_build_object('created_tasks', v_inserted));

  return v_inserted;
end;
$$;

create or replace view public.v_analyst_review_console as
select
  id,
  task_type,
  priority,
  status,
  title,
  description,
  related_resource_type,
  related_resource_id,
  assigned_to,
  evidence,
  due_at,
  created_at,
  updated_at,
  case priority when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end as priority_rank
from public.analyst_review_tasks
where status in ('open','assigned','in_review')
order by priority_rank, created_at desc;

create or replace view public.v_pipeline_trace_summary as
select
  operation_name,
  provider,
  layer,
  count(*)::bigint as spans,
  count(*) filter (where status = 'success')::bigint as success_spans,
  count(*) filter (where status in ('failed','degraded'))::bigint as problem_spans,
  round(avg(duration_ms)::numeric, 2) as avg_duration_ms,
  max(started_at) as latest_started_at
from public.pipeline_traces
where started_at > now() - interval '7 days'
group by operation_name, provider, layer
order by latest_started_at desc nulls last;

select cron.schedule('create_graph_snapshot_hourly', '0 * * * *', $$select public.create_graph_snapshot('scheduled');$$)
where not exists (select 1 from cron.job where jobname = 'create_graph_snapshot_hourly');

select cron.schedule('plan_anomaly_response_actions', '*/15 * * * *', $$select public.plan_anomaly_response_actions();$$)
where not exists (select 1 from cron.job where jobname = 'plan_anomaly_response_actions');

select cron.schedule('materialize_analyst_review_tasks', '*/10 * * * *', $$select public.materialize_analyst_review_tasks();$$)
where not exists (select 1 from cron.job where jobname = 'materialize_analyst_review_tasks');
