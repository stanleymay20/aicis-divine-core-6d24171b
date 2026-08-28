-- AICIS executive reporting epistemic truth floor v1
--
-- Presentation must not outrun evidence. The legacy briefing layer converted missing
-- KPI values to 0/70, republished quarantined causal/intervention outputs, generated
-- speculative SITREP language, and could immediately queue those products for
-- distribution. Preserve historical artifacts for audit, but require explicit
-- evidence semantics and human approval before anything can be distributed.

-- -----------------------------------------------------------------------------
-- 1. Template thresholds were policy constants, not calibrated confidence gates.
-- -----------------------------------------------------------------------------
ALTER TABLE public.executive_briefing_templates
  ALTER COLUMN minimum_confidence DROP DEFAULT,
  ALTER COLUMN minimum_relevance DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_minimum_confidence numeric,
  ADD COLUMN IF NOT EXISTS reported_minimum_relevance numeric,
  ADD COLUMN IF NOT EXISTS selection_policy_semantics text;

UPDATE public.executive_briefing_templates
SET
  reported_minimum_confidence = COALESCE(reported_minimum_confidence, minimum_confidence),
  reported_minimum_relevance = COALESCE(reported_minimum_relevance, minimum_relevance),
  minimum_confidence = NULL,
  minimum_relevance = NULL,
  selection_policy_semantics = COALESCE(
    selection_policy_semantics,
    'legacy_template_thresholds_not_calibrated_confidence_or_relevance'
  );

-- -----------------------------------------------------------------------------
-- 2. Executive reports: quarantine legacy scores and stale approval/publication.
-- -----------------------------------------------------------------------------
ALTER TABLE public.executive_briefing_reports
  ALTER COLUMN global_risk_index DROP DEFAULT,
  ALTER COLUMN confidence_score DROP DEFAULT,
  ALTER COLUMN evidence_quality_score DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_global_risk_index numeric,
  ADD COLUMN IF NOT EXISTS reported_confidence_score numeric,
  ADD COLUMN IF NOT EXISTS reported_evidence_quality_score numeric,
  ADD COLUMN IF NOT EXISTS global_risk_semantics text,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_quality_semantics text,
  ADD COLUMN IF NOT EXISTS content_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'unreviewed'
    CHECK (evidence_status IN ('legacy_unverified','unreviewed','reviewed','approved_for_distribution')),
  ADD COLUMN IF NOT EXISTS approval_evidence_record_keys text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS reported_approved_by uuid,
  ADD COLUMN IF NOT EXISTS reported_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS reported_published_at timestamptz;

UPDATE public.executive_briefing_reports
SET
  reported_global_risk_index = COALESCE(reported_global_risk_index, global_risk_index),
  reported_confidence_score = COALESCE(reported_confidence_score, confidence_score),
  reported_evidence_quality_score = COALESCE(reported_evidence_quality_score, evidence_quality_score),
  global_risk_index = NULL,
  confidence_score = NULL,
  evidence_quality_score = NULL,
  global_risk_semantics = COALESCE(global_risk_semantics, 'legacy_composite_risk_index_semantics_unverified'),
  confidence_semantics = COALESCE(confidence_semantics, 'withheld_not_established_as_epistemic_confidence'),
  evidence_quality_semantics = COALESCE(evidence_quality_semantics, 'legacy_evidence_quality_score_semantics_unverified'),
  content_semantics = COALESCE(content_semantics, 'legacy_system_generated_briefing_content_unverified'),
  evidence_status = 'legacy_unverified',
  approval_evidence_record_keys = '{}',
  reported_approved_by = COALESCE(reported_approved_by, approved_by),
  reported_approved_at = COALESCE(reported_approved_at, approved_at),
  reported_published_at = COALESCE(reported_published_at, published_at),
  approved_by = NULL,
  approved_at = NULL,
  published_at = NULL,
  report_status = 'legacy_quarantined';

