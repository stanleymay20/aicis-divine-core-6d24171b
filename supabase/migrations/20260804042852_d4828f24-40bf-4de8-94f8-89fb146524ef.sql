CREATE INDEX IF NOT EXISTS idx_ledger_prev_lookup
  ON public.ledger_entries (block_number DESC NULLS LAST, created_at DESC);

CREATE OR REPLACE FUNCTION public.replay_requeue_country(p_limit integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '150s'
SET lock_timeout = '3s'
AS $$
DECLARE n integer;
BEGIN
  WITH c AS (
    SELECT id FROM public.global_signals
    WHERE (affected_countries IS NULL OR affected_countries = '{}')
      AND country_extraction_status IS DISTINCT FROM 'pending'
      AND (country_extracted_at IS NULL OR country_extracted_at < now() - interval '24 hours')
    ORDER BY first_detected_at DESC
    LIMIT GREATEST(p_limit, 0)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.global_signals g
     SET country_extraction_status = 'pending', country_extracted_at = NULL
    FROM c WHERE g.id = c.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.replay_requeue_geocode(p_limit integer DEFAULT 5000, p_require_country boolean DEFAULT true)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '150s'
SET lock_timeout = '3s'
AS $$
DECLARE n integer;
BEGIN
  WITH c AS (
    SELECT id FROM public.global_signals
    WHERE geo_method = 'failed'
      AND (NOT p_require_country OR (affected_countries IS NOT NULL AND affected_countries <> '{}'))
    ORDER BY first_detected_at DESC
    LIMIT GREATEST(p_limit, 0)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.global_signals g
     SET geocoded_at = NULL, geo_method = NULL, geo_confidence = NULL
    FROM c WHERE g.id = c.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.replay_requeue_translation(p_limit integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '150s'
SET lock_timeout = '3s'
AS $$
DECLARE n integer;
BEGIN
  WITH c AS (
    SELECT id FROM public.global_signals
    WHERE translation_status = 'failed'
    ORDER BY first_detected_at DESC
    LIMIT GREATEST(p_limit, 0)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.global_signals g
     SET translation_status = 'pending'
    FROM c WHERE g.id = c.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.replay_requeue_enrichment(p_limit integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '150s'
SET lock_timeout = '3s'
AS $$
DECLARE n integer;
BEGIN
  WITH c AS (
    SELECT id FROM public.global_signals
    WHERE enrichment_status IN ('failed','error')
       OR (enrichment_status = 'processing' AND created_at < now() - interval '2 hours')
    ORDER BY first_detected_at DESC
    LIMIT GREATEST(p_limit, 0)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.global_signals g
     SET enrichment_status = 'pending', enrichment_error = NULL
    FROM c WHERE g.id = c.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;