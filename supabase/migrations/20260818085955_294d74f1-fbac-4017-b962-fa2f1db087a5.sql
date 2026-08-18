-- =====================================================================
-- LAYER 1: EVIDENCE-WEIGHTED TEMPORAL PLANETARY KNOWLEDGE GRAPH
-- =====================================================================
CREATE TABLE public.graph_relationship_evidence (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  relationship_key text NOT NULL UNIQUE,
  subject_kind text NOT NULL,
  subject_key text NOT NULL,
  object_kind text NOT NULL,
  object_key text NOT NULL,
  relation_type text NOT NULL,
  direction text NOT NULL DEFAULT 'directed',
  evidence_strength numeric,
  evidence_status text NOT NULL DEFAULT 'unvalidated',
  sample_size integer,
  window_days integer,
  country_count integer,
  method text NOT NULL,
  source_table text NOT NULL,
  source_row_id uuid,
  confidence numeric,
  observed_from timestamptz,
  observed_to timestamptz,
  last_measured_at timestamptz,
  decay_half_life_days integer NOT NULL DEFAULT 90,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT graph_rel_direction_chk CHECK (direction IN ('directed','undirected')),
  CONSTRAINT graph_rel_status_chk CHECK (evidence_status IN ('measured','unvalidated','insufficient_evidence','refuted')),
  CONSTRAINT graph_rel_halflife_chk CHECK (decay_half_life_days > 0)
);

CREATE INDEX idx_graph_rel_subject ON public.graph_relationship_evidence (subject_kind, subject_key);
CREATE INDEX idx_graph_rel_object ON public.graph_relationship_evidence (object_kind, object_key);
CREATE INDEX idx_graph_rel_type_status ON public.graph_relationship_evidence (relation_type, evidence_status);
CREATE INDEX idx_graph_rel_measured_at ON public.graph_relationship_evidence (last_measured_at DESC);

GRANT SELECT ON public.graph_relationship_evidence TO authenticated;
GRANT ALL ON public.graph_relationship_evidence TO service_role;
ALTER TABLE public.graph_relationship_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read graph evidence"
  ON public.graph_relationship_evidence FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manages graph evidence"
  ON public.graph_relationship_evidence FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_graph_rel_updated_at
  BEFORE UPDATE ON public.graph_relationship_evidence
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Temporal decay view: relationships lose weight as evidence ages.
CREATE VIEW public.graph_relationship_current
WITH (security_invoker = true) AS
SELECT
  e.*,
  GREATEST(0, EXTRACT(epoch FROM (now() - COALESCE(e.last_measured_at, e.created_at))) / 86400.0) AS evidence_age_days,
  CASE
    WHEN e.evidence_strength IS NULL THEN NULL
    ELSE round(
      (e.evidence_strength * exp(
        -ln(2.0) * GREATEST(0, EXTRACT(epoch FROM (now() - COALESCE(e.last_measured_at, e.created_at))) / 86400.0)
        / e.decay_half_life_days
      ))::numeric, 6)
  END AS decayed_weight
FROM public.graph_relationship_evidence e;

GRANT SELECT ON public.graph_relationship_current TO authenticated, service_role;

-- Populate strictly from measured production evidence.
CREATE OR REPLACE FUNCTION public.refresh_graph_relationship_evidence()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n_corr int := 0;
  n_dep int := 0;
  n_ent int := 0;
