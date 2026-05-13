-- AICIS Gap Closure: Operational Reality + Probabilistic Reasoning + Governance Layer
-- This migration adds foundations for the remaining frontier gaps:
-- telemetry integration, probabilistic simulation, causal graph traversal,
-- operational execution, sovereign security, cost governance, and ontology evolution.

-- =====================================================
-- 1. Real telemetry integration registry
-- =====================================================
CREATE TABLE IF NOT EXISTS public.telemetry_connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_key text UNIQUE NOT NULL,
  connector_name text NOT NULL,
  connector_type text NOT NULL,
  provider_name text,
  data_domain text,
  geographic_scope text DEFAULT 'global',
  auth_mode text DEFAULT 'api_key',
  polling_interval_seconds integer DEFAULT 3600,
  operational_status text DEFAULT 'configured',
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer DEFAULT 0,
  last_error_message text,
  trust_tier text DEFAULT 'tier_3',
  cost_tier text DEFAULT 'standard',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_connectors_domain_status
ON public.telemetry_connectors(data_domain, operational_status);

CREATE TABLE IF NOT EXISTS public.telemetry_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_key text REFERENCES public.telemetry_connectors(connector_key) ON DELETE SET NULL,
  observation_type text NOT NULL,
  observed_entity text,
  observed_region text,
  observed_at timestamptz DEFAULT now(),
  observation_value numeric,
  observation_unit text,
  confidence_score numeric DEFAULT 0,
  anomaly_score numeric DEFAULT 0,
  raw_payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_observations_region_time
ON public.telemetry_observations(observed_region, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_observations_type_anomaly
ON public.telemetry_observations(observation_type, anomaly_score DESC);

-- =====================================================
-- 2. Probabilistic simulation foundations
-- =====================================================
CREATE TABLE IF NOT EXISTS public.probabilistic_simulation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_key text UNIQUE NOT NULL,
  simulation_name text,
  simulation_type text DEFAULT 'monte_carlo',
  source_subject_type text,
  source_subject_id uuid,
  run_count integer DEFAULT 0,
  horizon_days integer DEFAULT 30,
  baseline_risk numeric DEFAULT 0,
  mean_projected_risk numeric DEFAULT 0,
  p05_projected_risk numeric DEFAULT 0,
  p50_projected_risk numeric DEFAULT 0,
  p95_projected_risk numeric DEFAULT 0,
  confidence_interval jsonb DEFAULT '{}'::jsonb,
  simulation_parameters jsonb DEFAULT '{}'::jsonb,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prob_sim_runs_risk
ON public.probabilistic_simulation_runs(mean_projected_risk DESC, p95_projected_risk DESC);

CREATE TABLE IF NOT EXISTS public.probabilistic_simulation_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_run_id uuid REFERENCES public.probabilistic_simulation_runs(id) ON DELETE CASCADE,
  sample_index integer,
  sampled_risk numeric DEFAULT 0,
  sampled_impact numeric DEFAULT 0,
  sampled_escalation numeric DEFAULT 0,
  sampled_humanitarian_pressure numeric DEFAULT 0,
  sampled_economic_pressure numeric DEFAULT 0,
  sample_payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE(simulation_run_id, sample_index)
);

-- =====================================================
-- 3. Multi-hop causal graph traversal
-- =====================================================
CREATE TABLE IF NOT EXISTS public.causal_graph_paths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path_key text UNIQUE NOT NULL,
  source_signal_id uuid REFERENCES public.global_signals(id) ON DELETE CASCADE,
  terminal_signal_id uuid REFERENCES public.global_signals(id) ON DELETE CASCADE,
  hop_count integer DEFAULT 1,
  cumulative_causal_confidence numeric DEFAULT 0,
  cumulative_impact_multiplier numeric DEFAULT 1,
  path_nodes jsonb DEFAULT '[]'::jsonb,
  path_edges jsonb DEFAULT '[]'::jsonb,
  path_summary text,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_causal_graph_paths_confidence
ON public.causal_graph_paths(cumulative_causal_confidence DESC, hop_count DESC);

