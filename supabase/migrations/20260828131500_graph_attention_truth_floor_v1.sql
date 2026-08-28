-- Graph attention epistemic truth floor v1
--
-- Attention ranking is a deterministic compression heuristic over topology scores.
-- It is not a calibrated probability, verified escalation, causal conclusion, or
-- measured confidence. Preserve that distinction in stored attention views.
--
-- Safe before restore: this migration no-ops when the source-era table is absent.

ALTER TABLE IF EXISTS public.graph_attention_views
  ADD COLUMN IF NOT EXISTS priority_semantics text,
  ADD COLUMN IF NOT EXISTS epistemic_status text NOT NULL DEFAULT 'legacy_unverified';

DO $$
BEGIN
  IF to_regclass('public.graph_attention_views') IS NOT NULL THEN
    UPDATE public.graph_attention_views
    SET
      priority_semantics = COALESCE(priority_semantics, 'legacy_priority_semantics_unverified'),
      epistemic_status = 'legacy_unverified';
  END IF;
END
$$;
