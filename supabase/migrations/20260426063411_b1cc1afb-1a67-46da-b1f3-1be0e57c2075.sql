CREATE OR REPLACE VIEW public.quantivis_risk_predictions
WITH (security_invoker=on) AS
SELECT
  rrp.id, rrp.country_iso3, rrp.domain, rrp.risk_probability,
  rrp.confidence_lower, rrp.confidence_upper, rrp.rank_position,
  rrp.horizon_days, rrp.factors, rrp.evidence_count, rrp.proxy_share,
  rrp.model_version, rrp.generated_at, rrp.generation_batch_id
FROM public.risk_ranking_predictions rrp
WHERE rrp.generation_batch_id = (
  SELECT generation_batch_id FROM public.risk_ranking_predictions
  ORDER BY generated_at DESC LIMIT 1
);

CREATE OR REPLACE VIEW public.quantivis_cross_border_signals
WITH (security_invoker=on) AS
SELECT id, signal_type, origin_iso3, affected_iso3, domain,
       intensity, description, detected_at, metadata
FROM public.cross_border_signals
WHERE detected_at >= NOW() - INTERVAL '30 days';

CREATE OR REPLACE VIEW public.quantivis_cross_domain_influence
WITH (security_invoker=on) AS
SELECT id, source_domain, target_domain, region,
       transfer_strength, sample_size, lag_days, computed_at
FROM public.cross_domain_influence
WHERE computed_at >= NOW() - INTERVAL '60 days';

CREATE OR REPLACE VIEW public.quantivis_recommended_actions
WITH (security_invoker=on) AS
SELECT
  id, country_iso3, domain, intervention_type, intervention_title,
  rationale_md, urgency_window, urgency_hours,
  estimated_roi_eur, estimated_cost_eur,
  expected_roi_lower, expected_roi_upper,
  confidence, status, generated_at
FROM public.risk_action_recommendations
WHERE generated_at >= NOW() - INTERVAL '14 days';

CREATE OR REPLACE VIEW public.quantivis_prediction_outcomes
WITH (security_invoker=on) AS
SELECT
  id, prediction_id, country_iso3, domain,
  predicted_probability, actual_label, error, brier_score, surprise,
  predicted_at, realized_at, horizon_days, delta_performance
FROM public.risk_prediction_realizations
WHERE realized_at >= NOW() - INTERVAL '90 days';

CREATE OR REPLACE VIEW public.quantivis_entity_links
WITH (security_invoker=on) AS
SELECT
  el.id,
  el.source_entity_id,
  src.canonical_name AS source_name,
  src.iso3 AS source_iso3,
  src.entity_type AS source_type,
  el.target_entity_id,
  tgt.canonical_name AS target_name,
  tgt.iso3 AS target_iso3,
  tgt.entity_type AS target_type,
  el.link_type,
  el.strength,
  el.source AS link_source,
  el.created_at
FROM public.entity_links el
LEFT JOIN public.canonical_entities src ON src.id = el.source_entity_id
LEFT JOIN public.canonical_entities tgt ON tgt.id = el.target_entity_id;

GRANT SELECT ON public.quantivis_risk_predictions TO anon, authenticated, service_role;
GRANT SELECT ON public.quantivis_cross_border_signals TO anon, authenticated, service_role;
GRANT SELECT ON public.quantivis_cross_domain_influence TO anon, authenticated, service_role;
GRANT SELECT ON public.quantivis_recommended_actions TO anon, authenticated, service_role;
GRANT SELECT ON public.quantivis_prediction_outcomes TO anon, authenticated, service_role;
GRANT SELECT ON public.quantivis_entity_links TO anon, authenticated, service_role;