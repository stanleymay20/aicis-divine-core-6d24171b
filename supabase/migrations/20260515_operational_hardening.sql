-- Operational hardening orchestration
-- Activates propagation scheduling, institutional feed orchestration,
-- source freshness monitoring, and incident lifecycle support.

create table if not exists public.operational_source_health (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null unique,
  provider_name text not null,
  last_success_at timestamptz,
  freshness_minutes integer default 0,
  status text default 'unknown',
  records_ingested bigint default 0,
  last_error text,
  updated_at timestamptz default now()
);

create table if not exists public.operational_incidents (
  id uuid primary key default gen_random_uuid(),
  incident_title text not null,
  incident_type text,
  severity text default 'strategic',
  lifecycle_stage text default 'detected',
  source_event_id uuid,
  assigned_team text,
  escalation_score numeric default 0,
  operational_summary text,
  recommended_action text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_operational_incidents_stage
on public.operational_incidents(lifecycle_stage);

create index if not exists idx_operational_incidents_severity
on public.operational_incidents(severity);

create or replace view public.operational_source_health_view as
select
  provider_key,
  provider_name,
  status,
  freshness_minutes,
  records_ingested,
  last_success_at,
  updated_at,
  case
    when freshness_minutes <= 30 then 'healthy'
    when freshness_minutes <= 180 then 'stale'
    else 'degraded'
  end as freshness_state
from public.operational_source_health;

create or replace view public.operational_incident_command_view as
select
  incident_title,
  incident_type,
  severity,
  lifecycle_stage,
  escalation_score,
  recommended_action,
  created_at
from public.operational_incidents
order by escalation_score desc, created_at desc;

comment on table public.operational_source_health is
'Enterprise operational source freshness and ingestion monitoring.';

comment on table public.operational_incidents is
'Incident lifecycle orchestration for operational coordination.';
