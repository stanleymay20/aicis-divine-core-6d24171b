-- Ethics enforcement trigger: prevent execution of unreviewed critical decisions
CREATE OR REPLACE FUNCTION public.enforce_decision_ethics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Block execution of critical decisions without review
  IF NEW.status = 'executed' AND OLD.status IS DISTINCT FROM 'executed' THEN
    -- Critical decisions (severity >= 8) require dual approval
    IF NEW.severity_score >= 8 THEN
      IF NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL THEN
        RAISE EXCEPTION 'Critical decisions (severity >= 8) require review before execution. Decision % has severity %.',
          NEW.id, NEW.severity_score;
      END IF;
      IF NEW.approved_by IS NULL OR NEW.approved_at IS NULL THEN
        RAISE EXCEPTION 'Critical decisions require explicit approval. Decision % not approved.', NEW.id;
      END IF;
    END IF;
    
    -- All executed decisions must have been approved
    IF NEW.approved_by IS NULL AND NEW.severity_score >= 5 THEN
      RAISE EXCEPTION 'Decisions with severity >= 5 require approval before execution. Decision % has severity %.',
        NEW.id, NEW.severity_score;
    END IF;
  END IF;

  -- Auto-flag low confidence decisions
  IF NEW.confidence IS NOT NULL AND NEW.confidence < 0.4 AND NEW.status = 'pending' THEN
    NEW.review_notes = COALESCE(NEW.review_notes, '') || 
      E'\n[AUTO-FLAG] Low confidence (' || ROUND(NEW.confidence::numeric, 2) || ') — requires manual review.';
  END IF;

  -- Auto-set execution timestamp
  IF NEW.status = 'executed' AND OLD.status IS DISTINCT FROM 'executed' AND NEW.executed_at IS NULL THEN
    NEW.executed_at = NOW();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_decision_ethics_trigger
  BEFORE UPDATE ON public.adi_decisions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_decision_ethics();

-- Create ethics review log for audit trail
CREATE TABLE IF NOT EXISTS public.ethics_review_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  decision_id UUID REFERENCES public.adi_decisions(id) ON DELETE CASCADE,
  reviewer_id UUID,
  review_type TEXT NOT NULL DEFAULT 'standard',
  flags TEXT[],
  assessment TEXT,
  approved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ethics_review_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view ethics reviews"
  ON public.ethics_review_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert ethics reviews"
  ON public.ethics_review_log FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

CREATE INDEX idx_ethics_review_decision ON public.ethics_review_log (decision_id);
