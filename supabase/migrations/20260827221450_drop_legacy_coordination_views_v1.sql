-- Pre-migration for 20260827221500_coordination_engine_legacy_quarantine_v1.sql.
-- The quarantine exposes evidence/semantics columns and changes the original view
-- shapes. Drop only compatibility views; the underlying strategic data is retained.

DROP VIEW IF EXISTS public.digital_twin_command_view;
DROP VIEW IF EXISTS public.multi_agent_simulation_command_view;
DROP VIEW IF EXISTS public.resource_allocation_command_view;
