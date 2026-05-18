-- AICIS Governance Workflow Engine
-- Institutional workflow orchestration, operational coordination,
-- trust-aware routing, SLA governance, and analyst task execution.

-- -----------------------------------------------------------------------------
-- 1. Governance workflows
-- -----------------------------------------------------------------------------

create table if not exists public.governance_workflows (
  id uuid primary key default gen_random_uuid(),
  workflow_key text unique,
  workflow_type text not null,
  workflow_status text not null default 'pending',
  operational_stage text,
  required_stakeholders text[],
  approval_chain text[],
  escalation_routing text,
  execution_priority integer default 100,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_governance_workflow_status
on public.governance_workflows(workflow_status);

-- -----------------------------------------------------------------------------
-- 2. Analyst operational tasks
-- -----------------------------------------------------------------------------

create table if not exists public.analyst_operational_tasks (
  id uuid primary key default gen_random_uuid(),
  task_key text unique,
  task_type text not null,
  task_status text not null default 'open',
  assigned_analyst text,
  related_signal_id text,
  related_escalation_id uuid,
  task_priority text default 'medium',
  task_summary text,
  due_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_analyst_tasks_status
on public.analyst_operational_tasks(task_status);

create index if not exists idx_analyst_tasks_priority
on public.analyst_operational_tasks(task_priority);

-- -----------------------------------------------------------------------------
-- 3. Operational incident coordination
-- -----------------------------------------------------------------------------

create table if not exists public.operational_incident_coordination (
  id uuid primary key default gen_random_uuid(),
  incident_key text unique,
  incident_type text,
  incident_severity text,
  operational_domain text,
  affected_regions text[],
  mitigation_status text default 'monitoring',
  coordination_summary text,
  recovery_eta timestamptz,
  resolution_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_incident_severity
on public.operational_incident_coordination(incident_severity);

-- -----------------------------------------------------------------------------
-- 4. Trust-aware decision routing
-- -----------------------------------------------------------------------------

create table if not exists public.trust_decision_routing (
  id uuid primary key default gen_random_uuid(),
  routing_key text unique,
  trust_threshold numeric,
  corroboration_requirement integer,
  requires_manual_review boolean default false,
  auto_escalation_enabled boolean default false,
  blocked_by_drift boolean default false,
  routing_action text,
  created_at timestamptz not null default now()
);

insert into public.trust_decision_routing (
  routing_key,
  trust_threshold,
  corroboration_requirement,
  requires_manual_review,
  auto_escalation_enabled,
  blocked_by_drift,
  routing_action
) values
(
  'critical_low_trust',
  0.50,
  2,
  true,
  false,
  true,
  'Require analyst approval before escalation'
),
(
  'high_confidence_operational',
  0.85,
  1,
  false,
  true,
  false,
  'Allow expedited operational routing'
),
(
  'drift_blocked_signal',
  0.70,
  2,
  true,
  false,
  true,
  'Quarantine signal until drift review completes'
)
on conflict (routing_key) do nothing;

-- -----------------------------------------------------------------------------
-- 5. Governance SLA tracking
-- -----------------------------------------------------------------------------

create table if not exists public.governance_sla_tracking (
  id uuid primary key default gen_random_uuid(),
  sla_scope text,
  target_response_minutes integer,
  actual_response_minutes integer,
  sla_status text,
  escalation_triggered boolean default false,
  accountable_team text,
  evaluated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 6. Institutional readiness metrics
-- -----------------------------------------------------------------------------

create table if not exists public.institutional_readiness_metrics (
  id uuid primary key default gen_random_uuid(),
  readiness_scope text,
  governance_readiness_score numeric,
  operational_resilience_score numeric,
  validation_coverage_score numeric,
  stewardship_readiness_score numeric,
  analyst_participation_score numeric,
  policy_compliance_score numeric,
  institutional_readiness_index numeric,
  generated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 7. Governance automation policies
-- -----------------------------------------------------------------------------

insert into public.validation_policy_rules (
  policy_key,
  policy_name,
  policy_scope,
  policy_condition,
  policy_action,
  policy_priority
) values
(
  'auto_create_analyst_task_for_critical_drift',
  'Auto-create analyst task for severe drift',
  'drift_detection',
  'critical drift severity detected',
  'create analyst operational task immediately',
  5
),
(
  'dual_review_geopolitical_escalation',
  'Require dual analyst review for geopolitical escalation',
  'governance_escalation',
  'critical geopolitical escalation',
  'require secondary analyst approval',
  8
),
(
  'quarantine_low_trust_propagation',
  'Quarantine low-trust propagation chains',
  'propagation_validation',
  'operational trust < 0.45',
  'suppress propagation visibility and escalate review',
  12
)
on conflict (policy_key) do nothing;

-- -----------------------------------------------------------------------------
-- 8. Governance operations command view
-- -----------------------------------------------------------------------------

create or replace view public.governance_operations_command_view as
select
  gw.workflow_type,
  gw.workflow_status,
  aot.task_type,
  aot.task_status,
  oic.incident_type,
  oic.incident_severity,
  tdr.routing_action,
  gsl.sla_status,
  irm.institutional_readiness_index,
  irm.operational_resilience_score
from public.governance_workflows gw
left join public.analyst_operational_tasks aot
  on true
left join public.operational_incident_coordination oic
  on true
left join public.trust_decision_routing tdr
  on true
left join public.governance_sla_tracking gsl
  on true
left join public.institutional_readiness_metrics irm
  on true;

comment on table public.governance_workflows is
'Institutional governance workflow orchestration infrastructure.';

comment on table public.analyst_operational_tasks is
'Operational analyst task coordination and execution infrastructure.';

comment on table public.operational_incident_coordination is
'Operational incident response and mitigation coordination layer.';

comment on table public.trust_decision_routing is
'Trust-aware routing and governed operational decision orchestration.';

comment on table public.governance_sla_tracking is
'Governance response SLA and operational accountability tracking.';

comment on table public.institutional_readiness_metrics is
'Institutional readiness scoring and operational resilience metrics.';

comment on view public.governance_operations_command_view is
'Unified governance operations and institutional coordination command surface.';
