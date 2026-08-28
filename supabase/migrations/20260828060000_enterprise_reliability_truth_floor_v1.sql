-- Enterprise reliability truth floor v1
-- Corrects false-success defaults in the 20260513120000 enterprise hardening layer.
-- Missing operational evidence remains unknown; it is never promoted to measured success or measured zero.

ALTER TABLE public.enterprise_slo_measurements
  ADD COLUMN IF NOT EXISTS measurement_status text,
  ADD COLUMN IF NOT EXISTS measurement_semantics text,
  ADD COLUMN IF NOT EXISTS observation_count integer,
  ADD COLUMN IF NOT EXISTS coverage_status text;

ALTER TABLE public.enterprise_slo_measurements
  ALTER COLUMN breach DROP DEFAULT;

ALTER TABLE public.enterprise_slo_measurements
  DROP CONSTRAINT IF EXISTS enterprise_slo_measurements_measurement_status_check;
ALTER TABLE public.enterprise_slo_measurements
  ADD CONSTRAINT enterprise_slo_measurements_measurement_status_check
  CHECK (measurement_status IS NULL OR measurement_status IN ('measured','unknown','legacy_unverified','withheld'));

UPDATE public.enterprise_slo_measurements
SET measurement_status = COALESCE(measurement_status, 'legacy_unverified'),
    measurement_semantics = COALESCE(measurement_semantics, 'legacy_enterprise_slo_v0_unverified'),
    coverage_status = COALESCE(coverage_status, 'legacy_unverified')
WHERE measurement_status IS NULL
   OR measurement_semantics IS NULL
   OR coverage_status IS NULL;

ALTER TABLE public.enterprise_readiness_scorecards
  ADD COLUMN IF NOT EXISTS scorecard_status text,
  ADD COLUMN IF NOT EXISTS scorecard_semantics text,
  ADD COLUMN IF NOT EXISTS component_statuses jsonb,
  ADD COLUMN IF NOT EXISTS observation_summary jsonb;

UPDATE public.enterprise_readiness_scorecards
SET scorecard_status = COALESCE(scorecard_status, 'legacy_unverified'),
    scorecard_semantics = COALESCE(scorecard_semantics, 'legacy_enterprise_readiness_v0_unverified'),
    component_statuses = COALESCE(component_statuses, '{}'::jsonb),
    observation_summary = COALESCE(observation_summary, '{}'::jsonb)
WHERE scorecard_status IS NULL
   OR scorecard_semantics IS NULL
   OR component_statuses IS NULL
   OR observation_summary IS NULL;

