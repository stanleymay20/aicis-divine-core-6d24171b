-- Enterprise Reliability + Security Hardening Layer
-- Moves AICIS from architecture maturity toward enterprise operational maturity.
-- Adds: job governance, dead-letter queues, SLA monitoring, incident management,
-- access/security audit foundations, deployment readiness scorecards, and operational command views.

-- =====================================================
-- 1. Enterprise job registry
-- =====================================================
CREATE TABLE IF NOT EXISTS public.enterprise_job_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key text UNIQUE NOT NULL,
  job_name text NOT NULL,
  job_domain text NOT NULL,
  job_type text DEFAULT 'scheduled',
  criticality text DEFAULT 'standard',
  owner_team text DEFAULT 'platform',
  expected_interval_seconds integer DEFAULT 3600,
  max_runtime_ms integer DEFAULT 300000,
  max_consecutive_failures integer DEFAULT 3,
  enabled boolean DEFAULT true,
  runbook_url text,
  job_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enterprise_job_registry_domain
ON public.enterprise_job_registry(job_domain, enabled, criticality);

-- =====================================================
-- 2. Enterprise job runs
-- =====================================================
CREATE TABLE IF NOT EXISTS public.enterprise_job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key text UNIQUE NOT NULL,
  job_key text REFERENCES public.enterprise_job_registry(job_key) ON DELETE SET NULL,
  status text DEFAULT 'started',
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer,
  rows_processed integer DEFAULT 0,
  rows_inserted integer DEFAULT 0,
  error_message text,
  retry_count integer DEFAULT 0,
  run_context jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enterprise_job_runs_job_time
ON public.enterprise_job_runs(job_key, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_enterprise_job_runs_status
ON public.enterprise_job_runs(status, started_at DESC);

-- =====================================================
-- 3. Dead-letter queue for failed records
-- =====================================================
CREATE TABLE IF NOT EXISTS public.enterprise_dead_letter_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dlq_key text UNIQUE NOT NULL,
  source_job_key text,
  source_connector_key text,
  failure_stage text,
  error_type text DEFAULT 'unknown',
  error_message text,
  payload jsonb DEFAULT '{}'::jsonb,
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 5,
  next_retry_at timestamptz,
  status text DEFAULT 'open',
  first_failed_at timestamptz DEFAULT now(),
  last_failed_at timestamptz DEFAULT now(),
  resolved_at timestamptz,
  resolution_notes text
);

CREATE INDEX IF NOT EXISTS idx_enterprise_dlq_status_retry
ON public.enterprise_dead_letter_queue(status, next_retry_at, retry_count);

-- =====================================================
-- 4. SLA/SLO definitions and measurements
-- =====================================================
CREATE TABLE IF NOT EXISTS public.enterprise_slo_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slo_key text UNIQUE NOT NULL,
  slo_name text NOT NULL,
  slo_domain text NOT NULL,
  target_metric text NOT NULL,
  target_operator text DEFAULT 'gte',
  target_value numeric NOT NULL,
  measurement_window text DEFAULT '24h',
  severity_if_breached text DEFAULT 'warning',
  enabled boolean DEFAULT true,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.enterprise_slo_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_key text UNIQUE NOT NULL,
  slo_key text REFERENCES public.enterprise_slo_definitions(slo_key) ON DELETE CASCADE,
  measured_value numeric,
  target_value numeric,
  breach boolean DEFAULT false,
  breach_severity text,
  measurement_summary text,
  measured_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slo_measurements_key_time
ON public.enterprise_slo_measurements(slo_key, measured_at DESC);

-- =====================================================
-- 5. Incident management foundation
-- =====================================================
CREATE TABLE IF NOT EXISTS public.enterprise_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_key text UNIQUE NOT NULL,
  incident_title text NOT NULL,
  incident_domain text,
  severity text DEFAULT 'sev3',
  incident_status text DEFAULT 'open',
  detected_by text DEFAULT 'system',
  detection_source text,
  impact_summary text,
  affected_components jsonb DEFAULT '[]'::jsonb,
  mitigation_steps jsonb DEFAULT '[]'::jsonb,
  opened_at timestamptz DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  postmortem_required boolean DEFAULT false,
  postmortem_notes text
);

