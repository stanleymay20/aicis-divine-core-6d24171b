
CREATE OR REPLACE VIEW public.prediction_ledger_validation_summary
WITH (security_invoker = true) AS
SELECT c.prospective_status,
       c.validation_mode,
       count(*) AS predictions,
       count(*) FILTER (WHERE p.target_date <= CURRENT_DATE) AS matured,
       count(o.id) AS scored_outcomes,
       round(avg(o.brier_score)::numeric, 4) AS mean_brier
  FROM public.prediction_ledger_classifications c
  JOIN public.prediction_ledger p ON p.id = c.ledger_id
  LEFT JOIN public.prediction_ledger_outcomes o ON o.ledger_id = p.id
 WHERE c.classifier_version = 'v1'
 GROUP BY c.prospective_status, c.validation_mode;

GRANT SELECT ON public.prediction_ledger_validation_summary TO authenticated;

CREATE OR REPLACE VIEW public.prospective_skill_verified
WITH (security_invoker = true) AS
SELECT count(*) AS prospective_total,
       count(*) FILTER (WHERE p.target_date <= CURRENT_DATE) AS prospective_matured,
       count(o.id) AS prospective_scored,
       round(avg(o.brier_score)::numeric, 4) AS prospective_mean_brier
  FROM public.prediction_ledger_classifications c
  JOIN public.prediction_ledger p ON p.id = c.ledger_id
  LEFT JOIN public.prediction_ledger_outcomes o ON o.ledger_id = p.id
 WHERE c.classifier_version = 'v1'
   AND c.prospective_status = 'prospective_pre_outcome';

GRANT SELECT ON public.prospective_skill_verified TO authenticated;

CREATE OR REPLACE VIEW public.agent_case_quality
WITH (security_invoker = true) AS
SELECT t.id AS task_id, t.task_key, t.question, t.subject_kind, t.subject_key,
       t.domains, t.status, t.created_at, t.completed_at, t.error,
       count(DISTINCT a.id) FILTER (WHERE a.status = 'success')      AS perspectives_ok,
       count(DISTINCT a.id) FILTER (WHERE a.status IS DISTINCT FROM 'success') AS perspectives_failed,
       count(DISTINCT a.specialist) FILTER (WHERE a.status = 'success')        AS distinct_specialists,
       count(DISTINCT ec.id)  AS citations,
       count(DISTINCT d.id)   AS disagreements,
       (s.id IS NOT NULL)     AS has_synthesis,
       s.degraded, s.degradation_reason, s.confidence_lower, s.confidence_upper,
       COALESCE(bool_and(a.evidence_count > 0) FILTER (WHERE a.status = 'success'), false) AS citations_complete
  FROM public.agent_coordination_tasks t
  LEFT JOIN public.agent_specialist_analyses a ON a.task_id = t.id
  LEFT JOIN public.agent_evidence_citations ec ON ec.task_id = t.id
  LEFT JOIN public.agent_disagreements d       ON d.task_id = t.id
  LEFT JOIN public.agent_syntheses s           ON s.task_id = t.id
 GROUP BY t.id, s.id;

GRANT SELECT ON public.agent_case_quality TO authenticated;

-- ---------------- certification: quality-based Gate I, prospective-only Gate U, new Gate W ----------------
CREATE OR REPLACE FUNCTION public.compute_pns_certification_gate_i()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n_recent int; n_completed int; n_three int; n_cited int; n_synth int; n_err int;
  n_dis int; share numeric; ok boolean;
