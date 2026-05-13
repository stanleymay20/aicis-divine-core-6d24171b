-- Executive Briefing + Operational Reporting Layer
-- Converts AICIS intelligence into institution-ready briefings, situation reports,
-- decision memos, and recurring operational publications.

-- =====================================================
-- 1. Briefing templates
-- =====================================================
CREATE TABLE IF NOT EXISTS public.executive_briefing_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text UNIQUE NOT NULL,
  template_name text NOT NULL,
  template_type text NOT NULL DEFAULT 'daily_brief',
  target_audience text DEFAULT 'executive',
  default_language_code text DEFAULT 'en',
  section_schema jsonb DEFAULT '[]'::jsonb,
  minimum_confidence numeric DEFAULT 60,
  minimum_relevance numeric DEFAULT 60,
  enabled boolean DEFAULT true,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.executive_briefing_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_key text UNIQUE NOT NULL,
  template_key text REFERENCES public.executive_briefing_templates(template_key) ON DELETE SET NULL,
  report_title text NOT NULL,
  report_type text DEFAULT 'daily_brief',
  audience text DEFAULT 'executive',
  language_code text DEFAULT 'en',
  reporting_window text DEFAULT '24h',
  global_risk_index numeric DEFAULT 0,
  confidence_score numeric DEFAULT 0,
  evidence_quality_score numeric DEFAULT 0,
  report_status text DEFAULT 'draft',
  executive_summary text,
  key_judgments jsonb DEFAULT '[]'::jsonb,
  top_risks jsonb DEFAULT '[]'::jsonb,
  causal_watchlist jsonb DEFAULT '[]'::jsonb,
  intervention_options jsonb DEFAULT '[]'::jsonb,
  governance_notes jsonb DEFAULT '[]'::jsonb,
  source_evidence jsonb DEFAULT '[]'::jsonb,
  recommended_actions jsonb DEFAULT '[]'::jsonb,
  generated_by text DEFAULT 'system',
  generated_at timestamptz DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  published_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_briefing_reports_type_status
ON public.executive_briefing_reports(report_type, report_status, generated_at DESC);

CREATE TABLE IF NOT EXISTS public.operational_situation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sitrep_key text UNIQUE NOT NULL,
  linked_briefing_id uuid REFERENCES public.executive_briefing_reports(id) ON DELETE SET NULL,
  incident_domain text,
  affected_region text,
  severity_band text DEFAULT 'monitor',
  situation_title text NOT NULL,
  current_state text,
  expected_development text,
  operational_constraints jsonb DEFAULT '[]'::jsonb,
  coordination_requirements jsonb DEFAULT '[]'::jsonb,
  next_update_due_at timestamptz,
  sitrep_status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sitreps_domain_region
ON public.operational_situation_reports(incident_domain, affected_region, severity_band, created_at DESC);

CREATE TABLE IF NOT EXISTS public.briefing_distribution_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_key text UNIQUE NOT NULL,
  profile_name text NOT NULL,
  audience_type text DEFAULT 'executive',
  preferred_language_code text DEFAULT 'en',
  delivery_frequency text DEFAULT 'daily',
  included_report_types jsonb DEFAULT '["daily_brief"]'::jsonb,
  minimum_severity text DEFAULT 'strategic',
  active boolean DEFAULT true,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.briefing_distribution_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_key text UNIQUE NOT NULL,
  report_id uuid REFERENCES public.executive_briefing_reports(id) ON DELETE CASCADE,
  profile_key text REFERENCES public.briefing_distribution_profiles(profile_key) ON DELETE SET NULL,
  delivery_channel text DEFAULT 'in_app',
  delivery_status text DEFAULT 'queued',
  error_message text,
  queued_at timestamptz DEFAULT now(),
  delivered_at timestamptz
);

-- =====================================================
-- 2. Seed templates/profiles
-- =====================================================
INSERT INTO public.executive_briefing_templates(
  template_key,template_name,template_type,target_audience,section_schema,minimum_confidence,minimum_relevance
)
VALUES
('global-daily-executive-brief','Global Daily Executive Brief','daily_brief','executive',
 jsonb_build_array('executive_summary','key_judgments','top_risks','causal_watchlist','intervention_options','governance_notes','recommended_actions'),60,60),
