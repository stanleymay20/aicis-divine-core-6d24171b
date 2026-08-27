-- AICIS Telemetry Backbone Truth Floor v1
--
-- Telemetry anomaly screens may prioritize human/governed review, but they must
-- not automatically become causal propagation. Operational queue health is also
-- distinct from epistemic evidence quality.

ALTER TABLE public.telemetry_event_bus
  ALTER COLUMN priority_score DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS priority_semantics text,
  ADD COLUMN IF NOT EXISTS epistemic_status text NOT NULL DEFAULT 'operational_event',
  ADD COLUMN IF NOT EXISTS source_observation_id uuid REFERENCES public.telemetry_observations(id) ON DELETE SET NULL;

ALTER TABLE public.telemetry_shard_workers
  ALTER COLUMN last_heartbeat_at DROP DEFAULT,
  ALTER COLUMN current_load DROP DEFAULT,
  ALTER COLUMN failure_count DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS heartbeat_semantics text,
  ADD COLUMN IF NOT EXISTS load_semantics text;

ALTER TABLE public.telemetry_replay_checkpoints
  ALTER COLUMN replay_status DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS replay_status_semantics text;

ALTER TABLE public.telemetry_lineage_records
  ALTER COLUMN trust_score DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS trust_score_semantics text;

ALTER TABLE public.telemetry_priority_rules
  ALTER COLUMN min_anomaly_score DROP DEFAULT,
  ALTER COLUMN min_confidence_score DROP DEFAULT,
  ALTER COLUMN priority_boost DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS rule_semantics text NOT NULL DEFAULT 'legacy_operational_priority_rule_not_probability';

UPDATE public.telemetry_event_bus
SET priority_semantics = COALESCE(priority_semantics, 'legacy_operational_priority_semantics_unverified')
WHERE priority_score IS NOT NULL;

UPDATE public.telemetry_shard_workers
SET
  heartbeat_semantics = COALESCE(heartbeat_semantics, CASE WHEN last_heartbeat_at IS NOT NULL THEN 'legacy_heartbeat_timestamp_semantics_unverified' END),
  load_semantics = COALESCE(load_semantics, CASE WHEN current_load IS NOT NULL THEN 'legacy_worker_load_semantics_unverified' END);

UPDATE public.telemetry_replay_checkpoints
SET replay_status_semantics = COALESCE(replay_status_semantics, 'legacy_replay_status_semantics_unverified')
WHERE replay_status IS NOT NULL;

UPDATE public.telemetry_lineage_records
SET trust_score_semantics = COALESCE(trust_score_semantics, 'legacy_lineage_trust_score_semantics_unverified')
WHERE trust_score IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.telemetry_reasoning_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id uuid REFERENCES public.telemetry_observations(id) ON DELETE SET NULL,
  action text NOT NULL,
  outcome text NOT NULL,
  reason text NOT NULL,
  anomaly_score numeric,
  anomaly_score_semantics text,
  confidence_score numeric,
  confidence_score_semantics text,
  observed_at timestamptz,
  observed_at_semantics text,
  source_connector_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_reasoning_attempts_observation
  ON public.telemetry_reasoning_attempts(observation_id, created_at DESC);

ALTER TABLE public.telemetry_reasoning_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read telemetry reasoning attempts"
  ON public.telemetry_reasoning_attempts;
CREATE POLICY "Authenticated read telemetry reasoning attempts"
  ON public.telemetry_reasoning_attempts
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role writes telemetry reasoning attempts"
  ON public.telemetry_reasoning_attempts;
CREATE POLICY "Service role writes telemetry reasoning attempts"
  ON public.telemetry_reasoning_attempts
  FOR INSERT TO service_role
  WITH CHECK (true);

GRANT SELECT ON public.telemetry_reasoning_attempts TO authenticated;
GRANT SELECT, INSERT ON public.telemetry_reasoning_attempts TO service_role;

DROP TRIGGER IF EXISTS trg_telemetry_reasoning_attempts_immutable
  ON public.telemetry_reasoning_attempts;
CREATE TRIGGER trg_telemetry_reasoning_attempts_immutable
  BEFORE UPDATE OR DELETE ON public.telemetry_reasoning_attempts
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

