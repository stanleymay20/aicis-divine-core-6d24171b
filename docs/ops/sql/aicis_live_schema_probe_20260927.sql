-- AICIS production live-schema probe
-- READ ONLY. Run only against canonical Lovable live project ps...rakk.
-- No CREATE/ALTER/DROP/INSERT/UPDATE/DELETE statements.

select
  current_database() as database_name,
  current_user as database_user,
  now() as observed_at;

select
  count(*) filter (where c.relkind in ('r','p')) as public_tables,
  count(*) filter (where c.relkind = 'v') as public_views,
  count(*) filter (where c.relkind = 'm') as public_materialized_views
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public';

with required(name, kind) as (
  values
    ('strategic_research_runs_v1','relation'),
    ('telemetry_backbone_command_view','relation'),
    ('intervention_governance_command_view','relation'),
    ('executive_planetary_insights_view','relation'),
    ('risk_action_learning_leaderboard','relation'),
    ('v_analyst_review_console','relation'),
    ('operational_source_health_view','relation'),
    ('operational_incident_command_view','relation'),
    ('validation_trust_command_view','relation'),
    ('public_intelligence_snapshot','routine')
)
select
  r.name,
  r.kind,
  case
    when r.kind = 'relation' then to_regclass('public.' || r.name) is not null
    when r.kind = 'routine' then exists (
      select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = r.name
    )
    else false
  end as exists_live
from required r
order by r.kind, r.name;

-- Dependencies for the public landing snapshot.
select
  name,
  to_regclass('public.' || name) is not null as exists_live
from (values
  ('country_performance_snapshots'),
  ('risk_ml_predictions'),
  ('simulation_runs'),
  ('ml_inference_audit'),
  ('risk_ranking_predictions')
) x(name)
order by name;

-- Telemetry closure.
select
  name,
  to_regclass('public.' || name) is not null as exists_live
from (values
  ('telemetry_event_bus'),
  ('telemetry_shard_workers'),
  ('telemetry_replay_checkpoints'),
  ('telemetry_lineage_records'),
  ('telemetry_priority_rules'),
  ('telemetry_observations'),
  ('telemetry_connectors'),
  ('telemetry_reasoning_attempts')
) x(name)
order by name;

-- Intervention closure.
select
  name,
  to_regclass('public.' || name) is not null as exists_live
from (values
  ('intervention_simulations'),
  ('intervention_safety_policies'),
  ('intervention_approval_workflows'),
  ('intervention_safety_evaluations'),
  ('intervention_human_review_queue'),
  ('coordination_response_plans'),
  ('intervention_outcome_ledger'),
  ('planetary_propagation_events')
) x(name)
order by name;

-- Pilot Truth learning closure.
select
  name,
  to_regclass('public.' || name) is not null as exists_live
from (values
  ('risk_action_recommendations'),
  ('decision_outcome_log'),
  ('recommendation_quality_score'),
  ('risk_action_performance_summary'),
  ('risk_action_score_adjustments')
) x(name)
order by name;

-- Definitions for page-critical views if they exist.
select schemaname, viewname, definition
from pg_catalog.pg_views
where schemaname = 'public'
  and viewname in (
    'telemetry_backbone_command_view',
    'intervention_governance_command_view',
    'executive_planetary_insights_view',
    'risk_action_learning_leaderboard',
    'v_analyst_review_console',
    'operational_source_health_view',
    'operational_incident_command_view',
    'validation_trust_command_view'
  )
order by viewname;

-- Function identity/definition for public snapshot if it exists.
select
  p.oid::regprocedure::text as signature,
  pg_get_functiondef(p.oid) as definition
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'public_intelligence_snapshot';

-- RLS/policies for strategic research ledger if present.
select
  c.relname,
  c.relrowsecurity,
  c.relforcerowsecurity
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'strategic_research_runs_v1';

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename = 'strategic_research_runs_v1'
order by policyname;
