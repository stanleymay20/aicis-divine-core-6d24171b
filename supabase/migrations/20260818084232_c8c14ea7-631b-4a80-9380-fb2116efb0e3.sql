
CREATE TABLE IF NOT EXISTS public.pns_certification_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  overall_score numeric NOT NULL,
  gates_total int NOT NULL,
  gates_passed int NOT NULL,
  gates jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pns_certification_runs TO authenticated;
GRANT ALL ON public.pns_certification_runs TO service_role;
ALTER TABLE public.pns_certification_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cert runs readable by authenticated" ON public.pns_certification_runs;
CREATE POLICY "cert runs readable by authenticated"
  ON public.pns_certification_runs FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.compute_pns_certification()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  g jsonb := '[]'::jsonb;
  v numeric;
  n int;
  total int;
  passed int;
  score numeric;
  res jsonb;

  FUNCTION_PLACEHOLDER int;
BEGIN
  -- helper inline: each gate appended as an object
  -- A. SENSING: distinct ingestion sources producing signals in last 24h
  SELECT count(DISTINCT ingestion_source) INTO n
    FROM global_signals WHERE ingested_at > now() - interval '24 hours';
  g := g || jsonb_build_object('gate','A_sensing','metric','distinct ingestion sources (24h)',
       'target',10,'value',n,'status', CASE WHEN n >= 10 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','global_signals.ingestion_source distinct count over 24h');

  -- B. COVERAGE: distinct resolved countries in last 30d
  SELECT count(DISTINCT geo_admin0_iso3) INTO n
    FROM global_signals WHERE ingested_at > now() - interval '30 days' AND geo_admin0_iso3 IS NOT NULL;
  g := g || jsonb_build_object('gate','B_coverage','metric','distinct resolved ISO3 countries (30d)',
       'target',150,'value',n,'status', CASE WHEN n >= 150 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','global_signals.geo_admin0_iso3 distinct count over 30d');

  -- C. FRESHNESS: minutes since most recent signal
  SELECT COALESCE(EXTRACT(epoch FROM (now() - max(ingested_at)))/60, 999999) INTO v FROM global_signals;
  g := g || jsonb_build_object('gate','C_freshness','metric','minutes since newest signal',
       'target','<= 120','value',round(v,1),'status', CASE WHEN v <= 120 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','max(global_signals.ingested_at)');

  -- D. PROVENANCE: share of 7d signals carrying source references
  SELECT COALESCE(100.0 * count(*) FILTER (WHERE source_references IS NOT NULL
           AND jsonb_typeof(source_references) = 'array' AND jsonb_array_length(source_references) > 0)
         / NULLIF(count(*),0), 0) INTO v
    FROM global_signals WHERE ingested_at > now() - interval '7 days';
  g := g || jsonb_build_object('gate','D_provenance','metric','% of 7d signals with source references',
       'target',90,'value',round(v,2),'status', CASE WHEN v >= 90 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','global_signals.source_references non-empty share over 7d');

  -- E. SEMANTIC ACCURACY: requires a human-labelled evaluation set
  g := g || jsonb_build_object('gate','E_semantic_accuracy','metric','macro F1 on labelled evaluation set',
       'target',0.80,'value',null,'status','FAIL',
       'evidence','NOT MEASURABLE: no human-labelled classification evaluation set exists in production');

  -- F. ENTITY / GEO RESOLUTION: share of 7d signals geo-resolved
  SELECT COALESCE(100.0 * count(*) FILTER (WHERE geo_admin0_iso3 IS NOT NULL) / NULLIF(count(*),0),0) INTO v
    FROM global_signals WHERE ingested_at > now() - interval '7 days';
  g := g || jsonb_build_object('gate','F_entity_resolution','metric','% of 7d signals resolved to a country',
       'target',70,'value',round(v,2),'status', CASE WHEN v >= 70 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','global_signals.geo_admin0_iso3 non-null share over 7d');

  -- G. CAUSAL REASONING: propagation events generated in last 7d
  SELECT count(*) INTO n FROM planetary_propagation_events WHERE generated_at > now() - interval '7 days';
  g := g || jsonb_build_object('gate','G_causal','metric','causal propagation events (7d)',
       'target',50,'value',n,'status', CASE WHEN n >= 50 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','planetary_propagation_events count over 7d');

  -- H. FORECAST CALIBRATION: mean Brier score of realized predictions (90d)
  SELECT avg(brier_score) INTO v FROM risk_prediction_realizations
    WHERE realized_at > now() - interval '90 days' AND brier_score IS NOT NULL;
  g := g || jsonb_build_object('gate','H_forecast_calibration','metric','mean Brier score of realized predictions (90d)',
       'target','<= 0.20','value',round(COALESCE(v,1),4),
       'status', CASE WHEN v IS NOT NULL AND v <= 0.20 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','risk_prediction_realizations.brier_score mean over 90d');

  -- I. MULTI-AGENT REASONING: differentiated agent analyses
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

  -- J. GOVERNANCE: recommendations requiring dual approval are gated
  SELECT count(*) INTO n FROM risk_action_recommendations
    WHERE executed_at IS NOT NULL AND requires_dual_approval = true
      AND (first_approver IS NULL OR second_approver IS NULL);
  g := g || jsonb_build_object('gate','J_governance','metric','dual-approval actions executed without two approvers',
       'target',0,'value',n,'status', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','risk_action_recommendations executed with requires_dual_approval and missing approvers');

  -- K. ACTUATION: actions actually executed in last 30d
  SELECT count(*) INTO n FROM risk_action_recommendations WHERE executed_at > now() - interval '30 days';
  g := g || jsonb_build_object('gate','K_actuation','metric','recommendations executed (30d)',
       'target',1,'value',n,'status', CASE WHEN n >= 1 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','risk_action_recommendations.executed_at count over 30d');

  -- L. OUTCOME LEARNING: predictions scored against reality in last 30d
  SELECT count(*) INTO n FROM risk_prediction_realizations WHERE realized_at > now() - interval '30 days';
  g := g || jsonb_build_object('gate','L_outcome_learning','metric','predictions realized and scored (30d)',
       'target',100,'value',n,'status', CASE WHEN n >= 100 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','risk_prediction_realizations count over 30d');

  -- M. MEMORY: hash-chained ledger growth in last 7d
  SELECT count(*) INTO n FROM ledger_entries WHERE created_at > now() - interval '7 days';
  g := g || jsonb_build_object('gate','M_memory','metric','hash-chained ledger entries written (7d)',
       'target',100,'value',n,'status', CASE WHEN n >= 100 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','ledger_entries count over 7d');

  -- N. RELIABILITY: automation job success rate over 24h
  SELECT COALESCE(100.0 * count(*) FILTER (WHERE status IN ('success','partial')) / NULLIF(count(*),0),0) INTO v
    FROM automation_logs WHERE executed_at > now() - interval '24 hours';
  g := g || jsonb_build_object('gate','N_reliability','metric','% automation runs succeeding (24h)',
       'target',95,'value',round(v,2),'status', CASE WHEN v >= 95 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','automation_logs status distribution over 24h');

  -- O. SECURITY: public tables exposed without RLS
  SELECT count(*) INTO n
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false;
  g := g || jsonb_build_object('gate','O_security','metric','public tables without row level security',
       'target',0,'value',n,'status', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','pg_class.relrowsecurity = false in schema public');

  -- P. OBSERVABILITY: enabled pipelines reporting inside their expected interval
  SELECT COALESCE(100.0 * count(*) FILTER (
           WHERE last_success_at IS NOT NULL
             AND last_success_at > now() - (COALESCE(expected_interval_minutes,60) * 3) * interval '1 minute')
         / NULLIF(count(*),0),0) INTO v
    FROM pipeline_heartbeats WHERE enabled = true;
  g := g || jsonb_build_object('gate','P_observability','metric','% enabled pipelines within 3x expected interval',
       'target',90,'value',round(v,2),'status', CASE WHEN v >= 90 THEN 'PASS' ELSE 'FAIL' END,
       'evidence','pipeline_heartbeats.last_success_at vs expected_interval_minutes');

  -- Q. DISASTER RECOVERY: requires a verified restore drill record
  g := g || jsonb_build_object('gate','Q_disaster_recovery','metric','verified restore drill in last 90d',
       'target',1,'value',null,'status','FAIL',
       'evidence','NOT MEASURABLE: no restore-drill record exists in production');

  SELECT count(*), count(*) FILTER (WHERE e->>'status' = 'PASS')
    INTO total, passed FROM jsonb_array_elements(g) e;

  score := round(100.0 * passed / NULLIF(total,0), 2);

  INSERT INTO pns_certification_runs (overall_score, gates_total, gates_passed, gates)
  VALUES (score, total, passed, g)
  RETURNING jsonb_build_object('run_id', id, 'overall_score', overall_score,
    'gates_total', gates_total, 'gates_passed', gates_passed, 'gates', gates) INTO res;

  RETURN res;
END;
$fn$;

REVOKE ALL ON FUNCTION public.compute_pns_certification() FROM public;
GRANT EXECUTE ON FUNCTION public.compute_pns_certification() TO service_role;
