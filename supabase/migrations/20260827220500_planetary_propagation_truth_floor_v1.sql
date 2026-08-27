-- AICIS Planetary Propagation Truth Floor v1
--
-- The planetary dependency graph remains useful as a structural/exposure model.
-- Cross-domain correlation remains useful as descriptive association evidence.
-- Neither structural weight nor correlation is causal probability/confidence.
-- Automatic propagation is quarantined until mechanistic/causal evidence is
-- governed and independently evaluated.

ALTER TABLE public.planetary_dependency_edges
  ALTER COLUMN propagation_strength DROP DEFAULT,
  ALTER COLUMN latency_hours DROP DEFAULT,
  ALTER COLUMN evidence_confidence DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_legacy_evidence_confidence numeric,
  ADD COLUMN IF NOT EXISTS propagation_strength_semantics text,
  ADD COLUMN IF NOT EXISTS latency_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_confidence_semantics text,
  ADD COLUMN IF NOT EXISTS association_semantics text,
  ADD COLUMN IF NOT EXISTS causal_evidence_status text NOT NULL DEFAULT 'not_established';

UPDATE public.planetary_dependency_edges
SET
  reported_legacy_evidence_confidence = COALESCE(reported_legacy_evidence_confidence, evidence_confidence),
  evidence_confidence = NULL,
  evidence_confidence_semantics = COALESCE(
    evidence_confidence_semantics,
    'withheld_legacy_expert_or_correlation_derived_value_not_causal_confidence'
  ),
  propagation_strength_semantics = COALESCE(
    propagation_strength_semantics,
    'expert_structural_exposure_prior_not_probability_or_causal_coefficient'
  ),
  latency_semantics = COALESCE(
    latency_semantics,
    'expert_structural_latency_prior_not_empirical_event_time_distribution'
  ),
  association_semantics = CASE
    WHEN measured_correlation IS NULL THEN 'no_measured_cross_domain_association'
    ELSE 'descriptive_cross_domain_correlation_not_causality'
  END,
  causal_evidence_status = 'not_established';

ALTER TABLE public.planetary_propagation_events
  ALTER COLUMN impact_probability DROP DEFAULT,
  ALTER COLUMN impact_severity DROP DEFAULT,
  ALTER COLUMN evidence_score DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_legacy_impact_probability numeric,
  ADD COLUMN IF NOT EXISTS reported_legacy_impact_severity numeric,
  ADD COLUMN IF NOT EXISTS reported_legacy_evidence_score numeric,
  ADD COLUMN IF NOT EXISTS reported_legacy_recommended_interventions jsonb,
  ADD COLUMN IF NOT EXISTS event_semantics text NOT NULL DEFAULT 'legacy_planetary_propagation_unverified',
  ADD COLUMN IF NOT EXISTS probability_semantics text,
  ADD COLUMN IF NOT EXISTS severity_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_score_semantics text,
  ADD COLUMN IF NOT EXISTS recommendation_semantics text,
  ADD COLUMN IF NOT EXISTS causal_status text NOT NULL DEFAULT 'not_established';

UPDATE public.planetary_propagation_events
SET
  reported_legacy_impact_probability = COALESCE(reported_legacy_impact_probability, impact_probability),
  reported_legacy_impact_severity = COALESCE(reported_legacy_impact_severity, impact_severity),
  reported_legacy_evidence_score = COALESCE(reported_legacy_evidence_score, evidence_score),
  reported_legacy_recommended_interventions = COALESCE(reported_legacy_recommended_interventions, recommended_interventions),
  impact_probability = NULL,
  impact_severity = NULL,
  evidence_score = NULL,
  recommended_interventions = '[]'::jsonb,
  event_semantics = 'legacy_planetary_propagation_unverified',
  probability_semantics = COALESCE(probability_semantics, 'withheld_structural_weight_product_not_probability'),
  severity_semantics = COALESCE(severity_semantics, 'withheld_structural_weight_product_not_validated_impact_severity'),
  evidence_score_semantics = COALESCE(evidence_score_semantics, 'withheld_expert_or_correlation_derived_value_not_causal_evidence_confidence'),
  recommendation_semantics = COALESCE(recommendation_semantics, 'withheld_generic_template_interventions_not_evidence_derived'),
  causal_status = 'not_established';

