-- AICIS executive reporting content approval guard v1
--
-- Approval metadata alone is insufficient if the report body still carries legacy
-- generated-content semantics. Require usable content semantics at both row approval
-- and distribution time.

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
       OR cardinality(NEW.approval_evidence_record_keys) = 0
       OR public.aicis_reporting_semantics_unusable_v1(NEW.content_semantics) THEN
      RAISE EXCEPTION 'report cannot be approved/published without reviewed content semantics, evidence review, approver identity/time, and evidence keys';
    END IF;
  END IF;

  IF NEW.published_at IS NOT NULL THEN
    IF NEW.report_status IS DISTINCT FROM 'published'
       OR NEW.evidence_status IS DISTINCT FROM 'approved_for_distribution'
       OR public.aicis_reporting_semantics_unusable_v1(NEW.content_semantics) THEN
      RAISE EXCEPTION 'published_at requires published status, approved_for_distribution evidence state, and reviewed content semantics';
    END IF;
  END IF;

  RETURN NEW;
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
     OR cardinality(rpt.approval_evidence_record_keys) = 0
     OR public.aicis_reporting_semantics_unusable_v1(rpt.content_semantics) THEN
    RETURN jsonb_build_object(
      'status','blocked',
      'reason','reviewed_content_human_approval_and_evidence_review_required',
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

REVOKE ALL ON FUNCTION public.guard_executive_report_epistemics_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.queue_briefing_distribution(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.queue_briefing_distribution(text) TO service_role;