BEGIN
  SELECT count(*) FILTER (WHERE created_at > now() - interval '30 days'),
         count(*) FILTER (WHERE created_at > now() - interval '30 days' AND status = 'completed'),
         count(*) FILTER (WHERE created_at > now() - interval '30 days' AND status = 'completed' AND distinct_specialists >= 3),
         count(*) FILTER (WHERE created_at > now() - interval '30 days' AND status = 'completed' AND citations_complete),
         count(*) FILTER (WHERE created_at > now() - interval '30 days' AND status = 'completed' AND has_synthesis),
         count(*) FILTER (WHERE created_at > now() - interval '30 days' AND status = 'error'),
         count(*) FILTER (WHERE created_at > now() - interval '30 days' AND disagreements > 0)
    INTO n_recent, n_completed, n_three, n_cited, n_synth, n_err, n_dis
    FROM agent_case_quality;

  share := CASE WHEN n_completed = 0 THEN 0 ELSE round(100.0 * n_three / n_completed, 2) END;
  ok := n_completed >= 3
        AND share >= 60
        AND n_cited = n_completed
        AND n_synth = n_completed
        AND (n_recent = 0 OR 100.0 * n_err / n_recent <= 20);

  RETURN jsonb_build_object('gate','I_multi_agent',
    'metric','% of completed multi-agent cases (30d) with >=3 independent cited perspectives and a synthesis',
    'target','>=60% over >=3 completed cases, full citation + synthesis coverage, <=20% errored',
    'value', share,
    'status', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END,
    'evidence', 'agent_case_quality (30d): tasks='||n_recent||', completed='||n_completed
      ||', with>=3 specialists='||n_three||', citation-complete='||n_cited||', with synthesis='||n_synth
      ||', with preserved disagreement='||n_dis||', errored='||n_err);
END $$;

CREATE OR REPLACE FUNCTION public.compute_pns_certification()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g jsonb := '[]'::jsonb; v numeric; n int; n2 int; b boolean;
  total int; passed int; score numeric; res jsonb;
  chain jsonb; prosp record;
