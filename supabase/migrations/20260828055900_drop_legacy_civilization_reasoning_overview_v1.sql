-- Pre-migration for 20260828056000_legacy_strategic_reasoning_quarantine_v1.sql.
-- PostgreSQL CREATE OR REPLACE VIEW cannot drop/reorder existing columns. Code
-- search shows no committed downstream consumer of this legacy compatibility view,
-- so drop it before recreating the safer evidence-aware shape in the next migration.

DROP VIEW IF EXISTS public.civilization_reasoning_overview;
