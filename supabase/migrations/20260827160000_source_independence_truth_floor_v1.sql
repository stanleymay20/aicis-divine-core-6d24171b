-- AICIS Source Lineage & Independence Truth Floor v1
--
-- Distinct URLs, publishers, source IDs or domains are not evidence of independent
-- origins. Dependence may be established by explicit lineage, exact duplicate
-- evidence hashes or declared syndication. Independence is issued only when the
-- complete evaluated source set has explicit, non-conflicting lineage evidence.

ALTER TABLE public.aicis_evidence_claims
  ADD COLUMN IF NOT EXISTS source_record_key text,
  ADD COLUMN IF NOT EXISTS source_origin_key text,
  ADD COLUMN IF NOT EXISTS source_lineage_status text,
  ADD COLUMN IF NOT EXISTS source_lineage_method text,
  ADD COLUMN IF NOT EXISTS syndication_key text,
  ADD COLUMN IF NOT EXISTS upstream_source_record_keys text[],
  ADD COLUMN IF NOT EXISTS source_lineage_evidence jsonb;

UPDATE public.aicis_evidence_claims
SET source_lineage_status = 'unknown'
WHERE source_lineage_status IS NULL;

ALTER TABLE public.aicis_evidence_claims
  ALTER COLUMN source_lineage_status SET DEFAULT 'unknown',
  ALTER COLUMN source_lineage_status SET NOT NULL,
  ADD CONSTRAINT aicis_evidence_claims_source_lineage_status_v1
    CHECK (source_lineage_status IN ('unknown','verified_origin','verified_derived')) NOT VALID,
  ADD CONSTRAINT aicis_evidence_claims_verified_lineage_requirements_v1
    CHECK (
      source_lineage_status = 'unknown'
      OR (
        source_record_key IS NOT NULL
        AND btrim(source_record_key) <> ''
        AND source_origin_key IS NOT NULL
        AND btrim(source_origin_key) <> ''
        AND source_lineage_method IS NOT NULL
        AND btrim(source_lineage_method) <> ''
      )
    ) NOT VALID;

CREATE INDEX IF NOT EXISTS aicis_evidence_claims_source_record_key_idx
  ON public.aicis_evidence_claims(source_record_key)
  WHERE source_record_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS aicis_evidence_claims_source_origin_key_idx
  ON public.aicis_evidence_claims(source_origin_key)
  WHERE source_origin_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS aicis_evidence_claims_syndication_key_idx
  ON public.aicis_evidence_claims(syndication_key)
  WHERE syndication_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.aicis_source_independence_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN (
    'claim_set','relationship','hypothesis','narrative','cascade','forecast'
  )),
  target_key text NOT NULL CHECK (btrim(target_key) <> ''),
  claim_ids uuid[] NOT NULL,
  source_count integer NOT NULL CHECK (source_count >= 0),
  deduplicated_source_count integer NOT NULL CHECK (deduplicated_source_count >= 0),
  lineage_status text NOT NULL CHECK (lineage_status IN (
    'not_assessed','partial','complete','conflicted'
  )),
  known_origin_count integer NOT NULL CHECK (known_origin_count >= 0),
  independent_origin_count integer CHECK (
    independent_origin_count IS NULL OR independent_origin_count >= 0
  ),
  lineage_coverage numeric NOT NULL CHECK (lineage_coverage >= 0 AND lineage_coverage <= 1),
  corroboration_status text NOT NULL CHECK (corroboration_status IN (
    'not_established','established','conflicted'
  )),
  method text NOT NULL CHECK (btrim(method) <> ''),
  semantics text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  assessed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aicis_source_independence_target_idx
  ON public.aicis_source_independence_assessments(target_type, target_key, assessed_at DESC);
CREATE INDEX IF NOT EXISTS aicis_source_independence_status_idx
  ON public.aicis_source_independence_assessments(lineage_status, assessed_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_source_independence_assessment_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'aicis_source_independence_assessments is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_source_independence_assessment_immutable_v1
  ON public.aicis_source_independence_assessments;
CREATE TRIGGER trg_source_independence_assessment_immutable_v1
BEFORE UPDATE OR DELETE ON public.aicis_source_independence_assessments
FOR EACH ROW EXECUTE FUNCTION public.prevent_source_independence_assessment_mutation_v1();

ALTER TABLE public.aicis_source_independence_assessments ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.aicis_source_independence_assessments TO authenticated;
GRANT ALL ON public.aicis_source_independence_assessments TO service_role;

DROP POLICY IF EXISTS "Operators inspect source independence assessments"
  ON public.aicis_source_independence_assessments;
CREATE POLICY "Operators inspect source independence assessments"
ON public.aicis_source_independence_assessments FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'admin'::app_role)
  OR public.has_role(auth.uid(),'operator'::app_role)
);

DROP POLICY IF EXISTS "Service appends source independence assessments"
  ON public.aicis_source_independence_assessments;
CREATE POLICY "Service appends source independence assessments"
ON public.aicis_source_independence_assessments FOR INSERT TO service_role
WITH CHECK (true);

COMMENT ON COLUMN public.aicis_evidence_claims.source_lineage_status IS
  'unknown unless explicit evidence establishes this source record as a verified origin or a verified derivative of an origin.';
COMMENT ON COLUMN public.aicis_evidence_claims.source_origin_key IS
  'Explicit origin-cluster key supported by source_lineage_method/evidence. Missing origin lineage must never be inferred from a distinct publisher or URL.';
COMMENT ON COLUMN public.aicis_evidence_claims.syndication_key IS
  'Optional explicit shared-story/wire/syndication identifier. Equality can establish dependence, not independence.';
COMMENT ON TABLE public.aicis_source_independence_assessments IS
  'Append-only source-lineage assessments. independent_origin_count remains NULL unless lineage_status=complete and no lineage conflict exists.';