CREATE INDEX IF NOT EXISTS idx_enterprise_incidents_status_severity
ON public.enterprise_incidents(incident_status, severity, opened_at DESC);

-- =====================================================
-- 6. Security and access audit foundations
-- =====================================================
CREATE TABLE IF NOT EXISTS public.enterprise_access_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_key text UNIQUE NOT NULL,
  actor_id uuid,
  actor_type text DEFAULT 'user',
  action text NOT NULL,
  resource_type text,
  resource_id text,
  sensitivity_level text DEFAULT 'standard',
  decision text DEFAULT 'allowed',
  reason text,
  ip_address text,
  user_agent text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_audit_actor_time
ON public.enterprise_access_audit_events(actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_access_audit_sensitive
ON public.enterprise_access_audit_events(sensitivity_level, decision, created_at DESC);

CREATE TABLE IF NOT EXISTS public.enterprise_security_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_key text UNIQUE NOT NULL,
  finding_title text NOT NULL,
  finding_category text,
  severity text DEFAULT 'medium',
  status text DEFAULT 'open',
  affected_component text,
  evidence jsonb DEFAULT '[]'::jsonb,
  remediation_summary text,
  owner_team text DEFAULT 'security',
  due_at timestamptz,
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_security_findings_status_severity
ON public.enterprise_security_findings(status, severity, due_at);

-- =====================================================
-- 7. Deployment readiness scorecards
-- =====================================================
CREATE TABLE IF NOT EXISTS public.enterprise_readiness_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scorecard_key text UNIQUE NOT NULL,
  scorecard_scope text DEFAULT 'platform',
  reliability_score numeric DEFAULT 0,
  security_score numeric DEFAULT 0,
  observability_score numeric DEFAULT 0,
  data_quality_score numeric DEFAULT 0,
  telemetry_coverage_score numeric DEFAULT 0,
  incident_response_score numeric DEFAULT 0,
  overall_enterprise_score numeric DEFAULT 0,
  readiness_grade text DEFAULT 'not-ready',
  blockers jsonb DEFAULT '[]'::jsonb,
  generated_at timestamptz DEFAULT now()
);

-- =====================================================
-- 8. Seed critical job registry
-- =====================================================
INSERT INTO public.enterprise_job_registry (
  job_key, job_name, job_domain, job_type, criticality, owner_team,
  expected_interval_seconds, max_runtime_ms, max_consecutive_failures, runbook_url, job_metadata
)
VALUES
('usgs-earthquake-telemetry','USGS Earthquake Telemetry','telemetry','scheduled','critical','platform',300,120000,3,NULL,jsonb_build_object('function','ingest-usgs-earthquake-telemetry')),
('openmeteo-global-mesh','Open-Meteo Global Mesh','telemetry','sharded','critical','platform',900,180000,3,NULL,jsonb_build_object('function','ingest-openmeteo-global-mesh','sharded',true)),
('opensky-aviation-telemetry','OpenSky Aviation Telemetry','telemetry','scheduled','strategic','platform',900,180000,3,NULL,jsonb_build_object('function','ingest-opensky-aviation-telemetry')),
('nasa-eonet-disaster-telemetry','NASA EONET Disaster Telemetry','telemetry','scheduled','critical','platform',1800,180000,3,NULL,jsonb_build_object('function','ingest-nasa-eonet-disaster-telemetry')),
('maritime-ais-telemetry','Maritime AIS Telemetry','telemetry','webhook','strategic','platform',900,180000,3,NULL,jsonb_build_object('function','ingest-maritime-ais-telemetry')),
('commercial-intelligence-cycle','Commercial Intelligence Cycle','intelligence','scheduled','critical','intelligence',3600,300000,3,NULL,jsonb_build_object('rpc','run_commercial_intelligence_jobs')),
('validation-explainability-cycle','Validation Explainability Cycle','trust','scheduled','critical','trust',3600,300000,3,NULL,jsonb_build_object('rpc','run_validation_explainability_cycle')),
('executive-dashboard-cycle','Executive Dashboard Cycle','executive','scheduled','critical','executive',1800,180000,3,NULL,jsonb_build_object('rpc','run_executive_dashboard_cycle')),
('gap-closure-cycle','Gap Closure Cycle','governance','scheduled','strategic','platform',21600,300000,3,NULL,jsonb_build_object('rpc','run_gap_closure_cycle'))
ON CONFLICT(job_key) DO UPDATE SET
  job_name = EXCLUDED.job_name,
  job_domain = EXCLUDED.job_domain,
  job_type = EXCLUDED.job_type,
  criticality = EXCLUDED.criticality,
  expected_interval_seconds = EXCLUDED.expected_interval_seconds,
  max_runtime_ms = EXCLUDED.max_runtime_ms,
  max_consecutive_failures = EXCLUDED.max_consecutive_failures,
  job_metadata = EXCLUDED.job_metadata,
  updated_at = now();

