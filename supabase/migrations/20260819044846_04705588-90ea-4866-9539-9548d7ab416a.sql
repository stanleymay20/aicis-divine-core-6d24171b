CREATE OR REPLACE FUNCTION public.compute_pns_certification()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g jsonb := '[]'::jsonb; v numeric; n int; n2 int; b boolean;
  total int; passed int; score numeric; res jsonb;
  chain jsonb; prosp record;
BEGIN
  SELECT count(DISTINCT ingestion_source) INTO n FROM global_signals WHERE ingested_at > now() - interval '24 hours';
  g := g || jsonb_build_object('gate','A_sensing','metric','distinct ingestion sources (24h)','target',10,'value',n,
       'status', CASE WHEN n >= 10 THEN 'PASS' ELSE 'FAIL' END,'evidence','global_signals.ingestion_source distinct over 24h');

  SELECT count(DISTINCT geo_admin0_iso3) INTO n FROM global_signals WHERE ingested_at > now() - interval '7 days' AND geo_admin0_iso3 IS NOT NULL;
  g := g || jsonb_build_object('gate','B_coverage','metric','countries with signals (7d)','target',150,'value',n,
       'status', CASE WHEN n >= 150 THEN 'PASS' ELSE 'FAIL' END,'evidence','distinct global_signals.geo_admin0_iso3 over 7d');

  SELECT COALESCE(EXTRACT(epoch FROM now() - max(ingested_at))/60,999999) INTO v FROM global_signals;
  g := g || jsonb_build_object('gate','C_freshness','metric','minutes since newest signal','target','<= 120','value',round(v,1),
       'status', CASE WHEN v <= 120 THEN 'PASS' ELSE 'FAIL' END,'evidence','max(global_signals.ingested_at)');

  SELECT COALESCE(100.0*count(*) FILTER (WHERE primary_source IS NOT NULL)/NULLIF(count(*),0),0) INTO v
    FROM global_signals WHERE ingested_at > now() - interval '7 days';
  g := g || jsonb_build_object('gate','D_provenance','metric','% of 7d signals carrying a primary source','target',95,'value',round(v,2),
       'status', CASE WHEN v >= 95 THEN 'PASS' ELSE 'FAIL' END,'evidence','global_signals.primary_source non-null share over 7d');

  SELECT COALESCE(100.0*count(*) FILTER (WHERE publisher_key IS NOT NULL)/NULLIF(count(*),0),0) INTO v
    FROM intelligence_citations WHERE created_at > now() - interval '30 days';
  g := g || jsonb_build_object('gate','E_official_sources','metric','% of 30d citations matched to a registered publisher','target',60,'value',round(v,2),
       'status', CASE WHEN v >= 60 THEN 'PASS' ELSE 'FAIL' END,'evidence','intelligence_citations.publisher_key matched share over 30d');

  SELECT COALESCE(100.0*count(*) FILTER (WHERE geo_admin0_iso3 IS NOT NULL)/NULLIF(count(*),0),0) INTO v
    FROM global_signals WHERE ingested_at > now() - interval '7 days';
  g := g || jsonb_build_object('gate','F_entity_resolution','metric','% of 7d signals resolved to a country','target',70,'value',round(v,2),
       'status', CASE WHEN v >= 70 THEN 'PASS' ELSE 'FAIL' END,'evidence','global_signals.geo_admin0_iso3 non-null share over 7d');

  SELECT count(*) INTO n FROM planetary_propagation_events WHERE created_at > now() - interval '7 days';
  g := g || jsonb_build_object('gate','G_causal','metric','causal propagation events (7d)','target',50,'value',n,
       'status', CASE WHEN n >= 50 THEN 'PASS' ELSE 'FAIL' END,'evidence','planetary_propagation_events count over 7d');

  SELECT avg(brier_score) INTO v FROM risk_prediction_realizations WHERE realized_at > now() - interval '90 days' AND brier_score IS NOT NULL;
  g := g || jsonb_build_object('gate','H_forecast_calibration','metric','mean Brier score of realized predictions (90d)','target','<= 0.20',
       'value',round(COALESCE(v,1),4),'status', CASE WHEN v IS NOT NULL AND v <= 0.20 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','risk_prediction_realizations.brier_score mean over 90d');

  g := g || public.compute_pns_certification_gate_i();

  SELECT count(*) INTO n FROM risk_action_recommendations WHERE executed_at IS NOT NULL AND status = 'executed' AND accepted_at IS NULL;
  g := g || jsonb_build_object('gate','J_governance','metric','executed recommendations with no recorded acceptance','target',0,'value',n,
       'status', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END,'evidence','risk_action_recommendations executed without accepted_at');

  SELECT count(*) INTO n FROM risk_action_recommendations WHERE executed_at > now() - interval '30 days';
  g := g || jsonb_build_object('gate','K_actuation','metric','recommendations executed (30d)','target',1,'value',n,
       'status', CASE WHEN n >= 1 THEN 'PASS' ELSE 'FAIL' END,'evidence','risk_action_recommendations.executed_at count over 30d');

  SELECT count(*) INTO n FROM risk_prediction_realizations WHERE realized_at > now() - interval '30 days';
  g := g || jsonb_build_object('gate','L_outcome_learning','metric','predictions realized and scored (30d)','target',100,'value',n,
       'status', CASE WHEN n >= 100 THEN 'PASS' ELSE 'FAIL' END,'evidence','risk_prediction_realizations count over 30d');

  SELECT count(*) INTO n FROM ledger_entries WHERE created_at > now() - interval '7 days';
  g := g || jsonb_build_object('gate','M_memory','metric','hash-chained ledger entries written (7d)','target',100,'value',n,
       'status', CASE WHEN n >= 100 THEN 'PASS' ELSE 'FAIL' END,'evidence','ledger_entries count over 7d');

  SELECT COALESCE(100.0*count(*) FILTER (WHERE status IN ('success','partial'))/NULLIF(count(*),0),0) INTO v
    FROM automation_logs WHERE created_at > now() - interval '24 hours';
  g := g || jsonb_build_object('gate','N_reliability','metric','% automation runs succeeding (24h)','target',95,'value',round(v,2),
       'status', CASE WHEN v >= 95 THEN 'PASS' ELSE 'FAIL' END,'evidence','automation_logs status distribution over 24h');

  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false;
  g := g || jsonb_build_object('gate','O_security','metric','public tables without row level security','target',0,'value',n,
       'status', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END,'evidence','pg_class.relrowsecurity = false in schema public');

  SELECT COALESCE(100.0*count(*) FILTER (
           WHERE last_success_at IS NOT NULL AND last_success_at > now() - (COALESCE(expected_interval_minutes,60)*3)*interval '1 minute')
         /NULLIF(count(*),0),0) INTO v FROM pipeline_heartbeats;
  g := g || jsonb_build_object('gate','P_observability','metric','% pipelines within 3x expected interval','target',90,'value',round(v,2),
       'status', CASE WHEN v >= 90 THEN 'PASS' ELSE 'FAIL' END,'evidence','pipeline_heartbeats.last_success_at vs expected_interval_minutes');

  g := g || jsonb_build_object('gate','Q_disaster_recovery','metric','verified restore drill in last 90d','target',1,'value',null,'status','FAIL',
       'evidence','NOT MEASURABLE: no restore-drill record exists in production');

  SELECT COALESCE(100.0*count(*) FILTER (WHERE evidence_status = 'measured')/NULLIF(count(*),0),0), count(*) INTO v, n FROM graph_relationship_evidence;
  g := g || jsonb_build_object('gate','R_graph_integrity','metric','% of graph relationships backed by measurement','target',80,'value',round(v,2),
       'status', CASE WHEN n > 0 AND v >= 80 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','graph_relationship_evidence.evidence_status = measured share ('||n||' total edges)');

  SELECT count(*) INTO n FROM weak_signal_runs WHERE started_at > now() - interval '7 days' AND status = 'success';
  SELECT count(*) INTO n2 FROM weak_signal_detections WHERE detected_at > now() - interval '7 days';
  g := g || jsonb_build_object('gate','S_weak_signal_discovery','metric','successful discovery runs (7d)','target',1,'value',n,
       'status', CASE WHEN n >= 1 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','weak_signal_runs status=success over 7d; '||n2||' detections written in the same window');

  SELECT count(*) INTO n FROM hypothesis_evaluations WHERE evaluated_at > now() - interval '30 days';
  SELECT count(*) INTO n2 FROM intelligence_hypotheses WHERE status = 'supported';
  g := g || jsonb_build_object('gate','T_hypothesis_testing','metric','hypothesis evaluations recorded (30d)','target',5,'value',n,
       'status', CASE WHEN n >= 5 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','hypothesis_evaluations over 30d; '||n2||' hypotheses currently supported by evidence');

  SELECT * INTO prosp FROM prospective_skill_verified;
  SELECT count(*) INTO n FROM prediction_ledger p
    JOIN prediction_ledger_classifications c ON c.ledger_id = p.id AND c.classifier_version = 'v1'
   WHERE c.prospective_status = 'prospective_pre_outcome' AND p.target_date <= CURRENT_DATE;
  SELECT count(o.id) INTO n2 FROM prediction_ledger p
    JOIN prediction_ledger_classifications c ON c.ledger_id = p.id AND c.classifier_version = 'v1'
    JOIN prediction_ledger_outcomes o ON o.ledger_id = p.id
   WHERE c.prospective_status = 'prospective_pre_outcome' AND p.target_date <= CURRENT_DATE;
  g := g || jsonb_build_object('gate','U_prospective_forecast_skill',
       'metric','matured prospective predictions scored (Brier), retrospective backfills excluded',
       'target','>=30 matured prospective predictions scored with mean Brier <= 0.25',
       'value', n2,
       'status', CASE WHEN n2 >= 30 AND COALESCE(prosp.prospective_mean_brier, 1) <= 0.25 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','NOT YET PROVEN unless target met. prospective_total='||COALESCE(prosp.prospective_total,0)
         ||', matured='||n||', scored='||n2||', mean_brier='||COALESCE(prosp.prospective_mean_brier::text,'null')
         ||'. Retrospective backfills excluded via prediction_ledger_classifications.');

  chain := public.verify_prediction_ledger_chain_full(200000);
  b := COALESCE((chain->>'chain_valid')::boolean,false) AND COALESCE((chain->>'payloads_valid')::boolean,false);
  g := g || jsonb_build_object('gate','W_ledger_integrity',
       'metric','tamper-evident prediction ledger: canonical payload hashes and chain links recomputed',
       'target','0 broken links and 0 payload mismatches',
       'value', COALESCE((chain->>'broken_links')::int,-1) + COALESCE((chain->>'payload_mismatches')::int,0),
       'status', CASE WHEN b THEN 'PASS' ELSE 'FAIL' END,
       'evidence', 'verify_prediction_ledger_chain_full: '||chain::text);

  SELECT count(*) INTO n FROM (
    SELECT domain FROM country_performance_snapshots
     WHERE snapshot_date > CURRENT_DATE - 365
       AND domain IN ('governance','health','energy','finance','food','security','education','climate','population')
     GROUP BY domain
    HAVING stddev_samp(performance_index) IS NULL OR stddev_samp(performance_index) < 0.5) dead;
  g := g || jsonb_build_object('gate','V_domain_viability','metric','core domains with a dead (non-varying) signal','target',0,'value',n,
       'status', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','country_performance_snapshots.performance_index stddev < 0.5 over 365d across the 9 core domains');

  SELECT count(*), count(*) FILTER (WHERE e->>'status' = 'PASS') INTO total, passed FROM jsonb_array_elements(g) e;
  score := round(100.0*passed/NULLIF(total,0),2);

  INSERT INTO pns_certification_runs (overall_score, gates_total, gates_passed, gates)
  VALUES (score, total, passed, g)
  RETURNING jsonb_build_object('run_id', id, 'overall_score', overall_score,
    'gates_total', gates_total, 'gates_passed', gates_passed, 'gates', gates) INTO res;

  RETURN res;
END $$;