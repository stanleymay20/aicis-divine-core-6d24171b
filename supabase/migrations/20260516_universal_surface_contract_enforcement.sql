-- AICIS Universal Surface Contract Enforcement
-- Enforces governance contracts across all operational surfaces,
-- adds degradation-aware scoring, and continuously validates
-- surface compatibility compliance.

-- -----------------------------------------------------------------------------
-- 1. Surface contract compliance runs
-- -----------------------------------------------------------------------------

create table if not exists public.surface_contract_compliance_runs (
  id uuid primary key default gen_random_uuid(),
  surface_name text not null,
  source_table text,
  compliance_status text not null default 'unknown',
  missing_fields text[] default '{}',
  degraded_operation boolean default false,
  degradation_reason text,
  operational_continuity_score numeric default 0,
  schema_compliance_score numeric default 0,
  trust_penalty_score numeric default 0,
  evaluated_at timestamptz not null default now()
);

create index if not exists idx_surface_contract_compliance_surface
on public.surface_contract_compliance_runs(surface_name);

-- -----------------------------------------------------------------------------
-- 2. Universal surface compatibility view
-- -----------------------------------------------------------------------------

create or replace view public.aicis_universal_surface_compatibility_view as
select
  r.surface_name,
  r.source_table,
  r.required_fields,
  r.default_urgency,
  r.default_evidence_tier,
  coalesce(c.compliance_status, 'unknown') as compliance_status,
  coalesce(c.degraded_operation, false) as degraded_operation,
  coalesce(c.operational_continuity_score, 0) as operational_continuity_score,
  coalesce(c.schema_compliance_score, 0) as schema_compliance_score,
  coalesce(c.trust_penalty_score, 0) as trust_penalty_score,
  c.degradation_reason,
  c.evaluated_at
from public.aicis_surface_contract_registry r
left join lateral (
  select *
  from public.surface_contract_compliance_runs scr
  where scr.surface_name = r.surface_name
  order by scr.evaluated_at desc
  limit 1
) c on true;

-- -----------------------------------------------------------------------------
-- 3. Compliance validation execution engine
-- -----------------------------------------------------------------------------

create or replace function public.run_surface_contract_compliance_cycle()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid := gen_random_uuid();
  r record;
  missing text[];
  continuity_score numeric;
  compliance_score numeric;
  penalty_score numeric;
  degraded boolean;
begin
  for r in
    select *
    from public.aicis_surface_contract_registry
    where is_enabled = true
  loop
    missing := array[]::text[];

    if not public.aicis_column_exists(r.source_table, 'urgency') then
      missing := missing || 'urgency';
    end if;

    if not public.aicis_column_exists(r.source_table, 'evidence_tier') then
      missing := missing || 'evidence_tier';
    end if;

    continuity_score := case
      when cardinality(missing) = 0 then 1.0
      when cardinality(missing) <= 2 then 0.75
      else 0.45
    end;

    compliance_score := greatest(0, 1 - (cardinality(missing)::numeric * 0.25));

    penalty_score := least(1, cardinality(missing)::numeric * 0.15);

    degraded := cardinality(missing) > 0;

    insert into public.surface_contract_compliance_runs (
      surface_name,
      source_table,
      compliance_status,
      missing_fields,
      degraded_operation,
      degradation_reason,
      operational_continuity_score,
      schema_compliance_score,
      trust_penalty_score,
      evaluated_at
    ) values (
      r.surface_name,
      r.source_table,
      case
        when cardinality(missing) = 0 then 'compliant'
        when cardinality(missing) <= 2 then 'degraded_but_operational'
        else 'critical_noncompliance'
      end,
      missing,
      degraded,
      case
        when cardinality(missing) = 0 then null
        else format('Missing required fields: %s', array_to_string(missing, ', '))
      end,
      continuity_score,
      compliance_score,
      penalty_score,
      now()
    );
  end loop;

  return v_run_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Trust-aware degradation routing
-- -----------------------------------------------------------------------------

create table if not exists public.surface_degradation_routing (
  id uuid primary key default gen_random_uuid(),
  surface_name text,
  degradation_level text,
  routing_action text,
  analyst_review_required boolean default false,
  escalation_suppressed boolean default false,
  auto_quarantine boolean default false,
  created_at timestamptz not null default now()
);

insert into public.surface_degradation_routing (
  surface_name,
  degradation_level,
  routing_action,
  analyst_review_required,
  escalation_suppressed,
  auto_quarantine
)
select
  surface_name,
  'degraded_but_operational',
  'Route through fail-soft operational mode',
  true,
  false,
  false
from public.aicis_surface_contract_registry
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 5. Operational degradation telemetry
-- -----------------------------------------------------------------------------

create table if not exists public.operational_degradation_telemetry (
  id uuid primary key default gen_random_uuid(),
  surface_name text,
  degradation_event text,
  degradation_severity text,
  continuity_preserved boolean default true,
  fail_soft_activated boolean default false,
  cache_fallback_used boolean default false,
  telemetry_summary text,
  recorded_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 6. Enterprise resilience command view
-- -----------------------------------------------------------------------------

create or replace view public.enterprise_resilience_command_view as
select
  auscv.surface_name,
  auscv.compliance_status,
  auscv.degraded_operation,
  auscv.operational_continuity_score,
  auscv.schema_compliance_score,
  auscv.trust_penalty_score,
  sdr.routing_action,
  sdr.analyst_review_required,
  sdr.auto_quarantine,
  odt.degradation_severity,
  odt.continuity_preserved,
  odt.fail_soft_activated,
  odt.cache_fallback_used,
  odt.recorded_at
from public.aicis_universal_surface_compatibility_view auscv
left join public.surface_degradation_routing sdr
  on sdr.surface_name = auscv.surface_name
left join public.operational_degradation_telemetry odt
  on odt.surface_name = auscv.surface_name;

comment on table public.surface_contract_compliance_runs is
'Continuous schema governance and operational surface compliance validation.';

comment on view public.aicis_universal_surface_compatibility_view is
'Unified enterprise-wide operational surface compatibility and governance visibility.';

comment on function public.run_surface_contract_compliance_cycle() is
'Continuously validates operational surfaces against governed schema contracts.';

comment on table public.surface_degradation_routing is
'Trust-aware operational degradation routing and fail-soft coordination rules.';

comment on table public.operational_degradation_telemetry is
'Operational degradation telemetry and resilience event tracking.';

comment on view public.enterprise_resilience_command_view is
'Enterprise resilience and degradation-aware operational governance command surface.';