CREATE OR REPLACE FUNCTION public.record_slo_measurement(
  p_slo_key text,
  p_value numeric,
  p_measurement_status text DEFAULT 'measured',
  p_measurement_semantics text DEFAULT NULL,
  p_observation_count integer DEFAULT NULL,
  p_coverage_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_def public.enterprise_slo_definitions%ROWTYPE;
  v_breach boolean := NULL;
  v_key text;
  v_status text;
  v_summary text;
BEGIN
  SELECT * INTO v_def
  FROM public.enterprise_slo_definitions
  WHERE slo_key = p_slo_key AND enabled = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','skipped','reason','slo_not_found');
  END IF;

  v_status := COALESCE(p_measurement_status, CASE WHEN p_value IS NULL THEN 'unknown' ELSE 'measured' END);
  IF v_status NOT IN ('measured','unknown','legacy_unverified','withheld') THEN
    RAISE EXCEPTION 'Unsupported measurement_status: %', v_status;
  END IF;
  IF p_observation_count IS NOT NULL AND p_observation_count < 0 THEN
    RAISE EXCEPTION 'observation_count cannot be negative';
  END IF;
  IF v_status = 'measured' AND p_value IS NULL THEN
    RAISE EXCEPTION 'Measured SLO value cannot be NULL';
  END IF;

  IF v_status = 'measured' AND p_value IS NOT NULL THEN
    v_breach := CASE v_def.target_operator
      WHEN 'gte' THEN p_value < v_def.target_value
      WHEN 'lte' THEN p_value > v_def.target_value
      WHEN 'eq' THEN p_value <> v_def.target_value
      ELSE NULL
    END;
  END IF;

  v_summary := CASE
    WHEN v_status = 'measured' THEN
      v_def.slo_name || ': measured=' || p_value || ', target=' || v_def.target_operator || ' ' || v_def.target_value
    ELSE
      v_def.slo_name || ': measurement withheld (' || v_status || ')'
  END;

  v_key := md5(p_slo_key || '|' || date_trunc('hour',now())::text);

  INSERT INTO public.enterprise_slo_measurements (
    measurement_key, slo_key, measured_value, target_value, breach, breach_severity,
    measurement_summary, measured_at, measurement_status, measurement_semantics,
    observation_count, coverage_status
  ) VALUES (
    v_key, p_slo_key, CASE WHEN v_status = 'measured' THEN p_value ELSE NULL END,
    v_def.target_value, v_breach,
    CASE WHEN v_breach IS TRUE THEN v_def.severity_if_breached WHEN v_breach IS FALSE THEN 'none' ELSE NULL END,
    v_summary, now(), v_status,
    COALESCE(p_measurement_semantics, CASE WHEN v_status = 'measured' THEN 'direct_operational_measurement_v1' ELSE 'insufficient_operational_evidence_v1' END),
    p_observation_count,
    COALESCE(p_coverage_status, CASE WHEN v_status = 'measured' THEN 'observed' ELSE 'insufficient_observation' END)
  )
  ON CONFLICT(measurement_key) DO UPDATE SET
    measured_value = EXCLUDED.measured_value,
    target_value = EXCLUDED.target_value,
    breach = EXCLUDED.breach,
    breach_severity = EXCLUDED.breach_severity,
    measurement_summary = EXCLUDED.measurement_summary,
    measurement_status = EXCLUDED.measurement_status,
    measurement_semantics = EXCLUDED.measurement_semantics,
    observation_count = EXCLUDED.observation_count,
    coverage_status = EXCLUDED.coverage_status,
    measured_at = now();

  IF v_breach IS TRUE AND v_def.severity_if_breached = 'critical' THEN
    PERFORM public.open_enterprise_incident(
      'SLO breach: ' || v_def.slo_name,
      v_def.slo_domain,
      'sev2',
      'enterprise_slo_measurements',
      'Measured value ' || p_value || ' breached target ' || v_def.target_operator || ' ' || v_def.target_value,
      jsonb_build_array(p_slo_key)
    );
  END IF;

  RETURN jsonb_build_object(
    'status','recorded',
    'slo_key',p_slo_key,
    'measurement_status',v_status,
    'breach',v_breach,
    'observation_count',p_observation_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.measure_enterprise_slos()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connector_health numeric;
  v_connector_count integer := 0;
  v_mesh_activation numeric;
  v_mesh_count integer := 0;
  v_job_success numeric;
  v_job_count integer := 0;
  v_open_incidents numeric := 0;
  v_critical_findings numeric := 0;
  v_analyst_queue numeric := 0;
BEGIN
  SELECT COUNT(*)::integer,
         CASE WHEN COUNT(*) = 0 THEN NULL
              ELSE ROUND((COUNT(*) FILTER (WHERE operational_status NOT IN ('degraded','offline'))::numeric / COUNT(*)::numeric) * 100,2)
         END
  INTO v_connector_count, v_connector_health
  FROM public.telemetry_connectors;

  SELECT COUNT(*)::integer,
         CASE WHEN COUNT(*) = 0 THEN NULL ELSE ROUND(AVG(activation_percent)::numeric,2) END
  INTO v_mesh_count, v_mesh_activation
  FROM public.global_telemetry_coverage_command_view
  WHERE activation_percent IS NOT NULL;

  SELECT COUNT(*)::integer,
         CASE WHEN COUNT(*) = 0 THEN NULL
              ELSE ROUND((COUNT(*) FILTER (WHERE status IN ('success','partial_success'))::numeric / COUNT(*)::numeric) * 100,2)
         END
  INTO v_job_count, v_job_success
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

  PERFORM public.record_slo_measurement(
    'telemetry-connector-health-95', v_connector_health,
    CASE WHEN v_connector_count > 0 THEN 'measured' ELSE 'unknown' END,
    'connector_operational_status_ratio_v1', v_connector_count,
    CASE WHEN v_connector_count > 0 THEN 'observed' ELSE 'insufficient_observation' END
  );
  PERFORM public.record_slo_measurement(
    'global-mesh-coverage-80', v_mesh_activation,
    CASE WHEN v_mesh_count > 0 THEN 'measured' ELSE 'unknown' END,
    'observed_mesh_activation_average_v1', v_mesh_count,
    CASE WHEN v_mesh_count > 0 THEN 'observed' ELSE 'insufficient_observation' END
  );
  PERFORM public.record_slo_measurement(
    'critical-job-success-95', v_job_success,
    CASE WHEN v_job_count > 0 THEN 'measured' ELSE 'unknown' END,
    'critical_job_run_success_ratio_24h_v1', v_job_count,
    CASE WHEN v_job_count > 0 THEN 'observed' ELSE 'insufficient_observation' END
  );
  PERFORM public.record_slo_measurement('open-incident-count-lte-5', v_open_incidents, 'measured', 'observed_open_incident_count_v1', v_open_incidents::integer, 'observed');
  PERFORM public.record_slo_measurement('security-critical-findings-zero', v_critical_findings, 'measured', 'observed_open_critical_finding_count_v1', v_critical_findings::integer, 'observed');
  PERFORM public.record_slo_measurement('analyst-queue-pressure-lte-100', v_analyst_queue, 'measured', 'observed_open_analyst_review_count_v1', v_analyst_queue::integer, 'observed');

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('enterprise-slo-measurement','success','SLO measurement cycle completed with explicit unknown semantics');

  RETURN jsonb_build_object(
    'status','success',
    'connector_health_percent',v_connector_health,
    'connector_observations',v_connector_count,
    'mesh_activation_percent',v_mesh_activation,
    'mesh_observations',v_mesh_count,
    'critical_job_success_percent',v_job_success,
    'critical_job_observations',v_job_count,
    'open_incidents',v_open_incidents,
    'critical_security_findings',v_critical_findings,
    'open_analyst_reviews',v_analyst_queue
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_enterprise_readiness_scorecard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reliability numeric;
  v_security numeric;
  v_observability numeric;
  v_data_quality numeric := NULL;
  v_coverage numeric;
  v_incident_response numeric;
  v_overall numeric := NULL;
  v_grade text := 'ungraded-insufficient-evidence';
  v_blockers jsonb := '[]'::jsonb;
  v_component_statuses jsonb := '{}'::jsonb;
  v_observation_summary jsonb := '{}'::jsonb;
  v_slo_measured integer := 0;
  v_slo_unknown integer := 0;
  v_connector_count integer := 0;
  v_coverage_count integer := 0;
  v_security_check_count integer := 0;
  v_incident_response_count integer := 0;
  v_required_complete boolean := false;
BEGIN
  SELECT COUNT(*) FILTER (WHERE measurement_status = 'measured')::integer,
         COUNT(*) FILTER (WHERE measurement_status IN ('unknown','withheld') OR measurement_status IS NULL)::integer,
         CASE WHEN COUNT(*) FILTER (WHERE measurement_status = 'measured') = 0 THEN NULL
              ELSE ROUND(AVG(CASE WHEN breach IS TRUE THEN 0 WHEN breach IS FALSE THEN 100 ELSE NULL END)::numeric,2)
         END
  INTO v_slo_measured, v_slo_unknown, v_reliability
  FROM public.enterprise_slo_measurements
  WHERE measured_at >= now() - interval '24 hours'
    AND measurement_status <> 'legacy_unverified';

  SELECT COUNT(*)::integer,
         CASE WHEN COUNT(*) = 0 THEN NULL
              ELSE ROUND((COUNT(*) FILTER (WHERE operational_status = 'active')::numeric / COUNT(*)::numeric) * 100,2)
         END
  INTO v_connector_count, v_observability
  FROM public.telemetry_connectors;

  SELECT COUNT(*)::integer,
         CASE WHEN COUNT(*) = 0 THEN NULL ELSE ROUND(AVG(activation_percent)::numeric,2) END
  INTO v_coverage_count, v_coverage
  FROM public.global_telemetry_coverage_command_view
  WHERE activation_percent IS NOT NULL;

  SELECT COUNT(*)::integer
  INTO v_security_check_count
  FROM public.automation_logs
  WHERE job_name = 'security-baseline-check'
    AND status = 'success'
    AND created_at >= now() - interval '24 hours';

  IF v_security_check_count > 0 THEN
    SELECT GREATEST(0,100 - COUNT(*) FILTER (WHERE severity IN ('critical','high') AND status = 'open') * 15)
    INTO v_security
    FROM public.enterprise_security_findings;
  ELSE
    v_security := NULL;
  END IF;

  -- Existing evidence_quality_score has no governed semantics. Preserve it for audit,
  -- but withhold it from enterprise readiness until a later governed metric exists.
  v_data_quality := NULL;

  SELECT COUNT(*)::integer
  INTO v_incident_response_count
  FROM public.enterprise_incidents
  WHERE acknowledged_at IS NOT NULL OR resolved_at IS NOT NULL;

  IF v_incident_response_count > 0 THEN
    SELECT GREATEST(0,100 - COUNT(*) FILTER (WHERE incident_status IN ('open','acknowledged','mitigating')) * 10)
    INTO v_incident_response
    FROM public.enterprise_incidents;
  ELSE
    v_incident_response := NULL;
  END IF;

  v_component_statuses := jsonb_build_object(
    'reliability', CASE WHEN v_reliability IS NULL OR v_slo_unknown > 0 THEN 'insufficient_observation' ELSE 'measured' END,
    'security', CASE WHEN v_security IS NULL THEN 'insufficient_observation' ELSE 'measured' END,
    'observability', CASE WHEN v_observability IS NULL THEN 'insufficient_observation' ELSE 'measured' END,
    'data_quality', 'withheld_ungoverned_semantics',
    'telemetry_coverage', CASE WHEN v_coverage IS NULL THEN 'insufficient_observation' ELSE 'measured' END,
    'incident_response', CASE WHEN v_incident_response IS NULL THEN 'insufficient_observation' ELSE 'measured' END
  );

  v_observation_summary := jsonb_build_object(
    'measured_slos',v_slo_measured,
    'unknown_or_withheld_slos',v_slo_unknown,
    'telemetry_connectors',v_connector_count,
    'telemetry_coverage_rows',v_coverage_count,
    'security_baseline_runs_24h',v_security_check_count,
    'incident_response_observations',v_incident_response_count,
    'data_quality_semantics','withheld_until_governed'
  );

  v_required_complete :=
    v_reliability IS NOT NULL AND v_slo_unknown = 0 AND
    v_security IS NOT NULL AND
    v_observability IS NOT NULL AND
    v_data_quality IS NOT NULL AND
    v_coverage IS NOT NULL AND
    v_incident_response IS NOT NULL;

  IF v_required_complete THEN
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
  END IF;

  v_blockers := (
    SELECT COALESCE(jsonb_agg(blocker),'[]'::jsonb)
    FROM (
      SELECT jsonb_build_object('type','slo_breach','summary',measurement_summary) AS blocker
      FROM public.enterprise_slo_measurements
      WHERE measured_at >= now() - interval '24 hours'
        AND measurement_status = 'measured'
        AND breach IS TRUE
      UNION ALL
      SELECT jsonb_build_object('type','insufficient_observation','component','reliability')
      WHERE v_reliability IS NULL OR v_slo_unknown > 0
      UNION ALL
      SELECT jsonb_build_object('type','insufficient_observation','component','security')
      WHERE v_security IS NULL
      UNION ALL
      SELECT jsonb_build_object('type','insufficient_observation','component','observability')
      WHERE v_observability IS NULL
      UNION ALL
      SELECT jsonb_build_object('type','ungoverned_metric','component','data_quality','reason','evidence_quality_score lacks governed readiness semantics')
      WHERE v_data_quality IS NULL
      UNION ALL
      SELECT jsonb_build_object('type','insufficient_observation','component','telemetry_coverage')
      WHERE v_coverage IS NULL
      UNION ALL
      SELECT jsonb_build_object('type','insufficient_observation','component','incident_response')
      WHERE v_incident_response IS NULL
      UNION ALL
      SELECT jsonb_build_object('type','security_finding','summary',finding_title)
      FROM public.enterprise_security_findings
      WHERE status = 'open' AND severity IN ('critical','high')
      UNION ALL
      SELECT jsonb_build_object('type','incident','summary',incident_title)
      FROM public.enterprise_incidents
      WHERE incident_status IN ('open','acknowledged','mitigating') AND severity IN ('sev1','sev2')
    ) x
  );

  INSERT INTO public.enterprise_readiness_scorecards (
    scorecard_key, scorecard_scope, reliability_score, security_score, observability_score,
    data_quality_score, telemetry_coverage_score, incident_response_score,
    overall_enterprise_score, readiness_grade, blockers, generated_at,
    scorecard_status, scorecard_semantics, component_statuses, observation_summary
  ) VALUES (
    md5('platform|' || date_trunc('hour',now())::text), 'platform',
    v_reliability, v_security, v_observability, v_data_quality, v_coverage, v_incident_response,
    v_overall, v_grade, v_blockers, now(),
    CASE WHEN v_required_complete THEN 'graded' ELSE 'withheld_insufficient_evidence' END,
    'enterprise_readiness_truth_floor_v1', v_component_statuses, v_observation_summary
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
    scorecard_status = EXCLUDED.scorecard_status,
    scorecard_semantics = EXCLUDED.scorecard_semantics,
    component_statuses = EXCLUDED.component_statuses,
    observation_summary = EXCLUDED.observation_summary,
    generated_at = now();

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES (
    'enterprise-readiness-scorecard','success',
    CASE WHEN v_required_complete
      THEN 'graded readiness score generated'
      ELSE 'readiness grade withheld: insufficient governed operational evidence'
    END
  );

  RETURN jsonb_build_object(
    'status',CASE WHEN v_required_complete THEN 'graded' ELSE 'withheld_insufficient_evidence' END,
    'grade',v_grade,
    'score',v_overall,
    'component_statuses',v_component_statuses,
    'observation_summary',v_observation_summary,
    'blockers',v_blockers
  );
END;
$$;

-- Shape changes are intentionally drop/recreate to satisfy clean-restore safety.
DROP VIEW IF EXISTS public.enterprise_slo_command_view;
CREATE VIEW public.enterprise_slo_command_view AS
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
  m.measurement_status,
  m.measurement_semantics,
  m.observation_count,
  m.coverage_status,
  m.measurement_summary,
  m.measured_at
FROM public.enterprise_slo_definitions d
LEFT JOIN public.enterprise_slo_measurements m ON m.slo_key = d.slo_key
WHERE d.enabled = true
ORDER BY d.slo_key, m.measured_at DESC NULLS LAST;

DROP VIEW IF EXISTS public.enterprise_readiness_command_view;
CREATE VIEW public.enterprise_readiness_command_view AS
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
  scorecard_status,
  scorecard_semantics,
  component_statuses,
  observation_summary,
  blockers,
  generated_at
FROM public.enterprise_readiness_scorecards
ORDER BY generated_at DESC;

INSERT INTO public.automation_logs(job_name,status,message)
VALUES (
  'enterprise-reliability-truth-floor-v1',
  'success',
  'false-success defaults removed; readiness now abstains when governed evidence is insufficient'
);
