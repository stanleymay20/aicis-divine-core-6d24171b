-- Pre-migration for 20260827220500_planetary_propagation_truth_floor_v1.sql.
-- The evidence-aware causal command view changes the legacy column shape and must
-- therefore be recreated from a dropped view rather than CREATE OR REPLACE alone.

DROP VIEW IF EXISTS public.planetary_causal_command_view;
