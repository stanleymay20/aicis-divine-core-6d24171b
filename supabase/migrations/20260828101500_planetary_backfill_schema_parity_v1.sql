-- AICIS Planetary Backfill Schema Parity v1
--
-- The hardened planetary-backfill worker writes explicit epistemic metadata on
-- normalized metrics. The canonical table historically lacked a metadata
-- column, which would make the worker fail at runtime despite passing static CI.
-- This migration adds a non-authoritative metadata envelope only; it does not
-- manufacture confidence, freshness, verification, or observation timestamps.

ALTER TABLE public.normalized_metrics
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.normalized_metrics.metadata IS
  'Non-authoritative ingestion/semantic metadata. Values here must not be interpreted as calibrated confidence, verified provenance, freshness, or source observation time unless explicitly governed by dedicated semantic columns.';
