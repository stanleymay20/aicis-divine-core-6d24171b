-- Phase 5: model registry, competency evidence, routing decisions, predictions and outcomes.

CREATE TABLE IF NOT EXISTS public.aicis_model_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key text NOT NULL,
  family text NOT NULL CHECK (family IN ('linear','tree','ann','cnn','rnn','lstm','temporal-transformer','gnn','vision-transformer','llm','multimodal')),
  provider text,
  version text NOT NULL,
  modalities text[] NOT NULL DEFAULT '{}',
  tasks text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  production_approved boolean NOT NULL DEFAULT false,
  artifact_uri text,
  artifact_hash text,
  training_data_hash text,
  training_cutoff timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(model_key, version)
);

CREATE TABLE IF NOT EXISTS public.aicis_model_competency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id uuid NOT NULL REFERENCES public.aicis_model_registry(id) ON DELETE CASCADE,
  domain text NOT NULL DEFAULT 'general',
  modality text NOT NULL,
  task text NOT NULL,
  sample_size int NOT NULL DEFAULT 0 CHECK (sample_size >= 0),
  competence numeric NOT NULL DEFAULT 0 CHECK (competence >= 0 AND competence <= 1),
  calibration numeric NOT NULL DEFAULT 0 CHECK (calibration >= 0 AND calibration <= 1),
  reliability numeric NOT NULL DEFAULT 0 CHECK (reliability >= 0 AND reliability <= 1),
  brier_score numeric,
  ece numeric,
  precision_score numeric,
  recall_score numeric,
  latency_ms_p95 numeric NOT NULL DEFAULT 0,
  cost_per_1k numeric,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  evaluation_dataset_hash text,
  UNIQUE(model_id, domain, modality, task)
);

CREATE TABLE IF NOT EXISTS public.aicis_model_routing_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id uuid,
  cognitive_event_id uuid REFERENCES public.aicis_cognitive_events(id) ON DELETE SET NULL,
  modality text NOT NULL,
  task text NOT NULL,
  domain text NOT NULL DEFAULT 'general',
  high_consequence boolean NOT NULL DEFAULT false,
  selected_model_ids uuid[] NOT NULL,
  candidate_scores jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_version text NOT NULL DEFAULT 'cortex-v1',
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.aicis_model_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routing_decision_id uuid REFERENCES public.aicis_model_routing_decisions(id) ON DELETE SET NULL,
  model_id uuid NOT NULL REFERENCES public.aicis_model_registry(id) ON DELETE RESTRICT,
  cognitive_event_id uuid REFERENCES public.aicis_cognitive_events(id) ON DELETE SET NULL,
  subject_entity_id uuid REFERENCES public.aicis_world_entities(id) ON DELETE SET NULL,
  task text NOT NULL,
  horizon text,
  prediction jsonb NOT NULL,
  probability numeric CHECK (probability IS NULL OR (probability >= 0 AND probability <= 1)),
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  issued_at timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  input_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.aicis_model_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id uuid NOT NULL REFERENCES public.aicis_model_predictions(id) ON DELETE CASCADE,
  observed_outcome jsonb NOT NULL,
  binary_outcome smallint CHECK (binary_outcome IN (0,1)),
  observed_at timestamptz NOT NULL,
  brier_score numeric,
  absolute_error numeric,
  evidence_claim_id uuid REFERENCES public.aicis_evidence_claims(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(prediction_id)
);

CREATE INDEX IF NOT EXISTS aicis_model_competency_route_idx ON public.aicis_model_competency (modality, task, competence DESC);
CREATE INDEX IF NOT EXISTS aicis_model_predictions_pending_idx ON public.aicis_model_predictions (valid_until, issued_at DESC);

ALTER TABLE public.aicis_model_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_model_competency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_model_routing_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_model_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_model_outcomes ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.aicis_model_registry, public.aicis_model_competency,
  public.aicis_model_routing_decisions, public.aicis_model_predictions,
  public.aicis_model_outcomes TO authenticated;
GRANT ALL ON public.aicis_model_registry, public.aicis_model_competency,
  public.aicis_model_routing_decisions, public.aicis_model_predictions,
  public.aicis_model_outcomes TO service_role;

CREATE POLICY "Operators inspect model registry" ON public.aicis_model_registry FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "Operators inspect model competency" ON public.aicis_model_competency FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "Operators inspect routing" ON public.aicis_model_routing_decisions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "Operators inspect model predictions" ON public.aicis_model_predictions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "Operators inspect model outcomes" ON public.aicis_model_outcomes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));

CREATE POLICY "Service manages model registry" ON public.aicis_model_registry FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manages model competency" ON public.aicis_model_competency FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manages routing" ON public.aicis_model_routing_decisions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manages model predictions" ON public.aicis_model_predictions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manages model outcomes" ON public.aicis_model_outcomes FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE VIEW public.aicis_model_cortex_health
WITH (security_invoker = true) AS
SELECT r.id, r.model_key, r.family, r.version, r.enabled, r.production_approved,
       c.domain, c.modality, c.task, c.sample_size, c.competence, c.calibration,
       c.reliability, c.brier_score, c.ece, c.latency_ms_p95, c.evaluated_at
FROM public.aicis_model_registry r
LEFT JOIN public.aicis_model_competency c ON c.model_id = r.id;
GRANT SELECT ON public.aicis_model_cortex_health TO authenticated, service_role;
