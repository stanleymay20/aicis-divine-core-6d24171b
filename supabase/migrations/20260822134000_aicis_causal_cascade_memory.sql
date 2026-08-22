-- AICIS Phase 3: causal assessments and systemic cascade memory.
-- These tables preserve the distinction between structural association and
-- evidence-backed causal support. Nothing here auto-promotes an LLM assertion.

CREATE TABLE IF NOT EXISTS public.aicis_causal_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL REFERENCES public.aicis_world_relationships(id) ON DELETE CASCADE,
  verdict text NOT NULL CHECK (verdict IN (
    'insufficient-evidence','associated','temporally-plausible',
    'mechanistically-supported','causally-supported','contradicted'
  )),
  causal_score numeric NOT NULL CHECK (causal_score >= 0 AND causal_score <= 1),
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  temporal_precedence numeric NOT NULL DEFAULT 0 CHECK (temporal_precedence >= 0 AND temporal_precedence <= 1),
  mechanism_support numeric NOT NULL DEFAULT 0 CHECK (mechanism_support >= 0 AND mechanism_support <= 1),
  evidence_diversity numeric NOT NULL DEFAULT 0 CHECK (evidence_diversity >= 0 AND evidence_diversity <= 1),
  contradiction_penalty numeric NOT NULL DEFAULT 0 CHECK (contradiction_penalty >= 0 AND contradiction_penalty <= 1),
  confounder_penalty numeric NOT NULL DEFAULT 0 CHECK (confounder_penalty >= 0 AND confounder_penalty <= 1),
  intervention_support numeric NOT NULL DEFAULT 0 CHECK (intervention_support >= 0 AND intervention_support <= 1),
  counterfactual_support numeric NOT NULL DEFAULT 0 CHECK (counterfactual_support >= 0 AND counterfactual_support <= 1),
  supporting_claim_ids uuid[] NOT NULL DEFAULT '{}',
  contradicting_claim_ids uuid[] NOT NULL DEFAULT '{}',
  mechanism_claim_ids uuid[] NOT NULL DEFAULT '{}',
  confounder_claim_ids uuid[] NOT NULL DEFAULT '{}',
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  method text NOT NULL DEFAULT 'aicis-evidence-causal-v1',
  assessed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS aicis_causal_assessments_relationship_idx
  ON public.aicis_causal_assessments (relationship_id, assessed_at DESC);
CREATE INDEX IF NOT EXISTS aicis_causal_assessments_verdict_idx
  ON public.aicis_causal_assessments (verdict, causal_score DESC, assessed_at DESC);

CREATE TABLE IF NOT EXISTS public.aicis_cascades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cascade_key text NOT NULL,
  origin_entity_id uuid NOT NULL REFERENCES public.aicis_world_entities(id) ON DELETE CASCADE,
  terminal_entity_id uuid REFERENCES public.aicis_world_entities(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN (
    'candidate','investigating','supported','weakened','refuted','resolved','retired'
  )),
  epistemic_status public.aicis_epistemic_status NOT NULL DEFAULT 'derived',
  systemic_score numeric NOT NULL CHECK (systemic_score >= 0 AND systemic_score <= 1),
  structural_confidence numeric NOT NULL CHECK (structural_confidence >= 0 AND structural_confidence <= 1),
  causal_confidence numeric CHECK (causal_confidence IS NULL OR (causal_confidence >= 0 AND causal_confidence <= 1)),
  hop_count int NOT NULL CHECK (hop_count >= 1),
  cross_domain_count int NOT NULL DEFAULT 0 CHECK (cross_domain_count >= 0),
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  graph_snapshot_id uuid REFERENCES public.aicis_graph_snapshots(id) ON DELETE SET NULL,
  provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (cascade_key, graph_snapshot_id)
);
CREATE INDEX IF NOT EXISTS aicis_cascades_status_idx
  ON public.aicis_cascades (status, systemic_score DESC, last_detected_at DESC);
CREATE INDEX IF NOT EXISTS aicis_cascades_origin_idx
  ON public.aicis_cascades (origin_entity_id, last_detected_at DESC);

CREATE TABLE IF NOT EXISTS public.aicis_cascade_steps (
  cascade_id uuid NOT NULL REFERENCES public.aicis_cascades(id) ON DELETE CASCADE,
  step_index int NOT NULL CHECK (step_index >= 0),
  relationship_id uuid NOT NULL REFERENCES public.aicis_world_relationships(id) ON DELETE RESTRICT,
  source_entity_id uuid NOT NULL REFERENCES public.aicis_world_entities(id) ON DELETE RESTRICT,
  target_entity_id uuid NOT NULL REFERENCES public.aicis_world_entities(id) ON DELETE RESTRICT,
  structural_confidence numeric NOT NULL CHECK (structural_confidence >= 0 AND structural_confidence <= 1),
  cumulative_confidence numeric NOT NULL CHECK (cumulative_confidence >= 0 AND cumulative_confidence <= 1),
  causal_assessment_id uuid REFERENCES public.aicis_causal_assessments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cascade_id, step_index)
);
CREATE INDEX IF NOT EXISTS aicis_cascade_steps_relationship_idx
  ON public.aicis_cascade_steps (relationship_id, cascade_id);

ALTER TABLE public.aicis_causal_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_cascades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_cascade_steps ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.aicis_causal_assessments, public.aicis_cascades, public.aicis_cascade_steps TO authenticated;
GRANT ALL ON public.aicis_causal_assessments, public.aicis_cascades, public.aicis_cascade_steps TO service_role;

CREATE POLICY "Operators inspect causal assessments"
  ON public.aicis_causal_assessments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));

CREATE POLICY "Authenticated users inspect supported cascades"
  ON public.aicis_cascades FOR SELECT TO authenticated
  USING (
    status = 'supported' AND
    epistemic_status NOT IN ('unverified','contradicted')
    OR public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'operator'::app_role)
  );

CREATE POLICY "Authenticated users inspect supported cascade steps"
  ON public.aicis_cascade_steps FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.aicis_cascades c
      WHERE c.id = cascade_id AND c.status = 'supported'
    )
    OR public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'operator'::app_role)
  );

CREATE POLICY "Service role manages causal assessments"
  ON public.aicis_causal_assessments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages cascades"
  ON public.aicis_cascades FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages cascade steps"
  ON public.aicis_cascade_steps FOR ALL TO service_role USING (true) WITH CHECK (true);

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
  c.graph_snapshot_id
FROM public.aicis_cascades c
JOIN public.aicis_world_entities origin ON origin.id = c.origin_entity_id
LEFT JOIN public.aicis_world_entities terminal ON terminal.id = c.terminal_entity_id
WHERE c.status = 'supported'
  AND c.epistemic_status NOT IN ('unverified','contradicted');

GRANT SELECT ON public.aicis_supported_cascades TO authenticated, service_role;
