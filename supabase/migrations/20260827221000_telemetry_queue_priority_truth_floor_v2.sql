-- AICIS Telemetry Queue Priority Truth Floor v2
--
-- Unknown operational priority must never jump ahead of assessed priority, and
-- omitted worker load/region must remain unknown rather than zero/GLOBAL.

ALTER TABLE public.telemetry_event_bus
  ALTER COLUMN source_region DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_legacy_priority_score numeric;

UPDATE public.telemetry_event_bus
SET
  reported_legacy_priority_score = COALESCE(reported_legacy_priority_score, priority_score),
  priority_score = NULL,
  priority_semantics = 'withheld_legacy_operational_priority_semantics_unverified'
WHERE priority_score IS NOT NULL
  AND (
    priority_semantics IS NULL
    OR priority_semantics LIKE '%legacy%'
    OR priority_semantics LIKE '%unverified%'
    OR priority_semantics LIKE '%unknown%'
  );

CREATE OR REPLACE FUNCTION public.enqueue_telemetry_event(
  p_event_type text,
  p_source_connector_key text,
  p_source_domain text,
  p_source_region text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_priority_score numeric DEFAULT NULL,
  p_shard_key integer DEFAULT 0,
  p_lineage jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_priority numeric;
BEGIN
  IF p_priority_score IS NOT NULL AND (p_priority_score < 0 OR p_priority_score > 100) THEN
    RAISE EXCEPTION 'p_priority_score must be 0-100 when supplied';
  END IF;

  v_priority := p_priority_score;
  v_key := md5(
    p_event_type || '|' ||
    COALESCE(p_source_connector_key,'') || '|' ||
    COALESCE(p_source_region,'UNSPECIFIED') || '|' ||
    p_payload::text
  );

  INSERT INTO public.telemetry_event_bus(
    event_key,event_type,source_connector_key,source_domain,source_region,
    shard_key,priority_score,priority_semantics,epistemic_status,event_status,
    payload,lineage,available_at,created_at,updated_at
  ) VALUES (
    v_key,p_event_type,p_source_connector_key,p_source_domain,p_source_region,
    p_shard_key,v_priority,
    CASE WHEN v_priority IS NULL THEN 'not_assessed' ELSE 'caller_supplied_operational_priority_not_probability' END,
    'operational_event','queued',p_payload,p_lineage,now(),now(),now()
  )
  ON CONFLICT(event_key) DO UPDATE SET
    priority_score = CASE
      WHEN public.telemetry_event_bus.priority_score IS NULL THEN EXCLUDED.priority_score
      WHEN EXCLUDED.priority_score IS NULL THEN public.telemetry_event_bus.priority_score
      ELSE GREATEST(public.telemetry_event_bus.priority_score, EXCLUDED.priority_score)
    END,
    priority_semantics = CASE
      WHEN EXCLUDED.priority_score IS NOT NULL THEN EXCLUDED.priority_semantics
      ELSE public.telemetry_event_bus.priority_semantics
    END,
    source_region = COALESCE(EXCLUDED.source_region, public.telemetry_event_bus.source_region),
    event_status = CASE
      WHEN public.telemetry_event_bus.event_status = 'failed' THEN 'queued'
      ELSE public.telemetry_event_bus.event_status
    END,
    updated_at = now();

  RETURN jsonb_build_object(
    'status','queued',
    'event_key',v_key,
    'priority_score',v_priority,
    'priority_semantics',CASE WHEN v_priority IS NULL THEN 'not_assessed' ELSE 'caller_supplied_operational_priority_not_probability' END,
    'source_region',p_source_region
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_telemetry_events(
  p_worker_key text,
  p_shard_key integer DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS SETOF public.telemetry_event_bus
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.telemetry_event_bus
    WHERE event_status = 'queued'
      AND available_at <= now()
      AND (p_shard_key IS NULL OR shard_key = p_shard_key)
    ORDER BY priority_score DESC NULLS LAST, created_at ASC
    LIMIT GREATEST(1,LEAST(p_limit,500))
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.telemetry_event_bus e
    SET
      event_status = 'processing',
      locked_by = p_worker_key,
      locked_at = now(),
      updated_at = now()
    FROM candidates c
    WHERE e.id = c.id
    RETURNING e.*
  )
  SELECT * FROM claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_telemetry_worker_heartbeat(
  p_worker_key text,
  p_shard_key integer,
  p_region_code text DEFAULT 'GLOBAL',
  p_current_load integer DEFAULT NULL,
  p_status text DEFAULT 'active'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.telemetry_shard_workers(
    worker_key, shard_key, region_code, worker_status, current_load, load_semantics,
    last_heartbeat_at, heartbeat_semantics, created_at, updated_at
  ) VALUES (
    p_worker_key,p_shard_key,p_region_code,p_status,p_current_load,
    CASE WHEN p_current_load IS NULL THEN 'not_reported' ELSE 'worker_reported_current_load_count' END,
    now(),'system_received_worker_heartbeat_time',now(),now()
  )
  ON CONFLICT(worker_key) DO UPDATE SET
    shard_key=EXCLUDED.shard_key,
    region_code=EXCLUDED.region_code,
    worker_status=EXCLUDED.worker_status,
    current_load=EXCLUDED.current_load,
    load_semantics=EXCLUDED.load_semantics,
    last_heartbeat_at=EXCLUDED.last_heartbeat_at,
    heartbeat_semantics=EXCLUDED.heartbeat_semantics,
    updated_at=now();

  RETURN jsonb_build_object(
    'status','heartbeat_recorded',
    'worker_key',p_worker_key,
    'current_load',p_current_load,
    'load_semantics',CASE WHEN p_current_load IS NULL THEN 'not_reported' ELSE 'worker_reported_current_load_count' END
  );
END;
$$;

CREATE OR REPLACE VIEW public.telemetry_backbone_command_view AS
SELECT
  event_status,
  epistemic_status,
  source_domain,
  source_region,
  shard_key,
  COUNT(*) AS event_count,
  ROUND(
    AVG(priority_score) FILTER (
      WHERE priority_score IS NOT NULL
        AND priority_semantics NOT LIKE '%legacy%'
        AND priority_semantics NOT LIKE '%unverified%'
        AND priority_semantics NOT LIKE '%unknown%'
        AND priority_semantics NOT LIKE '%withheld%'
    )::numeric,
    2
  ) AS avg_priority,
  CASE
    WHEN COUNT(priority_score) FILTER (
      WHERE priority_score IS NOT NULL
        AND priority_semantics NOT LIKE '%legacy%'
        AND priority_semantics NOT LIKE '%unverified%'
        AND priority_semantics NOT LIKE '%unknown%'
        AND priority_semantics NOT LIKE '%withheld%'
    ) = 0 THEN 'not_assessed'
    ELSE 'mean_governed_operational_queue_priority_not_probability'
  END AS avg_priority_semantics,
  MIN(created_at) AS oldest_event,
  MAX(created_at) AS newest_event
FROM public.telemetry_event_bus
GROUP BY event_status, epistemic_status, source_domain, source_region, shard_key
ORDER BY
  CASE event_status WHEN 'failed' THEN 1 WHEN 'queued' THEN 2 WHEN 'processing' THEN 3 ELSE 4 END,
  avg_priority DESC NULLS LAST;

COMMENT ON COLUMN public.telemetry_event_bus.reported_legacy_priority_score IS
  'Historical operational priority preserved when its semantics were absent/unverified. It is not used as governed queue priority.';
COMMENT ON FUNCTION public.claim_telemetry_events(text,integer,integer) IS
  'Claims queued events with assessed numeric priority first and unknown priority last; FIFO by creation time within priority.';