-- =====================================================
-- 9. Seed enterprise SLOs
-- =====================================================
INSERT INTO public.enterprise_slo_definitions (
  slo_key, slo_name, slo_domain, target_metric, target_operator, target_value, measurement_window, severity_if_breached, metadata
)
VALUES
('telemetry-connector-health-95','Telemetry connector health >=95%','telemetry','connector_health_percent','gte',95,'24h','critical',jsonb_build_object('description','Percentage of telemetry connectors not degraded')),
('global-mesh-coverage-80','Global mesh activation >=80%','telemetry','global_mesh_activation_percent','gte',80,'24h','warning',jsonb_build_object('description','Average activation percent across global mesh domains')),
('critical-job-success-95','Critical job success >=95%','reliability','critical_job_success_percent','gte',95,'24h','critical',jsonb_build_object('description','Success ratio for critical enterprise jobs')),
('open-incident-count-lte-5','Open incidents <=5','reliability','open_incidents','lte',5,'24h','warning',jsonb_build_object('description','Open incident pressure')),
('security-critical-findings-zero','Critical security findings =0','security','critical_security_findings','lte',0,'24h','critical',jsonb_build_object('description','No unresolved critical security findings')),
('analyst-queue-pressure-lte-100','Analyst queue <=100','operations','open_analyst_reviews','lte',100,'24h','warning',jsonb_build_object('description','Human review bottleneck control'))
ON CONFLICT(slo_key) DO UPDATE SET
  target_value = EXCLUDED.target_value,
  measurement_window = EXCLUDED.measurement_window,
  severity_if_breached = EXCLUDED.severity_if_breached,
  updated_at = now();

