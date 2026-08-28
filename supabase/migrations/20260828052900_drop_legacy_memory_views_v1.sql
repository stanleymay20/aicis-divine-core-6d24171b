-- Pre-migration for 20260828053000_planetary_memory_epistemic_truth_floor_v1.sql.
-- The next migration recreates these legacy compatibility views with additional
-- evidence/semantics columns; PostgreSQL requires dropping the old shape first.

DROP VIEW IF EXISTS public.memory_forecast_command_view;
DROP VIEW IF EXISTS public.civilization_resilience_command_view;
DROP VIEW IF EXISTS public.historical_analog_command_view;
DROP VIEW IF EXISTS public.planetary_memory_command_view;
