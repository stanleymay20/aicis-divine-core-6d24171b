
ALTER TABLE public.global_signals
  ADD COLUMN IF NOT EXISTS detection_latency_seconds integer,
  ADD COLUMN IF NOT EXISTS processing_latency_seconds integer,
  ADD COLUMN IF NOT EXISTS canonicalization_latency_seconds integer,
  ADD COLUMN IF NOT EXISTS last_pipeline_stage text,
  ADD COLUMN IF NOT EXISTS pipeline_completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_signals_last_pipeline_stage
  ON public.global_signals (last_pipeline_stage);

CREATE INDEX IF NOT EXISTS idx_signals_breaking_now
  ON public.global_signals (canonical_event_status, urgency_score DESC, first_detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_signals_pipeline_completed
  ON public.global_signals (pipeline_completed_at DESC);
