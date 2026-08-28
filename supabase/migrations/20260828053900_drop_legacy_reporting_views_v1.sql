-- Pre-migration for 20260828054000_executive_reporting_epistemic_truth_floor_v1.sql.
-- The safer reporting views add evidence/semantics columns and therefore require
-- dropping the old fixed column shape before recreation.

DROP VIEW IF EXISTS public.briefing_distribution_command_view;
DROP VIEW IF EXISTS public.operational_sitrep_command_view;
DROP VIEW IF EXISTS public.executive_briefing_command_view;
