-- AICIS Intelligence Source & Evidence Fabric v1
-- CONTROLLED SCHEMA CANDIDATE ONLY.
-- This file is intentionally a non-migration schema candidate and does not deploy anything.
--
-- Purpose:
--   preserve immutable evidence identity and lineage from source artifact -> transform -> claim
--   -> assessment -> normalized/intelligence fact without inventing trust, confidence, or time.
--
-- Core rules:
--   * unknown numeric confidence/reliability stays NULL;
--   * legacy provenance metadata is not automatically verified;
--   * content hashes use SHA-256 and source revisions are append-only;
--   * knowledge time is explicit and fail-closed;
--   * extraction/derivation activities are independently attributable;
--   * assessment evidence sets are cryptographically bound to explicit artifact manifests;
--   * source corroboration counts governed origin groups, not merely distinct URLs/records;
--   * C2PA/STIX/OpenLineage/W3C PROV interoperability metadata never substitutes for truth.

CREATE TABLE IF NOT EXISTS public.aicis_evidence_artifacts_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL,
  source_independence_key text,
  source_provider_key text REFERENCES public.data_provider_registry(provider_key),
  source_class text NOT NULL CHECK (source_class IN (
    'primary_official',
    'structured_dataset',
    'sensor_observation',
    'scientific_publication',
    'intergovernmental',
    'ngo_report',
    'commercial_intelligence',
    'news_media',
    'social_media',
    'cyber_threat_feed',
    'human_report',
    'derived_internal',
    'other'
  )),
  source_record_id text,
  source_uri text,
  canonical_uri text,
  source_license text,
  media_type text,
  artifact_sha256 text NOT NULL CHECK (artifact_sha256 ~ '^[0-9a-fA-F]{64}$'),
  artifact_bytes bigint CHECK (artifact_bytes IS NULL OR artifact_bytes >= 0),
  raw_payload_id uuid REFERENCES public.provider_raw_payloads(id),
  revision_id text,
  supersedes_artifact_id uuid REFERENCES public.aicis_evidence_artifacts_v1(id),
  valid_time_start timestamptz,
  valid_time_end timestamptz,
  published_at timestamptz,
  retrieved_at timestamptz NOT NULL,
  first_observed_at timestamptz NOT NULL,
  knowledge_time timestamptz,
  knowledge_time_status text NOT NULL DEFAULT 'unverified' CHECK (knowledge_time_status IN (
    'unverified',
    'verified_leakage_safe',
    'rejected_leakage_risk'
  )),
  knowledge_time_verified_at timestamptz,
  c2pa_status text NOT NULL DEFAULT 'not_checked' CHECK (c2pa_status IN (
    'not_checked',
    'not_applicable',
    'manifest_verified',
    'manifest_invalid',
    'manifest_present_unverified'
  )),
  c2pa_manifest_sha256 text CHECK (
    c2pa_manifest_sha256 IS NULL OR c2pa_manifest_sha256 ~ '^[0-9a-fA-F]{64}$'
  ),
  stix_object_id text,
  synthetic boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_independence_key IS NULL OR length(btrim(source_independence_key)) > 0),
  CHECK (valid_time_end IS NULL OR valid_time_start IS NULL OR valid_time_end >= valid_time_start),
  CHECK (published_at IS NULL OR knowledge_time IS NULL OR published_at <= knowledge_time),
  CHECK (knowledge_time IS NULL OR knowledge_time <= retrieved_at),
  CHECK (knowledge_time IS NULL OR knowledge_time <= first_observed_at),
  CHECK (knowledge_time_verified_at IS NULL OR knowledge_time IS NULL OR knowledge_time_verified_at >= knowledge_time),
  CHECK (
    knowledge_time_status <> 'verified_leakage_safe'
    OR (knowledge_time IS NOT NULL AND knowledge_time_verified_at IS NOT NULL)
  ),
  CHECK (
    c2pa_status <> 'manifest_verified'
    OR c2pa_manifest_sha256 IS NOT NULL
  ),
  CHECK (supersedes_artifact_id IS NULL OR supersedes_artifact_id <> id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_aicis_evidence_artifact_revision_v1
  ON public.aicis_evidence_artifacts_v1(artifact_sha256, source_id, revision_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_aicis_evidence_artifacts_source_v1
  ON public.aicis_evidence_artifacts_v1(source_id, published_at DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aicis_evidence_artifacts_independence_v1
  ON public.aicis_evidence_artifacts_v1(source_independence_key)
  WHERE source_independence_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_aicis_evidence_artifacts_hash_v1
  ON public.aicis_evidence_artifacts_v1(artifact_sha256);
CREATE INDEX IF NOT EXISTS idx_aicis_evidence_artifacts_knowledge_v1
  ON public.aicis_evidence_artifacts_v1(knowledge_time_status, knowledge_time);

CREATE TABLE IF NOT EXISTS public.aicis_evidence_transform_runs_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transform_type text NOT NULL CHECK (transform_type IN (
    'deterministic_code',
    'rule_based',
    'self_hosted_model',
    'external_model',
    'human',
    'manual_import'
  )),
  producer text NOT NULL,
  producer_version text,
  code_sha256 text CHECK (code_sha256 IS NULL OR code_sha256 ~ '^[0-9a-fA-F]{64}$'),
  model_id text,
  model_revision text CHECK (model_revision IS NULL OR model_revision ~ '^[0-9a-fA-F]{40}$'),
  model_artifact_lock_sha256 text CHECK (
    model_artifact_lock_sha256 IS NULL OR model_artifact_lock_sha256 ~ '^[0-9a-fA-F]{64}$'
  ),
  external_model_provider text,
  prompt_sha256 text CHECK (prompt_sha256 IS NULL OR prompt_sha256 ~ '^[0-9a-fA-F]{64}$'),
  request_config_sha256 text CHECK (
    request_config_sha256 IS NULL OR request_config_sha256 ~ '^[0-9a-fA-F]{64}$'
  ),
  input_set_sha256 text NOT NULL CHECK (input_set_sha256 ~ '^[0-9a-fA-F]{64}$'),
  output_set_sha256 text NOT NULL CHECK (output_set_sha256 ~ '^[0-9a-fA-F]{64}$'),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  synthetic_output boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (completed_at >= started_at),
  CHECK (
    transform_type NOT IN ('deterministic_code', 'rule_based')
    OR code_sha256 IS NOT NULL
  ),
  CHECK (
    transform_type <> 'self_hosted_model'
    OR (
      model_id IS NOT NULL
      AND model_revision IS NOT NULL
      AND model_artifact_lock_sha256 IS NOT NULL
      AND prompt_sha256 IS NOT NULL
    )
  ),
  CHECK (
    transform_type <> 'external_model'
    OR (
      model_id IS NOT NULL
      AND external_model_provider IS NOT NULL
      AND prompt_sha256 IS NOT NULL
      AND request_config_sha256 IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_aicis_evidence_transform_created_v1
  ON public.aicis_evidence_transform_runs_v1(transform_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.aicis_evidence_claims_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_origin text NOT NULL CHECK (claim_origin IN (
    'direct_source_record',
    'extracted',
    'derived',
    'human_entered'
  )),
  statement text NOT NULL CHECK (length(btrim(statement)) > 0),
  claim_sha256 text NOT NULL CHECK (claim_sha256 ~ '^[0-9a-fA-F]{64}$'),
  subject_entity_id uuid REFERENCES public.canonical_entities(id),
  predicate text,
  object_entity_id uuid REFERENCES public.canonical_entities(id),
  object_value jsonb,
  epistemic_status text NOT NULL CHECK (epistemic_status IN (
    'observed',
    'derived',
    'inferred',
    'unverified',
    'contradicted'
  )),
  confidence numeric CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  confidence_semantics text,
  occurred_at timestamptz,
  valid_from timestamptz,
  valid_to timestamptz,
  transform_run_id uuid REFERENCES public.aicis_evidence_transform_runs_v1(id),
  synthetic boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  CHECK (
    confidence IS NULL OR (
      confidence_semantics IS NOT NULL
      AND length(btrim(confidence_semantics)) > 0
      AND confidence_semantics !~* '(legacy|unknown|unspecified|unverified|not_quantified)'
    )
  ),
  CHECK (
    claim_origin NOT IN ('extracted', 'derived')
    OR transform_run_id IS NOT NULL
  ),
  UNIQUE (claim_sha256)
);

CREATE INDEX IF NOT EXISTS idx_aicis_evidence_claims_subject_v1
  ON public.aicis_evidence_claims_v1(subject_entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aicis_evidence_claims_status_v1
  ON public.aicis_evidence_claims_v1(epistemic_status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.aicis_evidence_claim_artifacts_v1 (
  claim_id uuid NOT NULL REFERENCES public.aicis_evidence_claims_v1(id),
  artifact_id uuid NOT NULL REFERENCES public.aicis_evidence_artifacts_v1(id),
  relationship text NOT NULL CHECK (relationship IN (
    'source_of',
    'supports',
    'contradicts',
    'mentions',
    'context'
  )),
  source_locator jsonb NOT NULL DEFAULT '{}'::jsonb,
  excerpt_sha256 text CHECK (excerpt_sha256 IS NULL OR excerpt_sha256 ~ '^[0-9a-fA-F]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (claim_id, artifact_id, relationship)
);

CREATE INDEX IF NOT EXISTS idx_aicis_evidence_claim_artifacts_artifact_v1
  ON public.aicis_evidence_claim_artifacts_v1(artifact_id, relationship);

CREATE TABLE IF NOT EXISTS public.aicis_evidence_claim_assessments_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.aicis_evidence_claims_v1(id),
  assessment_status text NOT NULL CHECK (assessment_status IN (
    'verified',
    'contradicted',
    'rejected',
    'insufficient_evidence',
    'superseded'
  )),
  assessment_method text NOT NULL CHECK (assessment_method IN (
    'direct_primary_source',
    'independent_source_corroboration',
    'structured_crosscheck',
    'human_review',
    'rule_based',
    'model_assisted'
  )),
  assessor_type text NOT NULL CHECK (assessor_type IN (
    'human',
    'deterministic_system',
    'model_assisted_system',
    'external_authority'
  )),
  assessor_id text NOT NULL,
  evidence_manifest jsonb NOT NULL CHECK (
    jsonb_typeof(evidence_manifest) = 'array'
    AND jsonb_array_length(evidence_manifest) >= 1
  ),
  evidence_set_sha256 text NOT NULL CHECK (evidence_set_sha256 ~ '^[0-9a-fA-F]{64}$'),
  evidence_artifact_count integer NOT NULL CHECK (evidence_artifact_count >= 1),
  independent_source_count integer NOT NULL CHECK (independent_source_count >= 1),
  assessment_knowledge_time timestamptz NOT NULL,
  confidence numeric CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  confidence_semantics text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  assessed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (assessment_knowledge_time <= assessed_at),
  CHECK (evidence_artifact_count = jsonb_array_length(evidence_manifest)),
  CHECK (independent_source_count <= evidence_artifact_count),
  CHECK (
    confidence IS NULL OR (
      confidence_semantics IS NOT NULL
      AND length(btrim(confidence_semantics)) > 0
      AND confidence_semantics !~* '(legacy|unknown|unspecified|unverified|not_quantified)'
    )
  ),
  CHECK (
    assessment_method <> 'independent_source_corroboration'
    OR independent_source_count >= 2
  )
);

CREATE INDEX IF NOT EXISTS idx_aicis_evidence_claim_assessments_claim_v1
  ON public.aicis_evidence_claim_assessments_v1(claim_id, assessed_at DESC);

CREATE TABLE IF NOT EXISTS public.aicis_evidence_fact_lineage_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_type text NOT NULL CHECK (fact_type IN (
    'normalized_event',
    'normalized_metric',
    'global_signal',
    'world_entity',
    'world_relationship',
    'forecast_resolution',
    'training_row'
  )),
  fact_id uuid NOT NULL,
  source_claim_id uuid REFERENCES public.aicis_evidence_claims_v1(id),
  source_artifact_id uuid REFERENCES public.aicis_evidence_artifacts_v1(id),
  transform_run_id uuid REFERENCES public.aicis_evidence_transform_runs_v1(id),
  lineage_role text NOT NULL CHECK (lineage_role IN (
    'source',
    'derived_from',
    'supports',
    'contradicts',
    'resolves'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_claim_id IS NOT NULL OR source_artifact_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_aicis_evidence_fact_lineage_v1
  ON public.aicis_evidence_fact_lineage_v1(
    fact_type,
    fact_id,
    source_claim_id,
    source_artifact_id,
    lineage_role
  ) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_aicis_evidence_fact_lineage_fact_v1
  ON public.aicis_evidence_fact_lineage_v1(fact_type, fact_id);

-- Legacy provenance is preserved for audit/migration, but it is explicitly not promoted
-- into verified Evidence Fabric state. In particular, old default confidence/quality values
-- are not carried into this compatibility view as admissible quantitative evidence.
CREATE OR REPLACE VIEW public.v_aicis_legacy_provenance_unverified_v1
WITH (security_invoker = true)
AS
SELECT
  dp.id AS legacy_provenance_id,
  dp.fact_type,
  dp.fact_id,
  dp.source_provider,
  dp.source_endpoint,
  dp.source_url,
  dp.source_license,
  dp.observed_at,
  dp.created_at,
  NULL::numeric AS admissible_confidence,
  NULL::numeric AS admissible_quality_score,
  'legacy_unverified'::text AS evidence_status,
  'Legacy data_provenance values require explicit Evidence Fabric re-admission; historical numeric defaults are not trusted.'::text AS evidence_warning
FROM public.data_provenance dp;

-- Append-only enforcement: corrections are represented by new revisions, claims,
-- assessments, or lineage edges. Historical evidence is never rewritten in place.
CREATE OR REPLACE FUNCTION public.aicis_evidence_append_only_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'AICIS Evidence Fabric v1 is append-only; create a new immutable record instead';
END;
$$;

CREATE TRIGGER trg_aicis_evidence_artifacts_append_only_v1
  BEFORE UPDATE OR DELETE ON public.aicis_evidence_artifacts_v1
  FOR EACH ROW EXECUTE FUNCTION public.aicis_evidence_append_only_v1();
CREATE TRIGGER trg_aicis_evidence_transform_runs_append_only_v1
  BEFORE UPDATE OR DELETE ON public.aicis_evidence_transform_runs_v1
  FOR EACH ROW EXECUTE FUNCTION public.aicis_evidence_append_only_v1();
CREATE TRIGGER trg_aicis_evidence_claims_append_only_v1
  BEFORE UPDATE OR DELETE ON public.aicis_evidence_claims_v1
  FOR EACH ROW EXECUTE FUNCTION public.aicis_evidence_append_only_v1();
CREATE TRIGGER trg_aicis_evidence_claim_artifacts_append_only_v1
  BEFORE UPDATE OR DELETE ON public.aicis_evidence_claim_artifacts_v1
  FOR EACH ROW EXECUTE FUNCTION public.aicis_evidence_append_only_v1();
CREATE TRIGGER trg_aicis_evidence_claim_assessments_append_only_v1
  BEFORE UPDATE OR DELETE ON public.aicis_evidence_claim_assessments_v1
  FOR EACH ROW EXECUTE FUNCTION public.aicis_evidence_append_only_v1();
CREATE TRIGGER trg_aicis_evidence_fact_lineage_append_only_v1
  BEFORE UPDATE OR DELETE ON public.aicis_evidence_fact_lineage_v1
  FOR EACH ROW EXECUTE FUNCTION public.aicis_evidence_append_only_v1();

ALTER TABLE public.aicis_evidence_artifacts_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_evidence_transform_runs_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_evidence_claims_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_evidence_claim_artifacts_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_evidence_claim_assessments_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_evidence_fact_lineage_v1 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.aicis_evidence_artifacts_v1 FROM anon, authenticated;
REVOKE ALL ON public.aicis_evidence_transform_runs_v1 FROM anon, authenticated;
REVOKE ALL ON public.aicis_evidence_claims_v1 FROM anon, authenticated;
REVOKE ALL ON public.aicis_evidence_claim_artifacts_v1 FROM anon, authenticated;
REVOKE ALL ON public.aicis_evidence_claim_assessments_v1 FROM anon, authenticated;
REVOKE ALL ON public.aicis_evidence_fact_lineage_v1 FROM anon, authenticated;
REVOKE ALL ON public.v_aicis_legacy_provenance_unverified_v1 FROM anon, authenticated;

GRANT SELECT, INSERT ON public.aicis_evidence_artifacts_v1 TO service_role;
GRANT SELECT, INSERT ON public.aicis_evidence_transform_runs_v1 TO service_role;
GRANT SELECT, INSERT ON public.aicis_evidence_claims_v1 TO service_role;
GRANT SELECT, INSERT ON public.aicis_evidence_claim_artifacts_v1 TO service_role;
GRANT SELECT, INSERT ON public.aicis_evidence_claim_assessments_v1 TO service_role;
GRANT SELECT, INSERT ON public.aicis_evidence_fact_lineage_v1 TO service_role;
GRANT SELECT ON public.v_aicis_legacy_provenance_unverified_v1 TO service_role;

-- End of controlled candidate. No migration/deployment is authorized by this file.