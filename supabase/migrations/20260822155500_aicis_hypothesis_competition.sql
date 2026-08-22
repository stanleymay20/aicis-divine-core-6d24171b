-- Phase 4: competing hypotheses, belief updates, temporal relations, and evidence requests.

CREATE TABLE IF NOT EXISTS public.aicis_hypothesis_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_entity_id uuid REFERENCES public.aicis_world_entities(id) ON DELETE SET NULL,
  question text NOT NULL CHECK (length(trim(question)) > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','retired')),
  leader_hypothesis_id uuid REFERENCES public.aicis_hypotheses(id) ON DELETE SET NULL,
  entropy numeric NOT NULL DEFAULT 1 CHECK (entropy >= 0 AND entropy <= 1),
  margin numeric NOT NULL DEFAULT 0 CHECK (margin >= 0 AND margin <= 1),
  unresolved boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS aicis_hypothesis_sets_open_idx
  ON public.aicis_hypothesis_sets (updated_at DESC) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.aicis_hypothesis_set_members (
  hypothesis_set_id uuid NOT NULL REFERENCES public.aicis_hypothesis_sets(id) ON DELETE CASCADE,
  hypothesis_id uuid NOT NULL REFERENCES public.aicis_hypotheses(id) ON DELETE CASCADE,
  prior numeric NOT NULL DEFAULT 0.5 CHECK (prior > 0 AND prior < 1),
  normalized_probability numeric CHECK (normalized_probability IS NULL OR (normalized_probability >= 0 AND normalized_probability <= 1)),
  rank int,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hypothesis_set_id, hypothesis_id)
);

CREATE TABLE IF NOT EXISTS public.aicis_hypothesis_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hypothesis_id uuid NOT NULL REFERENCES public.aicis_hypotheses(id) ON DELETE CASCADE,
  claim_id uuid REFERENCES public.aicis_evidence_claims(id) ON DELETE CASCADE,
  cognitive_event_id uuid REFERENCES public.aicis_cognitive_events(id) ON DELETE CASCADE,
  stance text NOT NULL CHECK (stance IN ('supports','contradicts','context','discriminates')),
  reliability numeric NOT NULL DEFAULT 0.5 CHECK (reliability >= 0 AND reliability <= 1),
  likelihood_given_hypothesis numeric NOT NULL DEFAULT 0.5 CHECK (likelihood_given_hypothesis > 0 AND likelihood_given_hypothesis < 1),
  likelihood_given_alternative numeric NOT NULL DEFAULT 0.5 CHECK (likelihood_given_alternative > 0 AND likelihood_given_alternative < 1),
  description text,
  direct_observation boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (claim_id IS NOT NULL OR cognitive_event_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS aicis_hypothesis_evidence_hypothesis_idx
  ON public.aicis_hypothesis_evidence (hypothesis_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.aicis_hypothesis_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hypothesis_set_id uuid REFERENCES public.aicis_hypothesis_sets(id) ON DELETE CASCADE,
  hypothesis_id uuid NOT NULL REFERENCES public.aicis_hypotheses(id) ON DELETE CASCADE,
  prior numeric NOT NULL CHECK (prior >= 0 AND prior <= 1),
  posterior numeric NOT NULL CHECK (posterior >= 0 AND posterior <= 1),
  delta numeric NOT NULL,
  evidence_weight numeric NOT NULL DEFAULT 0 CHECK (evidence_weight >= 0),
  previous_status text,
  new_status text NOT NULL,
  reason jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aicis_hypothesis_updates_recent_idx
  ON public.aicis_hypothesis_updates (created_at DESC, hypothesis_id);

CREATE TABLE IF NOT EXISTS public.aicis_evidence_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hypothesis_set_id uuid REFERENCES public.aicis_hypothesis_sets(id) ON DELETE CASCADE,
  hypothesis_id uuid REFERENCES public.aicis_hypotheses(id) ON DELETE CASCADE,
  target text NOT NULL CHECK (target IN ('support','contradiction','mechanism','temporal','counterfactual')),
  priority numeric NOT NULL CHECK (priority >= 0 AND priority <= 1),
  rationale text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','searching','satisfied','cancelled')),
  satisfied_by_claim_id uuid REFERENCES public.aicis_evidence_claims(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aicis_evidence_requests_open_idx
  ON public.aicis_evidence_requests (priority DESC, created_at) WHERE status IN ('open','searching');

CREATE TABLE IF NOT EXISTS public.aicis_temporal_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cause_event_id uuid NOT NULL REFERENCES public.aicis_cognitive_events(id) ON DELETE CASCADE,
  effect_event_id uuid NOT NULL REFERENCES public.aicis_cognitive_events(id) ON DELETE CASCADE,
  relation text NOT NULL CHECK (relation IN ('before','after','overlaps','contains','during','simultaneous','unknown')),
  plausible_forward_causation boolean NOT NULL DEFAULT false,
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  lag_ms bigint,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cause_event_id, effect_event_id)
);
CREATE INDEX IF NOT EXISTS aicis_temporal_relations_effect_idx
  ON public.aicis_temporal_relations (effect_event_id, assessed_at DESC);

ALTER TABLE public.aicis_hypothesis_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_hypothesis_set_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_hypothesis_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_hypothesis_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_evidence_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_temporal_relations ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.aicis_hypothesis_sets, public.aicis_hypothesis_set_members,
  public.aicis_hypothesis_evidence, public.aicis_hypothesis_updates,
  public.aicis_evidence_requests, public.aicis_temporal_relations TO authenticated;
GRANT ALL ON public.aicis_hypothesis_sets, public.aicis_hypothesis_set_members,
  public.aicis_hypothesis_evidence, public.aicis_hypothesis_updates,
  public.aicis_evidence_requests, public.aicis_temporal_relations TO service_role;

CREATE POLICY "Operators inspect hypothesis sets" ON public.aicis_hypothesis_sets
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "Operators inspect hypothesis members" ON public.aicis_hypothesis_set_members
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "Operators inspect hypothesis evidence" ON public.aicis_hypothesis_evidence
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "Operators inspect hypothesis updates" ON public.aicis_hypothesis_updates
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "Operators inspect evidence requests" ON public.aicis_evidence_requests
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "Operators inspect temporal relations" ON public.aicis_temporal_relations
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));

CREATE POLICY "Service manages hypothesis sets" ON public.aicis_hypothesis_sets
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manages hypothesis members" ON public.aicis_hypothesis_set_members
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manages hypothesis evidence" ON public.aicis_hypothesis_evidence
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manages hypothesis updates" ON public.aicis_hypothesis_updates
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manages evidence requests" ON public.aicis_evidence_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service manages temporal relations" ON public.aicis_temporal_relations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE VIEW public.aicis_active_hypothesis_competitions
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.question,
  s.subject_entity_id,
  s.leader_hypothesis_id,
  s.entropy,
  s.margin,
  s.unresolved,
  s.updated_at,
  count(m.hypothesis_id) AS hypothesis_count
FROM public.aicis_hypothesis_sets s
LEFT JOIN public.aicis_hypothesis_set_members m ON m.hypothesis_set_id = s.id
WHERE s.status = 'open'
GROUP BY s.id;

GRANT SELECT ON public.aicis_active_hypothesis_competitions TO authenticated, service_role;