-- =====================================================
-- 10. Job run lifecycle functions
-- =====================================================
CREATE OR REPLACE FUNCTION public.start_enterprise_job_run(
  p_job_key text,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_key text;
BEGIN
  v_key := md5(p_job_key || '|' || now()::text || '|' || random()::text);
  INSERT INTO public.enterprise_job_runs(run_key, job_key, status, started_at, run_context)
  VALUES (v_key, p_job_key, 'started', now(), p_context)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_enterprise_job_run(
  p_run_id uuid,
  p_status text DEFAULT 'success',
  p_rows_processed integer DEFAULT 0,
  p_rows_inserted integer DEFAULT 0,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_started timestamptz;
  v_duration integer;
BEGIN
  SELECT started_at INTO v_started FROM public.enterprise_job_runs WHERE id = p_run_id;
  v_duration := GREATEST(0, (EXTRACT(EPOCH FROM (now() - COALESCE(v_started, now()))) * 1000)::integer);

  UPDATE public.enterprise_job_runs
  SET status = p_status,
      completed_at = now(),
      duration_ms = v_duration,
      rows_processed = p_rows_processed,
      rows_inserted = p_rows_inserted,
      error_message = p_error_message
  WHERE id = p_run_id;

  RETURN jsonb_build_object('status','recorded','run_id',p_run_id,'duration_ms',v_duration);
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_dead_letter(
  p_source_job_key text,
  p_source_connector_key text,
  p_failure_stage text,
  p_error_type text,
  p_error_message text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := md5(COALESCE(p_source_job_key,'') || '|' || COALESCE(p_source_connector_key,'') || '|' || COALESCE(p_failure_stage,'') || '|' || p_payload::text);

  INSERT INTO public.enterprise_dead_letter_queue (
    dlq_key, source_job_key, source_connector_key, failure_stage,
    error_type, error_message, payload, retry_count, next_retry_at, status,
    first_failed_at, last_failed_at
  ) VALUES (
    v_key, p_source_job_key, p_source_connector_key, p_failure_stage,
    p_error_type, LEFT(p_error_message,1000), p_payload, 0, now() + interval '15 minutes', 'open',
    now(), now()
  )
  ON CONFLICT(dlq_key) DO UPDATE SET
    retry_count = public.enterprise_dead_letter_queue.retry_count + 1,
    last_failed_at = now(),
    next_retry_at = now() + make_interval(mins => LEAST(240, 15 * GREATEST(1, public.enterprise_dead_letter_queue.retry_count + 1))),
    error_message = LEFT(EXCLUDED.error_message,1000),
    status = CASE WHEN public.enterprise_dead_letter_queue.retry_count + 1 >= public.enterprise_dead_letter_queue.max_retries THEN 'exhausted' ELSE 'open' END;

  RETURN jsonb_build_object('status','queued','dlq_key',v_key);
END;
$$;

-- =====================================================
-- 11. SLO measurement function
-- =====================================================
CREATE OR REPLACE FUNCTION public.measure_enterprise_slos()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connector_health numeric := 100;
  v_mesh_activation numeric := 0;
  v_job_success numeric := 100;
  v_open_incidents numeric := 0;
  v_critical_findings numeric := 0;
  v_analyst_queue numeric := 0;
BEGIN
  SELECT CASE WHEN COUNT(*) = 0 THEN 100 ELSE ROUND((COUNT(*) FILTER (WHERE operational_status NOT IN ('degraded','offline'))::numeric / COUNT(*)::numeric) * 100,2) END
  INTO v_connector_health
  FROM public.telemetry_connectors;

  SELECT COALESCE(ROUND(AVG(activation_percent)::numeric,2),0)
  INTO v_mesh_activation
  FROM public.global_telemetry_coverage_command_view;

  SELECT CASE WHEN COUNT(*) = 0 THEN 100 ELSE ROUND((COUNT(*) FILTER (WHERE status IN ('success','partial_success'))::numeric / COUNT(*)::numeric) * 100,2) END
  INTO v_job_success
  FROM public.enterprise_job_runs jr
  JOIN public.enterprise_job_registry reg ON reg.job_key = jr.job_key
  WHERE jr.started_at >= now() - interval '24 hours'
    AND reg.criticality = 'critical';

  SELECT COUNT(*) INTO v_open_incidents
  FROM public.enterprise_incidents
  WHERE incident_status IN ('open','acknowledged','mitigating');

  SELECT COUNT(*) INTO v_critical_findings
  FROM public.enterprise_security_findings
  WHERE status = 'open' AND severity = 'critical';

  SELECT COUNT(*) INTO v_analyst_queue
  FROM public.analyst_review_queue
  WHERE review_status = 'open';

  PERFORM public.record_slo_measurement('telemetry-connector-health-95', v_connector_health);
  PERFORM public.record_slo_measurement('global-mesh-coverage-80', v_mesh_activation);
  PERFORM public.record_slo_measurement('critical-job-success-95', v_job_success);
  PERFORM public.record_slo_measurement('open-incident-count-lte-5', v_open_incidents);
  PERFORM public.record_slo_measurement('security-critical-findings-zero', v_critical_findings);
  PERFORM public.record_slo_measurement('analyst-queue-pressure-lte-100', v_analyst_queue);

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('enterprise-slo-measurement','success','slos measured');

  RETURN jsonb_build_object(
    'status','success',
    'connector_health_percent',v_connector_health,
    'mesh_activation_percent',v_mesh_activation,
    'critical_job_success_percent',v_job_success,
    'open_incidents',v_open_incidents,
    'critical_security_findings',v_critical_findings,
    'open_analyst_reviews',v_analyst_queue
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_slo_measurement(
  p_slo_key text,
  p_value numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_def public.enterprise_slo_definitions%ROWTYPE;
  v_breach boolean;
  v_key text;
BEGIN
  SELECT * INTO v_def
  FROM public.enterprise_slo_definitions
  WHERE slo_key = p_slo_key AND enabled = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','skipped','reason','slo_not_found');
  END IF;

  v_breach := CASE v_def.target_operator
    WHEN 'gte' THEN p_value < v_def.target_value
    WHEN 'lte' THEN p_value > v_def.target_value
    WHEN 'eq' THEN p_value <> v_def.target_value
    ELSE false
  END;

  v_key := md5(p_slo_key || '|' || date_trunc('hour',now())::text);

  INSERT INTO public.enterprise_slo_measurements (
    measurement_key, slo_key, measured_value, target_value, breach, breach_severity, measurement_summary, measured_at
  ) VALUES (
    v_key, p_slo_key, p_value, v_def.target_value, v_breach,
    CASE WHEN v_breach THEN v_def.severity_if_breached ELSE 'none' END,
    v_def.slo_name || ': measured=' || p_value || ', target=' || v_def.target_operator || ' ' || v_def.target_value,
    now()
  )
  ON CONFLICT(measurement_key) DO UPDATE SET
    measured_value = EXCLUDED.measured_value,
    breach = EXCLUDED.breach,
    breach_severity = EXCLUDED.breach_severity,
    measurement_summary = EXCLUDED.measurement_summary,
    measured_at = now();

  IF v_breach AND v_def.severity_if_breached = 'critical' THEN
    PERFORM public.open_enterprise_incident(
      'SLO breach: ' || v_def.slo_name,
      v_def.slo_domain,
      'sev2',
      'enterprise_slo_measurements',
      'Measured value ' || p_value || ' breached target ' || v_def.target_operator || ' ' || v_def.target_value,
      jsonb_build_array(p_slo_key)
    );
  END IF;

  RETURN jsonb_build_object('status','recorded','slo_key',p_slo_key,'breach',v_breach);
END;
$$;

-- =====================================================
-- 12. Incident creation function
-- =====================================================
CREATE OR REPLACE FUNCTION public.open_enterprise_incident(
  p_title text,
  p_domain text,
  p_severity text,
  p_detection_source text,
  p_impact_summary text,
  p_affected_components jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := md5(p_title || '|' || p_domain || '|' || date_trunc('day',now())::text);

  INSERT INTO public.enterprise_incidents (
    incident_key, incident_title, incident_domain, severity, incident_status,
    detected_by, detection_source, impact_summary, affected_components,
    mitigation_steps, opened_at, postmortem_required
  ) VALUES (
    v_key, p_title, p_domain, p_severity, 'open',
    'system', p_detection_source, p_impact_summary, p_affected_components,
    jsonb_build_array('Investigate source', 'Assign owner', 'Apply mitigation', 'Validate recovery'),
    now(), p_severity IN ('sev1','sev2')
  )
  ON CONFLICT(incident_key) DO UPDATE SET
    incident_status = CASE WHEN public.enterprise_incidents.incident_status = 'resolved' THEN 'open' ELSE public.enterprise_incidents.incident_status END,
    impact_summary = EXCLUDED.impact_summary,
    affected_components = EXCLUDED.affected_components;

  RETURN jsonb_build_object('status','incident_opened_or_updated','incident_key',v_key);
END;
$$;

-- =====================================================
-- 13. Security baseline check
-- =====================================================
CREATE OR REPLACE FUNCTION public.run_security_baseline_check()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_findings integer := 0;
BEGIN
  -- Finding: no active telemetry connectors means operational observability gap.
  INSERT INTO public.enterprise_security_findings (
    finding_key, finding_title, finding_category, severity, status,
    affected_component, evidence, remediation_summary, owner_team, due_at, created_at
  )
  SELECT
    md5('telemetry-connectors-none'),
    'No active telemetry connectors detected',
    'operational-observability',
    'high',
    'open',
    'telemetry_connectors',
    jsonb_build_array(jsonb_build_object('active_count',0)),
    'Enable and validate at least one tier-1 telemetry connector.',
    'platform',
    now() + interval '7 days',
    now()
  WHERE NOT EXISTS (SELECT 1 FROM public.telemetry_connectors WHERE operational_status = 'active')
  ON CONFLICT(finding_key) DO UPDATE SET
    status = CASE WHEN EXISTS (SELECT 1 FROM public.telemetry_connectors WHERE operational_status = 'active') THEN 'resolved' ELSE 'open' END,
    resolved_at = CASE WHEN EXISTS (SELECT 1 FROM public.telemetry_connectors WHERE operational_status = 'active') THEN now() ELSE NULL END;

  -- Finding: critical SLO breaches.
  INSERT INTO public.enterprise_security_findings (
    finding_key, finding_title, finding_category, severity, status,
    affected_component, evidence, remediation_summary, owner_team, due_at, created_at
  )
  SELECT
    md5('critical-slo-breach|' || m.slo_key),
    'Critical SLO breach: ' || d.slo_name,
    'reliability-governance',
    'critical',
    'open',
    d.slo_domain,
    jsonb_build_array(jsonb_build_object('measured_value',m.measured_value,'target_value',m.target_value)),
    'Investigate breached SLO and apply runbook mitigation.',
    'platform',
    now() + interval '2 days',
    now()
  FROM public.enterprise_slo_measurements m
  JOIN public.enterprise_slo_definitions d ON d.slo_key = m.slo_key
  WHERE m.measured_at >= now() - interval '24 hours'
    AND m.breach = true
    AND m.breach_severity = 'critical'
  ON CONFLICT(finding_key) DO UPDATE SET
    evidence = EXCLUDED.evidence,
    status = 'open',
    due_at = EXCLUDED.due_at;

  GET DIAGNOSTICS v_findings = ROW_COUNT;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('security-baseline-check','success','findings_upserted=' || v_findings);

  RETURN jsonb_build_object('status','success','findings_upserted',v_findings);
END;
$$;

-- =====================================================
-- 14. Enterprise readiness scorecard
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_enterprise_readiness_scorecard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reliability numeric := 0;
  v_security numeric := 0;
  v_observability numeric := 0;
  v_data_quality numeric := 0;
  v_coverage numeric := 0;
  v_incident_response numeric := 0;
  v_overall numeric := 0;
  v_grade text := 'not-ready';
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(AVG(CASE WHEN breach THEN 0 ELSE 100 END),100)
  INTO v_reliability
  FROM public.enterprise_slo_measurements
  WHERE measured_at >= now() - interval '24 hours';

  SELECT GREATEST(0,100 - COUNT(*) FILTER (WHERE severity IN ('critical','high') AND status = 'open') * 15)
  INTO v_security
  FROM public.enterprise_security_findings;

  SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE ROUND((COUNT(*) FILTER (WHERE operational_status = 'active')::numeric / COUNT(*)::numeric) * 100,2) END
  INTO v_observability
  FROM public.telemetry_connectors;

  SELECT COALESCE(AVG(evidence_quality_score),0)
  INTO v_data_quality
  FROM public.intelligence_evidence_packets
  WHERE generated_at >= now() - interval '7 days';

  SELECT COALESCE(AVG(activation_percent),0)
  INTO v_coverage
  FROM public.global_telemetry_coverage_command_view;

  SELECT GREATEST(0,100 - COUNT(*) FILTER (WHERE incident_status IN ('open','acknowledged','mitigating')) * 10)
  INTO v_incident_response
  FROM public.enterprise_incidents;

  v_overall := ROUND((
    v_reliability * 0.22 +
    v_security * 0.20 +
    v_observability * 0.18 +
    v_data_quality * 0.15 +
    v_coverage * 0.15 +
    v_incident_response * 0.10
  )::numeric,2);

  v_grade := CASE
    WHEN v_overall >= 90 THEN 'enterprise-ready'
    WHEN v_overall >= 80 THEN 'enterprise-pilot-ready'
    WHEN v_overall >= 70 THEN 'commercial-beta-ready'
    WHEN v_overall >= 60 THEN 'internal-alpha-ready'
    ELSE 'not-ready'
  END;

  v_blockers := (
    SELECT COALESCE(jsonb_agg(blocker),'[]'::jsonb)
    FROM (
      SELECT jsonb_build_object('type','slo_breach','summary',measurement_summary) AS blocker
      FROM public.enterprise_slo_measurements
      WHERE measured_at >= now() - interval '24 hours' AND breach = true
      UNION ALL
      SELECT jsonb_build_object('type','security_finding','summary',finding_title) AS blocker
      FROM public.enterprise_security_findings
      WHERE status = 'open' AND severity IN ('critical','high')
      UNION ALL
      SELECT jsonb_build_object('type','incident','summary',incident_title) AS blocker
      FROM public.enterprise_incidents
      WHERE incident_status IN ('open','acknowledged','mitigating') AND severity IN ('sev1','sev2')
    ) x
  );

  INSERT INTO public.enterprise_readiness_scorecards (
    scorecard_key,
    scorecard_scope,
    reliability_score,
    security_score,
    observability_score,
    data_quality_score,
    telemetry_coverage_score,
    incident_response_score,
    overall_enterprise_score,
    readiness_grade,
    blockers,
    generated_at
  ) VALUES (
    md5('platform|' || date_trunc('hour',now())::text),
    'platform',
    ROUND(v_reliability::numeric,2),
    ROUND(v_security::numeric,2),
    ROUND(v_observability::numeric,2),
    ROUND(v_data_quality::numeric,2),
    ROUND(v_coverage::numeric,2),
    ROUND(v_incident_response::numeric,2),
    v_overall,
    v_grade,
    v_blockers,
    now()
  )
  ON CONFLICT(scorecard_key) DO UPDATE SET
    reliability_score = EXCLUDED.reliability_score,
    security_score = EXCLUDED.security_score,
    observability_score = EXCLUDED.observability_score,
    data_quality_score = EXCLUDED.data_quality_score,
    telemetry_coverage_score = EXCLUDED.telemetry_coverage_score,
    incident_response_score = EXCLUDED.incident_response_score,
    overall_enterprise_score = EXCLUDED.overall_enterprise_score,
    readiness_grade = EXCLUDED.readiness_grade,
    blockers = EXCLUDED.blockers,
    generated_at = now();

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('enterprise-readiness-scorecard','success','grade=' || v_grade || ', score=' || v_overall);

  RETURN jsonb_build_object('status','success','grade',v_grade,'score',v_overall,'blockers',v_blockers);
END;
$$;

-- =====================================================
-- 15. Command views
-- =====================================================
CREATE OR REPLACE VIEW public.enterprise_operations_command_view AS
SELECT
  reg.job_key,
  reg.job_name,
  reg.job_domain,
  reg.criticality,
  reg.enabled,
  latest.status AS latest_status,
  latest.started_at AS latest_started_at,
  latest.completed_at AS latest_completed_at,
  latest.duration_ms AS latest_duration_ms,
  latest.error_message AS latest_error_message,
  CASE
    WHEN latest.started_at IS NULL THEN 'never_run'
    WHEN latest.started_at < now() - make_interval(secs => reg.expected_interval_seconds * 2) THEN 'stale'
    WHEN latest.status IN ('error','failed') THEN 'failing'
    ELSE 'healthy'
  END AS operational_health
FROM public.enterprise_job_registry reg
LEFT JOIN LATERAL (
  SELECT *
  FROM public.enterprise_job_runs jr
  WHERE jr.job_key = reg.job_key
  ORDER BY jr.started_at DESC
  LIMIT 1
) latest ON true
ORDER BY
  CASE reg.criticality WHEN 'critical' THEN 1 WHEN 'strategic' THEN 2 ELSE 3 END,
  reg.job_domain,
  reg.job_name;

CREATE OR REPLACE VIEW public.enterprise_slo_command_view AS
SELECT DISTINCT ON (d.slo_key)
  d.slo_key,
  d.slo_name,
  d.slo_domain,
  d.target_metric,
  d.target_operator,
  d.target_value,
  m.measured_value,
  m.breach,
  m.breach_severity,
  m.measurement_summary,
  m.measured_at
FROM public.enterprise_slo_definitions d
LEFT JOIN public.enterprise_slo_measurements m ON m.slo_key = d.slo_key
WHERE d.enabled = true
ORDER BY d.slo_key, m.measured_at DESC NULLS LAST;

CREATE OR REPLACE VIEW public.enterprise_incident_command_view AS
SELECT
  incident_title,
  incident_domain,
  severity,
  incident_status,
  impact_summary,
  affected_components,
  opened_at,
  acknowledged_at,
  resolved_at,
  postmortem_required
FROM public.enterprise_incidents
ORDER BY
  CASE severity WHEN 'sev1' THEN 1 WHEN 'sev2' THEN 2 WHEN 'sev3' THEN 3 ELSE 4 END,
  opened_at DESC;

CREATE OR REPLACE VIEW public.enterprise_security_command_view AS
SELECT
  finding_title,
  finding_category,
  severity,
  status,
  affected_component,
  remediation_summary,
  owner_team,
  due_at,
  created_at,
  resolved_at
FROM public.enterprise_security_findings
ORDER BY
  CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
  due_at NULLS LAST;

CREATE OR REPLACE VIEW public.enterprise_readiness_command_view AS
SELECT
  scorecard_scope,
  reliability_score,
  security_score,
  observability_score,
  data_quality_score,
  telemetry_coverage_score,
  incident_response_score,
  overall_enterprise_score,
  readiness_grade,
  blockers,
  generated_at
FROM public.enterprise_readiness_scorecards
ORDER BY generated_at DESC;

CREATE OR REPLACE VIEW public.enterprise_dead_letter_command_view AS
SELECT
  source_job_key,
  source_connector_key,
  failure_stage,
  error_type,
  error_message,
  retry_count,
  max_retries,
  next_retry_at,
  status,
  first_failed_at,
  last_failed_at
FROM public.enterprise_dead_letter_queue
ORDER BY
  CASE status WHEN 'open' THEN 1 WHEN 'exhausted' THEN 2 WHEN 'resolved' THEN 3 ELSE 4 END,
  last_failed_at DESC;

-- =====================================================
-- 16. Enterprise hardening orchestrator
-- =====================================================
CREATE OR REPLACE FUNCTION public.run_enterprise_hardening_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r1 jsonb;
  r2 jsonb;
  r3 jsonb;
BEGIN
  r1 := public.measure_enterprise_slos();
  r2 := public.run_security_baseline_check();
  r3 := public.generate_enterprise_readiness_scorecard();

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('enterprise-hardening-cycle','success','enterprise SLO, security, and readiness cycle completed');

  RETURN jsonb_build_object(
    'status','success',
    'slo_measurements',r1,
    'security_baseline',r2,
    'readiness_scorecard',r3
  );
END;
$$;

INSERT INTO public.automation_logs(job_name,status,message)
VALUES (
  'enterprise-reliability-security-hardening',
  'success',
  'enterprise job registry, DLQ, SLOs, incidents, security findings, readiness scorecards, and command views initialized'
);
