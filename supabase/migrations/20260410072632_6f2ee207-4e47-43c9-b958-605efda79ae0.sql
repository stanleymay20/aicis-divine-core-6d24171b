
CREATE TABLE public.signal_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  signal_id UUID,
  decision_id UUID,
  feedback_type TEXT NOT NULL DEFAULT 'confirmed',
  rating SMALLINT,
  comment TEXT,
  category TEXT,
  source_tier TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT signal_feedback_type_check CHECK (feedback_type IN ('confirmed', 'rejected', 'unclear')),
  CONSTRAINT signal_feedback_rating_check CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5))
);

ALTER TABLE public.signal_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view all feedback" ON public.signal_feedback FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create own feedback" ON public.signal_feedback FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own feedback" ON public.signal_feedback FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own feedback" ON public.signal_feedback FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_signal_feedback_signal ON public.signal_feedback(signal_id);
CREATE INDEX idx_signal_feedback_type ON public.signal_feedback(feedback_type);
CREATE INDEX idx_signal_feedback_created ON public.signal_feedback(created_at DESC);
