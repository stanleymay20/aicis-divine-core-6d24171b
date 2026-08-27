-- AICIS Causal/Cascade Epistemic Truth Floor v2
--
-- The existing causal pipeline contains deterministic evidence-screening formulas.
-- Those scores are useful operationally, but they are not calibrated probabilities
-- and must not be presented as causal confidence. Unknown quantitative evidence
-- remains NULL and automated scans never auto-promote a cascade to causal truth.

ALTER TABLE public.aicis_causal_assessments
  ALTER COLUMN causal_score DROP NOT NULL,
  ALTER COLUMN confidence DROP NOT NULL,
  ALTER COLUMN temporal_precedence DROP DEFAULT,
  ALTER COLUMN temporal_precedence DROP NOT NULL,
  ALTER COLUMN mechanism_support DROP DEFAULT,
  ALTER COLUMN mechanism_support DROP NOT NULL,
  ALTER COLUMN evidence_diversity DROP DEFAULT,
  ALTER COLUMN evidence_diversity DROP NOT NULL,
  ALTER COLUMN contradiction_penalty DROP DEFAULT,
  ALTER COLUMN contradiction_penalty DROP NOT NULL,
  ALTER COLUMN confounder_penalty DROP DEFAULT,
  ALTER COLUMN confounder_penalty DROP NOT NULL,
  ALTER COLUMN intervention_support DROP DEFAULT,
  ALTER COLUMN intervention_support DROP NOT NULL,
  ALTER COLUMN counterfactual_support DROP DEFAULT,
  ALTER COLUMN counterfactual_support DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS score_semantics text,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS temporal_precedence_semantics text,
  ADD COLUMN IF NOT EXISTS source_independence_status text,
  ADD COLUMN IF NOT EXISTS quantitative_evidence_status text,
  ADD COLUMN IF NOT EXISTS eligible_for_cascade boolean NOT NULL DEFAULT false;

UPDATE public.aicis_causal_assessments
SET
  score_semantics = COALESCE(score_semantics, 'legacy_causal_score_semantics_unverified'),
  confidence_semantics = COALESCE(confidence_semantics, 'legacy_numeric_confidence_semantics_unverified'),
  temporal_precedence_semantics = COALESCE(temporal_precedence_semantics, 'legacy_temporal_metric_semantics_unverified'),
  source_independence_status = COALESCE(source_independence_status, 'legacy_not_assessed'),
  quantitative_evidence_status = COALESCE(quantitative_evidence_status, 'legacy_not_assessed')
WHERE
  score_semantics IS NULL
  OR confidence_semantics IS NULL
  OR temporal_precedence_semantics IS NULL
  OR source_independence_status IS NULL
  OR quantitative_evidence_status IS NULL;

ALTER TABLE public.aicis_cascades
  ALTER COLUMN causal_confidence DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS systemic_score_semantics text,
  ADD COLUMN IF NOT EXISTS structural_confidence_semantics text,
  ADD COLUMN IF NOT EXISTS causal_confidence_semantics text,
  ADD COLUMN IF NOT EXISTS causal_evidence_score numeric CHECK (
    causal_evidence_score IS NULL OR (causal_evidence_score >= 0 AND causal_evidence_score <= 1)
  ),
  ADD COLUMN IF NOT EXISTS causal_evidence_score_semantics text,
  ADD COLUMN IF NOT EXISTS support_semantics text;

UPDATE public.aicis_cascades
SET
  systemic_score_semantics = COALESCE(systemic_score_semantics, 'legacy_systemic_score_semantics_unverified'),
  structural_confidence_semantics = COALESCE(structural_confidence_semantics, 'legacy_structural_confidence_semantics_unverified'),
  causal_confidence_semantics = COALESCE(causal_confidence_semantics, 'legacy_causal_confidence_semantics_unverified'),
  support_semantics = COALESCE(support_semantics, 'legacy_support_semantics_unverified')
WHERE
  systemic_score_semantics IS NULL
  OR structural_confidence_semantics IS NULL
  OR causal_confidence_semantics IS NULL
  OR support_semantics IS NULL;

ALTER TABLE public.aicis_cascade_steps
  ADD COLUMN IF NOT EXISTS structural_score_semantics text,
  ADD COLUMN IF NOT EXISTS cumulative_score_semantics text,
  ADD COLUMN IF NOT EXISTS causal_evidence_score numeric CHECK (
    causal_evidence_score IS NULL OR (causal_evidence_score >= 0 AND causal_evidence_score <= 1)
  ),
  ADD COLUMN IF NOT EXISTS causal_evidence_score_semantics text;

UPDATE public.aicis_cascade_steps
SET
  structural_score_semantics = COALESCE(structural_score_semantics, 'legacy_structural_confidence_semantics_unverified'),
  cumulative_score_semantics = COALESCE(cumulative_score_semantics, 'legacy_cumulative_confidence_semantics_unverified')
WHERE structural_score_semantics IS NULL OR cumulative_score_semantics IS NULL;

COMMENT ON COLUMN public.aicis_causal_assessments.causal_score IS
  'Nullable deterministic evidence-screening score. It is not a calibrated probability of causation; inspect score_semantics.';
COMMENT ON COLUMN public.aicis_causal_assessments.confidence IS
  'Nullable calibrated confidence only. Truth-floor-v2 automated causal screening does not issue one and writes NULL.';
COMMENT ON COLUMN public.aicis_causal_assessments.temporal_precedence IS
  'Nullable temporal evidence score. It must remain NULL when actual cause/effect event ordering has not been established.';
COMMENT ON COLUMN public.aicis_cascades.causal_confidence IS
  'Nullable calibrated causal confidence. Automated truth-floor-v2 cascade scans do not manufacture this value.';
COMMENT ON COLUMN public.aicis_cascades.causal_evidence_score IS
  'Deterministic path-level causal-evidence screening score; not a causal probability.';
COMMENT ON COLUMN public.aicis_cascades.systemic_score IS
  'Deterministic systemic-priority heuristic; not a probability. Inspect systemic_score_semantics.';
COMMENT ON COLUMN public.aicis_cascade_steps.structural_confidence IS
  'Compatibility field containing a deterministic structural path score under truth-floor-v2; inspect structural_score_semantics.';

CREATE OR REPLACE VIEW public.aicis_supported_cascades AS
SELECT
  c.id,
  c.cascade_key,
  c.origin_entity_id,
  origin.canonical_name AS origin_name,
  c.terminal_entity_id,
  terminal.canonical_name AS terminal_name,
  c.systemic_score,
  c.structural_confidence,
  c.causal_confidence,
  c.hop_count,
  c.cross_domain_count,
  c.first_detected_at,
  c.last_detected_at,
  c.graph_snapshot_id,
  c.causal_evidence_score,
  c.systemic_score_semantics,
  c.structural_confidence_semantics,
  c.causal_confidence_semantics,
  c.causal_evidence_score_semantics,
  c.support_semantics
FROM public.aicis_cascades c
JOIN public.aicis_world_entities origin ON origin.id = c.origin_entity_id
LEFT JOIN public.aicis_world_entities terminal ON terminal.id = c.terminal_entity_id
WHERE c.status = 'supported'
  AND c.epistemic_status NOT IN ('unverified','contradicted');

GRANT SELECT ON public.aicis_supported_cascades TO authenticated, service_role;
