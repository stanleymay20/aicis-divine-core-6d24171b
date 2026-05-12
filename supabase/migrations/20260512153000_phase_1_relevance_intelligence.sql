-- Phase 1 — Relevance Intelligence Layer
-- Purpose: suppress noisy/global alerts by scoring canonical signals against user/org context
-- while preserving weak-signal discovery and raw-stream access.

create table if not exists public.user_relevance_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  workspace_id uuid null,

  watched_countries text[] not null default '{}',
  watched_regions text[] not null default '{}',
  watched_sectors text[] not null default '{}',
  watched_topics text[] not null default '{}',
  watched_entities text[] not null default '{}',
  excluded_topics text[] not null default '{}',

  alert_threshold numeric not null default 70 check (alert_threshold between 0 and 100),
  discovery_threshold numeric not null default 40 check (discovery_threshold between 0 and 100),
  weights jsonb not null default jsonb_build_object(
    'domain_match', 0.20,
    'geo_match', 0.20,
    'sector_match', 0.15,
    'entity_match', 0.15,
    'impact', 0.10,
    'urgency', 0.10,
    'confidence', 0.05,
    'novelty_anomaly', 0.05
  ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- NULLS NOT DISTINCT lets one null workspace behave like one real tenant scope.
-- This is required for Supabase upsert/onConflict to work cleanly.
create unique index if not exists user_relevance_profiles_user_workspace_uidx
  on public.user_relevance_profiles (user_id, workspace_id) nulls not distinct;

create index if not exists user_relevance_profiles_user_idx
  on public.user_relevance_profiles (user_id);

create table if not exists public.signal_relevance_scores (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references public.global_signals(id) on delete cascade,
  user_id uuid not null,
  workspace_id uuid null,

  relevance_score numeric not null check (relevance_score between 0 and 100),
  relevance_tier text not null check (relevance_tier in ('critical', 'important', 'monitor', 'discovery', 'hidden')),
  relevance_reason jsonb not null default '{}'::jsonb,

  computed_at timestamptz not null default now()
);

create unique index if not exists signal_relevance_scores_signal_user_workspace_uidx
  on public.signal_relevance_scores (signal_id, user_id, workspace_id) nulls not distinct;

create index if not exists signal_relevance_scores_user_tier_idx
  on public.signal_relevance_scores (user_id, relevance_tier, computed_at desc);

create index if not exists signal_relevance_scores_signal_idx
  on public.signal_relevance_scores (signal_id);

create table if not exists public.user_signal_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  signal_id uuid not null references public.global_signals(id) on delete cascade,
  feedback_type text not null check (feedback_type in ('important', 'not_relevant', 'save', 'dismiss', 'escalate')),
  feedback_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists user_signal_feedback_user_signal_idx
  on public.user_signal_feedback (user_id, signal_id, created_at desc);

create index if not exists user_signal_feedback_type_idx
  on public.user_signal_feedback (feedback_type, created_at desc);

-- Convenience view for dashboards and validation.
create or replace view public.signal_relevance_tier_counts as
select
  user_id,
  workspace_id,
  relevance_tier,
  count(*)::bigint as signal_count,
  max(computed_at) as last_computed_at
from public.signal_relevance_scores
group by user_id, workspace_id, relevance_tier;

alter table public.user_relevance_profiles enable row level security;
alter table public.signal_relevance_scores enable row level security;
alter table public.user_signal_feedback enable row level security;

-- Keep policies defensive and idempotent. Service role bypasses RLS for cron/backfills.
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'user_relevance_profiles' and policyname = 'Users manage own relevance profiles'
  ) then
    create policy "Users manage own relevance profiles"
      on public.user_relevance_profiles
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'signal_relevance_scores' and policyname = 'Users read own relevance scores'
  ) then
    create policy "Users read own relevance scores"
      on public.signal_relevance_scores
      for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'user_signal_feedback' and policyname = 'Users manage own signal feedback'
  ) then
    create policy "Users manage own signal feedback"
      on public.user_signal_feedback
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

-- Optional notification gate: downstream alert senders can use this view/functionally equivalent filter.
create or replace view public.critical_signal_relevance_alerts as
select
  srs.*,
  urp.alert_threshold
from public.signal_relevance_scores srs
join public.user_relevance_profiles urp
  on urp.user_id = srs.user_id
 and urp.workspace_id is not distinct from srs.workspace_id
where srs.relevance_tier = 'critical'
   or srs.relevance_score >= urp.alert_threshold;
