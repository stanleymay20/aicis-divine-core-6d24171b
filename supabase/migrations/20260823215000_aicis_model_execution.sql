-- Phase 5 continuation: governed model execution and ensemble prediction memory.

CREATE TABLE IF NOT EXISTS public.aicis_model_execution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routing_decision_id uuid NOT NULL REFERENCES public.aicis_model_routing_decisions(id) ON DELETE CASCADE,
  cognitive_event_id uuid REFERENCES public.aicis_cognitive_events(id) ON DELETE SET NULL,
  input_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete','partial','failed','rejected')),
  high_consequence boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.aicis_model_execution_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_run_id uuid NOT NULL REFERENCES public.aicis_model_execution_runs(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.aicis_model_registry(id) ON DELETE RESTRICT,
  prediction_kind text NOT NULL CHECK (prediction_kind IN ('probability','numeric','label','structured')),
  output jsonb NOT NULL,
  probability numeric CHECK (probability IS NULL OR (probability >= 0 AND probability <= 1)),
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  latency_ms numeric NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  warning_count int NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  evidence_claim_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(execution_run_id, model_id)
);

CREATE TABLE IF NOT EXISTS public.aicis_ensemble_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_run_id uuid NOT NULL UNIQUE REFERENCES public.aicis_model_execution_runs(id) ON DELETE CASCADE,
  routing_decision_id uuid NOT NULL REFERENCES public.aicis_model_routing_decisions(id) ON DELETE CASCADE,
  cognitive_event_id uuid REFERENCES public.aicis_cognitive_events(id) ON DELETE SET NULL,
  subject_entity_id uuid REFERENCES public.aicis_world_entities(id) ON DELETE SET NULL,
  task text NOT NULL,
  horizon text,
  probability numeric CHECK (probability IS NULL OR (probability >= 0 AND probability <= 1)),
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  disagreement numeric NOT NULL DEFAULT 0 CHECK (disagreement >= 0 AND disagreement <= 1),
  spread numeric NOT NULL DEFAULT 0 CHECK (spread >= 0 AND spread <= 1),
  member_count int NOT NULL DEFAULT 0 CHECK (member_count >= 0),
  high_disagreement boolean NOT NULL DEFAULT false,
  epistemic_status text NOT NULL DEFAULT 'predicted' CHECK (epistemic_status IN ('predicted','simulated','unverified')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS aicis_model_execution_runs_route_idx ON public.aicis_model_execution_runs (routing_decision_id, started_at DESC);
CREATE INDEX IF NOT EXISTS aicis_ensemble_predictions_task_idx ON public.aicis_ensemble_predictions (task, issued_at DESC);
CREATE INDEX IF NOT EXISTS aicis_ensemble_predictions_disagreement_idx ON public.aicis_ensemble_predictions (high_disagreement, disagreement DESC);

ALTER TABLE public.aicis_model_execution_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_model_execution_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_ensemble_predictions ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.aicis_model_execution_runs, public.aicis_model_execution_outputs,
  public.aicis_ensemble_predictions TO authenticated;
GRANT ALL ON public.aicis_model_execution_runs, public.aicis_model_execution_outputs,
  public.aicis_ensemble_predictions TO service_role;

CREATE POLICY "Operators inspect model executions" ON public.aicis_model_execution_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "Operators inspect model outputs" ON public.aicis_model_execution_outputs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "Operators inspect ensemble predictions" ON public.aicis_ensemble_predictions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));

CREATE POLICY "Service manages model executions" ON public.aicis_model_execution_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manages model outputs" ON public.aicis_model_execution_outputs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manages ensemble predictions" ON public.aicis_ensemble_predictions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE VIEW public.aicis_recent_ensemble_predictions
WITH (security_invoker = true) AS
SELECT e.id, e.task, e.horizon, e.probability, e.confidence, e.disagreement,
       e.spread, e.member_count, e.high_disagreement, e.epistemic_status,
       e.issued_at, e.valid_until, e.cognitive_event_id, e.subject_entity_id
FROM public.aicis_ensemble_predictions e
ORDER BY e.issued_at DESC;
GRANT SELECT ON public.aicis_recent_ensemble_predictions TO authenticated, service_role;
