-- AICIS Governance Execution Layer
-- Institutional governance, stewardship, escalation,
-- analyst oversight, and operational trust accountability.

-- -----------------------------------------------------------------------------
-- 1. Analyst validation reviews
-- -----------------------------------------------------------------------------

create table if not exists public.analyst_validation_reviews (
  id uuid primary key default gen_random_uuid(),
  signal_id text not null,
  signal_type text,
  analyst_id text,
  analyst_name text,
  original_ai_confidence numeric,
  adjusted_confidence numeric,
  review_decision text not null default 'pending',
  override_reason text,
  escalation_triggered boolean not null default false,
  escalation_id uuid,
  review_latency_minutes numeric,
  metadata jsonb not null default '{}'::jsonb,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_analyst_reviews_signal
on public.analyst_validation_reviews(signal_id);

create index if not exists idx_analyst_reviews_decision
on public.analyst_validation_reviews(review_decision);

-- -----------------------------------------------------------------------------
-- 2. Governance escalations
-- -----------------------------------------------------------------------------

create table if not exists public.governance_escalations (
  id uuid primary key default gen_random_uuid(),
  escalation_key text unique,
  escalation_severity text not null default 'medium',
  escalation_status text not null default 'open',
  operational_domain text,
  impacted_region text,
  source_signal_id text,
  assigned_reviewer text,
  escalation_reason text,
  resolution_summary text,
  response_sla_minutes integer,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_governance_escalations_status
on public.governance_escalations(escalation_status);

create index if not exists idx_governance_escalations_severity
on public.governance_escalations(escalation_severity);

-- -----------------------------------------------------------------------------
-- 3. Operational override history
-- -----------------------------------------------------------------------------

create table if not exists public.operational_override_history (
  id uuid primary key default gen_random_uuid(),
  signal_id text,
  override_type text,
  original_value text,
  overridden_value text,
  override_reason text,
  overridden_by text,
  policy_triggered boolean default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_override_history_signal
on public.operational_override_history(signal_id);

-- -----------------------------------------------------------------------------
-- 4. Data stewardship assignments
-- -----------------------------------------------------------------------------

create table if not exists public.data_steward_assignments (
  id uuid primary key default gen_random_uuid(),
  steward_id text,
  steward_name text,
  governed_provider text,
  governed_domain text,
  governed_region text,
  stewardship_status text not null default 'active',
  operational_sla_hours numeric,
  accountability_score numeric default 0.8,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_steward_provider
on public.data_steward_assignments(governed_provider);

-- -----------------------------------------------------------------------------
-- 5. Governance maturity metrics
-- -----------------------------------------------------------------------------

create table if not exists public.governance_maturity_metrics (
  id uuid primary key default gen_random_uuid(),
  evaluation_scope text,
  validation_maturity_score numeric,
  stewardship_coverage_score numeric,
  corroboration_quality_score numeric,
  drift_responsiveness_score numeric,
  analyst_participation_score numeric,
  escalation_responsiveness_score numeric,
  operational_trust_score numeric,
  governance_maturity_index numeric,
  generated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 6. Governance timeline events
-- -----------------------------------------------------------------------------

create table if not exists public.governance_timeline_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  event_severity text,
  related_signal_id text,
  related_escalation_id uuid,
  event_summary text,
  event_actor text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_governance_timeline_type
on public.governance_timeline_events(event_type);

-- -----------------------------------------------------------------------------
-- 7. Validation policy rules
-- -----------------------------------------------------------------------------

create table if not exists public.validation_policy_rules (
  id uuid primary key default gen_random_uuid(),
  policy_key text unique,
  policy_name text not null,
  policy_scope text,
  policy_condition text,
  policy_action text,
  policy_priority integer default 100,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.validation_policy_rules (
  policy_key,
  policy_name,
  policy_scope,
  policy_condition,
  policy_action,
  policy_priority
) values
(
  'require_corroboration_for_critical',
  'Require corroboration for critical escalation',
  'governance_escalation',
  'critical severity without corroboration >= 2',
  'block escalation and require analyst review',
  10
),
(
  'suppress_low_confidence_signals',
  'Suppress low-confidence operational signals',
  'operational_signal',
  'confidence < 0.40',
  'downgrade visibility and require manual validation',
  20
),
(
  'auto_escalate_critical_drift',
  'Auto escalate severe operational drift',
  'drift_detection',
  'drift severity = critical',
  'create governance escalation immediately',
  5
)
on conflict (policy_key) do nothing;

-- -----------------------------------------------------------------------------
-- 8. Governance maturity command view
-- -----------------------------------------------------------------------------

create or replace view public.governance_command_center_view as
select
  gmm.evaluation_scope,
  gmm.governance_maturity_index,
  gmm.operational_trust_score,
  avr.review_decision,
  ge.escalation_status,
  ge.escalation_severity,
  dsa.governed_provider,
  dsa.accountability_score,
  gte.event_type,
  gte.event_severity,
  gte.event_summary,
  gte.created_at
from public.governance_maturity_metrics gmm
left join public.analyst_validation_reviews avr
  on true
left join public.governance_escalations ge
  on true
left join public.data_steward_assignments dsa
  on true
left join public.governance_timeline_events gte
  on true;

comment on table public.analyst_validation_reviews is
'Human analyst operational review and confidence override infrastructure.';

comment on table public.governance_escalations is
'Institutional escalation workflows and operational governance coordination.';

comment on table public.operational_override_history is
'Operational override and intervention audit history.';

comment on table public.data_steward_assignments is
'Data stewardship ownership and accountability infrastructure.';

comment on table public.governance_maturity_metrics is
'Governance maturity scoring and institutional readiness metrics.';

comment on table public.governance_timeline_events is
'Institutional operational governance timeline and event memory.';

comment on table public.validation_policy_rules is
'Operational validation governance policy engine.';

comment on view public.governance_command_center_view is
'Unified governance and stewardship operational command surface.';
