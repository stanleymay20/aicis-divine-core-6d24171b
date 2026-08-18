CREATE OR REPLACE FUNCTION public.compute_pns_certification()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g jsonb := '[]'::jsonb;
  v numeric;
  n int;
  n2 int;
  b boolean;
  total int;
  passed int;
  score numeric;
  res jsonb;
BEGIN
  -- A. SENSING
  SELECT count(DISTINCT ingestion_source) INTO n
    FROM global_signals WHERE ingested_at > now() - interval '24 hours';
  g := g || jsonb_build_object('gate','A_sensing','metric','distinct ingestion sources (24h)',
       'target',10,'value',n,'status', CASE WHEN n >= 10 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','global_signals.ingestion_source distinct count over 24h');

  -- B. COVERAGE
  SELECT count(DISTINCT geo_admin0_iso3) INTO n
    FROM global_signals WHERE ingested_at > now() - interval '30 days' AND geo_admin0_iso3 IS NOT NULL;
  g := g || jsonb_build_object('gate','B_coverage','metric','distinct resolved ISO3 countries (30d)',
       'target',150,'value',n,'status', CASE WHEN n >= 150 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','global_signals.geo_admin0_iso3 distinct count over 30d');

  -- C. FRESHNESS
  SELECT COALESCE(EXTRACT(epoch FROM (now() - max(ingested_at)))/60, 999999) INTO v FROM global_signals;
  g := g || jsonb_build_object('gate','C_freshness','metric','minutes since newest signal',
       'target','<= 120','value',round(v,1),'status', CASE WHEN v <= 120 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','max(global_signals.ingested_at)');

  -- D. PROVENANCE
  SELECT COALESCE(100.0 * count(*) FILTER (WHERE source_references IS NOT NULL
           AND jsonb_typeof(source_references) = 'array' AND jsonb_array_length(source_references) > 0)
         / NULLIF(count(*),0), 0) INTO v
    FROM global_signals WHERE ingested_at > now() - interval '7 days';
  g := g || jsonb_build_object('gate','D_provenance','metric','% of 7d signals with source references',
       'target',90,'value',round(v,2),'status', CASE WHEN v >= 90 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','global_signals.source_references non-empty share over 7d');

  -- E. SEMANTIC ACCURACY
  g := g || jsonb_build_object('gate','E_semantic_accuracy','metric','macro F1 on labelled evaluation set',
       'target',0.80,'value',null,'status','FAIL',
       'evidence','NOT MEASURABLE: no human-labelled classification evaluation set exists in production');

  -- F. ENTITY / GEO RESOLUTION
  SELECT COALESCE(100.0 * count(*) FILTER (WHERE geo_admin0_iso3 IS NOT NULL) / NULLIF(count(*),0),0) INTO v
    FROM global_signals WHERE ingested_at > now() - interval '7 days';
  g := g || jsonb_build_object('gate','F_entity_resolution','metric','% of 7d signals resolved to a country',
       'target',70,'value',round(v,2),'status', CASE WHEN v >= 70 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','global_signals.geo_admin0_iso3 non-null share over 7d');

  -- G. CAUSAL REASONING
  SELECT count(*) INTO n FROM planetary_propagation_events WHERE generated_at > now() - interval '7 days';
  g := g || jsonb_build_object('gate','G_causal','metric','causal propagation events (7d)',
       'target',50,'value',n,'status', CASE WHEN n >= 50 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','planetary_propagation_events count over 7d');

  -- H. FORECAST CALIBRATION
  SELECT avg(brier_score) INTO v FROM risk_prediction_realizations
    WHERE realized_at > now() - interval '90 days' AND brier_score IS NOT NULL;
  g := g || jsonb_build_object('gate','H_forecast_calibration','metric','mean Brier score of realized predictions (90d)',
       'target','<= 0.20','value',round(COALESCE(v,1),4),
       'status', CASE WHEN v IS NOT NULL AND v <= 0.20 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','risk_prediction_realizations.brier_score mean over 90d');

  -- I. MULTI-AGENT REASONING
  IF to_regclass('public.agent_coordination_tasks') IS NULL THEN
    g := g || jsonb_build_object('gate','I_multi_agent','metric','agent analyses with cited evidence (7d)',
         'target',1,'value',null,'status','FAIL',
         'evidence','NOT DEPLOYED: agent_coordination_tasks does not exist in production (repo/production drift)');
  ELSE
    EXECUTE 'SELECT count(*) FROM public.agent_coordination_tasks WHERE created_at > now() - interval ''7 days''' INTO n;
    g := g || jsonb_build_object('gate','I_multi_agent','metric','agent coordination tasks (7d)',
         'target',20,'value',n,'status', CASE WHEN n >= 20 THEN 'PASS' ELSE 'FAIL' END,
         'evidence','agent_coordination_tasks count over 7d');
  END IF;

  -- J. GOVERNANCE
  SELECT count(*) INTO n FROM risk_action_recommendations
    WHERE executed_at IS NOT NULL AND requires_dual_approval = true
      AND (first_approver IS NULL OR second_approver IS NULL);
  g := g || jsonb_build_object('gate','J_governance','metric','dual-approval actions executed without two approvers',
       'target',0,'value',n,'status', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','risk_action_recommendations executed with requires_dual_approval and missing approvers');

  -- K. ACTUATION
  SELECT count(*) INTO n FROM risk_action_recommendations WHERE executed_at > now() - interval '30 days';
  g := g || jsonb_build_object('gate','K_actuation','metric','recommendations executed (30d)',
       'target',1,'value',n,'status', CASE WHEN n >= 1 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','risk_action_recommendations.executed_at count over 30d');

  -- L. OUTCOME LEARNING
  SELECT count(*) INTO n FROM risk_prediction_realizations WHERE realized_at > now() - interval '30 days';
  g := g || jsonb_build_object('gate','L_outcome_learning','metric','predictions realized and scored (30d)',
       'target',100,'value',n,'status', CASE WHEN n >= 100 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','risk_prediction_realizations count over 30d');

  -- M. MEMORY
  SELECT count(*) INTO n FROM ledger_entries WHERE created_at > now() - interval '7 days';
  g := g || jsonb_build_object('gate','M_memory','metric','hash-chained ledger entries written (7d)',
       'target',100,'value',n,'status', CASE WHEN n >= 100 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','ledger_entries count over 7d');

  -- N. RELIABILITY
  SELECT COALESCE(100.0 * count(*) FILTER (WHERE status IN ('success','partial')) / NULLIF(count(*),0),0) INTO v
    FROM automation_logs WHERE executed_at > now() - interval '24 hours';
  g := g || jsonb_build_object('gate','N_reliability','metric','% automation runs succeeding (24h)',
       'target',95,'value',round(v,2),'status', CASE WHEN v >= 95 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','automation_logs status distribution over 24h');

  -- O. SECURITY
  SELECT count(*) INTO n
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false;
  g := g || jsonb_build_object('gate','O_security','metric','public tables without row level security',
       'target',0,'value',n,'status', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','pg_class.relrowsecurity = false in schema public');

  -- P. OBSERVABILITY
  SELECT COALESCE(100.0 * count(*) FILTER (
           WHERE last_success_at IS NOT NULL
             AND last_success_at > now() - (COALESCE(expected_interval_minutes,60) * 3) * interval '1 minute')
         / NULLIF(count(*),0),0) INTO v
    FROM pipeline_heartbeats WHERE enabled = true;
  g := g || jsonb_build_object('gate','P_observability','metric','% enabled pipelines within 3x expected interval',
       'target',90,'value',round(v,2),'status', CASE WHEN v >= 90 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','pipeline_heartbeats.last_success_at vs expected_interval_minutes');

  -- Q. DISASTER RECOVERY
  g := g || jsonb_build_object('gate','Q_disaster_recovery','metric','verified restore drill in last 90d',
       'target',1,'value',null,'status','FAIL',
       'evidence','NOT MEASURABLE: no restore-drill record exists in production');

  -- R. KNOWLEDGE GRAPH INTEGRITY
  SELECT COALESCE(100.0 * count(*) FILTER (WHERE evidence_status = 'measured') / NULLIF(count(*),0), 0)
    INTO v FROM graph_relationship_evidence;
  SELECT count(*) INTO n FROM graph_relationship_evidence;
  g := g || jsonb_build_object('gate','R_graph_integrity','metric','% of graph relationships backed by measurement',
       'target',80,'value',round(v,2),'status', CASE WHEN n > 0 AND v >= 80 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','graph_relationship_evidence.evidence_status = measured share ('||n||' total edges)');

  -- S. WEAK-SIGNAL DISCOVERY
  SELECT count(*) INTO n FROM weak_signal_runs
    WHERE started_at > now() - interval '7 days' AND status = 'success';
  SELECT count(*) INTO n2 FROM weak_signal_detections WHERE detected_at > now() - interval '7 days';
  g := g || jsonb_build_object('gate','S_weak_signal_discovery','metric','successful discovery runs on non-stale input (7d)',
       'target',1,'value',n,'status', CASE WHEN n >= 1 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','weak_signal_runs status=success over 7d; '||n2||' detections written in the same window');

  -- T. HYPOTHESIS TESTING
  SELECT count(*) INTO n FROM hypothesis_evaluations WHERE evaluated_at > now() - interval '30 days';
  SELECT count(*) INTO n2 FROM intelligence_hypotheses WHERE status = 'supported';
  g := g || jsonb_build_object('gate','T_hypothesis_testing','metric','hypothesis evaluations recorded (30d)',
       'target',5,'value',n,'status', CASE WHEN n >= 5 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','hypothesis_evaluations over 30d; '||n2||' hypotheses currently supported by evidence');

  -- U. PREDICTION LEDGER
  SELECT (public.verify_prediction_ledger_chain()->>'chain_valid')::boolean INTO b;
  SELECT COALESCE(100.0 * count(o.id) / NULLIF(count(p.id),0), 0) INTO v
    FROM prediction_ledger p LEFT JOIN prediction_ledger_outcomes o ON o.ledger_id = p.id
   WHERE p.target_date <= CURRENT_DATE;
  g := g || jsonb_build_object('gate','U_prediction_ledger','metric','% of due sealed predictions scored, with valid hash chain',
       'target',50,'value',round(v,2),
       'status', CASE WHEN COALESCE(b,false) AND v >= 50 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','prediction_ledger due-vs-scored share; chain_valid='||COALESCE(b,false));

  -- V. DOMAIN SIGNAL VIABILITY
  SELECT count(*) INTO n FROM (
    SELECT domain FROM country_performance_snapshots
     WHERE snapshot_date > CURRENT_DATE - 365
       AND domain IN ('governance','health','energy','finance','food','security','education','climate','population')
     GROUP BY domain
    HAVING stddev_samp(performance_index) IS NULL OR stddev_samp(performance_index) < 0.5) dead;
  g := g || jsonb_build_object('gate','V_domain_viability','metric','core domains with a dead (non-varying) signal',
       'target',0,'value',n,'status', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','country_performance_snapshots.performance_index stddev < 0.5 over 365d across the 9 core domains');

  SELECT count(*), count(*) FILTER (WHERE e->>'status' = 'PASS')
    INTO total, passed FROM jsonb_array_elements(g) e;

  score := round(100.0 * passed / NULLIF(total,0), 2);

  INSERT INTO pns_certification_runs (overall_score, gates_total, gates_passed, gates)
  VALUES (score, total, passed, g)
  RETURNING jsonb_build_object('run_id', id, 'overall_score', overall_score,
    'gates_total', gates_total, 'gates_passed', gates_passed, 'gates', gates) INTO res;

  RETURN res;
END;
$$;

-- Automation for all five layers
SELECT cron.schedule('pns-graph-evidence-refresh', '20 */6 * * *',
  $$SELECT public.refresh_graph_relationship_evidence();$$);
SELECT cron.schedule('pns-weak-signal-discovery', '35 2 * * *',
  $$SELECT public.detect_weak_signals();$$);
SELECT cron.schedule('pns-hypothesis-evaluation', '50 3 * * 1',
  $$SELECT public.evaluate_all_hypotheses();$$);
SELECT cron.schedule('pns-prediction-ledger-seal', '10 * * * *',
  $$SELECT public.seal_predictions_into_ledger(5000);$$);
SELECT cron.schedule('pns-prediction-ledger-realize', '40 * * * *',
  $$SELECT public.realize_prediction_ledger(10000);$$);
SELECT cron.schedule('pns-certification-daily', '15 5 * * *',
  $$SELECT public.compute_pns_certification();$$);