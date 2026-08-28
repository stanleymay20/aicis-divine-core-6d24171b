-- Pre-migration for 20260828052000_intervention_governance_epistemic_truth_floor_v1.sql.
-- PostgreSQL CREATE OR REPLACE VIEW cannot drop/reorder existing columns. These
-- compatibility views are recreated immediately by the next migration with explicit
-- evidence/semantics columns.

DROP VIEW IF EXISTS public.intervention_governance_command_view;
DROP VIEW IF EXISTS public.coordination_response_command_view;
DROP VIEW IF EXISTS public.intervention_simulation_command_view;