('government-crisis-sitrep','Government Crisis Situation Report','sitrep','government',
 jsonb_build_array('current_state','expected_development','operational_constraints','coordination_requirements','next_actions'),70,70),
('humanitarian-early-warning-brief','Humanitarian Early Warning Brief','early_warning','ngo_humanitarian',
 jsonb_build_array('risk_summary','affected_populations','climate_disaster_watch','food_health_migration_links','recommended_predeployment'),65,65),
('supply-chain-risk-brief','Supply Chain Risk Brief','risk_brief','enterprise_logistics',
 jsonb_build_array('shipping_risk','aviation_risk','weather_disruption','port_chokepoints','rerouting_options'),60,60)
ON CONFLICT(template_key) DO UPDATE SET
  section_schema = EXCLUDED.section_schema,
  updated_at = now();

INSERT INTO public.briefing_distribution_profiles(
  profile_key,profile_name,audience_type,preferred_language_code,delivery_frequency,included_report_types,minimum_severity
)
VALUES
('default-executive','Default Executive Audience','executive','en','daily','["daily_brief","risk_brief"]'::jsonb,'strategic'),
('government-crisis-room','Government Crisis Room','government','en','hourly','["sitrep","daily_brief"]'::jsonb,'critical'),
('humanitarian-operators','Humanitarian Operators','ngo_humanitarian','en','daily','["early_warning","sitrep"]'::jsonb,'strategic')
ON CONFLICT(profile_key) DO UPDATE SET active = true, updated_at = now();

