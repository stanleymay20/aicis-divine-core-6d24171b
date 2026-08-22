-- AICIS Planetary Cognitive Substrate v0
-- Durable world state for entities, claims, relationships, cognitive events,
-- hypotheses and prediction outcomes. Generated text is never trusted by default.

DO $$ BEGIN
  CREATE TYPE public.aicis_epistemic_status AS ENUM (
    'observed','derived','inferred','predicted','hypothesized',
    'simulated','unverified','contradicted'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.aicis_relationship_status AS ENUM (
    'proposed','verified','rejected','superseded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.aicis_world_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL CHECK (length(trim(canonical_name)) > 0),
  entity_type text NOT NULL CHECK (length(trim(entity_type)) > 0),
  external_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS aicis_world_entities_identity_idx
  ON public.aicis_world_entities (lower(entity_type), lower(canonical_name));
CREATE INDEX IF NOT EXISTS aicis_world_entities_type_idx
  ON public.aicis_world_entities (entity_type, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.aicis_entity_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES public.aicis_world_entities(id) ON DELETE CASCADE,
  alias text NOT NULL CHECK (length(trim(alias)) > 0),
  language_code text,
  source_id text,
  confidence numeric NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS aicis_entity_aliases_unique_idx
  ON public.aicis_entity_aliases (entity_id, lower(alias), coalesce(language_code, ''));
CREATE INDEX IF NOT EXISTS aicis_entity_alias_lookup_idx
  ON public.aicis_entity_aliases (lower(alias));

CREATE TABLE IF NOT EXISTS public.aicis_evidence_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement text NOT NULL CHECK (length(trim(statement)) > 0),
  subject_entity_id uuid REFERENCES public.aicis_world_entities(id) ON DELETE SET NULL,
  predicate text,
  object_entity_id uuid REFERENCES public.aicis_world_entities(id) ON DELETE SET NULL,
  object_value jsonb,
  epistemic_status public.aicis_epistemic_status NOT NULL DEFAULT 'unverified',
  confidence numeric NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  occurred_at timestamptz,
  valid_from timestamptz,
  valid_to timestamptz,
  source_id text NOT NULL,
  source_type text NOT NULL,
  source_uri text,
  source_published_at timestamptz,
  observed_at timestamptz NOT NULL DEFAULT now(),
  extractor text,
  extractor_version text,
  evidence_hash text,
  raw_excerpt text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS aicis_claims_subject_idx
  ON public.aicis_evidence_claims (subject_entity_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS aicis_claims_status_idx
  ON public.aicis_evidence_claims (epistemic_status, confidence DESC, observed_at DESC);
CREATE INDEX IF NOT EXISTS aicis_claims_source_idx
  ON public.aicis_evidence_claims (source_id, observed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS aicis_claims_evidence_hash_idx
  ON public.aicis_evidence_claims (evidence_hash)
  WHERE evidence_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.aicis_world_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_entity_id uuid NOT NULL REFERENCES public.aicis_world_entities(id) ON DELETE CASCADE,
  target_entity_id uuid NOT NULL REFERENCES public.aicis_world_entities(id) ON DELETE CASCADE,
  relationship_type text NOT NULL CHECK (length(trim(relationship_type)) > 0),
  status public.aicis_relationship_status NOT NULL DEFAULT 'proposed',
  epistemic_status public.aicis_epistemic_status NOT NULL DEFAULT 'unverified',
  strength numeric CHECK (strength IS NULL OR (strength >= 0 AND strength <= 1)),
  confidence numeric NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  valid_from timestamptz,
  valid_to timestamptz,
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_entity_id <> target_entity_id),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS aicis_relationship_identity_idx
  ON public.aicis_world_relationships
  (source_entity_id, target_entity_id, lower(relationship_type));
CREATE INDEX IF NOT EXISTS aicis_relationship_source_idx
  ON public.aicis_world_relationships (source_entity_id, status, confidence DESC);
CREATE INDEX IF NOT EXISTS aicis_relationship_target_idx
  ON public.aicis_world_relationships (target_entity_id, status, confidence DESC);
CREATE INDEX IF NOT EXISTS aicis_relationship_verified_idx
  ON public.aicis_world_relationships (relationship_type, confidence DESC)
  WHERE status = 'verified';

CREATE TABLE IF NOT EXISTS public.aicis_relationship_evidence (
  relationship_id uuid NOT NULL REFERENCES public.aicis_world_relationships(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES public.aicis_evidence_claims(id) ON DELETE CASCADE,
  stance text NOT NULL DEFAULT 'supports' CHECK (stance IN ('supports','contradicts','context')),
  weight numeric NOT NULL DEFAULT 1 CHECK (weight >= 0 AND weight <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (relationship_id, claim_id)
);
CREATE INDEX IF NOT EXISTS aicis_relationship_evidence_claim_idx
  ON public.aicis_relationship_evidence (claim_id, stance);

CREATE TABLE IF NOT EXISTS public.aicis_cognitive_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (length(trim(event_type)) > 0),
  epistemic_status public.aicis_epistemic_status NOT NULL DEFAULT 'unverified',
  confidence numeric NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  subject_entity_id uuid REFERENCES public.aicis_world_entities(id) ON DELETE SET NULL,
  correlation_id uuid,
  causation_id uuid,
  occurred_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  producer text NOT NULL CHECK (length(trim(producer)) > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aicis_cognitive_events_type_idx
  ON public.aicis_cognitive_events (event_type, observed_at DESC);
CREATE INDEX IF NOT EXISTS aicis_cognitive_events_subject_idx
  ON public.aicis_cognitive_events (subject_entity_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS aicis_cognitive_events_unprocessed_idx
  ON public.aicis_cognitive_events (observed_at)
  WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS aicis_cognitive_events_correlation_idx
  ON public.aicis_cognitive_events (correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.aicis_hypotheses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement text NOT NULL CHECK (length(trim(statement)) > 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','supported','weakened','refuted','retired')),
  confidence numeric NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  supporting_claim_ids uuid[] NOT NULL DEFAULT '{}',
  contradicting_claim_ids uuid[] NOT NULL DEFAULT '{}',
  assumptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS aicis_hypotheses_status_idx
  ON public.aicis_hypotheses (status, confidence DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.aicis_prediction_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_key text NOT NULL,
  model_name text NOT NULL,
  model_version text,
  predicted_probability numeric CHECK (
    predicted_probability IS NULL OR
    (predicted_probability >= 0 AND predicted_probability <= 1)
  ),
  predicted_value jsonb,
  horizon_at timestamptz NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  outcome_observed_at timestamptz,
  actual_outcome jsonb,
  brier_score numeric,
  absolute_error numeric,
  evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  graph_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (prediction_key, model_name, model_version, issued_at)
);
CREATE INDEX IF NOT EXISTS aicis_prediction_outcomes_pending_idx
  ON public.aicis_prediction_outcomes (horizon_at)
  WHERE actual_outcome IS NULL;
CREATE INDEX IF NOT EXISTS aicis_prediction_outcomes_model_idx
  ON public.aicis_prediction_outcomes (model_name, model_version, issued_at DESC);

-- RLS: raw cognition is operationally sensitive. Normal authenticated users can
-- inspect canonical entities and verified relationships; raw evidence/events,
-- hypotheses and outcome-learning records are restricted to admin/operator.
ALTER TABLE public.aicis_world_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_entity_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_evidence_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_world_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_relationship_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_cognitive_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_hypotheses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_prediction_outcomes ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.aicis_world_entities, public.aicis_entity_aliases,
  public.aicis_world_relationships TO authenticated;
GRANT SELECT ON public.aicis_evidence_claims, public.aicis_relationship_evidence,
  public.aicis_cognitive_events, public.aicis_hypotheses,
  public.aicis_prediction_outcomes TO authenticated;
GRANT ALL ON public.aicis_world_entities, public.aicis_entity_aliases,
  public.aicis_evidence_claims, public.aicis_world_relationships,
  public.aicis_relationship_evidence, public.aicis_cognitive_events,
  public.aicis_hypotheses, public.aicis_prediction_outcomes TO service_role;

CREATE POLICY "Authenticated users read world entities"
  ON public.aicis_world_entities FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users read entity aliases"
  ON public.aicis_entity_aliases FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users read verified relationships"
  ON public.aicis_world_relationships FOR SELECT TO authenticated
  USING (status = 'verified' AND epistemic_status NOT IN ('unverified','contradicted'));

CREATE POLICY "Operators inspect evidence claims"
  ON public.aicis_evidence_claims FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "Operators inspect relationship evidence"
  ON public.aicis_relationship_evidence FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "Operators inspect cognitive events"
  ON public.aicis_cognitive_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "Operators inspect hypotheses"
  ON public.aicis_hypotheses FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "Operators inspect prediction outcomes"
  ON public.aicis_prediction_outcomes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));

CREATE POLICY "Service role manages world entities"
  ON public.aicis_world_entities FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages entity aliases"
  ON public.aicis_entity_aliases FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages evidence claims"
  ON public.aicis_evidence_claims FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages relationships"
  ON public.aicis_world_relationships FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages relationship evidence"
  ON public.aicis_relationship_evidence FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages cognitive events"
  ON public.aicis_cognitive_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages hypotheses"
  ON public.aicis_hypotheses FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages prediction outcomes"
  ON public.aicis_prediction_outcomes FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Publicly consumable graph surface: only verified, non-contradicted edges.
CREATE OR REPLACE VIEW public.aicis_verified_graph AS
SELECT
  r.id,
  r.source_entity_id,
  s.canonical_name AS source_name,
  s.entity_type AS source_type,
  r.target_entity_id,
  t.canonical_name AS target_name,
  t.entity_type AS target_type,
  r.relationship_type,
  r.strength,
  r.confidence,
  r.epistemic_status,
  r.valid_from,
  r.valid_to,
  r.last_verified_at,
  r.metadata
FROM public.aicis_world_relationships r
JOIN public.aicis_world_entities s ON s.id = r.source_entity_id
JOIN public.aicis_world_entities t ON t.id = r.target_entity_id
WHERE r.status = 'verified'
  AND r.epistemic_status NOT IN ('unverified','contradicted');

GRANT SELECT ON public.aicis_verified_graph TO authenticated, service_role;