CREATE OR REPLACE FUNCTION public.aicis_reporting_semantics_unusable_v1(p_semantics text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_semantics IS NULL
    OR btrim(p_semantics) = ''
    OR lower(p_semantics) LIKE '%legacy%'
    OR lower(p_semantics) LIKE '%unknown%'
    OR lower(p_semantics) LIKE '%unverified%'
    OR lower(p_semantics) LIKE '%unspecified%'
    OR lower(p_semantics) LIKE '%unlabeled%'
    OR lower(p_semantics) LIKE '%withheld%';
$$;

CREATE OR REPLACE FUNCTION public.guard_executive_report_epistemics_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.global_risk_index IS NOT NULL
     AND public.aicis_reporting_semantics_unusable_v1(NEW.global_risk_semantics) THEN
    NEW.reported_global_risk_index := COALESCE(NEW.reported_global_risk_index, NEW.global_risk_index);
    NEW.global_risk_index := NULL;
    NEW.global_risk_semantics := 'withheld_unlabeled_global_risk_index';
  END IF;

  IF NEW.confidence_score IS NOT NULL
     AND public.aicis_reporting_semantics_unusable_v1(NEW.confidence_semantics) THEN
    NEW.reported_confidence_score := COALESCE(NEW.reported_confidence_score, NEW.confidence_score);
    NEW.confidence_score := NULL;
    NEW.confidence_semantics := 'withheld_unlabeled_report_confidence';
  END IF;

  IF NEW.evidence_quality_score IS NOT NULL
     AND public.aicis_reporting_semantics_unusable_v1(NEW.evidence_quality_semantics) THEN
    NEW.reported_evidence_quality_score := COALESCE(NEW.reported_evidence_quality_score, NEW.evidence_quality_score);
    NEW.evidence_quality_score := NULL;
    NEW.evidence_quality_semantics := 'withheld_unlabeled_evidence_quality_score';
  END IF;

  IF NEW.report_status IN ('approved','published') THEN
    IF NEW.evidence_status IS DISTINCT FROM 'approved_for_distribution'
       OR NEW.approved_by IS NULL
       OR NEW.approved_at IS NULL
       OR cardinality(NEW.approval_evidence_record_keys) = 0 THEN
      RAISE EXCEPTION 'report cannot be approved/published without evidence review, approver identity, approval time, and evidence keys';
    END IF;
  END IF;

  IF NEW.published_at IS NOT NULL THEN
    IF NEW.report_status IS DISTINCT FROM 'published'
       OR NEW.evidence_status IS DISTINCT FROM 'approved_for_distribution' THEN
      RAISE EXCEPTION 'published_at requires published status and approved_for_distribution evidence state';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_executive_report_epistemics_v1
ON public.executive_briefing_reports;
CREATE TRIGGER trg_guard_executive_report_epistemics_v1
BEFORE INSERT OR UPDATE ON public.executive_briefing_reports
FOR EACH ROW EXECUTE FUNCTION public.guard_executive_report_epistemics_v1();

REVOKE ALL ON FUNCTION public.aicis_reporting_semantics_unusable_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_executive_report_epistemics_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aicis_reporting_semantics_unusable_v1(text) TO service_role;

-- -----------------------------------------------------------------------------
-- 3. SITREPs: unknown region/severity/development cannot become active certainty.
-- -----------------------------------------------------------------------------
ALTER TABLE public.operational_situation_reports
  ALTER COLUMN severity_band DROP DEFAULT,
  ALTER COLUMN sitrep_status DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_severity_band text,
  ADD COLUMN IF NOT EXISTS severity_semantics text,
  ADD COLUMN IF NOT EXISTS region_semantics text,
  ADD COLUMN IF NOT EXISTS reported_expected_development text,
  ADD COLUMN IF NOT EXISTS development_semantics text,
  ADD COLUMN IF NOT EXISTS content_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'unreviewed';

UPDATE public.operational_situation_reports
SET
  reported_severity_band = COALESCE(reported_severity_band, severity_band),
  severity_band = NULL,
  severity_semantics = COALESCE(severity_semantics, 'legacy_sitrep_severity_semantics_unverified'),
  region_semantics = COALESCE(region_semantics, 'legacy_affected_region_semantics_unverified'),
  reported_expected_development = COALESCE(reported_expected_development, expected_development),
  expected_development = NULL,
  development_semantics = COALESCE(development_semantics, 'withheld_not_supported_as_forecast'),
  content_semantics = COALESCE(content_semantics, 'legacy_generated_sitrep_content_unverified'),
  evidence_status = 'legacy_unverified',
  sitrep_status = 'legacy_quarantined';

-- -----------------------------------------------------------------------------
-- 4. Distribution: block legacy queued artifacts and require explicit approval.
-- -----------------------------------------------------------------------------
ALTER TABLE public.briefing_distribution_log
  ADD COLUMN IF NOT EXISTS authorization_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS distribution_semantics text;

UPDATE public.briefing_distribution_log
SET
  delivery_status = CASE
    WHEN delivery_status = 'queued' THEN 'blocked_unverified'
    ELSE delivery_status
  END,
  authorization_status = 'legacy_unverified',
  distribution_semantics = COALESCE(
    distribution_semantics,
    'legacy_distribution_record_not_evidence_authorization'
  );

-- -----------------------------------------------------------------------------
-- 5. Legacy automatic report/SITREP generation is disabled. Keep compatibility
-- names callable but make them explicit abstention stubs.
-- -----------------------------------------------------------------------------
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
BEGIN
  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES (
    'executive-briefing-generation',
    'skipped',
    'quarantined: executive reports require evidence-reviewed inputs and explicit semantics'
  );

  RETURN jsonb_build_object(
    'status','quarantined',
    'reason','evidence_reviewed_reporting_contract_required',
    'template_key',p_template_key,
    'language_code',p_language_code,
    'window',p_window::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_operational_sitrep_from_top_risk()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES (
    'operational-sitrep-generation',
    'skipped',
    'quarantined: top-risk selection and expected-development synthesis require governed evidence semantics'
  );

  RETURN jsonb_build_object(
    'status','quarantined',
    'reason','governed_sitrep_evidence_contract_required'
  );
END;
$$;

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
  SELECT * INTO rpt
  FROM public.executive_briefing_reports
  WHERE report_key = p_report_key;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','error','message','missing_report');
  END IF;

  IF rpt.report_status NOT IN ('approved','published')
     OR rpt.evidence_status IS DISTINCT FROM 'approved_for_distribution'
     OR rpt.approved_by IS NULL
     OR rpt.approved_at IS NULL
     OR cardinality(rpt.approval_evidence_record_keys) = 0 THEN
    RETURN jsonb_build_object(
      'status','blocked',
      'reason','explicit_human_approval_and_evidence_review_required',
      'report_key',p_report_key
    );
  END IF;

  FOR prof IN
    SELECT *
    FROM public.briefing_distribution_profiles
    WHERE active = true
      AND included_report_types ? rpt.report_type
  LOOP
    INSERT INTO public.briefing_distribution_log(
      distribution_key,
      report_id,
      profile_key,
      delivery_channel,
      delivery_status,
      queued_at,
      authorization_status,
      distribution_semantics
    ) VALUES (
      md5(rpt.id::text || '|' || prof.profile_key),
      rpt.id,
      prof.profile_key,
      'in_app',
      'queued',
      now(),
      'approved',
      'human_approved_evidence_reviewed_distribution_v1'
    )
    ON CONFLICT(distribution_key) DO UPDATE SET
      delivery_status = 'queued',
      queued_at = now(),
      authorization_status = 'approved',
      distribution_semantics = 'human_approved_evidence_reviewed_distribution_v1';
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'status','queued',
    'report_key',p_report_key,
    'distributions_queued',v_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.run_executive_briefing_cycle(
  p_language_code text DEFAULT 'en'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES (
    'executive-briefing-cycle',
    'skipped',
    'quarantined: automatic generation/distribution disabled pending evidence-reviewed reporting pipeline'
  );

  RETURN jsonb_build_object(
    'status','quarantined',
    'language_code',p_language_code,
    'automatic_generation',false,
    'automatic_distribution',false
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Compatibility views expose evidence/authorization state.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.executive_briefing_command_view AS
SELECT
  report_title,
  report_type,
  audience,
  language_code,
  global_risk_index,
  confidence_score,
  evidence_quality_score,
  global_risk_semantics,
  confidence_semantics,
  evidence_quality_semantics,
  evidence_status,
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
  region_semantics,
  severity_band,
  severity_semantics,
  current_state,
  expected_development,
  development_semantics,
  evidence_status,
  next_update_due_at,
  sitrep_status,
  created_at
FROM public.operational_situation_reports
ORDER BY severity_band DESC NULLS LAST, created_at DESC;

CREATE OR REPLACE VIEW public.briefing_distribution_command_view AS
SELECT
  r.report_title,
  p.profile_name,
  p.audience_type,
  d.delivery_channel,
  d.delivery_status,
  d.authorization_status,
  d.distribution_semantics,
  d.queued_at,
  d.delivered_at,
  d.error_message
FROM public.briefing_distribution_log d
JOIN public.executive_briefing_reports r ON r.id = d.report_id
LEFT JOIN public.briefing_distribution_profiles p ON p.profile_key = d.profile_key
ORDER BY d.queued_at DESC;

REVOKE ALL ON FUNCTION public.generate_executive_briefing_report(text,text,interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_operational_sitrep_from_top_risk() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.queue_briefing_distribution(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_executive_briefing_cycle(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.generate_executive_briefing_report(text,text,interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_operational_sitrep_from_top_risk() TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_briefing_distribution(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_executive_briefing_cycle(text) TO service_role;

COMMENT ON TABLE public.executive_briefing_reports IS
  'Executive reporting artifacts. Distribution requires approved_for_distribution evidence state, explicit approver identity/time, and evidence record keys.';
COMMENT ON COLUMN public.executive_briefing_reports.confidence_score IS
  'Nullable governed confidence only when semantics are explicit; legacy 70-style fallbacks are quarantined.';
COMMENT ON TABLE public.operational_situation_reports IS
  'Operational SITREP artifacts. Legacy generated severity/development claims are quarantined; unknown does not become monitor/GLOBAL/current.';