BEGIN
  -- 1. Measured cross-domain correlations (country-level, empirical)
  INSERT INTO public.graph_relationship_evidence (
    relationship_key, subject_kind, subject_key, object_kind, object_key,
    relation_type, direction, evidence_strength, evidence_status,
    sample_size, window_days, country_count, method, source_table, source_row_id,
    confidence, observed_from, observed_to, last_measured_at, decay_half_life_days, metadata)
  SELECT
    'cdc:' || c.iso3 || ':' || c.domain_a || ':' || c.domain_b,
    'country_domain', c.iso3 || '/' || c.domain_a,
    'country_domain', c.iso3 || '/' || c.domain_b,
    'correlates_with', 'undirected',
    abs(c.correlation),
    CASE WHEN COALESCE(c.sample_size,0) >= 8 THEN 'measured' ELSE 'insufficient_evidence' END,
    c.sample_size, c.window_days, 1,
    'pearson_cross_domain', 'cross_domain_correlations', c.id,
    CASE WHEN COALESCE(c.sample_size,0) >= 8
         THEN LEAST(1.0, COALESCE(c.sample_size,0)::numeric / 30.0) ELSE NULL END,
    c.computed_at - (COALESCE(c.window_days,0) || ' days')::interval,
    c.computed_at, c.computed_at, 90,
    jsonb_build_object('signed_correlation', c.correlation)
  FROM public.cross_domain_correlations c
  WHERE c.correlation IS NOT NULL
  ON CONFLICT (relationship_key) DO UPDATE SET
    evidence_strength = EXCLUDED.evidence_strength,
    evidence_status = EXCLUDED.evidence_status,
    sample_size = EXCLUDED.sample_size,
    window_days = EXCLUDED.window_days,
    confidence = EXCLUDED.confidence,
    observed_from = EXCLUDED.observed_from,
    observed_to = EXCLUDED.observed_to,
    last_measured_at = EXCLUDED.last_measured_at,
    metadata = EXCLUDED.metadata,
    updated_at = now();
  GET DIAGNOSTICS n_corr = ROW_COUNT;

  -- 2. Planetary dependency edges (only carry forward what was actually measured)
  INSERT INTO public.graph_relationship_evidence (
    relationship_key, subject_kind, subject_key, object_kind, object_key,
    relation_type, direction, evidence_strength, evidence_status,
    sample_size, country_count, method, source_table, source_row_id,
    confidence, last_measured_at, decay_half_life_days, metadata)
  SELECT
    'pde:' || d.edge_key,
    'system_node', d.source_node_key,
    'system_node', d.target_node_key,
    COALESCE(d.dependency_type, 'depends_on'), 'directed',
    d.measured_correlation,
    CASE WHEN d.measured_correlation IS NOT NULL AND COALESCE(d.measured_sample_size,0) >= 8
         THEN 'measured' ELSE 'unvalidated' END,
    d.measured_sample_size, d.measured_country_count,
    'planetary_dependency_measurement', 'planetary_dependency_edges', d.id,
    d.evidence_confidence, COALESCE(d.measured_at, d.created_at), 180,
    jsonb_build_object('latency_hours', d.latency_hours, 'strength_basis', d.strength_basis,
                       'declared_propagation_strength', d.propagation_strength)
  FROM public.planetary_dependency_edges d
  ON CONFLICT (relationship_key) DO UPDATE SET
    evidence_strength = EXCLUDED.evidence_strength,
    evidence_status = EXCLUDED.evidence_status,
    sample_size = EXCLUDED.sample_size,
    country_count = EXCLUDED.country_count,
    confidence = EXCLUDED.confidence,
    last_measured_at = EXCLUDED.last_measured_at,
    metadata = EXCLUDED.metadata,
    updated_at = now();
  GET DIAGNOSTICS n_dep = ROW_COUNT;

  -- 3. Provider-derived entity links carrying real provenance
  INSERT INTO public.graph_relationship_evidence (
    relationship_key, subject_kind, subject_key, object_kind, object_key,
    relation_type, direction, evidence_strength, evidence_status,
    method, source_table, source_row_id, confidence,
    last_measured_at, decay_half_life_days, metadata)
  SELECT
    'el:' || l.id::text,
    'entity', l.source_entity_id::text,
    'entity', l.target_entity_id::text,
    l.link_type::text, 'directed',
    l.strength,
    CASE WHEN l.provenance_confidence IS NOT NULL THEN 'measured' ELSE 'unvalidated' END,
    'entity_resolution_link', 'entity_links', l.id,
    l.provenance_confidence,
    COALESCE(l.provenance_observed_at, l.updated_at, l.created_at), 365,
    jsonb_build_object('provenance_source', l.provenance_source, 'source', l.source)
  FROM public.entity_links l
  WHERE l.source_entity_id IS NOT NULL AND l.target_entity_id IS NOT NULL
  ON CONFLICT (relationship_key) DO UPDATE SET
    evidence_strength = EXCLUDED.evidence_strength,
    evidence_status = EXCLUDED.evidence_status,
    confidence = EXCLUDED.confidence,
    last_measured_at = EXCLUDED.last_measured_at,
    updated_at = now();
  GET DIAGNOSTICS n_ent = ROW_COUNT;

  RETURN jsonb_build_object(
    'correlation_edges', n_corr,
    'dependency_edges', n_dep,
    'entity_edges', n_ent,
    'total_edges', (SELECT count(*) FROM public.graph_relationship_evidence),
    'measured_edges', (SELECT count(*) FROM public.graph_relationship_evidence WHERE evidence_status = 'measured'),
    'refreshed_at', now()
  );
