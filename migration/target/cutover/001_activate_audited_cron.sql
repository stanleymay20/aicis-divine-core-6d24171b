-- AICIS CUTOVER-ONLY TARGET ACTIVATION
--
-- FAIL-CLOSED PLACEHOLDER.
--
-- Correct-source read-only inspection on 2026-08-28 established that the live
-- AICIS scheduler contains 172 jobs, 171 active. The previous four-job
-- activation wave was based on an incomplete/cross-project scheduler model and
-- must not be used for production cutover.
--
-- Verified source schedule snapshot:
--   migration/source/aicis-cron-snapshot-20260828.json
-- Decision ledger:
--   migration/target/cutover/live-source-cron-decisions.json
--
-- This file intentionally schedules ZERO jobs until every verified source job
-- has an explicit activate/replace/retire decision, required implementations
-- are audited/deployed, source/target parity is proven, final delta is applied,
-- and target writer activation is explicitly approved.
--
-- Do not weaken this guard merely to make a migration or CI check pass.

DO $$
BEGIN
  RAISE EXCEPTION USING
    MESSAGE = 'AICIS cutover blocked: verified live scheduler has 172 jobs and source cron decisions are incomplete',
    HINT = 'Complete migration/target/cutover/live-source-cron-decisions.json from the verified AICIS cron snapshot, prove all migration gates, then generate a new audited activation SQL.';
END;
$$;
