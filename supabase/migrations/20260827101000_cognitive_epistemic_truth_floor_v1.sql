-- AICIS Cognitive Epistemic Truth Floor v1
--
-- Purpose:
-- * Unknown confidence/reliability/likelihood stays NULL. It is never manufactured
--   as 0.5, 1.0, or another convenient number by schema defaults.
-- * Existing numeric rows are preserved, but their semantics are explicitly marked
--   legacy/unverified unless a writer has supplied stronger provenance.
-- * Hypothesis probabilities are treated as subjective quantitative beliefs unless
--   and until a calibrated empirical interpretation is proven.
-- * Qualitative hypothesis evidence may exist without made-up likelihood ratios.

-- ---------------------------------------------------------------------------
-- Core cognitive substrate: remove numeric truth defaults.
-- ---------------------------------------------------------------------------
ALTER TABLE public.aicis_entity_aliases
  ALTER COLUMN confidence DROP DEFAULT,
  ALTER COLUMN confidence DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS confidence_semantics text;

ALTER TABLE public.aicis_evidence_claims
  ALTER COLUMN confidence DROP DEFAULT,
  ALTER COLUMN confidence DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS confidence_semantics text;

ALTER TABLE public.aicis_world_relationships
  ALTER COLUMN confidence DROP DEFAULT,
  ALTER COLUMN confidence DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS confidence_semantics text;

ALTER TABLE public.aicis_relationship_evidence
  ALTER COLUMN weight DROP DEFAULT,
  ALTER COLUMN weight DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS weight_semantics text;

ALTER TABLE public.aicis_cognitive_events
  ALTER COLUMN confidence DROP DEFAULT,
  ALTER COLUMN confidence DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS confidence_semantics text;

ALTER TABLE public.aicis_hypotheses
  ALTER COLUMN confidence DROP DEFAULT,
  ALTER COLUMN confidence DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS confidence_semantics text;

-- Preserve historical numbers but stop treating them as self-explanatory evidence.
UPDATE public.aicis_entity_aliases
SET confidence_semantics = 'legacy_numeric_semantics_unverified'
WHERE confidence IS NOT NULL AND confidence_semantics IS NULL;

UPDATE public.aicis_evidence_claims
SET confidence_semantics = 'legacy_numeric_semantics_unverified'
WHERE confidence IS NOT NULL AND confidence_semantics IS NULL;

UPDATE public.aicis_world_relationships
SET confidence_semantics = 'legacy_numeric_semantics_unverified'
WHERE confidence IS NOT NULL AND confidence_semantics IS NULL;

UPDATE public.aicis_relationship_evidence
SET weight_semantics = 'legacy_numeric_semantics_unverified'
WHERE weight IS NOT NULL AND weight_semantics IS NULL;

UPDATE public.aicis_cognitive_events
SET confidence_semantics = 'legacy_numeric_semantics_unverified'
WHERE confidence IS NOT NULL AND confidence_semantics IS NULL;

UPDATE public.aicis_hypotheses
SET confidence_semantics = 'legacy_numeric_semantics_unverified'
WHERE confidence IS NOT NULL AND confidence_semantics IS NULL;

-- ---------------------------------------------------------------------------
-- Competing-hypothesis substrate: no implicit 0.5 prior/reliability/likelihood.
-- ---------------------------------------------------------------------------
ALTER TABLE public.aicis_hypothesis_sets
  ALTER COLUMN entropy DROP DEFAULT,
  ALTER COLUMN entropy DROP NOT NULL,
  ALTER COLUMN margin DROP DEFAULT,
  ALTER COLUMN margin DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS competition_semantics text;

ALTER TABLE public.aicis_hypothesis_set_members
  ALTER COLUMN prior DROP DEFAULT,
  ALTER COLUMN prior DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS prior_semantics text,
  ADD COLUMN IF NOT EXISTS normalized_probability_semantics text;

ALTER TABLE public.aicis_hypothesis_evidence
  ALTER COLUMN reliability DROP DEFAULT,
  ALTER COLUMN reliability DROP NOT NULL,
  ALTER COLUMN likelihood_given_hypothesis DROP DEFAULT,
  ALTER COLUMN likelihood_given_hypothesis DROP NOT NULL,
  ALTER COLUMN likelihood_given_alternative DROP DEFAULT,
  ALTER COLUMN likelihood_given_alternative DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS quantitative_semantics text;

ALTER TABLE public.aicis_hypothesis_updates
  ALTER COLUMN prior DROP NOT NULL,
  ALTER COLUMN posterior DROP NOT NULL,
  ALTER COLUMN evidence_weight DROP DEFAULT,
  ALTER COLUMN evidence_weight DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS probability_semantics text;

UPDATE public.aicis_hypothesis_sets
SET competition_semantics = 'legacy_competition_metrics_semantics_unverified'
WHERE competition_semantics IS NULL
  AND (entropy IS NOT NULL OR margin IS NOT NULL);

UPDATE public.aicis_hypothesis_set_members
SET prior_semantics = 'legacy_numeric_prior_semantics_unverified'
WHERE prior IS NOT NULL AND prior_semantics IS NULL;

