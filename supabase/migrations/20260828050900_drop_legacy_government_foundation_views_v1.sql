-- Pre-migration for 20260828051000_government_foundation_legacy_epistemic_quarantine_v1.sql.
-- Even though the replacement select lists remain compatibility-oriented, explicit
-- drop/recreate makes view replacement deterministic under the migration contract.

DROP VIEW IF EXISTS public.scenario_simulation_command_view;
DROP VIEW IF EXISTS public.population_stress_command_view;
