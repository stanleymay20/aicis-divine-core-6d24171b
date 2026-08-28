-- Pre-migration for 20260827220000_telemetry_backbone_truth_floor_v1.sql.
-- The truth-floor migration adds epistemic/operational semantics to these views,
-- changing the legacy fixed column shape.

DROP VIEW IF EXISTS public.telemetry_worker_command_view;
DROP VIEW IF EXISTS public.telemetry_backbone_command_view;
