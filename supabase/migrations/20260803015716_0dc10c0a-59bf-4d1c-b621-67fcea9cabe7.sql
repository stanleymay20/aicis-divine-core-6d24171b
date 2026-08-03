CREATE INDEX IF NOT EXISTS idx_gs_replay_country_queue
  ON public.global_signals (first_detected_at DESC)
  WHERE (affected_countries IS NULL OR affected_countries = '{}')
    AND country_extraction_status IS DISTINCT FROM 'pending';

CREATE INDEX IF NOT EXISTS idx_gs_replay_translation_queue
  ON public.global_signals (first_detected_at DESC)
  WHERE translation_status = 'failed';

ALTER FUNCTION public.replay_requeue_country(integer) SET statement_timeout TO '150s';
ALTER FUNCTION public.replay_requeue_translation(integer) SET statement_timeout TO '150s';
ALTER FUNCTION public.replay_requeue_enrichment(integer) SET statement_timeout TO '150s';
ALTER FUNCTION public.replay_backlog_summary() SET statement_timeout TO '60s';