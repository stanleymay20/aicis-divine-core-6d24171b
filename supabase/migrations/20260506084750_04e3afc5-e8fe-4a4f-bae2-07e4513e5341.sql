-- Signal-level recommendations (distinct from country/domain risk_action_recommendations)
CREATE TABLE IF NOT EXISTS public.signal_action_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES public.global_signals(id) ON DELETE CASCADE,
  category text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  affected_countries text[] NOT NULL DEFAULT '{}',
  affected_sectors text[] NOT NULL DEFAULT '{}',
  recommended_action text NOT NULL,
  rationale text,
  confidence numeric NOT NULL DEFAULT 0.6,
  urgency_score smallint,
  impact_score smallint,
  evidence_count integer NOT NULL DEFAULT 1,
  suggested_time_to_action text,
  generation_method text NOT NULL DEFAULT 'template',
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','reviewed','escalated','dismissed','executed','expired')),
  reviewed_at timestamptz,
  reviewed_by uuid,
  dismissed_at timestamptz,
  escalated_at timestamptz,
  -- outcome / learning hook (schema only)
  outcome_status text,
  outcome_observed_at timestamptz,
  recommendation_effectiveness_score numeric,
  outcome_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signal_id)
);

CREATE INDEX IF NOT EXISTS idx_sar_status ON public.signal_action_recommendations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sar_severity ON public.signal_action_recommendations(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sar_countries ON public.signal_action_recommendations USING GIN (affected_countries);

ALTER TABLE public.signal_action_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view signal recommendations"
  ON public.signal_action_recommendations FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Service role manages signal recommendations"
  ON public.signal_action_recommendations FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admin/operator update signal rec lifecycle"
  ON public.signal_action_recommendations FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'operator'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'operator'::app_role));

CREATE TRIGGER trg_sar_updated_at
  BEFORE UPDATE ON public.signal_action_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Per-user notification queue with dedup
CREATE TABLE IF NOT EXISTS public.risk_notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  recommendation_id uuid NOT NULL REFERENCES public.signal_action_recommendations(id) ON DELETE CASCADE,
  signal_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app','email','webhook')),
  dedup_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedup_key)
);

CREATE INDEX IF NOT EXISTS idx_rnq_status ON public.risk_notification_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_rnq_user ON public.risk_notification_queue(user_id, created_at DESC);

ALTER TABLE public.risk_notification_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own queued notifications"
  ON public.risk_notification_queue FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages risk notification queue"
  ON public.risk_notification_queue FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Quantivis-compatible view of pending recommendations with decision metadata
CREATE OR REPLACE VIEW public.quantivis_pending_recommendations
WITH (security_invoker = true) AS
SELECT
  r.id                            AS recommendation_id,
  r.signal_id,
  s.title                         AS signal_title,
  r.category,
  r.severity,
  r.affected_countries,
  r.affected_sectors,
  r.recommended_action,
  r.rationale,
  r.confidence,
  COALESCE(r.urgency_score, s.urgency_score)  AS urgency,
  COALESCE(r.impact_score, s.impact_score)    AS impact,
  r.evidence_count,
  COALESCE(r.affected_countries[1], NULL)     AS affected_market,
  r.suggested_time_to_action,
  r.status,
  r.created_at
FROM public.signal_action_recommendations r
JOIN public.global_signals s ON s.id = r.signal_id
WHERE r.status IN ('pending_review','reviewed','escalated');

GRANT SELECT ON public.quantivis_pending_recommendations TO authenticated, anon;