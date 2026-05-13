-- Distributed Planetary Telemetry Backbone
-- Adds event-bus semantics, shard workers, replay/recovery, heartbeat scoring,
-- adaptive prioritization, and causal trigger hooks for planetary telemetry.

-- =====================================================
-- 1. Durable telemetry event bus
-- =====================================================
CREATE TABLE IF NOT EXISTS public.telemetry_event_bus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text UNIQUE NOT NULL,
  event_type text NOT NULL,
  source_connector_key text,
  source_domain text,
  source_region text DEFAULT 'GLOBAL',
  shard_key integer DEFAULT 0,
  priority_score numeric DEFAULT 50,
  event_status text DEFAULT 'queued',
  payload jsonb DEFAULT '{}'::jsonb,
  lineage jsonb DEFAULT '{}'::jsonb,
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 5,
  available_at timestamptz DEFAULT now(),
  locked_by text,
  locked_at timestamptz,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_event_bus_queue
ON public.telemetry_event_bus(event_status, available_at, priority_score DESC, created_at);

CREATE INDEX IF NOT EXISTS idx_telemetry_event_bus_shard
ON public.telemetry_event_bus(shard_key, event_status, priority_score DESC);

-- =====================================================
-- 2. Shard workers and heartbeats
-- =====================================================
CREATE TABLE IF NOT EXISTS public.telemetry_shard_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_key text UNIQUE NOT NULL,
  shard_key integer NOT NULL,
  region_code text DEFAULT 'GLOBAL',
  worker_type text DEFAULT 'telemetry-ingestion',
  worker_status text DEFAULT 'active',
  capacity_per_minute integer DEFAULT 100,
  last_heartbeat_at timestamptz DEFAULT now(),
  current_load integer DEFAULT 0,
  failure_count integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_workers_shard_status
ON public.telemetry_shard_workers(shard_key, worker_status, last_heartbeat_at DESC);

-- =====================================================
-- 3. Replay checkpoints
-- =====================================================
CREATE TABLE IF NOT EXISTS public.telemetry_replay_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkpoint_key text UNIQUE NOT NULL,
  connector_key text NOT NULL,
  shard_key integer DEFAULT 0,
  checkpoint_cursor text,
  checkpoint_time timestamptz,
  last_successful_event_key text,
  replay_status text DEFAULT 'healthy',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =====================================================
-- 4. Telemetry lineage records
-- =====================================================
CREATE TABLE IF NOT EXISTS public.telemetry_lineage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lineage_key text UNIQUE NOT NULL,
  event_key text,
  connector_key text,
  observation_id uuid,
  source_uri text,
  raw_hash text,
  normalized_hash text,
  transformation_steps jsonb DEFAULT '[]'::jsonb,
  trust_score numeric DEFAULT 70,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_lineage_event
ON public.telemetry_lineage_records(event_key, connector_key);

-- =====================================================
-- 5. Adaptive telemetry priority rules
-- =====================================================
CREATE TABLE IF NOT EXISTS public.telemetry_priority_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text UNIQUE NOT NULL,
  rule_name text NOT NULL,
  coverage_domain text,
  observation_type_pattern text,
  min_anomaly_score numeric DEFAULT 70,
  min_confidence_score numeric DEFAULT 50,
  priority_boost numeric DEFAULT 20,
  trigger_causal_reasoning boolean DEFAULT true,
  enabled boolean DEFAULT true,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

INSERT INTO public.telemetry_priority_rules(rule_key,rule_name,coverage_domain,observation_type_pattern,min_anomaly_score,min_confidence_score,priority_boost,trigger_causal_reasoning)
VALUES
('critical-earthquake','Critical earthquake telemetry','geophysical-disaster','earthquake%',75,70,35,true),
('extreme-weather','Extreme weather telemetry','weather-climate','weather%extreme%',70,70,30,true),
('natural-hazard','Natural hazard telemetry','climate-disaster','natural_hazard%',70,65,30,true),
('aviation-emergency','Aviation emergency telemetry','aviation-logistics','aviation_emergency%',70,70,35,true),
('maritime-chokepoint','Maritime chokepoint telemetry','shipping-logistics','maritime%',65,65,25,true)
ON CONFLICT(rule_key) DO UPDATE SET
  min_anomaly_score = EXCLUDED.min_anomaly_score,
  priority_boost = EXCLUDED.priority_boost,
  trigger_causal_reasoning = EXCLUDED.trigger_causal_reasoning,
  updated_at = now();

