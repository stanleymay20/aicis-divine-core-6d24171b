
-- ═══════════════════════════════════════════════════════════════════════
-- Pipeline Heartbeats: every cron/edge function reports here on success
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.pipeline_heartbeats (
  pipeline_name TEXT PRIMARY KEY,
  last_success_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  expected_interval_minutes INT NOT NULL DEFAULT 60,
  consecutive_failures INT NOT NULL DEFAULT 0,
  target_function TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_error TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pipeline_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage heartbeats" ON public.pipeline_heartbeats
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated read heartbeats" ON public.pipeline_heartbeats
  FOR SELECT TO authenticated USING (true);

-- ═══════════════════════════════════════════════════════════════════════
-- Canary probes: synthetic records to validate end-to-end propagation
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.canary_probes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  probe_type TEXT NOT NULL,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_record_id UUID,
  propagated_to_links BOOLEAN DEFAULT false,
  propagated_to_links_at TIMESTAMPTZ,
  propagation_lag_seconds INT,
  status TEXT NOT NULL DEFAULT 'pending',
  details JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_canary_probes_status ON public.canary_probes(status, inserted_at DESC);

ALTER TABLE public.canary_probes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage canaries" ON public.canary_probes
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated read canaries" ON public.canary_probes
  FOR SELECT TO authenticated USING (true);

-- ═══════════════════════════════════════════════════════════════════════
-- SLO violations log
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.slo_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_name TEXT NOT NULL,
  violation_type TEXT NOT NULL,
  expected_value NUMERIC,
  actual_value NUMERIC,
  severity TEXT NOT NULL DEFAULT 'warning',
  auto_remediated BOOLEAN DEFAULT false,
  remediation_action TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slo_violations_recent ON public.slo_violations(created_at DESC);

ALTER TABLE public.slo_violations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage slo violations" ON public.slo_violations
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated read slo violations" ON public.slo_violations
  FOR SELECT TO authenticated USING (true);

-- ═══════════════════════════════════════════════════════════════════════
-- Function: register a successful pipeline run
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.register_pipeline_heartbeat(
  _pipeline_name TEXT,
  _success BOOLEAN DEFAULT true,
  _error TEXT DEFAULT NULL,
  _metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO pipeline_heartbeats (pipeline_name, last_success_at, last_attempt_at, consecutive_failures, last_error, metadata)
  VALUES (
    _pipeline_name,
    CASE WHEN _success THEN now() ELSE NULL END,
    now(),
    CASE WHEN _success THEN 0 ELSE 1 END,
    _error,
    _metadata
  )
  ON CONFLICT (pipeline_name) DO UPDATE SET
    last_attempt_at = now(),
    last_success_at = CASE WHEN _success THEN now() ELSE pipeline_heartbeats.last_success_at END,
    consecutive_failures = CASE WHEN _success THEN 0 ELSE pipeline_heartbeats.consecutive_failures + 1 END,
    last_error = CASE WHEN _success THEN NULL ELSE _error END,
    metadata = COALESCE(_metadata, pipeline_heartbeats.metadata),
    updated_at = now();
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- Function: find stalled pipelines (used by watchdog)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.find_stalled_pipelines()
RETURNS TABLE(
  pipeline_name TEXT,
  target_function TEXT,
  minutes_since_success NUMERIC,
  expected_interval_minutes INT,
  consecutive_failures INT,
  severity TEXT
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ph.pipeline_name,
    ph.target_function,
    ROUND(EXTRACT(EPOCH FROM (now() - COALESCE(ph.last_success_at, ph.created_at))) / 60, 1) AS minutes_since_success,
    ph.expected_interval_minutes,
    ph.consecutive_failures,
    CASE
      WHEN ph.last_success_at IS NULL AND EXTRACT(EPOCH FROM (now() - ph.created_at)) / 60 > ph.expected_interval_minutes * 4 THEN 'critical'
      WHEN EXTRACT(EPOCH FROM (now() - ph.last_success_at)) / 60 > ph.expected_interval_minutes * 6 THEN 'critical'
      WHEN EXTRACT(EPOCH FROM (now() - ph.last_success_at)) / 60 > ph.expected_interval_minutes * 3 THEN 'warning'
      ELSE 'info'
    END AS severity
  FROM pipeline_heartbeats ph
  WHERE ph.enabled = true
    AND ph.target_function IS NOT NULL
    AND (
      ph.last_success_at IS NULL
      OR EXTRACT(EPOCH FROM (now() - ph.last_success_at)) / 60 > ph.expected_interval_minutes * 2
    )
  ORDER BY minutes_since_success DESC;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- Function: run canary probe — insert + verify propagation
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.run_canary_probe()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_probe_id UUID := gen_random_uuid();
  v_pending_count INT;
  v_resolved_count INT;
  v_failed_count INT;
BEGIN
  -- 1. Insert a fresh canary probe row (just the marker; propagation verified later)
  INSERT INTO canary_probes (id, probe_type, status, details)
  VALUES (
    v_probe_id,
    'heartbeat_marker',
    'pending',
    jsonb_build_object('inserted_by', 'run_canary_probe', 'expected_propagation_minutes', 30)
  );

  -- 2. Resolve any old probes that have had time to propagate
  --    Mark as 'verified' if any new normalized_metrics arrived after the probe insert
  UPDATE canary_probes cp
  SET
    status = 'verified',
    propagated_to_links = true,
    propagated_to_links_at = now(),
    propagation_lag_seconds = EXTRACT(EPOCH FROM (now() - cp.inserted_at))::INT
  WHERE cp.status = 'pending'
    AND cp.inserted_at < now() - INTERVAL '15 minutes'
    AND EXISTS (
      SELECT 1 FROM normalized_metrics nm
      WHERE nm.created_at > cp.inserted_at
      LIMIT 1
    );

  -- 3. Mark probes as failed if >2h with no propagation
  UPDATE canary_probes cp
  SET
    status = 'failed',
    details = COALESCE(cp.details, '{}'::jsonb) || jsonb_build_object('failure_reason', 'no_propagation_within_2h')
  WHERE cp.status = 'pending'
    AND cp.inserted_at < now() - INTERVAL '2 hours';

  SELECT
    COUNT(*) FILTER (WHERE status = 'pending'),
    COUNT(*) FILTER (WHERE status = 'verified' AND inserted_at > now() - INTERVAL '24 hours'),
    COUNT(*) FILTER (WHERE status = 'failed' AND inserted_at > now() - INTERVAL '24 hours')
  INTO v_pending_count, v_resolved_count, v_failed_count
  FROM canary_probes;

  -- 4. If failures detected, log SLO violation
  IF v_failed_count > 0 THEN
    INSERT INTO slo_violations (pipeline_name, violation_type, expected_value, actual_value, severity)
    VALUES ('canary_probe', 'no_propagation', 0, v_failed_count, 'critical');

    INSERT INTO critical_alerts (headline, level, event_type, meta)
    VALUES (
      'Canary failure: ' || v_failed_count || ' probes did not propagate in 2h',
      'critical',
      'canary_failure',
      jsonb_build_object('failed_count', v_failed_count, 'window_hours', 24)
    );
  END IF;

  PERFORM register_pipeline_heartbeat('canary_probe', true, NULL,
    jsonb_build_object('pending', v_pending_count, 'verified_24h', v_resolved_count, 'failed_24h', v_failed_count));

  RETURN jsonb_build_object(
    'probe_id', v_probe_id,
    'pending', v_pending_count,
    'verified_24h', v_resolved_count,
    'failed_24h', v_failed_count,
    'ok', v_failed_count = 0
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- Seed critical pipelines
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO pipeline_heartbeats (pipeline_name, expected_interval_minutes, target_function) VALUES
  ('graph-recovery-tick',          10, 'graph-recovery-tick'),
  ('planetary-backfill',           60, 'planetary-backfill'),
  ('cron-enterprise-health',       60, 'cron-enterprise-health'),
  ('log-system-health',            60, 'log-system-health'),
  ('snapshot-prospective-health',  1440, 'snapshot-prospective-health'),
  ('check-accumulation-health',    60, NULL),
  ('canary_probe',                 60, NULL),
  ('check-daily-accumulation-misses', 1440, NULL)
ON CONFLICT (pipeline_name) DO UPDATE SET
  expected_interval_minutes = EXCLUDED.expected_interval_minutes,
  target_function = COALESCE(EXCLUDED.target_function, pipeline_heartbeats.target_function);
