-- AICIS Real-Time Intelligence Orchestration Layer
-- Adds live operator notifications, collaboration presence, realtime event channels,
-- and Supabase realtime publication hooks for operational intelligence tables.

create table if not exists public.realtime_operator_notifications (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null check (notification_type in ('critical_signal','anomaly','dead_letter','review_task','forecast','provider_degraded','system')),
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  title text not null,
  body text,
  related_resource_type text,
  related_resource_id text,
  target_role text default 'operator' check (target_role in ('viewer','analyst','operator','admin')),
  target_user_id uuid references auth.users(id),
  read_at timestamptz,
  acknowledged_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_realtime_notifications_priority_created on public.realtime_operator_notifications(priority, created_at desc);
create index if not exists idx_realtime_notifications_unread on public.realtime_operator_notifications(target_role, created_at desc) where read_at is null;
create index if not exists idx_realtime_notifications_user_unread on public.realtime_operator_notifications(target_user_id, created_at desc) where read_at is null;

create table if not exists public.operator_presence_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  role text,
  current_page text,
  current_task_id uuid references public.analyst_review_tasks(id),
  status text not null default 'online' check (status in ('online','away','busy','offline')),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(user_id)
);

create index if not exists idx_operator_presence_last_seen on public.operator_presence_sessions(last_seen_at desc);
create index if not exists idx_operator_presence_task on public.operator_presence_sessions(current_task_id) where current_task_id is not null;