-- =====================================================
-- 3. Briefing generation engine
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_executive_briefing_report(
  p_template_key text DEFAULT 'global-daily-executive-brief',
  p_language_code text DEFAULT 'en',
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tmpl record;
  kpi record;
  v_key text;
  v_title text;
  v_summary text;
  v_top_risks jsonb := '[]'::jsonb;
  v_key_judgments jsonb := '[]'::jsonb;
  v_causal jsonb := '[]'::jsonb;
  v_interventions jsonb := '[]'::jsonb;
  v_governance jsonb := '[]'::jsonb;
  v_actions jsonb := '[]'::jsonb;
  v_evidence jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO tmpl
  FROM public.executive_briefing_templates
  WHERE template_key = p_template_key AND enabled = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','error','message','missing_template');
  END IF;

  PERFORM public.run_executive_dashboard_cycle('global_executive_overview', p_window);

  SELECT * INTO kpi
  FROM public.executive_planetary_dashboard_kpis_view
  WHERE preset_key = 'global_executive_overview'
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'title', insight_title,
    'severity', severity_band,
    'summary', insight_summary,
    'confidence', confidence_score,
    'action', recommended_action
  ) ORDER BY display_rank),'[]'::jsonb)
  INTO v_key_judgments
  FROM public.executive_planetary_insights_view
  WHERE preset_key = 'global_executive_overview'
  LIMIT 10;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'domain', category,
    'title', title,
    'summary', summary,
    'impact', impact_score,
    'urgency', urgency_score,
    'region', affected_countries
  ) ORDER BY COALESCE(impact_score,0) DESC),'[]'::jsonb)
  INTO v_top_risks
  FROM (
    SELECT *
    FROM public.global_signals
    WHERE COALESCE(ingested_at,created_at) >= now() - p_window
      AND COALESCE(canonical_event_status,'canonical') = 'canonical'
    ORDER BY COALESCE(impact_score,0) DESC, COALESCE(urgency_score,0) DESC
    LIMIT 10
  ) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'source_event', source_event,
    'source_domain', source_domain,
    'impacted_system', impacted_system,
    'probability', impact_probability,
    'severity', impact_severity,
    'time_window', projected_time_window
  ) ORDER BY impact_probability DESC),'[]'::jsonb)
  INTO v_causal
  FROM public.planetary_causal_command_view
  LIMIT 10;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'simulation', simulation_name,
    'strategy', strategy_key,
    'risk_reduction', risk_reduction_score,
    'confidence', confidence_score,
    'feasibility', execution_feasibility
  ) ORDER BY risk_reduction_score DESC),'[]'::jsonb)
  INTO v_interventions
  FROM public.intervention_simulation_command_view
  LIMIT 10;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'workflow', workflow_key,
    'simulation', simulation_name,
    'approval_status', approval_status,
    'safety_rating', safety_rating,
    'evidence_gate', evidence_gate_status
  ) ORDER BY created_at DESC),'[]'::jsonb)
  INTO v_governance
  FROM public.intervention_governance_command_view
  LIMIT 10;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'action', action_title,
    'summary', action_summary,
    'urgency', urgency_band,
    'effectiveness', expected_effectiveness
  ) ORDER BY expected_effectiveness DESC),'[]'::jsonb)
  INTO v_actions
  FROM public.executive_action_register_view
  LIMIT 10;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'source_type','telemetry_coverage',
    'domain', coverage_domain,
    'activation_percent', activation_percent,
    'active_cells', active_cells
  )),'[]'::jsonb)
  INTO v_evidence
  FROM public.global_telemetry_coverage_command_view;

  v_title := tmpl.template_name || ' - ' || to_char(now(),'YYYY-MM-DD HH24:MI UTC');
  v_summary := 'AICIS briefing generated from executive KPIs, global signals, causal propagation, intervention simulations, governance workflows, and telemetry coverage.';
  v_key := md5(p_template_key || '|' || p_language_code || '|' || date_trunc('hour',now())::text);

  INSERT INTO public.executive_briefing_reports(
    report_key,template_key,report_title,report_type,audience,language_code,reporting_window,
    global_risk_index,confidence_score,evidence_quality_score,report_status,executive_summary,
    key_judgments,top_risks,causal_watchlist,intervention_options,governance_notes,source_evidence,recommended_actions,
    generated_by,generated_at
  ) VALUES (
    v_key, p_template_key, v_title, tmpl.template_type, tmpl.target_audience, p_language_code, p_window::text,
    COALESCE(kpi.global_risk_index,0),
    COALESCE(kpi.institutional_trust_score,70),
    COALESCE(kpi.evidence_quality_score,70),
    'draft',
    v_summary,
    v_key_judgments,
    v_top_risks,
    v_causal,
    v_interventions,
    v_governance,
    v_evidence,
    v_actions,
    'system',
    now()
  )
  ON CONFLICT(report_key) DO UPDATE SET
    global_risk_index = EXCLUDED.global_risk_index,
    confidence_score = EXCLUDED.confidence_score,
    evidence_quality_score = EXCLUDED.evidence_quality_score,
    executive_summary = EXCLUDED.executive_summary,
    key_judgments = EXCLUDED.key_judgments,
    top_risks = EXCLUDED.top_risks,
    causal_watchlist = EXCLUDED.causal_watchlist,
    intervention_options = EXCLUDED.intervention_options,
    governance_notes = EXCLUDED.governance_notes,
    source_evidence = EXCLUDED.source_evidence,
    recommended_actions = EXCLUDED.recommended_actions,
    generated_at = now();

  RETURN jsonb_build_object('status','success','report_key',v_key,'title',v_title);
END;
$$;

-- =====================================================
-- 4. SITREP generator
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_operational_sitrep_from_top_risk()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  risk record;
  v_key text;
BEGIN
  SELECT * INTO risk
  FROM public.global_signals
  WHERE COALESCE(canonical_event_status,'canonical') = 'canonical'
  ORDER BY COALESCE(impact_score,0) DESC, COALESCE(urgency_score,0) DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','skipped','message','no_signal_found');
  END IF;

  v_key := md5('sitrep|' || risk.id::text || '|' || date_trunc('hour',now())::text);

  INSERT INTO public.operational_situation_reports(
    sitrep_key,incident_domain,affected_region,severity_band,situation_title,
    current_state,expected_development,operational_constraints,coordination_requirements,
    next_update_due_at,sitrep_status,created_at,updated_at
  ) VALUES (
    v_key,
    risk.category,
    COALESCE(array_to_string(risk.affected_countries,','),'GLOBAL'),
    CASE WHEN COALESCE(risk.impact_score,0) >= 85 THEN 'critical' WHEN COALESCE(risk.impact_score,0) >= 70 THEN 'strategic' ELSE 'monitor' END,
    risk.title,
    risk.summary,
    'Monitor propagation, update causal watchlist, and validate intervention options as new telemetry arrives.',
    jsonb_build_array('telemetry uncertainty','coordination latency','source confidence variation'),
    jsonb_build_array('analyst review','executive awareness','domain owner coordination'),
    now() + interval '6 hours',
    'active',
    now(),now()
  )
  ON CONFLICT(sitrep_key) DO UPDATE SET
    current_state = EXCLUDED.current_state,
    expected_development = EXCLUDED.expected_development,
    updated_at = now();

  RETURN jsonb_build_object('status','success','sitrep_key',v_key);