CREATE TABLE IF NOT EXISTS public.planetary_propagation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_event text,
  source_domain text,
  source_region text,
  requested_initial_severity numeric,
  action text NOT NULL,
  outcome text NOT NULL,
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planetary_propagation_attempts_created
  ON public.planetary_propagation_attempts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_planetary_propagation_attempts_source
  ON public.planetary_propagation_attempts(source_domain, source_region, created_at DESC);

ALTER TABLE public.planetary_propagation_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read planetary propagation attempts"
  ON public.planetary_propagation_attempts;
CREATE POLICY "Authenticated read planetary propagation attempts"
  ON public.planetary_propagation_attempts
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role writes planetary propagation attempts"
  ON public.planetary_propagation_attempts;
CREATE POLICY "Service role writes planetary propagation attempts"
  ON public.planetary_propagation_attempts
  FOR INSERT TO service_role
  WITH CHECK (true);

GRANT SELECT ON public.planetary_propagation_attempts TO authenticated;
GRANT SELECT, INSERT ON public.planetary_propagation_attempts TO service_role;

DROP TRIGGER IF EXISTS trg_planetary_propagation_attempts_immutable
  ON public.planetary_propagation_attempts;
CREATE TRIGGER trg_planetary_propagation_attempts_immutable
  BEFORE UPDATE OR DELETE ON public.planetary_propagation_attempts
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

-- Association refresh remains active. It measures correlation and coverage, but
-- intentionally emits no causal confidence.
CREATE OR REPLACE FUNCTION public.refresh_planetary_edge_evidence()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  WITH ev AS (
    SELECT
      e.id,
      c.avg_corr,
      c.n,
      c.countries,
      c.last
    FROM public.planetary_dependency_edges e
    JOIN public.planetary_system_nodes sn ON sn.node_key = e.source_node_key
    JOIN public.planetary_system_nodes tn ON tn.node_key = e.target_node_key
    LEFT JOIN LATERAL (
      SELECT
        avg(cc.correlation) AS avg_corr,
        sum(cc.sample_size) AS n,
        count(DISTINCT cc.iso3) AS countries,
        max(cc.computed_at) AS last
      FROM public.cross_domain_correlations cc
      WHERE LEAST(cc.domain_a, cc.domain_b) = LEAST(
              public.planetary_domain_to_metric_domain(sn.node_domain),
              public.planetary_domain_to_metric_domain(tn.node_domain)
            )
        AND GREATEST(cc.domain_a, cc.domain_b) = GREATEST(
              public.planetary_domain_to_metric_domain(sn.node_domain),
              public.planetary_domain_to_metric_domain(tn.node_domain)
            )
    ) c ON true
  )
  UPDATE public.planetary_dependency_edges e
  SET
    measured_correlation = ev.avg_corr,
    measured_sample_size = ev.n,
    measured_country_count = ev.countries,
    measured_at = ev.last,
    evidence_status = CASE
      WHEN ev.avg_corr IS NULL THEN 'association_not_available'
      WHEN abs(ev.avg_corr) >= 0.30 THEN 'association_observed_stronger'
      WHEN abs(ev.avg_corr) >= 0.10 THEN 'association_observed_moderate'
      ELSE 'association_observed_weak'
    END,
    strength_basis = CASE
      WHEN ev.avg_corr IS NULL THEN 'expert_structural_prior_no_measured_association'
      ELSE 'expert_structural_prior_with_descriptive_association_context'
    END,
    evidence_confidence = NULL,
    evidence_confidence_semantics = 'not_applicable_correlation_is_not_causal_confidence',
    association_semantics = CASE
      WHEN ev.avg_corr IS NULL THEN 'no_measured_cross_domain_association'
      ELSE 'descriptive_cross_domain_correlation_not_causality'
    END,
    causal_evidence_status = 'not_established'
  FROM ev
  WHERE ev.id = e.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN jsonb_build_object(
    'status','success',
    'edges_updated',v_updated,
    'evidence_semantics','descriptive_association_only_not_causal_validation'
  );
