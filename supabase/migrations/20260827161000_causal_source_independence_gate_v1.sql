-- AICIS causal source-independence gate v1
--
-- Distinct publishers/source IDs are descriptive only. Automated cascade review
-- and persistence require an append-only source-lineage assessment proving that
-- the exact supporting-claim set has complete, non-conflicting lineage and at
-- least two independent origins.

ALTER TABLE public.aicis_causal_assessments
  ADD COLUMN IF NOT EXISTS source_independence_assessment_id uuid
    REFERENCES public.aicis_source_independence_assessments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS independent_origin_count integer CHECK (
    independent_origin_count IS NULL OR independent_origin_count >= 0
  ),
  ADD COLUMN IF NOT EXISTS source_independence_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_diversity_semantics text;

ALTER TABLE public.aicis_cascades
  ADD COLUMN IF NOT EXISTS source_independence_status text,
  ADD COLUMN IF NOT EXISTS source_independence_semantics text,
  ADD COLUMN IF NOT EXISTS source_independence_assessment_ids uuid[],
  ADD COLUMN IF NOT EXISTS minimum_independent_origin_count integer CHECK (
    minimum_independent_origin_count IS NULL OR minimum_independent_origin_count >= 0
  );

CREATE OR REPLACE FUNCTION public.enforce_causal_source_independence_gate_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.eligible_for_cascade THEN
    IF NEW.source_independence_status IS DISTINCT FROM 'established'
       OR NEW.source_independence_assessment_id IS NULL
       OR NEW.independent_origin_count IS NULL
       OR NEW.independent_origin_count < 2 THEN
      NEW.eligible_for_cascade := false;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_causal_source_independence_gate_v1
  ON public.aicis_causal_assessments;
CREATE TRIGGER trg_enforce_causal_source_independence_gate_v1
BEFORE INSERT OR UPDATE ON public.aicis_causal_assessments
FOR EACH ROW EXECUTE FUNCTION public.enforce_causal_source_independence_gate_v1();

REVOKE ALL ON FUNCTION public.enforce_causal_source_independence_gate_v1() FROM PUBLIC;

-- Defense in depth for an older scanner binary. The truth-floor-v2 automated
-- scanner uses this exact support_semantics value for newly detected candidates.
-- If it does not also persist the new lineage proof fields, reject the cascade.
CREATE OR REPLACE FUNCTION public.enforce_automated_cascade_source_independence_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.support_semantics = 'automated_scan_candidate_only_manual_or_governed_promotion_required' THEN
    IF NEW.source_independence_status IS DISTINCT FROM 'established_for_every_edge'
       OR NEW.source_independence_assessment_ids IS NULL
       OR cardinality(NEW.source_independence_assessment_ids) < GREATEST(1, NEW.hop_count)
       OR NEW.minimum_independent_origin_count IS NULL
       OR NEW.minimum_independent_origin_count < 2 THEN
      RAISE EXCEPTION
        'Automated cascade persistence requires established source independence for every edge';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_automated_cascade_source_independence_v1
  ON public.aicis_cascades;
CREATE TRIGGER trg_enforce_automated_cascade_source_independence_v1
BEFORE INSERT OR UPDATE ON public.aicis_cascades
FOR EACH ROW EXECUTE FUNCTION public.enforce_automated_cascade_source_independence_v1();

REVOKE ALL ON FUNCTION public.enforce_automated_cascade_source_independence_v1() FROM PUBLIC;

COMMENT ON COLUMN public.aicis_causal_assessments.evidence_diversity IS
  'Descriptive distinct-source-identifier diversity only. It is excluded from causal scoring and is not source independence.';
COMMENT ON COLUMN public.aicis_causal_assessments.source_independence_assessment_id IS
  'Append-only lineage assessment used for the exact supporting-claim set. Required for automated cascade eligibility.';
COMMENT ON COLUMN public.aicis_causal_assessments.independent_origin_count IS
  'Count of explicit independent source origins from a complete non-conflicting lineage assessment; NULL when not established.';
COMMENT ON COLUMN public.aicis_cascades.source_independence_assessment_ids IS
  'Lineage assessment IDs for every causal edge used by an automated cascade candidate.';
COMMENT ON COLUMN public.aicis_cascades.minimum_independent_origin_count IS
  'Minimum independently established origin count across all edges in the cascade; NULL when not established.';
COMMENT ON FUNCTION public.enforce_causal_source_independence_gate_v1() IS
  'Fail-closed guard: an automated causal assessment cannot become cascade-eligible without explicit independent-origin evidence.';
COMMENT ON FUNCTION public.enforce_automated_cascade_source_independence_v1() IS
  'Fail-closed guard against older scanner binaries persisting automated cascades without per-edge source-independence proof.';