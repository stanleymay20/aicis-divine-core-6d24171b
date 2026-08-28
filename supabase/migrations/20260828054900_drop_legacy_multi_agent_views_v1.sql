-- Pre-migration for 20260828055000_multi_agent_coordination_epistemic_truth_floor_v1.sql.
-- The new command views expose evidence/semantics state and therefore change the
-- legacy fixed column shape. Drop only the views; the underlying tables are retained.

DROP VIEW IF EXISTS public.agent_consensus_command_view;
DROP VIEW IF EXISTS public.agent_cognition_command_view;
DROP VIEW IF EXISTS public.agent_task_command_view;
DROP VIEW IF EXISTS public.operational_agent_command_view;
