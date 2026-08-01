-- 1. Partial indexes to eliminate statement timeouts in signal processing pipelines
CREATE INDEX IF NOT EXISTS idx_gs_pending_country_extraction
  ON public.global_signals (first_detected_at DESC)
  WHERE country_extracted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_gs_pending_geocode
  ON public.global_signals (first_detected_at DESC)
  WHERE geocoded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_gs_failed_geocode
  ON public.global_signals (first_detected_at DESC)
  WHERE geo_method = 'failed';

CREATE INDEX IF NOT EXISTS idx_gs_pending_language_route
  ON public.global_signals (first_detected_at DESC)
  WHERE language_routed_at IS NULL;

-- 2. Allow official multilateral source types rejected by LRIL ingestion
ALTER TABLE public.aicis_raw_local_signals
  DROP CONSTRAINT IF EXISTS aicis_raw_local_signals_source_type_check;

ALTER TABLE public.aicis_raw_local_signals
  ADD CONSTRAINT aicis_raw_local_signals_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'news','gov','ngo','remote','proxy','aggregator','social','sensor',
    'un','intergov','academic','official'
  ]));