UPDATE public.aicis_hypothesis_set_members
SET normalized_probability_semantics = 'legacy_normalized_belief_semantics_unverified'
WHERE normalized_probability IS NOT NULL
  AND normalized_probability_semantics IS NULL;

UPDATE public.aicis_hypothesis_evidence
SET quantitative_semantics = 'legacy_quantitative_evidence_semantics_unverified'
WHERE quantitative_semantics IS NULL
  AND (
    reliability IS NOT NULL
    OR likelihood_given_hypothesis IS NOT NULL
    OR likelihood_given_alternative IS NOT NULL
  );

UPDATE public.aicis_hypothesis_updates
SET probability_semantics = 'legacy_belief_update_semantics_unverified'
WHERE probability_semantics IS NULL
  AND (prior IS NOT NULL OR posterior IS NOT NULL);

-- Each evaluation is auditable even when quantitative belief updating abstains.
CREATE TABLE IF NOT EXISTS public.aicis_hypothesis_evaluation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hypothesis_set_id uuid NOT NULL REFERENCES public.aicis_hypothesis_sets(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN (
    'quantified_subjective_belief_update',
    'qualitative_only',
    'insufficient_quantitative_priors',
    'insufficient_quantitative_evidence',
    'mixed_quantitative_coverage'
  )),
  member_count integer NOT NULL CHECK (member_count >= 0),
  quantified_prior_count integer NOT NULL CHECK (quantified_prior_count >= 0),
  quantitative_evidence_count integer NOT NULL CHECK (quantitative_evidence_count >= 0),
  qualitative_evidence_count integer NOT NULL CHECK (qualitative_evidence_count >= 0),
  probability_semantics text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  evaluated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aicis_hypothesis_evaluation_attempts_set_idx
  ON public.aicis_hypothesis_evaluation_attempts(hypothesis_set_id, evaluated_at DESC);

ALTER TABLE public.aicis_hypothesis_evaluation_attempts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.aicis_hypothesis_evaluation_attempts TO authenticated;
GRANT ALL ON public.aicis_hypothesis_evaluation_attempts TO service_role;

DROP POLICY IF EXISTS "Operators inspect hypothesis evaluation attempts"
  ON public.aicis_hypothesis_evaluation_attempts;
CREATE POLICY "Operators inspect hypothesis evaluation attempts"
  ON public.aicis_hypothesis_evaluation_attempts FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'operator'::app_role)
  );

DROP POLICY IF EXISTS "Service manages hypothesis evaluation attempts"
  ON public.aicis_hypothesis_evaluation_attempts;
CREATE POLICY "Service manages hypothesis evaluation attempts"
  ON public.aicis_hypothesis_evaluation_attempts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Temporal assessment: invalid/unknown timing must not become numeric confidence.
-- ---------------------------------------------------------------------------
ALTER TABLE public.aicis_temporal_relations
  ALTER COLUMN confidence DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS relation_semantics text;

UPDATE public.aicis_temporal_relations
SET confidence_semantics = 'legacy_numeric_semantics_unverified'
WHERE confidence IS NOT NULL AND confidence_semantics IS NULL;

UPDATE public.aicis_temporal_relations
SET relation_semantics = 'deterministic_timestamp_ordering_legacy'
WHERE relation_semantics IS NULL;

-- ---------------------------------------------------------------------------
-- Documentation: numeric fields are not self-authenticating probabilities.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.aicis_evidence_claims.confidence IS
  'Nullable numeric confidence supplied or derived by a named method. NULL means unknown/not quantified. Inspect confidence_semantics before interpretation.';
COMMENT ON COLUMN public.aicis_world_relationships.confidence IS
  'Nullable relationship confidence. NULL means unknown/not quantified; never substitute a neutral-looking default. Inspect confidence_semantics.';
COMMENT ON COLUMN public.aicis_cognitive_events.confidence IS
  'Nullable confidence in an event assessment. Deterministic derivation success is not epistemic confidence. Inspect confidence_semantics.';
COMMENT ON COLUMN public.aicis_hypotheses.confidence IS
  'Nullable hypothesis belief value. For truth-floor writers this is never an empirical probability unless explicitly proven by confidence_semantics.';
COMMENT ON COLUMN public.aicis_hypothesis_set_members.prior IS
  'Nullable subjective prior. Omitted prior remains NULL; no automatic 0.5 prior is created.';
COMMENT ON COLUMN public.aicis_hypothesis_evidence.reliability IS
  'Nullable explicitly supplied quantitative evidence reliability. Qualitative evidence may remain NULL.';
COMMENT ON COLUMN public.aicis_hypothesis_evidence.likelihood_given_hypothesis IS
  'Nullable explicitly supplied subjective likelihood assumption P(E|H); not inferred from stance.';
COMMENT ON COLUMN public.aicis_hypothesis_evidence.likelihood_given_alternative IS
  'Nullable explicitly supplied subjective likelihood assumption P(E|alternative); not inferred from stance.';
COMMENT ON COLUMN public.aicis_temporal_relations.confidence IS
  'Nullable confidence associated with timing inputs. Unknown/invalid timing yields NULL rather than a fabricated low confidence number.';
