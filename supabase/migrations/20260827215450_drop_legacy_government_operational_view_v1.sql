-- Pre-migration for 20260827215500_legacy_strategic_generator_quarantine_v1.sql.
-- The quarantine adds evidence/semantics columns to the legacy government command
-- view, so the old fixed view shape must be removed before recreation.

DROP VIEW IF EXISTS public.government_operational_command_view;
