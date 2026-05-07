
CREATE TABLE IF NOT EXISTS public.aicis_relevance_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID,
  organization_id UUID,
  signal_title TEXT,
  signal_summary TEXT,
  source TEXT,
  country TEXT,
  domain TEXT,
  severity TEXT,
  confidence NUMERIC,
  affected_entities JSONB DEFAULT '[]'::jsonb,
  organization_context JSONB DEFAULT '{}'::jsonb,
  relevance_score NUMERIC,
  relevance_tier TEXT,
  explanation TEXT,
  why_this_matters TEXT,
  recommended_action TEXT,
  confidence_score NUMERIC,
  model_used TEXT,
  prompt_version TEXT DEFAULT 'v1',
  user_feedback TEXT,
  feedback_at TIMESTAMPTZ,
  feedback_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_relevance_signal ON public.aicis_relevance_evaluations(signal_id);
CREATE INDEX IF NOT EXISTS idx_relevance_org ON public.aicis_relevance_evaluations(organization_id);
CREATE INDEX IF NOT EXISTS idx_relevance_created ON public.aicis_relevance_evaluations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_relevance_tier ON public.aicis_relevance_evaluations(relevance_tier);

ALTER TABLE public.aicis_relevance_evaluations ENABLE ROW LEVEL SECURITY;

-- View: any authenticated user can read evaluations for their org or org-less (global) ones
CREATE POLICY "relevance_select_own_org_or_global"
ON public.aicis_relevance_evaluations
FOR SELECT
TO authenticated
USING (
  organization_id IS NULL
  OR EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.org_id = aicis_relevance_evaluations.organization_id
      AND om.user_id = auth.uid()
  )
);

-- Insert: service role only
CREATE POLICY "relevance_insert_service_only"
ON public.aicis_relevance_evaluations
FOR INSERT
TO authenticated
WITH CHECK (auth.role() = 'service_role');

-- Update: authenticated users can update feedback fields on rows they can view
CREATE POLICY "relevance_update_feedback"
ON public.aicis_relevance_evaluations
FOR UPDATE
TO authenticated
USING (
  organization_id IS NULL
  OR EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.org_id = aicis_relevance_evaluations.organization_id
      AND om.user_id = auth.uid()
  )
)
WITH CHECK (
  organization_id IS NULL
  OR EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.org_id = aicis_relevance_evaluations.organization_id
      AND om.user_id = auth.uid()
  )
);