-- Compatibility enqueue function. Priority is operational scheduling metadata,
-- not confidence/probability. Missing priority remains NULL rather than 50.
CREATE OR REPLACE FUNCTION public.enqueue_telemetry_event(
  p_event_type text,
  p_source_connector_key text,
  p_source_domain text,
  p_source_region text DEFAULT 'GLOBAL',
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
    COALESCE(p_source_region,'GLOBAL') || '|' ||
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
    event_status = CASE WHEN public.telemetry_event_bus.event_status = 'failed' THEN 'queued' ELSE public.telemetry_event_bus.event_status END,
    updated_at = now();

  RETURN jsonb_build_object(
    'status','queued',
    'event_key',v_key,
    'priority_score',v_priority,
    'priority_semantics',CASE WHEN v_priority IS NULL THEN 'not_assessed' ELSE 'caller_supplied_operational_priority_not_probability' END
  );
END;
$$;

-- Heartbeats only become healthy after an actual heartbeat call. No row-default
-- timestamp is allowed to impersonate a worker observation.
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
    worker_key, shard_key, region_code, worker_status, current_load, load_semantics,
    last_heartbeat_at, heartbeat_semantics, created_at, updated_at
  ) VALUES (
    p_worker_key,p_shard_key,p_region_code,p_status,p_current_load,
    'worker_reported_current_load_count',now(),'system_received_worker_heartbeat_time',now(),now()
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

  RETURN jsonb_build_object('status','heartbeat_recorded','worker_key',p_worker_key);
END;
$$;

-- Operational SLO heuristic only. No workers => unknown, not health=100.
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
  v_worker_count integer := 0;
  v_health numeric;
BEGIN
  SELECT COUNT(*) FILTER (WHERE event_status='queued'),
         COUNT(*) FILTER (WHERE event_status='failed')
  INTO v_queued, v_failed
  FROM public.telemetry_event_bus
  WHERE created_at >= now() - interval '24 hours';

  SELECT COUNT(*),
         COUNT(*) FILTER (
           WHERE last_heartbeat_at IS NOT NULL
             AND heartbeat_semantics = 'system_received_worker_heartbeat_time'
             AND last_heartbeat_at >= now() - interval '10 minutes'
             AND worker_status='active'
         ),
         COUNT(*) FILTER (
           WHERE last_heartbeat_at IS NULL
              OR heartbeat_semantics IS DISTINCT FROM 'system_received_worker_heartbeat_time'
              OR last_heartbeat_at < now() - interval '10 minutes'
              OR worker_status <> 'active'
         )
  INTO v_worker_count, v_active_workers, v_stale_workers
  FROM public.telemetry_shard_workers;

  IF v_worker_count = 0 THEN
    RETURN jsonb_build_object(
      'status','unknown',
      'health_score',NULL,
      'health_semantics','no_worker_heartbeat_observations_no_health_score_issued',
      'queued_events',v_queued,
      'failed_events',v_failed,
      'active_workers',0,
      'stale_workers',0
    );
  END IF;

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
    'Operational queue/worker SLO heuristic=' || v_health || ', queued=' || v_queued || ', failed=' || v_failed || ', active_workers=' || v_active_workers,
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
    'health_semantics','deterministic_operational_slo_heuristic_not_data_quality_or_epistemic_confidence',
    'queued_events',v_queued,
    'failed_events',v_failed,
    'active_workers',v_active_workers,
    'stale_workers',v_stale_workers
  );
END;
$$;