-- =====================================================
-- 4. Operational execution and coordination rooms
-- =====================================================
CREATE TABLE IF NOT EXISTS public.operational_coordination_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_key text UNIQUE NOT NULL,
  room_title text NOT NULL,
  room_type text DEFAULT 'crisis-coordination',
  lead_agency text,
  participating_agencies jsonb DEFAULT '[]'::jsonb,
  linked_regions jsonb DEFAULT '[]'::jsonb,
  linked_risks jsonb DEFAULT '[]'::jsonb,
  operational_status text DEFAULT 'active',
  priority_band text DEFAULT 'monitor',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.operational_execution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid REFERENCES public.operational_coordination_rooms(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.coordination_tasks(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_summary text,
  actor_type text DEFAULT 'system',
  actor_id uuid,
  execution_status text DEFAULT 'logged',
  evidence jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operational_events_room_time
ON public.operational_execution_events(room_id, created_at DESC);

-- =====================================================
-- 5. Sovereign security, access partitions, and audit proofs
-- =====================================================
CREATE TABLE IF NOT EXISTS public.sovereign_security_partitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partition_key text UNIQUE NOT NULL,
  partition_name text NOT NULL,
  sovereign_entity text,
  data_classification text DEFAULT 'restricted',
  residency_region text,
  allowed_domains jsonb DEFAULT '[]'::jsonb,
  sharing_policy jsonb DEFAULT '{}'::jsonb,
  encryption_policy jsonb DEFAULT '{}'::jsonb,
  operational_status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.intelligence_audit_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_key text UNIQUE NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid,
  previous_hash text,
  proof_hash text NOT NULL,
  proof_payload jsonb DEFAULT '{}'::jsonb,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_proofs_subject
ON public.intelligence_audit_proofs(subject_type, subject_id);

-- =====================================================
-- 6. Adaptive ontology evolution
-- =====================================================
CREATE TABLE IF NOT EXISTS public.adaptive_ontology_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term_key text UNIQUE NOT NULL,
  term_label text NOT NULL,
  term_type text DEFAULT 'emerging-concept',
  parent_term_key text,
  discovery_source text DEFAULT 'signal-pattern',
  occurrence_count integer DEFAULT 0,
  strategic_relevance numeric DEFAULT 0,
  confidence_score numeric DEFAULT 0,
  status text DEFAULT 'candidate',
  supporting_examples jsonb DEFAULT '[]'::jsonb,
  first_seen_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adaptive_ontology_relevance
ON public.adaptive_ontology_terms(strategic_relevance DESC, occurrence_count DESC);

-- =====================================================
-- 7. Cost governance and retention lifecycle
-- =====================================================
CREATE TABLE IF NOT EXISTS public.compute_cost_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  cost_category text DEFAULT 'database',
  estimated_units numeric DEFAULT 0,
  estimated_cost_usd numeric DEFAULT 0,
  row_count_processed integer DEFAULT 0,
  duration_ms integer DEFAULT 0,
  cost_metadata jsonb DEFAULT '{}'::jsonb,
  recorded_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_ledger_job_time
ON public.compute_cost_ledger(job_name, recorded_at DESC);

CREATE TABLE IF NOT EXISTS public.data_retention_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key text UNIQUE NOT NULL,
  target_table text NOT NULL,
  retention_days integer DEFAULT 365,
  archive_strategy text DEFAULT 'summarize_then_delete',
  enabled boolean DEFAULT true,
  policy_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =====================================================
-- 8. Seed high-value telemetry connector types
-- =====================================================
INSERT INTO public.telemetry_connectors (
  connector_key,
  connector_name,
  connector_type,
  provider_name,
  data_domain,
  geographic_scope,
  trust_tier,
  metadata
)
VALUES
('ais_shipping_global','AIS Shipping Global','ais','future-provider','shipping-logistics','global','tier_2',jsonb_build_object('purpose','vessel movement and port congestion')),
('adsb_aviation_global','ADS-B Aviation Global','adsb','future-provider','aviation-logistics','global','tier_2',jsonb_build_object('purpose','air traffic disruption monitoring')),
('power_grid_status','Power Grid Status','infrastructure','future-provider','energy-infrastructure','regional','tier_1',jsonb_build_object('purpose','grid outage and energy resilience')),
('weather_extreme_feed','Extreme Weather Feed','weather','future-provider','climate-disaster','global','tier_1',jsonb_build_object('purpose','flood fire storm drought detection')),
('public_health_surveillance','Public Health Surveillance','health','future-provider','public-health','global','tier_1',jsonb_build_object('purpose','outbreak and health system stress')),
('port_congestion_feed','Port Congestion Feed','logistics','future-provider','supply-chain','global','tier_2',jsonb_build_object('purpose','port delay and logistics stress'))
ON CONFLICT(connector_key) DO UPDATE SET
  connector_name = EXCLUDED.connector_name,
  connector_type = EXCLUDED.connector_type,
  data_domain = EXCLUDED.data_domain,
  metadata = EXCLUDED.metadata,
  updated_at = now();

INSERT INTO public.data_retention_policies(policy_key,target_table,retention_days,archive_strategy)
VALUES
('raw-telemetry-90d','telemetry_observations',90,'aggregate_then_archive'),
('simulation-samples-180d','probabilistic_simulation_samples',180,'summarize_then_delete'),
('automation-logs-90d','automation_logs',90,'summarize_then_delete'),
('review-queue-730d','analyst_review_queue',730,'retain_for_audit')
ON CONFLICT(policy_key) DO UPDATE SET
  retention_days = EXCLUDED.retention_days,
  archive_strategy = EXCLUDED.archive_strategy,
  updated_at = now();

-- =====================================================
-- 9. Functions: telemetry health synthesis
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_telemetry_health_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer := 0;
  v_active integer := 0;
  v_failed integer := 0;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE operational_status IN ('active','configured')),
         COUNT(*) FILTER (WHERE consecutive_failures >= 3)
  INTO v_total, v_active, v_failed
  FROM public.telemetry_connectors;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('telemetry-health-summary','success','connectors=' || v_total || ', active=' || v_active || ', failed=' || v_failed);

  RETURN jsonb_build_object(
    'status','success',
    'total_connectors',v_total,
    'active_connectors',v_active,
    'failed_connectors',v_failed
  );
END;
$$;

-- =====================================================
-- 10. Functions: bounded probabilistic simulation
-- =====================================================
CREATE OR REPLACE FUNCTION public.run_probabilistic_risk_simulation(
  p_source_subject_type text DEFAULT 'global',
  p_source_subject_id uuid DEFAULT NULL,
  p_horizon_days integer DEFAULT 30,
  p_samples integer DEFAULT 250
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
  v_key text;
  v_baseline numeric := 50;
  v_samples integer := GREATEST(25, LEAST(p_samples, 1000));
  v_i integer;
  v_risk numeric;
  v_mean numeric;
  v_p50 numeric;
  v_p95 numeric;
BEGIN
  SELECT COALESCE(AVG(COALESCE(impact_score,0)),50)
  INTO v_baseline
  FROM public.global_signals
  WHERE COALESCE(ingested_at,created_at) >= now() - interval '7 days'
    AND COALESCE(canonical_event_status,'canonical') = 'canonical';

  v_key := md5(COALESCE(p_source_subject_type,'global') || '|' || COALESCE(p_source_subject_id::text,'none') || '|' || p_horizon_days::text || '|' || current_date::text);

  INSERT INTO public.probabilistic_simulation_runs (
    simulation_key,
    simulation_name,
    simulation_type,
    source_subject_type,
    source_subject_id,
    run_count,
    horizon_days,
    baseline_risk,
    simulation_parameters,
    generated_at
  ) VALUES (
    v_key,
    'Bounded Monte Carlo Risk Simulation',
    'monte_carlo',
    p_source_subject_type,
    p_source_subject_id,
    v_samples,
    p_horizon_days,
    ROUND(v_baseline::numeric,2),
    jsonb_build_object('samples',v_samples,'horizon_days',p_horizon_days),
    now()
  )
  ON CONFLICT(simulation_key) DO UPDATE SET
    run_count = EXCLUDED.run_count,
    baseline_risk = EXCLUDED.baseline_risk,
    simulation_parameters = EXCLUDED.simulation_parameters,
    generated_at = now()
  RETURNING id INTO v_run_id;

  FOR v_i IN 1..v_samples LOOP
    v_risk := GREATEST(0, LEAST(100, v_baseline + ((random() - 0.5) * 35) + (random() * 10)));
    INSERT INTO public.probabilistic_simulation_samples (
      simulation_run_id,
      sample_index,
      sampled_risk,
      sampled_impact,
      sampled_escalation,
      sampled_humanitarian_pressure,
      sampled_economic_pressure,
      sample_payload
    ) VALUES (
      v_run_id,
      v_i,
      ROUND(v_risk::numeric,2),
      ROUND(GREATEST(0, LEAST(100, v_risk + ((random() - 0.5) * 20)))::numeric,2),
      ROUND(GREATEST(0, LEAST(100, v_risk + ((random() - 0.5) * 25)))::numeric,2),
      ROUND(GREATEST(0, LEAST(100, v_risk + ((random() - 0.5) * 30)))::numeric,2),
      ROUND(GREATEST(0, LEAST(100, v_risk + ((random() - 0.5) * 25)))::numeric,2),
      jsonb_build_object('baseline',v_baseline)
    )
    ON CONFLICT(simulation_run_id, sample_index) DO UPDATE SET
      sampled_risk = EXCLUDED.sampled_risk,
      sampled_impact = EXCLUDED.sampled_impact,
      sampled_escalation = EXCLUDED.sampled_escalation,
      sampled_humanitarian_pressure = EXCLUDED.sampled_humanitarian_pressure,
      sampled_economic_pressure = EXCLUDED.sampled_economic_pressure,
      sample_payload = EXCLUDED.sample_payload;
  END LOOP;

  SELECT AVG(sampled_risk), percentile_cont(0.5) WITHIN GROUP (ORDER BY sampled_risk), percentile_cont(0.95) WITHIN GROUP (ORDER BY sampled_risk)
  INTO v_mean, v_p50, v_p95
  FROM public.probabilistic_simulation_samples
  WHERE simulation_run_id = v_run_id;

  UPDATE public.probabilistic_simulation_runs
  SET mean_projected_risk = ROUND(v_mean::numeric,2),
      p50_projected_risk = ROUND(v_p50::numeric,2),
      p95_projected_risk = ROUND(v_p95::numeric,2),
      confidence_interval = jsonb_build_object('p50',ROUND(v_p50::numeric,2),'p95',ROUND(v_p95::numeric,2))
  WHERE id = v_run_id;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('probabilistic-risk-simulation','success','samples=' || v_samples || ', mean=' || ROUND(v_mean::numeric,2));

  RETURN jsonb_build_object('status','success','simulation_run_id',v_run_id,'samples',v_samples,'mean_risk',ROUND(v_mean::numeric,2),'p95_risk',ROUND(v_p95::numeric,2));
END;
$$;

-- =====================================================
-- 11. Functions: multi-hop causal traversal
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_causal_graph_paths(
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  WITH first_hop AS (
    SELECT *
    FROM public.strategic_causal_links
    WHERE causal_confidence >= 50
    ORDER BY causal_confidence DESC
    LIMIT GREATEST(50, LEAST(p_limit, 1000))
  ), second_hop AS (
    SELECT
      fh.source_signal_id,
      l2.target_signal_id AS terminal_signal_id,
      fh.target_signal_id AS middle_signal_id,
      fh.causal_confidence AS c1,
      l2.causal_confidence AS c2,
      fh.systemic_impact_multiplier AS m1,
      l2.systemic_impact_multiplier AS m2,
      fh.causal_type AS t1,
      l2.causal_type AS t2
    FROM first_hop fh
    JOIN public.strategic_causal_links l2
      ON l2.source_signal_id = fh.target_signal_id
     AND l2.target_signal_id <> fh.source_signal_id
    WHERE l2.causal_confidence >= 45
  )
  INSERT INTO public.causal_graph_paths (
    path_key,
    source_signal_id,
    terminal_signal_id,
    hop_count,
    cumulative_causal_confidence,
    cumulative_impact_multiplier,
    path_nodes,
    path_edges,
    path_summary,
    generated_at
  )
  SELECT
    md5(source_signal_id::text || '|' || middle_signal_id::text || '|' || terminal_signal_id::text),
    source_signal_id,
    terminal_signal_id,
    2,
    ROUND(((c1 + c2) / 2)::numeric,2),
    ROUND((m1 * m2)::numeric,2),
    jsonb_build_array(source_signal_id, middle_signal_id, terminal_signal_id),
    jsonb_build_array(t1, t2),
    'Two-hop causal pathway detected across strategic signal graph.',
    now()
  FROM second_hop
  ON CONFLICT(path_key) DO UPDATE SET
    cumulative_causal_confidence = EXCLUDED.cumulative_causal_confidence,
    cumulative_impact_multiplier = EXCLUDED.cumulative_impact_multiplier,
    generated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('causal-graph-path-generation','success','paths=' || v_rows);

  RETURN jsonb_build_object('status','success','paths',v_rows);
END;
$$;

-- =====================================================
-- 12. Functions: adaptive ontology mining
-- =====================================================
CREATE OR REPLACE FUNCTION public.mine_adaptive_ontology_terms(
  p_window interval DEFAULT interval '30 days'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  INSERT INTO public.adaptive_ontology_terms (
    term_key,
    term_label,
    term_type,
    discovery_source,
    occurrence_count,
    strategic_relevance,
    confidence_score,
    status,
    supporting_examples,
    first_seen_at,
    last_seen_at
  )
  SELECT
    md5(lower(COALESCE(category,'unknown'))),
    lower(COALESCE(category,'unknown')),
    'category-pattern',
    'global_signals.category',
    COUNT(*),
    LEAST(100, ROUND((AVG(COALESCE(impact_score,0)) * 0.5 + COUNT(*) * 1.5)::numeric,2)),
    ROUND(AVG(COALESCE(confidence_score,0))::numeric,2),
    CASE WHEN COUNT(*) >= 20 THEN 'accepted' ELSE 'candidate' END,
    jsonb_agg(jsonb_build_object('signal_id',id,'title',LEFT(COALESCE(translated_title,title,''),160)) ORDER BY COALESCE(impact_score,0) DESC) FILTER (WHERE id IS NOT NULL),
    MIN(COALESCE(ingested_at,created_at)),
    MAX(COALESCE(ingested_at,created_at))
  FROM public.global_signals
  WHERE COALESCE(ingested_at,created_at) >= now() - p_window
    AND category IS NOT NULL
  GROUP BY lower(COALESCE(category,'unknown'))
  ON CONFLICT(term_key) DO UPDATE SET
    occurrence_count = EXCLUDED.occurrence_count,
    strategic_relevance = EXCLUDED.strategic_relevance,
    confidence_score = EXCLUDED.confidence_score,
    status = EXCLUDED.status,
    supporting_examples = EXCLUDED.supporting_examples,
    last_seen_at = EXCLUDED.last_seen_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('adaptive-ontology-mining','success','terms=' || v_rows);

  RETURN jsonb_build_object('status','success','terms',v_rows);
END;
$$;

-- =====================================================
-- 13. Functions: audit proof generation
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_intelligence_audit_proof(
  p_subject_type text,
  p_subject_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous text;
  v_hash text;
  v_key text;
BEGIN
  SELECT proof_hash INTO v_previous
  FROM public.intelligence_audit_proofs
  ORDER BY generated_at DESC
  LIMIT 1;

  v_key := md5(p_subject_type || '|' || COALESCE(p_subject_id::text,'none') || '|' || now()::text);
  v_hash := encode(digest(COALESCE(v_previous,'genesis') || p_subject_type || COALESCE(p_subject_id::text,'none') || p_payload::text || now()::text, 'sha256'), 'hex');

  INSERT INTO public.intelligence_audit_proofs (
    proof_key,
    subject_type,
    subject_id,
    previous_hash,
    proof_hash,
    proof_payload,
    generated_at
  ) VALUES (
    v_key,
    p_subject_type,
    p_subject_id,
    v_previous,
    v_hash,
    p_payload,
    now()
  );

  RETURN jsonb_build_object('status','success','proof_key',v_key,'proof_hash',v_hash);
END;
$$;

-- =====================================================
-- 14. Cost governance utility
-- =====================================================
CREATE OR REPLACE FUNCTION public.record_compute_cost(
  p_job_name text,
  p_row_count integer DEFAULT 0,
  p_duration_ms integer DEFAULT 0,
  p_estimated_units numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cost numeric;
BEGIN
  v_cost := ROUND((p_estimated_units * 0.00001 + p_duration_ms * 0.0000002 + p_row_count * 0.0000001)::numeric,6);

  INSERT INTO public.compute_cost_ledger (
    job_name,
    cost_category,
    estimated_units,
    estimated_cost_usd,
    row_count_processed,
    duration_ms,
    cost_metadata,
    recorded_at
  ) VALUES (
    p_job_name,
    'estimated-compute',
    p_estimated_units,
    v_cost,
    p_row_count,
    p_duration_ms,
    jsonb_build_object('method','rule-of-thumb-estimate'),
    now()
  );

  RETURN jsonb_build_object('status','success','estimated_cost_usd',v_cost);
END;
$$;

-- =====================================================
-- 15. Command views
-- =====================================================
CREATE OR REPLACE VIEW public.telemetry_health_command_view AS
SELECT
  connector_key,
  connector_name,
  connector_type,
  data_domain,
  operational_status,
  last_success_at,
  last_failure_at,
  consecutive_failures,
  trust_tier,
  updated_at
FROM public.telemetry_connectors
ORDER BY data_domain, connector_name;

CREATE OR REPLACE VIEW public.probabilistic_simulation_command_view AS
SELECT
  simulation_name,
  simulation_type,
  horizon_days,
  baseline_risk,
  mean_projected_risk,
  p50_projected_risk,
  p95_projected_risk,
  run_count,
  generated_at
FROM public.probabilistic_simulation_runs
ORDER BY generated_at DESC;

CREATE OR REPLACE VIEW public.causal_path_command_view AS
SELECT
  hop_count,
  cumulative_causal_confidence,
  cumulative_impact_multiplier,
  path_summary,
  generated_at
FROM public.causal_graph_paths
ORDER BY cumulative_causal_confidence DESC;

CREATE OR REPLACE VIEW public.ontology_evolution_command_view AS
SELECT
  term_label,
  term_type,
  occurrence_count,
  strategic_relevance,
  confidence_score,
  status,
  first_seen_at,
  last_seen_at
FROM public.adaptive_ontology_terms
ORDER BY strategic_relevance DESC;

CREATE OR REPLACE VIEW public.cost_governance_command_view AS
SELECT
  job_name,
  cost_category,
  SUM(estimated_cost_usd) AS estimated_cost_usd,
  SUM(row_count_processed) AS rows_processed,
  AVG(duration_ms) AS avg_duration_ms,
  MAX(recorded_at) AS last_recorded_at
FROM public.compute_cost_ledger
GROUP BY job_name, cost_category
ORDER BY estimated_cost_usd DESC;

-- =====================================================
-- 16. Master gap-closure cycle
-- =====================================================
CREATE OR REPLACE FUNCTION public.run_gap_closure_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r1 jsonb;
  r2 jsonb;
  r3 jsonb;
  r4 jsonb;
  r5 jsonb;
  r6 jsonb;
BEGIN
  r1 := public.generate_telemetry_health_summary();
  r2 := public.run_probabilistic_risk_simulation('global', NULL, 30, 250);
  r3 := public.generate_causal_graph_paths(500);
  r4 := public.mine_adaptive_ontology_terms(interval '30 days');
  r5 := public.generate_institutional_trust_scorecard();
  r6 := public.record_compute_cost('gap-closure-cycle', 0, 0, 250);

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('gap-closure-cycle','success','telemetry, simulation, causal paths, ontology, trust, and cost governance completed');

  RETURN jsonb_build_object(
    'status','success',
    'telemetry',r1,
    'probabilistic_simulation',r2,
    'causal_paths',r3,
    'ontology',r4,
    'trust_scorecard',r5,
    'cost',r6
  );
END;
$$;

INSERT INTO public.automation_logs(job_name,status,message)
VALUES (
  'gap-closure-operational-reality-layer',
  'success',
  'telemetry connectors, probabilistic simulations, causal traversal, operational rooms, sovereign partitions, ontology evolution, audit proofs, and cost governance initialized'
);