-- =====================================================
-- 6. Event enqueue and claim functions
-- =====================================================
CREATE OR REPLACE FUNCTION public.enqueue_telemetry_event(
  p_event_type text,
  p_source_connector_key text,
  p_source_domain text,
  p_source_region text DEFAULT 'GLOBAL',
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_priority_score numeric DEFAULT 50,
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
BEGIN
  v_key := md5(
    p_event_type || '|' ||
    COALESCE(p_source_connector_key,'') || '|' ||
    COALESCE(p_source_region,'GLOBAL') || '|' ||
    p_payload::text
  );

  INSERT INTO public.telemetry_event_bus(
    event_key,event_type,source_connector_key,source_domain,source_region,
    shard_key,priority_score,event_status,payload,lineage,available_at,created_at,updated_at
  ) VALUES (
    v_key,p_event_type,p_source_connector_key,p_source_domain,p_source_region,
    p_shard_key,LEAST(100,GREATEST(0,p_priority_score)),'queued',p_payload,p_lineage,now(),now(),now()
  )
  ON CONFLICT(event_key) DO UPDATE SET
    priority_score = GREATEST(public.telemetry_event_bus.priority_score, EXCLUDED.priority_score),
    event_status = CASE WHEN public.telemetry_event_bus.event_status = 'failed' THEN 'queued' ELSE public.telemetry_event_bus.event_status END,
    updated_at = now();

  RETURN jsonb_build_object('status','queued','event_key',v_key);
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
    ORDER BY priority_score DESC, created_at ASC
    LIMIT GREATEST(1,LEAST(p_limit,500))
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.telemetry_event_bus e
    SET event_status = 'processing',
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

CREATE OR REPLACE FUNCTION public.complete_telemetry_event(
  p_event_key text,
  p_success boolean DEFAULT true,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.telemetry_event_bus%ROWTYPE;
BEGIN
  SELECT * INTO v_event
  FROM public.telemetry_event_bus
  WHERE event_key = p_event_key;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','missing_event');
  END IF;

  IF p_success THEN
    UPDATE public.telemetry_event_bus
    SET event_status='processed', processed_at=now(), error_message=NULL, updated_at=now()
    WHERE event_key=p_event_key;
    RETURN jsonb_build_object('status','processed','event_key',p_event_key);
  END IF;

  IF v_event.retry_count + 1 >= v_event.max_retries THEN
    UPDATE public.telemetry_event_bus
    SET event_status='failed', retry_count=retry_count+1, error_message=LEFT(p_error_message,1000), updated_at=now()
    WHERE event_key=p_event_key;

    PERFORM public.enqueue_dead_letter(
      v_event.event_type,
      v_event.source_connector_key,
      'telemetry_event_processing',
      'processing_failure',
      COALESCE(p_error_message,'unknown'),
      v_event.payload
    );

    RETURN jsonb_build_object('status','failed_exhausted','event_key',p_event_key);
  END IF;

  UPDATE public.telemetry_event_bus
  SET event_status='queued',
      retry_count=retry_count+1,
      available_at=now() + make_interval(mins => LEAST(240, 5 * GREATEST(1,retry_count+1))),
      error_message=LEFT(p_error_message,1000),
      locked_by=NULL,
      locked_at=NULL,
      updated_at=now()
  WHERE event_key=p_event_key;

  RETURN jsonb_build_object('status','requeued','event_key',p_event_key);
END;
$$;

-- =====================================================
-- 7. Heartbeat and scoring
-- =====================================================
CREATE OR REPLACE FUNCTION public.record_telemetry_worker_heartbeat(
  p_worker_key text,
  p_shard_key integer,
  p_region_code text DEFAULT 'GLOBAL',
  p_current_load integer DEFAULT 0,
  p_status text DEFAULT 'active'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.telemetry_shard_workers(
    worker_key, shard_key, region_code, worker_status, current_load, last_heartbeat_at, created_at, updated_at
  ) VALUES (
    p_worker_key,p_shard_key,p_region_code,p_status,p_current_load,now(),now(),now()
  )
  ON CONFLICT(worker_key) DO UPDATE SET
    shard_key=EXCLUDED.shard_key,
    region_code=EXCLUDED.region_code,
    worker_status=EXCLUDED.worker_status,
    current_load=EXCLUDED.current_load,
    last_heartbeat_at=now(),
    updated_at=now();

  RETURN jsonb_build_object('status','heartbeat_recorded','worker_key',p_worker_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.score_telemetry_backbone_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queued integer := 0;
  v_failed integer := 0;
  v_stale_workers integer := 0;
  v_active_workers integer := 0;
  v_health numeric := 100;
BEGIN
  SELECT COUNT(*) FILTER (WHERE event_status='queued'),
         COUNT(*) FILTER (WHERE event_status='failed')
  INTO v_queued, v_failed
  FROM public.telemetry_event_bus
  WHERE created_at >= now() - interval '24 hours';

  SELECT COUNT(*) FILTER (WHERE last_heartbeat_at >= now() - interval '10 minutes' AND worker_status='active'),
         COUNT(*) FILTER (WHERE last_heartbeat_at < now() - interval '10 minutes' OR worker_status <> 'active')
  INTO v_active_workers, v_stale_workers
  FROM public.telemetry_shard_workers;

  v_health := GREATEST(0, LEAST(100,
    100 - (v_failed * 2) - (v_stale_workers * 8) - CASE WHEN v_queued > 10000 THEN 20 ELSE 0 END
  ));

  INSERT INTO public.enterprise_slo_measurements(
    measurement_key,slo_key,measured_value,target_value,breach,breach_severity,measurement_summary,measured_at
  ) VALUES (
    md5('telemetry-backbone-health|' || date_trunc('hour',now())::text),
    'telemetry-backbone-health-90',
    v_health,
    90,
    v_health < 90,
    CASE WHEN v_health < 75 THEN 'critical' WHEN v_health < 90 THEN 'warning' ELSE 'none' END,
    'Telemetry backbone health=' || v_health || ', queued=' || v_queued || ', failed=' || v_failed || ', active_workers=' || v_active_workers,
    now()
  )
  ON CONFLICT(measurement_key) DO UPDATE SET
    measured_value=EXCLUDED.measured_value,
    breach=EXCLUDED.breach,
    breach_severity=EXCLUDED.breach_severity,
    measurement_summary=EXCLUDED.measurement_summary,
    measured_at=now();

  RETURN jsonb_build_object(
    'status','success',
    'health_score',v_health,
    'queued_events',v_queued,
    'failed_events',v_failed,
    'active_workers',v_active_workers,
    'stale_workers',v_stale_workers
  );
END;
$$;

INSERT INTO public.enterprise_slo_definitions(
  slo_key,slo_name,slo_domain,target_metric,target_operator,target_value,measurement_window,severity_if_breached,metadata
)
VALUES (
  'telemetry-backbone-health-90','Telemetry backbone health >=90','telemetry','telemetry_backbone_health','gte',90,'24h','critical',jsonb_build_object('description','Distributed telemetry queue and worker health')
)
ON CONFLICT(slo_key) DO UPDATE SET target_value=EXCLUDED.target_value, updated_at=now();

-- =====================================================
-- 8. Automatic causal triggers from telemetry observations
-- =====================================================
CREATE OR REPLACE FUNCTION public.trigger_causal_reasoning_from_telemetry(
  p_observation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  obs record;
  rule record;
  v_domain text;
  v_count integer := 0;
BEGIN
  SELECT * INTO obs
  FROM public.telemetry_observations
  WHERE id = p_observation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','missing_observation');
  END IF;

  SELECT data_domain INTO v_domain
  FROM public.telemetry_connectors
  WHERE connector_key = obs.connector_key;

  FOR rule IN
    SELECT *
    FROM public.telemetry_priority_rules
    WHERE enabled = true
      AND (coverage_domain IS NULL OR coverage_domain = v_domain)
      AND obs.observation_type LIKE observation_type_pattern
      AND COALESCE(obs.anomaly_score,0) >= min_anomaly_score
      AND COALESCE(obs.confidence_score,0) >= min_confidence_score
      AND trigger_causal_reasoning = true
  LOOP
    PERFORM public.generate_planetary_propagation_event(
      obs.observation_type || ': ' || COALESCE(obs.observed_entity,'telemetry event'),
      CASE
        WHEN v_domain = 'weather-climate' THEN 'climate'
        WHEN v_domain = 'climate-disaster' THEN 'climate'
        WHEN v_domain = 'shipping-logistics' THEN 'logistics'
        WHEN v_domain = 'aviation-logistics' THEN 'logistics'
        WHEN v_domain = 'geophysical-disaster' THEN 'climate'
        WHEN v_domain = 'energy-infrastructure' THEN 'energy'
        ELSE COALESCE(v_domain,'unknown')
      END,
      COALESCE(obs.observed_region,'GLOBAL'),
      COALESCE(obs.anomaly_score,50)
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('status','success','causal_triggers',v_count,'observation_id',p_observation_id);
END;
$$;

-- =====================================================
-- 9. Enqueue recent high-priority observations for reasoning
-- =====================================================
CREATE OR REPLACE FUNCTION public.enqueue_recent_priority_telemetry(
  p_window interval DEFAULT interval '1 hour'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  INSERT INTO public.telemetry_event_bus(
    event_key,event_type,source_connector_key,source_domain,source_region,shard_key,
    priority_score,event_status,payload,lineage,available_at,created_at,updated_at
  )
  SELECT
    md5('observation-priority|' || o.id::text),
    'priority_observation_reasoning',
    o.connector_key,
    COALESCE(c.data_domain,'unknown'),
    COALESCE(o.observed_region,'GLOBAL'),
    abs(hashtext(COALESCE(o.observed_region,'GLOBAL'))) % 12,
    LEAST(100, COALESCE(o.anomaly_score,0) + COALESCE(o.confidence_score,0) * 0.2),
    'queued',
    jsonb_build_object('observation_id',o.id,'observation_type',o.observation_type,'anomaly_score',o.anomaly_score,'confidence_score',o.confidence_score),
    jsonb_build_object('source','telemetry_observations','connector_key',o.connector_key),
    now(),now(),now()
  FROM public.telemetry_observations o
  LEFT JOIN public.telemetry_connectors c ON c.connector_key = o.connector_key
  WHERE o.created_at >= now() - p_window
    AND COALESCE(o.anomaly_score,0) >= 70
  ON CONFLICT(event_key) DO UPDATE SET
    priority_score = GREATEST(public.telemetry_event_bus.priority_score, EXCLUDED.priority_score),
    updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object('status','success','events_enqueued',v_rows);
END;
$$;

-- =====================================================
-- 10. Command views
-- =====================================================
CREATE OR REPLACE VIEW public.telemetry_backbone_command_view AS
SELECT
  event_status,
  source_domain,
  source_region,
  shard_key,
  COUNT(*) AS event_count,
  ROUND(AVG(priority_score)::numeric,2) AS avg_priority,
  MIN(created_at) AS oldest_event,
  MAX(created_at) AS newest_event
FROM public.telemetry_event_bus
GROUP BY event_status, source_domain, source_region, shard_key
ORDER BY
  CASE event_status WHEN 'failed' THEN 1 WHEN 'queued' THEN 2 WHEN 'processing' THEN 3 ELSE 4 END,
  avg_priority DESC;

CREATE OR REPLACE VIEW public.telemetry_worker_command_view AS
SELECT
  worker_key,
  shard_key,
  region_code,
  worker_type,
  worker_status,
  capacity_per_minute,
  current_load,
  failure_count,
  last_heartbeat_at,
  CASE WHEN last_heartbeat_at >= now() - interval '10 minutes' AND worker_status='active' THEN 'healthy' ELSE 'stale_or_inactive' END AS health_state
FROM public.telemetry_shard_workers
ORDER BY shard_key, worker_key;

CREATE OR REPLACE VIEW public.telemetry_replay_command_view AS
SELECT
  checkpoint_key,
  connector_key,
  shard_key,
  checkpoint_cursor,
  checkpoint_time,
  replay_status,
  updated_at
FROM public.telemetry_replay_checkpoints
ORDER BY updated_at DESC;

-- =====================================================
-- 11. Orchestrator
-- =====================================================
CREATE OR REPLACE FUNCTION public.run_distributed_telemetry_backbone_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r1 jsonb;
  r2 jsonb;
BEGIN
  r1 := public.enqueue_recent_priority_telemetry(interval '1 hour');
  r2 := public.score_telemetry_backbone_health();

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('distributed-telemetry-backbone-cycle','success','priority telemetry enqueued and backbone health scored');

  RETURN jsonb_build_object('status','success','priority_enqueue',r1,'health',r2);
END;
$$;

INSERT INTO public.automation_logs(job_name,status,message)
VALUES (
  'distributed-planetary-telemetry-backbone',
  'success',
  'telemetry event bus, shard workers, replay checkpoints, lineage, priority rules, and causal trigger hooks initialized'
);
