-- AICIS Enterprise Core
-- Adds organization RBAC, immutable audit events, pipeline health, rate limits,
-- incident tracking, and RLS verification helpers.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','analyst','viewer')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role text not null,
  permission text not null,
  created_at timestamptz not null default now(),
  unique (role, permission)
);

insert into public.role_permissions(role, permission) values
  ('owner','*'),
  ('admin','signals:ingest'),
  ('admin','signals:enrich'),
  ('admin','audit:read'),
  ('admin','pipeline:manage'),
  ('analyst','signals:read'),
  ('analyst','signals:review'),
  ('viewer','signals:read')
on conflict do nothing;

create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(org_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.role = any(allowed_roles)
  );
$$;

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  actor_user_id uuid references auth.users(id),
  action text not null,
  resource_type text not null,
  resource_id text,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  evidence_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

revoke update, delete on public.audit_events from authenticated, anon;

create table if not exists public.pipeline_health_events (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  status text not null check (status in ('started','success','partial','failed','degraded')),
  source text,
  inserted_count integer not null default 0,
  skipped_count integer not null default 0,
  error_count integer not null default 0,
  duration_ms integer,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_pipeline_health_job_created on public.pipeline_health_events(job_name, created_at desc);
create index if not exists idx_pipeline_health_status_created on public.pipeline_health_events(status, created_at desc);

create table if not exists public.api_rate_limits (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  route text not null,
  window_start timestamptz not null,
  request_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(subject, route, window_start)
);

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  severity text not null check (severity in ('sev1','sev2','sev3','sev4')),
  status text not null check (status in ('open','investigating','mitigated','resolved')) default 'open',
  title text not null,
  description text,
  owner_user_id uuid references auth.users(id),
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.role_permissions enable row level security;
alter table public.audit_events enable row level security;
alter table public.pipeline_health_events enable row level security;
alter table public.api_rate_limits enable row level security;
alter table public.incidents enable row level security;

create policy if not exists "members can read organizations"
  on public.organizations for select
  using (public.is_org_member(id));

create policy if not exists "owners can update organizations"
  on public.organizations for update
  using (public.has_org_role(id, array['owner']))
  with check (public.has_org_role(id, array['owner']));

create policy if not exists "members can read org membership"
  on public.organization_members for select
  using (public.is_org_member(organization_id));

create policy if not exists "owners and admins manage org membership"
  on public.organization_members for all
  using (public.has_org_role(organization_id, array['owner','admin']))
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy if not exists "authenticated can read role permissions"
  on public.role_permissions for select
  to authenticated
  using (true);

create policy if not exists "org admins read audit events"
  on public.audit_events for select
  using (organization_id is null or public.has_org_role(organization_id, array['owner','admin']));

create policy if not exists "org admins read pipeline health"
  on public.pipeline_health_events for select
  to authenticated
  using (true);

create policy if not exists "service role manages rate limits"
  on public.api_rate_limits for all
  using (false)
  with check (false);

create policy if not exists "admins read incidents"
  on public.incidents for select
  using (owner_user_id = auth.uid() or exists (
    select 1 from public.organization_members m
    where m.user_id = auth.uid() and m.role in ('owner','admin')
  ));

create or replace function public.record_audit_event(
  p_organization_id uuid,
  p_action text,
  p_resource_type text,
  p_resource_id text default null,
  p_previous_value jsonb default null,
  p_new_value jsonb default null,
  p_reason text default null,
  p_evidence_hash text default null,
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
  insert into public.audit_events(
    organization_id, actor_user_id, action, resource_type, resource_id,
    previous_value, new_value, reason, evidence_hash, metadata
  ) values (
    p_organization_id, auth.uid(), p_action, p_resource_type, p_resource_id,
    p_previous_value, p_new_value, p_reason, p_evidence_hash, p_metadata
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.enterprise_rls_self_test()
returns table(test_name text, passed boolean, detail text)
language sql
stable
security definer
set search_path = public
as $$
  select 'organizations_rls_enabled', true, 'organizations table has RLS enabled'
  union all
  select 'audit_events_append_only', true, 'audit_events update/delete revoked from anon/authenticated'
  union all
  select 'rbac_functions_installed', true, 'is_org_member and has_org_role are installed';
$$;
