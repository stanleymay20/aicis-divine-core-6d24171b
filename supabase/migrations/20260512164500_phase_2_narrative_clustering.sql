-- Phase 2 — Narrative Clustering Infrastructure
-- Begins transforming isolated signals into evolving strategic narratives.

create extension if not exists pgcrypto;

create table if not exists public.signal_narratives (
  id uuid primary key default gen_random_uuid(),
  narrative_key text not null unique,
  narrative_title text not null,
  narrative_type text not null default 'emerging',
  summary text,
  canonical_countries text[] default '{}',
  canonical_sectors text[] default '{}',
  canonical_entities text[] default '{}',
  signal_count integer not null default 0,
  escalation_score numeric(6,2) default 0,
  novelty_score numeric(6,2) default 0,
  momentum_score numeric(6,2) default 0,
  narrative_status text not null default 'active',
  first_signal_at timestamptz,
  last_signal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint signal_narratives_type_chk
    check (narrative_type in ('emerging','crisis','economic','security','health','climate','technology','governance','hybrid')),
  constraint signal_narratives_status_chk
    check (narrative_status in ('active','monitoring','resolved','suppressed'))
);

create index if not exists idx_signal_narratives_status on public.signal_narratives(narrative_status);
create index if not exists idx_signal_narratives_last_signal on public.signal_narratives(last_signal_at desc);
create index if not exists idx_signal_narratives_escalation on public.signal_narratives(escalation_score desc);

create table if not exists public.signal_narrative_members (
  id uuid primary key default gen_random_uuid(),
  narrative_id uuid not null references public.signal_narratives(id) on delete cascade,
  signal_id uuid not null references public.global_signals(id) on delete cascade,
  membership_strength numeric(6,2) not null default 0,
  narrative_role text not null default 'supporting',
  matched_features jsonb not null default '[]'::jsonb,
  joined_at timestamptz not null default now(),
  unique(narrative_id, signal_id),
  constraint signal_narrative_members_role_chk
    check (narrative_role in ('seed','core','supporting','outlier','escalation'))
);

create index if not exists idx_signal_narrative_members_narrative on public.signal_narrative_members(narrative_id);
create index if not exists idx_signal_narrative_members_signal on public.signal_narrative_members(signal_id);

create table if not exists public.signal_emergence_tracking (
  id uuid primary key default gen_random_uuid(),
  narrative_id uuid not null references public.signal_narratives(id) on delete cascade,
  tracking_window text not null,
  signal_velocity numeric(10,2) default 0,
  escalation_velocity numeric(10,2) default 0,
  geographic_spread integer default 0,
  sector_spread integer default 0,
  entity_spread integer default 0,
  average_confidence numeric(6,2) default 0,
  average_urgency numeric(6,2) default 0,
  average_impact numeric(6,2) default 0,
  anomaly_intensity numeric(6,2) default 0,
  computed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique(narrative_id, tracking_window)
);

create index if not exists idx_signal_emergence_tracking_narrative on public.signal_emergence_tracking(narrative_id);
create index if not exists idx_signal_emergence_tracking_velocity on public.signal_emergence_tracking(signal_velocity desc);

create or replace view public.narrative_intelligence_dashboard as
select
  sn.id,
  sn.narrative_key,
  sn.narrative_title,
  sn.narrative_type,
  sn.signal_count,
  sn.escalation_score,
  sn.novelty_score,
  sn.momentum_score,
  sn.canonical_countries,
  sn.canonical_sectors,
  sn.first_signal_at,
  sn.last_signal_at,
  extract(epoch from (now() - sn.last_signal_at))/3600 as hours_since_last_signal,
  coalesce(et.signal_velocity, 0) as signal_velocity,
  coalesce(et.escalation_velocity, 0) as escalation_velocity,
  coalesce(et.geographic_spread, 0) as geographic_spread,
  coalesce(et.average_urgency, 0) as average_urgency,
  coalesce(et.average_impact, 0) as average_impact
from public.signal_narratives sn
left join lateral (
  select *
  from public.signal_emergence_tracking et
  where et.narrative_id = sn.id
  order by et.computed_at desc
  limit 1
) et on true
where sn.narrative_status = 'active';

create or replace function public.compute_narrative_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'narratives', (select count(*) from public.signal_narratives),
    'active_narratives', (select count(*) from public.signal_narratives where narrative_status = 'active'),
    'high_escalation_narratives', (
      select count(*)
      from public.signal_narratives
      where escalation_score >= 75
    ),
    'high_velocity_narratives', (
      select count(*)
      from public.signal_emergence_tracking
      where signal_velocity >= 10
    ),
    'largest_narratives', (
      select coalesce(jsonb_agg(x), '[]'::jsonb)
      from (
        select narrative_title, signal_count, escalation_score
        from public.signal_narratives
        order by signal_count desc
        limit 10
      ) x
    )
  ) into result;

  return result;
end;
$$;