create table if not exists public.live_intelligence_channels (
  id uuid primary key default gen_random_uuid(),
  channel_key text unique not null,
  display_name text not null,
  description text,
  channel_type text not null check (channel_type in ('signals','operations','anomalies','forecasts','review','system')),
  minimum_role text not null default 'operator' check (minimum_role in ('viewer','analyst','operator','admin')),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.live_intelligence_channels(channel_key, display_name, description, channel_type, minimum_role) values
  ('live-signals-critical','Critical Signals','High-confidence or high-severity signals requiring attention','signals','analyst'),
  ('ops-event-bus','Event Bus Operations','Queued, failed, and dead-letter operational events','operations','operator'),
  ('ops-anomalies','Operational Anomalies','SLO breaches and system anomalies','anomalies','operator'),
  ('analyst-review','Analyst Review Queue','Contradictions, geo review, entity governance, and anomaly triage','review','operator'),
  ('forecast-updates','Forecast Updates','Scenario completion and new forecast results','forecasts','operator'),
  ('system-admin','System Admin Stream','Admin-only system events and provider degradation','system','admin')
on conflict (channel_key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  channel_type = excluded.channel_type,
  minimum_role = excluded.minimum_role;

create or replace function public.emit_operator_notification(
  p_notification_type text,
  p_priority text,
  p_title text,
  p_body text default null,
  p_related_resource_type text default null,
  p_related_resource_id text default null,
  p_target_role text default 'operator',
  p_target_user_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.realtime_operator_notifications(
    notification_type, priority, title, body, related_resource_type, related_resource_id,
    target_role, target_user_id, metadata
  ) values (
    p_notification_type, p_priority, p_title, p_body, p_related_resource_type, p_related_resource_id,
    p_target_role, p_target_user_id, p_metadata
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.materialize_realtime_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  with anomaly_notifications as (
    select
      'anomaly'::text as notification_type,
      case severity when 'critical' then 'critical' when 'high' then 'high' else 'normal' end as priority,
      'Operational anomaly: ' || coalesce(metric_name, anomaly_type) as title,
      description as body,
      'observability_anomaly' as resource_type,
      id::text as resource_id,
      'operator' as target_role,
      jsonb_build_object('severity', severity, 'layer', layer, 'observed_value', observed_value, 'expected_value', expected_value) as metadata
    from public.observability_anomalies oa
    where oa.status = 'open'
      and oa.created_at > now() - interval '24 hours'
      and not exists (
        select 1 from public.realtime_operator_notifications n
        where n.related_resource_type = 'observability_anomaly'
          and n.related_resource_id = oa.id::text
      )
  ), dead_letter_notifications as (
    select
      'dead_letter'::text,
      'high'::text,
      'Dead-letter event: ' || event_type,
      coalesce(error, 'Event reached dead-letter state.'),
      'aicis_event_bus',
      id::text,
      'operator',
      jsonb_build_object('event_type', event_type, 'priority', priority, 'attempts', attempts)
    from public.aicis_event_bus eb
    where eb.status = 'dead_letter'
      and eb.updated_at > now() - interval '24 hours'
      and not exists (
        select 1 from public.realtime_operator_notifications n
        where n.related_resource_type = 'aicis_event_bus'
          and n.related_resource_id = eb.id::text
      )
  ), review_notifications as (
    select
      'review_task'::text,
      case priority when 'critical' then 'critical' when 'high' then 'high' else 'normal' end,
      'Analyst task: ' || title,
      description,
      'analyst_review_task',
      id::text,
      'operator',
      jsonb_build_object('task_type', task_type, 'priority', priority)
    from public.analyst_review_tasks t
    where t.status = 'open'
      and t.created_at > now() - interval '24 hours'
      and not exists (
        select 1 from public.realtime_operator_notifications n
        where n.related_resource_type = 'analyst_review_task'
          and n.related_resource_id = t.id::text
      )
  ), forecast_notifications as (
    select
      'forecast'::text,
      case when coalesce(fr.probability, 0) >= 0.7 or coalesce(fr.severity_score, 0) >= 80 then 'high' else 'normal' end,
      'Forecast completed: ' || fs.name,
      fr.explanation,
      'forecast_result',
      fr.id::text,
      'operator',
      jsonb_build_object('scenario_id', fs.id, 'probability', fr.probability, 'severity_score', fr.severity_score)
    from public.forecast_results fr
    join public.forecast_scenarios fs on fs.id = fr.scenario_id
    where fr.created_at > now() - interval '24 hours'
      and not exists (
        select 1 from public.realtime_operator_notifications n
        where n.related_resource_type = 'forecast_result'
          and n.related_resource_id = fr.id::text
      )
  ), all_notifications as (
    select * from anomaly_notifications
    union all select * from dead_letter_notifications
    union all select * from review_notifications
    union all select * from forecast_notifications
  ), inserted as (
    insert into public.realtime_operator_notifications(
      notification_type, priority, title, body, related_resource_type, related_resource_id, target_role, metadata
    )
    select notification_type, priority, title, body, resource_type, resource_id, target_role, metadata
    from all_notifications
    returning 1
  )
  select count(*) into v_inserted from inserted;

  insert into public.pipeline_health_events(job_name, status, source, inserted_count, message, metadata)
  values ('materialize_realtime_notifications', case when v_inserted > 0 then 'partial' else 'success' end, 'database', v_inserted, 'Realtime operator notifications materialized', jsonb_build_object('notifications', v_inserted));

  return v_inserted;
end;
$$;

create or replace function public.heartbeat_operator_presence(
  p_current_page text default null,
  p_current_task_id uuid default null,
  p_status text default 'online',
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.operator_presence_sessions(user_id, role, current_page, current_task_id, status, metadata)
  values (auth.uid(), coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', 'operator'), p_current_page, p_current_task_id, p_status, p_metadata)
  on conflict (user_id) do update set
    current_page = excluded.current_page,
    current_task_id = excluded.current_task_id,
    status = excluded.status,
    metadata = excluded.metadata,
    last_seen_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace view public.v_realtime_operations_center as
select
  (select count(*) from public.realtime_operator_notifications where read_at is null) as unread_notifications,
  (select count(*) from public.realtime_operator_notifications where read_at is null and priority = 'critical') as critical_notifications,
  (select count(*) from public.aicis_event_bus where status = 'queued') as queued_events,
  (select count(*) from public.aicis_event_bus where status = 'dead_letter') as dead_letter_events,
  (select count(*) from public.observability_anomalies where status = 'open') as open_anomalies,
  (select count(*) from public.analyst_review_tasks where status in ('open','assigned','in_review')) as open_review_tasks,
  (select count(*) from public.operator_presence_sessions where last_seen_at > now() - interval '5 minutes' and status <> 'offline') as active_operators,
  now() as computed_at;

create or replace view public.v_live_operator_notifications as
select
  id,
  notification_type,
  priority,
  title,
  body,
  related_resource_type,
  related_resource_id,
  target_role,
  target_user_id,
  read_at,
  acknowledged_at,
  metadata,
  created_at
from public.realtime_operator_notifications
where read_at is null
order by
  case priority when 'critical' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,
  created_at desc;

alter table public.realtime_operator_notifications replica identity full;
alter table public.operator_presence_sessions replica identity full;
alter table public.aicis_event_bus replica identity full;
alter table public.analyst_review_tasks replica identity full;
alter table public.observability_anomalies replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.realtime_operator_notifications;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.operator_presence_sessions;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.aicis_event_bus;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.analyst_review_tasks;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.observability_anomalies;
  exception when duplicate_object then null;
  end;
end $$;

select cron.schedule('materialize_realtime_notifications', '*/2 * * * *', $$select public.materialize_realtime_notifications();$$)
where not exists (select 1 from cron.job where jobname = 'materialize_realtime_notifications');