END;
$$;

-- =====================================================
-- 5. Distribution queue
-- =====================================================
CREATE OR REPLACE FUNCTION public.queue_briefing_distribution(
  p_report_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rpt record;
  prof record;
  v_count integer := 0;
BEGIN
  SELECT * INTO rpt FROM public.executive_briefing_reports WHERE report_key = p_report_key;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','error','message','missing_report');
  END IF;

  FOR prof IN
    SELECT * FROM public.briefing_distribution_profiles
    WHERE active = true
      AND included_report_types ? rpt.report_type
  LOOP
    INSERT INTO public.briefing_distribution_log(
      distribution_key,report_id,profile_key,delivery_channel,delivery_status,queued_at
    ) VALUES (
      md5(rpt.id::text || '|' || prof.profile_key),
      rpt.id,
      prof.profile_key,
      'in_app',
      'queued',
      now()
    )
    ON CONFLICT(distribution_key) DO UPDATE SET delivery_status = 'queued', queued_at = now();
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('status','success','distributions_queued',v_count);
END;
$$;

-- =====================================================
-- 6. Command views
-- =====================================================
CREATE OR REPLACE VIEW public.executive_briefing_command_view AS
SELECT
  report_title,
  report_type,
  audience,
  language_code,
  global_risk_index,
  confidence_score,
  evidence_quality_score,
  report_status,
  generated_at,
  approved_at,
  published_at
FROM public.executive_briefing_reports
ORDER BY generated_at DESC;

CREATE OR REPLACE VIEW public.operational_sitrep_command_view AS
SELECT
  situation_title,
  incident_domain,
  affected_region,
  severity_band,
  current_state,
  expected_development,
  next_update_due_at,
  sitrep_status,
  created_at
FROM public.operational_situation_reports
ORDER BY
  CASE severity_band WHEN 'critical' THEN 1 WHEN 'strategic' THEN 2 ELSE 3 END,
  created_at DESC;

CREATE OR REPLACE VIEW public.briefing_distribution_command_view AS
SELECT
  r.report_title,
  p.profile_name,
  p.audience_type,
  d.delivery_channel,
  d.delivery_status,
  d.queued_at,
  d.delivered_at,
  d.error_message
FROM public.briefing_distribution_log d
JOIN public.executive_briefing_reports r ON r.id = d.report_id
LEFT JOIN public.briefing_distribution_profiles p ON p.profile_key = d.profile_key
ORDER BY d.queued_at DESC;

-- =====================================================
-- 7. Briefing cycle orchestrator
-- =====================================================
CREATE OR REPLACE FUNCTION public.run_executive_briefing_cycle(
  p_language_code text DEFAULT 'en'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r1 jsonb;
  r2 jsonb;
  v_report_key text;
  r3 jsonb;
BEGIN
  r1 := public.generate_executive_briefing_report('global-daily-executive-brief', p_language_code, interval '24 hours');
  r2 := public.generate_operational_sitrep_from_top_risk();
  v_report_key := r1->>'report_key';
  IF v_report_key IS NOT NULL THEN
    r3 := public.queue_briefing_distribution(v_report_key);
  ELSE
    r3 := jsonb_build_object('status','skipped');
  END IF;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('executive-briefing-cycle','success','language=' || p_language_code);

  RETURN jsonb_build_object('status','success','briefing',r1,'sitrep',r2,'distribution',r3);
END;
$$;

INSERT INTO public.automation_logs(job_name,status,message)
VALUES (
  'executive-briefing-and-operational-reporting',
  'success',
  'briefing templates, report generation, SITREPs, distribution profiles, and briefing cycle initialized'
);
