-- Pre-migration for 20260828057000_executive_console_evidence_truth_floor_v1.sql.
-- The next migration intentionally replaces synthetic derived score expressions with
-- NULL while preserving the public column contract. Explicit drop/recreate keeps the
-- post-truth-floor view replacement rule deterministic.

DROP VIEW IF EXISTS public.executive_filtered_signal_view;