END;
$$;

-- =====================================================================
-- LAYER 2: PLANETARY ANOMALY + WEAK-SIGNAL DISCOVERY
-- =====================================================================
CREATE TABLE public.weak_signal_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  input_max_date date,
  input_stale_days integer,
  candidates_scanned integer NOT NULL DEFAULT 0,
  detections_written integer NOT NULL DEFAULT 0,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weak_signal_run_status_chk CHECK (status IN ('running','success','stale_input','error'))
);

CREATE INDEX idx_weak_signal_runs_started ON public.weak_signal_runs (started_at DESC);

GRANT SELECT ON public.weak_signal_runs TO authenticated;
GRANT ALL ON public.weak_signal_runs TO service_role;
ALTER TABLE public.weak_signal_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read weak signal runs"
  ON public.weak_signal_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manages weak signal runs"
  ON public.weak_signal_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.weak_signal_detections (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid REFERENCES public.weak_signal_runs(id) ON DELETE SET NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  iso3 text NOT NULL,
  domain text NOT NULL,
  signal_class text NOT NULL,
  observed_value numeric NOT NULL,
  baseline_mean numeric NOT NULL,
  baseline_stddev numeric NOT NULL,
  baseline_sample_size integer NOT NULL,
  z_score numeric NOT NULL,
  window_days integer NOT NULL,
  corroborating_domains integer NOT NULL DEFAULT 0,
  corroborating_sources integer NOT NULL DEFAULT 0,
  novelty_score numeric,
  confidence numeric,
  method text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open',
  review_verdict text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  detected_on date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weak_signal_class_chk CHECK (signal_class IN ('anomaly','weak_signal','corroborated_cluster')),
  CONSTRAINT weak_signal_status_chk CHECK (status IN ('open','reviewed','dismissed','escalated')),
  CONSTRAINT weak_signal_verdict_chk CHECK (review_verdict IS NULL OR review_verdict IN ('true_positive','false_positive','inconclusive'))
);

CREATE UNIQUE INDEX uq_weak_signal_daily ON public.weak_signal_detections
  (iso3, domain, signal_class, detected_on);
CREATE INDEX idx_weak_signal_detected ON public.weak_signal_detections (detected_at DESC);
CREATE INDEX idx_weak_signal_iso3_domain ON public.weak_signal_detections (iso3, domain, detected_at DESC);
CREATE INDEX idx_weak_signal_open ON public.weak_signal_detections (status, detected_at DESC) WHERE status = 'open';