-- Automatic causal promotion is disabled. An observation can be recorded as a
-- reasoning attempt/review candidate, but the current planetary propagation
-- engine is not a validated causal model and must not receive telemetry directly.
CREATE OR REPLACE FUNCTION public.trigger_causal_reasoning_from_telemetry(
  p_observation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  obs public.telemetry_observations%ROWTYPE;
BEGIN
  SELECT * INTO obs
  FROM public.telemetry_observations
  WHERE id = p_observation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','missing_observation');
  END IF;

  INSERT INTO public.telemetry_reasoning_attempts(
    observation_id,action,outcome,reason,
    anomaly_score,anomaly_score_semantics,
    confidence_score,confidence_score_semantics,
    observed_at,observed_at_semantics,source_connector_key,metadata
  ) VALUES (
    obs.id,
    'causal_reasoning_request',
    'abstained',
    'automatic_planetary_causal_propagation_disabled_until_causal_engine_semantics_and_evidence_contract_are_governed',
    obs.anomaly_score,obs.anomaly_score_semantics,
    obs.confidence_score,obs.confidence_score_semantics,
    obs.observed_at,obs.observed_at_semantics,obs.connector_key,
    jsonb_build_object('evidence_status',obs.evidence_status)
  );

  RETURN jsonb_build_object(
    'status','abstained',
    'causal_triggers',0,
    'observation_id',p_observation_id,
    'reason','planetary_causal_engine_not_governed_for_automatic_telemetry_promotion'
  );
END;
$$;

-- Queue governed review candidates only when an anomaly score is present and its
-- semantics are usable. Confidence is not fabricated and does not receive a
-- default. Priority is a deterministic scheduling score, explicitly not risk.
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
    priority_score,priority_semantics,epistemic_status,source_observation_id,
    event_status,payload,lineage,available_at,created_at,updated_at
  )
  SELECT
    md5('telemetry-review-candidate|' || o.id::text),
    'telemetry_review_candidate',
    o.connector_key,
    c.data_domain,
    o.observed_region,
    abs(hashtext(COALESCE(o.observed_region,'UNSPECIFIED'))) % 12,
    LEAST(100, GREATEST(0, o.anomaly_score)),
    'deterministic_anomaly_screen_used_for_queue_order_not_probability_or_confidence',
    'review_candidate',
    o.id,
    'queued',
    jsonb_build_object(
      'observation_id',o.id,
      'observation_type',o.observation_type,
      'anomaly_score',o.anomaly_score,
      'anomaly_score_semantics',o.anomaly_score_semantics,
      'confidence_score',o.confidence_score,
      'confidence_score_semantics',o.confidence_score_semantics,
      'observed_at',o.observed_at,
      'observed_at_semantics',o.observed_at_semantics,
      'evidence_status',o.evidence_status
    ),
    jsonb_build_object(
      'source','telemetry_observations',
      'connector_key',o.connector_key,
      'automatic_causal_promotion',false
    ),
    now(),now(),now()
  FROM public.telemetry_observations o
  LEFT JOIN public.telemetry_connectors c ON c.connector_key = o.connector_key
  WHERE o.created_at >= now() - p_window
    AND o.anomaly_score IS NOT NULL
    AND o.anomaly_score >= 70
    AND NOT public.aicis_telemetry_semantics_unusable_v1(o.anomaly_score_semantics)
  ON CONFLICT(event_key) DO UPDATE SET
    priority_score = EXCLUDED.priority_score,
    priority_semantics = EXCLUDED.priority_semantics,
    epistemic_status = EXCLUDED.epistemic_status,
    payload = EXCLUDED.payload,
    lineage = EXCLUDED.lineage,
    updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'status','success',
    'events_enqueued',v_rows,
    'event_semantics','telemetry_review_candidates_no_automatic_causal_promotion'
  );
END;
$$;

-- Command views expose the operational semantics explicitly.
CREATE OR REPLACE VIEW public.telemetry_backbone_command_view AS
SELECT
  event_status,
  epistemic_status,
  source_domain,
  source_region,
  shard_key,
  COUNT(*) AS event_count,
  ROUND(AVG(priority_score) FILTER (WHERE priority_score IS NOT NULL)::numeric,2) AS avg_priority,
  CASE
    WHEN COUNT(priority_score) = 0 THEN 'not_assessed'
    ELSE 'mean_operational_queue_priority_not_probability'
  END AS avg_priority_semantics,
  MIN(created_at) AS oldest_event,
  MAX(created_at) AS newest_event
FROM public.telemetry_event_bus
GROUP BY event_status, epistemic_status, source_domain, source_region, shard_key
ORDER BY
  CASE event_status WHEN 'failed' THEN 1 WHEN 'queued' THEN 2 WHEN 'processing' THEN 3 ELSE 4 END,
  avg_priority DESC NULLS LAST;

CREATE OR REPLACE VIEW public.telemetry_worker_command_view AS
SELECT
  worker_key,
  shard_key,
  region_code,
  worker_type,
  worker_status,
  capacity_per_minute,
  current_load,
  load_semantics,
  failure_count,
  last_heartbeat_at,
  heartbeat_semantics,
  CASE
    WHEN last_heartbeat_at IS NULL THEN 'unknown_no_heartbeat'
    WHEN heartbeat_semantics IS DISTINCT FROM 'system_received_worker_heartbeat_time' THEN 'unknown_heartbeat_semantics'
    WHEN last_heartbeat_at >= now() - interval '10 minutes' AND worker_status='active' THEN 'operational_recent_heartbeat'
    ELSE 'stale_or_inactive'
  END AS health_state
FROM public.telemetry_shard_workers
ORDER BY shard_key, worker_key;

COMMENT ON FUNCTION public.trigger_causal_reasoning_from_telemetry(uuid) IS
  'Audit-only abstention bridge. Automatic telemetry-to-planetary-causal promotion is disabled until the propagation engine has a governed causal evidence contract.';
COMMENT ON FUNCTION public.enqueue_recent_priority_telemetry(interval) IS
  'Enqueues semantic-aware telemetry review candidates. Queue priority is operational scheduling metadata, never probability/confidence.';
COMMENT ON FUNCTION public.score_telemetry_backbone_health() IS
  'Operational queue/worker SLO heuristic. Returns unknown when worker heartbeat evidence is absent; it is not epistemic/data-quality confidence.';
