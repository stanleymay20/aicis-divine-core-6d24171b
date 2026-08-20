DO $$
DECLARE
  r record;
  auth_fns text[] := ARRAY[
    'has_role','has_export_role','is_org_owner','get_user_org','get_user_tier','get_public_status',
    'audit_prospective_match_quality','check_accumulation_health','check_pilot_scaling_guard',
    'clone_export_preset','evaluate_forecast_readiness','log_pilot_scaling_override',
    'prospective_accumulation_monitor','prospective_coverage_gaps','prospective_domain_breakdown',
    'prospective_horizon_breakdown','prospective_model_breakdown','prospective_summary_stats',
    'refresh_recommendation_quality_scores','replay_backlog_summary','run_milestone_audit',
    'snapshot_prospective_health','start_controlled_pilot_run','transition_risk_action'
  ];
  anon_fns text[] := ARRAY['has_role','has_export_role','is_org_owner','get_public_status'];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND p.proname = ANY(auth_fns)
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    IF r.proname = ANY(anon_fns) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.sig);
    END IF;
  END LOOP;
END;
$$;