GRANT SELECT, UPDATE ON public.weak_signal_detections TO authenticated;
GRANT ALL ON public.weak_signal_detections TO service_role;
ALTER TABLE public.weak_signal_detections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read detections"
  ON public.weak_signal_detections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators can record a review verdict"
  ON public.weak_signal_detections FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Service role manages detections"
  ON public.weak_signal_detections FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_weak_signal_updated_at
  BEFORE UPDATE ON public.weak_signal_detections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.detect_weak_signals(
  p_window_days integer DEFAULT 14,
  p_baseline_days integer DEFAULT 180,
  p_anomaly_z numeric DEFAULT 2.5,
  p_weak_z numeric DEFAULT 1.5,
  p_min_baseline_n integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
  v_max_date date;
  v_stale int;
  v_scanned int := 0;
  v_written int := 0;
  v_status text := 'success';
BEGIN
  SELECT max(snapshot_date) INTO v_max_date FROM public.country_performance_snapshots;
  IF v_max_date IS NULL THEN
    INSERT INTO public.weak_signal_runs (status, completed_at, error, parameters)
    VALUES ('error', now(), 'No country_performance_snapshots rows available', '{}'::jsonb)
    RETURNING id INTO v_run_id;
    RETURN jsonb_build_object('run_id', v_run_id, 'status', 'error',
      'reason', 'no input data', 'detections', 0);
  END IF;

  v_stale := (CURRENT_DATE - v_max_date);
  IF v_stale > 21 THEN v_status := 'stale_input'; END IF;

  INSERT INTO public.weak_signal_runs (input_max_date, input_stale_days, parameters)
  VALUES (v_max_date, v_stale, jsonb_build_object(
    'window_days', p_window_days, 'baseline_days', p_baseline_days,
    'anomaly_z', p_anomaly_z, 'weak_z', p_weak_z, 'min_baseline_n', p_min_baseline_n))
  RETURNING id INTO v_run_id;

  WITH recent AS (
    SELECT iso3, domain, avg(performance_index) AS obs, count(*) AS n_recent
    FROM public.country_performance_snapshots
    WHERE snapshot_date > v_max_date - p_window_days
      AND performance_index IS NOT NULL
    GROUP BY iso3, domain
  ),
  baseline AS (
    SELECT iso3, domain, avg(performance_index) AS mu,
           stddev_samp(performance_index) AS sd, count(*) AS n
    FROM public.country_performance_snapshots
    WHERE snapshot_date <= v_max_date - p_window_days
      AND snapshot_date > v_max_date - p_window_days - p_baseline_days
      AND performance_index IS NOT NULL
    GROUP BY iso3, domain
  ),
  scored AS (
    SELECT r.iso3, r.domain, r.obs, b.mu, b.sd, b.n,
           (r.obs - b.mu) / b.sd AS z
    FROM recent r
    JOIN baseline b ON b.iso3 = r.iso3 AND b.domain = r.domain
    WHERE b.sd IS NOT NULL AND b.sd > 0 AND b.n >= p_min_baseline_n
  ),
  corroboration AS (
    SELECT s.*,
      (SELECT count(*) FROM scored s2
        WHERE s2.iso3 = s.iso3 AND s2.domain <> s.domain AND abs(s2.z) >= p_weak_z) AS corr_domains
    FROM scored s
    WHERE abs(s.z) >= p_weak_z
  ),
  sources AS (
    SELECT c.*,
      COALESCE((SELECT count(DISTINCT g.ingestion_source) FROM public.global_signals g
         WHERE g.geo_admin0_iso3 = c.iso3
           AND g.ingested_at > now() - (p_window_days || ' days')::interval), 0) AS corr_sources
    FROM corroboration c
  )
  INSERT INTO public.weak_signal_detections (
    run_id, iso3, domain, signal_class, observed_value, baseline_mean, baseline_stddev,
    baseline_sample_size, z_score, window_days, corroborating_domains, corroborating_sources,
    novelty_score, confidence, method, evidence)
  SELECT
    v_run_id, s.iso3, s.domain,
    CASE
      WHEN abs(s.z) >= p_anomaly_z THEN 'anomaly'
      WHEN s.corr_domains >= 2 THEN 'corroborated_cluster'
      ELSE 'weak_signal'
    END,
    round(s.obs::numeric, 4), round(s.mu::numeric, 4), round(s.sd::numeric, 4), s.n,
    round(s.z::numeric, 4), p_window_days, s.corr_domains, s.corr_sources,
    round(LEAST(1.0, abs(s.z) / 6.0)::numeric, 4),
    round(LEAST(1.0,
      (LEAST(1.0, abs(s.z) / p_anomaly_z) * 0.5)
      + (LEAST(1.0, s.corr_domains::numeric / 3.0) * 0.25)
      + (LEAST(1.0, s.corr_sources::numeric / 5.0) * 0.25))::numeric, 4),
    'snapshot_zscore_v1',
    jsonb_build_object(
      'source_table', 'country_performance_snapshots',
      'input_max_date', v_max_date,
      'input_stale_days', v_stale,
      'baseline_window_days', p_baseline_days,
      'corroborating_source_table', 'global_signals')
  FROM sources s
  ON CONFLICT (iso3, domain, signal_class, detected_on) DO NOTHING;

  GET DIAGNOSTICS v_written = ROW_COUNT;
  SELECT count(*) INTO v_scanned FROM public.country_performance_snapshots
   WHERE snapshot_date > v_max_date - p_window_days;

  UPDATE public.weak_signal_runs
     SET completed_at = now(), status = v_status,
         candidates_scanned = v_scanned, detections_written = v_written
   WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'run_id', v_run_id, 'status', v_status, 'input_max_date', v_max_date,
    'input_stale_days', v_stale, 'candidates_scanned', v_scanned,
    'detections', v_written);
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_graph_relationship_evidence() TO service_role;
GRANT EXECUTE ON FUNCTION public.detect_weak_signals(integer, integer, numeric, numeric, integer) TO service_role;