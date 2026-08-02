CREATE TABLE IF NOT EXISTS public.pipeline_replay_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lane text NOT NULL,
  mode text NOT NULL DEFAULT 'failed',
  requested_limit integer NOT NULL DEFAULT 0,
  requeued_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  notes text,
  triggered_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pipeline_replay_runs TO authenticated;
GRANT ALL ON public.pipeline_replay_runs TO service_role;

ALTER TABLE public.pipeline_replay_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view replay runs"
ON public.pipeline_replay_runs FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_replay_runs_started ON public.pipeline_replay_runs (started_at DESC);

CREATE TRIGGER trg_replay_runs_updated_at
BEFORE UPDATE ON public.pipeline_replay_runs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Requeue failed / dropped geocoding
CREATE OR REPLACE FUNCTION public.replay_requeue_geocode(p_limit integer DEFAULT 2000, p_require_country boolean DEFAULT true)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  WITH c AS (
    SELECT id FROM public.global_signals
    WHERE geo_method = 'failed'
      AND (NOT p_require_country OR (affected_countries IS NOT NULL AND affected_countries <> '{}'))
    ORDER BY first_detected_at DESC
    LIMIT GREATEST(p_limit, 0)
  )
  UPDATE public.global_signals g
     SET geocoded_at = NULL, geo_method = NULL, geo_confidence = NULL
    FROM c WHERE g.id = c.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Requeue failed translations
CREATE OR REPLACE FUNCTION public.replay_requeue_translation(p_limit integer DEFAULT 2000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  WITH c AS (
    SELECT id FROM public.global_signals
    WHERE translation_status = 'failed'
    ORDER BY first_detected_at DESC
    LIMIT GREATEST(p_limit, 0)
  )
  UPDATE public.global_signals g
     SET translation_status = 'pending', translated_at = NULL
    FROM c WHERE g.id = c.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Requeue country attribution for unattributed signals
CREATE OR REPLACE FUNCTION public.replay_requeue_country(p_limit integer DEFAULT 2000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  WITH c AS (
    SELECT id FROM public.global_signals
    WHERE (affected_countries IS NULL OR affected_countries = '{}')
      AND (country_extraction_status IS DISTINCT FROM 'pending')
    ORDER BY first_detected_at DESC
    LIMIT GREATEST(p_limit, 0)
  )
  UPDATE public.global_signals g
     SET country_extraction_status = 'pending', country_extracted_at = NULL
    FROM c WHERE g.id = c.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Requeue failed / stalled enrichment
CREATE OR REPLACE FUNCTION public.replay_requeue_enrichment(p_limit integer DEFAULT 1000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  WITH c AS (
    SELECT id FROM public.global_signals
    WHERE enrichment_status IN ('failed','error')
       OR (enrichment_status = 'processing' AND created_at < now() - interval '2 hours')
    ORDER BY first_detected_at DESC
    LIMIT GREATEST(p_limit, 0)
  )
  UPDATE public.global_signals g
     SET enrichment_status = 'pending', enrichment_error = NULL
    FROM c WHERE g.id = c.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Backlog summary for the replay console
CREATE OR REPLACE FUNCTION public.replay_backlog_summary()
RETURNS TABLE(lane text, stuck_count bigint, replayable_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'geocode',
         count(*) FILTER (WHERE geo_method = 'failed'),
         count(*) FILTER (WHERE geo_method = 'failed' AND affected_countries IS NOT NULL AND affected_countries <> '{}')
  FROM public.global_signals
  UNION ALL
  SELECT 'geocode_pending', count(*) FILTER (WHERE geocoded_at IS NULL), count(*) FILTER (WHERE geocoded_at IS NULL)
  FROM public.global_signals
  UNION ALL
  SELECT 'translation',
         count(*) FILTER (WHERE translation_status = 'failed'),
         count(*) FILTER (WHERE translation_status = 'failed')
  FROM public.global_signals
  UNION ALL
  SELECT 'country',
         count(*) FILTER (WHERE affected_countries IS NULL OR affected_countries = '{}'),
         count(*) FILTER (WHERE (affected_countries IS NULL OR affected_countries = '{}') AND country_extraction_status IS DISTINCT FROM 'pending')
  FROM public.global_signals
  UNION ALL
  SELECT 'enrichment',
         count(*) FILTER (WHERE enrichment_status IN ('failed','error') OR (enrichment_status='processing' AND created_at < now() - interval '2 hours')),
         count(*) FILTER (WHERE enrichment_status IN ('failed','error') OR (enrichment_status='processing' AND created_at < now() - interval '2 hours'))
  FROM public.global_signals
  UNION ALL
  SELECT 'ingestion_errors', count(*), count(*) FILTER (WHERE created_at > now() - interval '30 days')
  FROM public.ingestion_errors;
$$;

GRANT EXECUTE ON FUNCTION public.replay_backlog_summary() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.replay_requeue_geocode(integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.replay_requeue_translation(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.replay_requeue_country(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.replay_requeue_enrichment(integer) TO service_role;