BEGIN
  g := (SELECT jsonb_agg(e) FROM jsonb_array_elements(
          (SELECT gates FROM pns_certification_runs ORDER BY created_at DESC LIMIT 1)) e
        WHERE e->>'gate' NOT IN ('I_multi_agent','U_prediction_ledger','W_ledger_integrity'));
  -- rebuild every gate from scratch instead of reusing a previous run
  g := '[]'::jsonb;

  -- A. SENSING
  SELECT count(DISTINCT ingestion_source) INTO n FROM global_signals WHERE ingested_at > now() - interval '24 hours';
  g := g || jsonb_build_object('gate','A_sensing','metric','distinct ingestion sources (24h)','target',10,'value',n,
       'status', CASE WHEN n >= 10 THEN 'PASS' ELSE 'FAIL' END,'evidence','global_signals.ingestion_source distinct over 24h');

  -- B. COVERAGE
  SELECT count(DISTINCT geo_admin0_iso3) INTO n FROM global_signals WHERE ingested_at > now() - interval '7 days' AND geo_admin0_iso3 IS NOT NULL;
  g := g || jsonb_build_object('gate','B_coverage','metric','countries with signals (7d)','target',150,'value',n,
       'status', CASE WHEN n >= 150 THEN 'PASS' ELSE 'FAIL' END,'evidence','distinct global_signals.geo_admin0_iso3 over 7d');

  -- C. FRESHNESS
  SELECT COALESCE(EXTRACT(epoch FROM now() - max(ingested_at))/60,999999) INTO v FROM global_signals;
  g := g || jsonb_build_object('gate','C_freshness','metric','minutes since newest signal','target','<= 120','value',round(v,1),
       'status', CASE WHEN v <= 120 THEN 'PASS' ELSE 'FAIL' END,'evidence','max(global_signals.ingested_at)');

  -- D. PROVENANCE
  SELECT COALESCE(100.0*count(*) FILTER (WHERE source_url IS NOT NULL)/NULLIF(count(*),0),0) INTO v
    FROM global_signals WHERE ingested_at > now() - interval '7 days';
  g := g || jsonb_build_object('gate','D_provenance','metric','% of 7d signals with a source URL','target',95,'value',round(v,2),
       'status', CASE WHEN v >= 95 THEN 'PASS' ELSE 'FAIL' END,'evidence','global_signals.source_url non-null share over 7d');

  -- E. OFFICIAL SOURCE MATCH
  SELECT COALESCE(100.0*count(*) FILTER (WHERE publisher_key IS NOT NULL)/NULLIF(count(*),0),0) INTO v
    FROM intelligence_citations WHERE created_at > now() - interval '30 days';
  g := g || jsonb_build_object('gate','E_official_sources','metric','% of 30d citations matched to a registered publisher','target',60,'value',round(v,2),
       'status', CASE WHEN v >= 60 THEN 'PASS' ELSE 'FAIL' END,'evidence','intelligence_citations.publisher_key matched share over 30d');

  -- F. ENTITY RESOLUTION
  SELECT COALESCE(100.0*count(*) FILTER (WHERE geo_admin0_iso3 IS NOT NULL)/NULLIF(count(*),0),0) INTO v
    FROM global_signals WHERE ingested_at > now() - interval '7 days';
  g := g || jsonb_build_object('gate','F_entity_resolution','metric','% of 7d signals resolved to a country','target',70,'value',round(v,2),
       'status', CASE WHEN v >= 70 THEN 'PASS' ELSE 'FAIL' END,'evidence','global_signals.geo_admin0_iso3 non-null share over 7d');

  -- G. CAUSAL REASONING
  SELECT count(*) INTO n FROM planetary_propagation_events WHERE generated_at > now() - interval '7 days';
  g := g || jsonb_build_object('gate','G_causal','metric','causal propagation events (7d)','target',50,'value',n,
       'status', CASE WHEN n >= 50 THEN 'PASS' ELSE 'FAIL' END,'evidence','planetary_propagation_events count over 7d');

  -- H. FORECAST CALIBRATION
  SELECT avg(brier_score) INTO v FROM risk_prediction_realizations WHERE realized_at > now() - interval '90 days' AND brier_score IS NOT NULL;
  g := g || jsonb_build_object('gate','H_forecast_calibration','metric','mean Brier score of realized predictions (90d)','target','<= 0.20',
       'value',round(COALESCE(v,1),4),'status', CASE WHEN v IS NOT NULL AND v <= 0.20 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','risk_prediction_realizations.brier_score mean over 90d');

  -- I. MULTI-AGENT REASONING (quality-based)
  g := g || public.compute_pns_certification_gate_i();

  -- J. GOVERNANCE
  SELECT count(*) INTO n FROM risk_action_recommendations
   WHERE executed_at IS NOT NULL AND requires_dual_approval = true AND (first_approver IS NULL OR second_approver IS NULL);
  g := g || jsonb_build_object('gate','J_governance','metric','dual-approval actions executed without two approvers','target',0,'value',n,
       'status', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END,'evidence','risk_action_recommendations executed with requires_dual_approval and missing approvers');

  -- K. ACTUATION
  SELECT count(*) INTO n FROM risk_action_recommendations WHERE executed_at > now() - interval '30 days';
  g := g || jsonb_build_object('gate','K_actuation','metric','recommendations executed (30d)','target',1,'value',n,
       'status', CASE WHEN n >= 1 THEN 'PASS' ELSE 'FAIL' END,'evidence','risk_action_recommendations.executed_at count over 30d');

  -- L. OUTCOME LEARNING
  SELECT count(*) INTO n FROM risk_prediction_realizations WHERE realized_at > now() - interval '30 days';
  g := g || jsonb_build_object('gate','L_outcome_learning','metric','predictions realized and scored (30d)','target',100,'value',n,
       'status', CASE WHEN n >= 100 THEN 'PASS' ELSE 'FAIL' END,'evidence','risk_prediction_realizations count over 30d');

  -- M. MEMORY
  SELECT count(*) INTO n FROM ledger_entries WHERE created_at > now() - interval '7 days';
  g := g || jsonb_build_object('gate','M_memory','metric','hash-chained ledger entries written (7d)','target',100,'value',n,
       'status', CASE WHEN n >= 100 THEN 'PASS' ELSE 'FAIL' END,'evidence','ledger_entries count over 7d');

  -- N. RELIABILITY
  SELECT COALESCE(100.0*count(*) FILTER (WHERE status IN ('success','partial'))/NULLIF(count(*),0),0) INTO v
    FROM automation_logs WHERE executed_at > now() - interval '24 hours';
  g := g || jsonb_build_object('gate','N_reliability','metric','% automation runs succeeding (24h)','target',95,'value',round(v,2),
       'status', CASE WHEN v >= 95 THEN 'PASS' ELSE 'FAIL' END,'evidence','automation_logs status distribution over 24h');

  -- O. SECURITY
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false;
  g := g || jsonb_build_object('gate','O_security','metric','public tables without row level security','target',0,'value',n,
       'status', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END,'evidence','pg_class.relrowsecurity = false in schema public');

  -- P. OBSERVABILITY
  SELECT COALESCE(100.0*count(*) FILTER (
           WHERE last_success_at IS NOT NULL AND last_success_at > now() - (COALESCE(expected_interval_minutes,60)*3)*interval '1 minute')
         /NULLIF(count(*),0),0) INTO v FROM pipeline_heartbeats WHERE enabled = true;
  g := g || jsonb_build_object('gate','P_observability','metric','% enabled pipelines within 3x expected interval','target',90,'value',round(v,2),
       'status', CASE WHEN v >= 90 THEN 'PASS' ELSE 'FAIL' END,'evidence','pipeline_heartbeats.last_success_at vs expected_interval_minutes');

  -- Q. DISASTER RECOVERY
  g := g || jsonb_build_object('gate','Q_disaster_recovery','metric','verified restore drill in last 90d','target',1,'value',null,'status','FAIL',
       'evidence','NOT MEASURABLE: no restore-drill record exists in production');

  -- R. KNOWLEDGE GRAPH INTEGRITY
  SELECT COALESCE(100.0*count(*) FILTER (WHERE evidence_status = 'measured')/NULLIF(count(*),0),0) INTO v FROM graph_relationship_evidence;
  SELECT count(*) INTO n FROM graph_relationship_evidence;
  g := g || jsonb_build_object('gate','R_graph_integrity','metric','% of graph relationships backed by measurement','target',80,'value',round(v,2),
       'status', CASE WHEN n > 0 AND v >= 80 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','graph_relationship_evidence.evidence_status = measured share ('||n||' total edges)');

  -- S. WEAK-SIGNAL DISCOVERY
  SELECT count(*) INTO n FROM weak_signal_runs WHERE started_at > now() - interval '7 days' AND status = 'success';
  SELECT count(*) INTO n2 FROM weak_signal_detections WHERE detected_at > now() - interval '7 days';
  g := g || jsonb_build_object('gate','S_weak_signal_discovery','metric','successful discovery runs on non-stale input (7d)','target',1,'value',n,
       'status', CASE WHEN n >= 1 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','weak_signal_runs status=success over 7d; '||n2||' detections written in the same window');

  -- T. HYPOTHESIS TESTING
  SELECT count(*) INTO n FROM hypothesis_evaluations WHERE evaluated_at > now() - interval '30 days';
  SELECT count(*) INTO n2 FROM intelligence_hypotheses WHERE status = 'supported';
  g := g || jsonb_build_object('gate','T_hypothesis_testing','metric','hypothesis evaluations recorded (30d)','target',5,'value',n,
       'status', CASE WHEN n >= 5 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','hypothesis_evaluations over 30d; '||n2||' hypotheses currently supported by evidence');

  -- U. PROSPECTIVE FORECASTING SKILL (prospective predictions only)
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
         ||'. Retrospective backfills are excluded from forecasting skill by prediction_ledger_classifications.');

  -- W. LEDGER INTEGRITY (infrastructure submetric, independent of forecasting skill)
  chain := public.verify_prediction_ledger_chain_full(200000);
  b := COALESCE((chain->>'chain_valid')::boolean,false) AND COALESCE((chain->>'payloads_valid')::boolean,false);
  g := g || jsonb_build_object('gate','W_ledger_integrity',
       'metric','tamper-evident prediction ledger: canonical payload hashes and chain links recomputed',
       'target','0 broken links and 0 payload mismatches',
       'value', COALESCE((chain->>'broken_links')::int,-1) + COALESCE((chain->>'payload_mismatches')::int,0),
       'status', CASE WHEN b THEN 'PASS' ELSE 'FAIL' END,
       'evidence', 'verify_prediction_ledger_chain_full: '||chain::text);

  -- V. DOMAIN SIGNAL VIABILITY
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