END;
$$;

-- Compatibility entry point. Existing callers receive an explicit abstention and
-- no propagation event is emitted.
CREATE OR REPLACE FUNCTION public.generate_planetary_propagation_event(
  p_source_event text,
  p_source_domain text,
  p_source_region text DEFAULT 'global',
  p_initial_severity numeric DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.planetary_propagation_attempts(
    source_event,source_domain,source_region,requested_initial_severity,
    action,outcome,reason,metadata
  ) VALUES (
    p_source_event,p_source_domain,p_source_region,p_initial_severity,
    'generate_planetary_propagation_event','abstained',
    'automatic_planetary_causal_propagation_quarantined_structural_weights_and_correlations_do_not_establish_causality',
    jsonb_build_object('replacement_required',true)
  );

  RETURN jsonb_build_object(
    'status','abstained',
    'source_event',p_source_event,
    'source_domain',p_source_domain,
    'generated_propagations',0,
    'reason','planetary_causal_evidence_contract_not_established'
  );
END;
$$;

-- Compatibility cron target. Do not throw: an unknown live source cron may still
-- invoke the historical name. The call is auditable and produces no causal event.
CREATE OR REPLACE FUNCTION public.drive_planetary_causal_engine(p_limit integer DEFAULT 40)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.planetary_propagation_attempts(
    action,outcome,reason,metadata
  ) VALUES (
    'drive_planetary_causal_engine','abstained',
    'legacy_driver_quarantined_global_signal_impact_is_not_causal_propagation_evidence',
    jsonb_build_object('requested_limit',p_limit,'possible_live_cron_compatibility',true)
  );

  RETURN jsonb_build_object(
    'status','quarantined',
    'signals_considered',0,
    'sources_propagated',0,
    'reason','legacy_planetary_causal_driver_disabled_pending_governed_causal_model'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.generate_planetary_propagation_event(text,text,text,numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_planetary_propagation_event(text,text,text,numeric)
  TO service_role;

REVOKE ALL ON FUNCTION public.drive_planetary_causal_engine(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drive_planetary_causal_engine(integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.refresh_planetary_edge_evidence()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_planetary_edge_evidence()
  TO service_role;

CREATE OR REPLACE VIEW public.planetary_causal_command_view AS
SELECT
  p.source_event,
  p.source_domain,
  p.source_region,
  n.node_name AS impacted_system,
  p.impact_type,
  p.impact_probability,
  p.probability_semantics,
  p.impact_severity,
  p.severity_semantics,
  p.evidence_score,
  p.evidence_score_semantics,
  p.causal_status,
  p.event_semantics,
  p.projected_time_window,
  p.recommended_interventions,
  p.recommendation_semantics,
  p.generated_at
FROM public.planetary_propagation_events p
LEFT JOIN public.planetary_system_nodes n
  ON n.node_key = p.impacted_node_key
ORDER BY p.generated_at DESC;

COMMENT ON COLUMN public.planetary_dependency_edges.measured_correlation IS
  'Descriptive cross-domain association. It does not establish causal direction, mechanism, or intervention effect.';
COMMENT ON COLUMN public.planetary_dependency_edges.propagation_strength IS
  'Expert structural exposure prior. Not a probability or validated causal coefficient; interpret through propagation_strength_semantics.';
COMMENT ON FUNCTION public.refresh_planetary_edge_evidence() IS
  'Refreshes descriptive cross-domain association evidence and coverage only; never converts correlation into causal confidence.';
COMMENT ON FUNCTION public.generate_planetary_propagation_event(text,text,text,numeric) IS
  'Quarantined compatibility entry point. Records an abstention and emits no causal propagation events.';
COMMENT ON FUNCTION public.drive_planetary_causal_engine(integer) IS
  'Quarantined compatibility cron target. Records an abstention and emits no causal propagation events.';
