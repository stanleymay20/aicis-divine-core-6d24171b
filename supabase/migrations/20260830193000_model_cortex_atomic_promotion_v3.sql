-- AICIS Model Cortex Atomic Promotion v3
-- Additive only: creates governance and evaluation primitives; promotes nothing.

CREATE TABLE IF NOT EXISTS public.aicis_model_promotion_policies (
  domain text NOT NULL,
  modality text NOT NULL,
  task text NOT NULL,
  policy_version text NOT NULL CHECK (btrim(policy_version) <> ''),
  high_consequence boolean NOT NULL DEFAULT true,
  minimum_verified_samples integer NOT NULL CHECK (minimum_verified_samples >= 30),
  minimum_relative_brier_improvement numeric NOT NULL CHECK (minimum_relative_brier_improvement BETWEEN 0 AND 1),
  maximum_calibration_regression numeric NOT NULL CHECK (maximum_calibration_regression BETWEEN 0 AND 1),
  active boolean NOT NULL DEFAULT true,
  rationale text NOT NULL CHECK (btrim(rationale) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (domain, modality, task)
);
ALTER TABLE public.aicis_model_promotion_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aicis_model_promotion_policies FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.aicis_model_promotion_policies TO service_role;

COMMENT ON TABLE public.aicis_model_promotion_policies IS
  'Exact-scope server policy. No active row means promotion is blocked. Request values may only tighten these floors.';

CREATE OR REPLACE FUNCTION public.aicis_probability_semantics_evaluation_eligible(p_semantics text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_semantics IS NOT NULL
    AND btrim(p_semantics) <> ''
    AND (lower(p_semantics) LIKE '%probability%' OR lower(p_semantics) LIKE '%probabilistic%')
    AND lower(p_semantics) NOT LIKE '%not_probability%'
    AND lower(p_semantics) NOT LIKE '%not_probabilistic%'
    AND lower(p_semantics) NOT LIKE '%screen%'
    AND lower(p_semantics) NOT LIKE '%heuristic%'
    AND lower(p_semantics) NOT LIKE '%uncalibrated%'
    AND lower(p_semantics) NOT LIKE '%legacy%'
    AND lower(p_semantics) NOT LIKE '%unknown%'
    AND lower(p_semantics) NOT LIKE '%unspecified%';
$$;
REVOKE ALL ON FUNCTION public.aicis_probability_semantics_evaluation_eligible(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aicis_probability_semantics_evaluation_eligible(text) TO service_role;

CREATE OR REPLACE FUNCTION public.aicis_model_cortex_scope_metrics_v4(
  p_model_id text, p_domain text, p_modality text, p_task text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
WITH eligible AS (
  SELECT
    v.prediction_id,
    CASE WHEN v.probability::text ~ '^([0-9]+(\.[0-9]+)?|\.[0-9]+)$'
      THEN v.probability::numeric ELSE NULL END AS probability,
    v.binary_outcome::integer AS outcome,
    v.target_fingerprint_sha256,
    v.external_evidence_sha256,
    v.resolution_id
  FROM public.aicis_verified_model_outcome_evaluations v
  WHERE v.model_id = p_model_id
    AND v.domain = p_domain
    AND v.modality = p_modality
    AND v.task = p_task
    AND public.aicis_probability_semantics_evaluation_eligible(v.probability_semantics)
), usable AS (
  SELECT * FROM eligible WHERE probability BETWEEN 0 AND 1 AND outcome IN (0, 1)
), totals AS (
  SELECT
    count(*)::integer AS n,
    avg(power(probability - outcome, 2))::numeric AS brier,
    encode(digest(convert_to(COALESCE(string_agg(
      concat_ws('|', prediction_id, probability::text, outcome::text,
        target_fingerprint_sha256, external_evidence_sha256, resolution_id),
      E'\n' ORDER BY prediction_id), ''), 'UTF8'), 'sha256'), 'hex') AS fingerprint
  FROM usable
), bins AS (
  SELECT least(9, floor(probability * 10)::integer) AS bin_id,
    count(*)::integer AS n, avg(probability)::numeric AS p, avg(outcome)::numeric AS y
  FROM usable
  GROUP BY least(9, floor(probability * 10)::integer)
), cal AS (
  SELECT CASE WHEN (SELECT n FROM totals) < 30 THEN NULL::numeric
    ELSE sum((bins.n::numeric / NULLIF((SELECT n FROM totals), 0)) * abs(bins.p - bins.y))::numeric END AS ece
  FROM bins
)
SELECT jsonb_build_object(
  'sample_size', totals.n,
  'brier_score', totals.brier,
  'ece', cal.ece,
  'evidence_set_sha256', totals.fingerprint,
  'evaluation_method', 'externally_verified_target_resolution_probability_metrics_v4_full_population',
  'evaluation_evidence_policy', 'external_verified_target_resolution_v2_sealed_knowledge_time',
  'evaluation_scope', 'model_domain_modality_task',
  'population_truncated', false
) FROM totals CROSS JOIN cal;
$$;
REVOKE ALL ON FUNCTION public.aicis_model_cortex_scope_metrics_v4(text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aicis_model_cortex_scope_metrics_v4(text,text,text,text) TO service_role;

ALTER TABLE public.aicis_model_competency
  ADD COLUMN IF NOT EXISTS evaluation_evidence_set_sha256 text
  CHECK (evaluation_evidence_set_sha256 IS NULL OR evaluation_evidence_set_sha256 ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION public.refresh_aicis_model_cortex_competency_v4(
  p_model_id text, p_domain text, p_modality text, p_task text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  m jsonb;
  n integer;
  b numeric;
  e numeric;
BEGIN
  m := public.aicis_model_cortex_scope_metrics_v4(p_model_id, p_domain, p_modality, p_task);
  n := COALESCE((m->>'sample_size')::integer, 0);
  b := NULLIF(m->>'brier_score', '')::numeric;
  e := NULLIF(m->>'ece', '')::numeric;

  UPDATE public.aicis_model_competency
  SET sample_size = n,
      verified_sample_size = n,
      brier_score = b,
      brier_score_semantics = CASE WHEN b IS NULL THEN NULL ELSE 'mean_squared_probability_error_on_externally_verified_target_resolved_binary_outcomes' END,
      ece = e,
      ece_semantics = CASE WHEN e IS NULL THEN NULL ELSE 'ten_equal_width_bin_expected_calibration_error_on_externally_verified_target_resolved_binary_outcomes' END,
      evaluation_status = CASE WHEN n = 0 THEN 'no_externally_verified_target_resolved_probability_pairs'
        WHEN e IS NULL THEN 'partial_externally_verified_probabilistic_evaluation'
        ELSE 'externally_verified_probabilistic_outcomes_evaluated_v4_full_population' END,
      evaluation_method = m->>'evaluation_method',
      evaluation_evidence_policy = m->>'evaluation_evidence_policy',
      evaluation_scope = m->>'evaluation_scope',
      evaluation_evidence_set_sha256 = m->>'evidence_set_sha256',
      evaluated_at = now()
  WHERE model_id::text = p_model_id AND domain = p_domain AND modality = p_modality AND task = p_task;

  RETURN m;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_aicis_model_cortex_competency_v4(text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_aicis_model_cortex_competency_v4(text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.promote_aicis_model_cortex_atomic_v4(
  p_challenger_model_id text,
  p_baseline_model_id text,
  p_domain text,
  p_modality text,
  p_task text,
  p_confirm_promotion boolean DEFAULT false,
  p_requested_minimum_relative_brier_improvement numeric DEFAULT NULL,
  p_requested_maximum_calibration_regression numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  pol public.aicis_model_promotion_policies%ROWTYPE;
  challenger public.aicis_model_registry%ROWTYPE;
  baseline public.aicis_model_registry%ROWTYPE;
  cm jsonb;
  bm jsonb;
  cn integer;
  bn integer;
  cb numeric;
  bb numeric;
  ce numeric;
  be numeric;
  min_imp numeric;
  max_reg numeric;
  rel_imp numeric;
  cal_imp numeric;
  reasons text[] := ARRAY[]::text[];
  eligible boolean;
  promoted boolean;
  ts timestamptz := now();
BEGIN
  IF p_challenger_model_id IS NULL OR p_baseline_model_id IS NULL OR p_challenger_model_id = p_baseline_model_id THEN
    RAISE EXCEPTION 'challenger and baseline must be distinct model ids';
  END IF;

  SELECT * INTO pol FROM public.aicis_model_promotion_policies
  WHERE domain = p_domain AND modality = p_modality AND task = p_task AND active = true
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no active governed promotion policy exists for exact scope'; END IF;

  IF p_requested_minimum_relative_brier_improvement IS NOT NULL
     AND p_requested_minimum_relative_brier_improvement < pol.minimum_relative_brier_improvement THEN
    RAISE EXCEPTION 'requested Brier threshold may not weaken governed policy floor';
  END IF;
  IF p_requested_maximum_calibration_regression IS NOT NULL
     AND p_requested_maximum_calibration_regression > pol.maximum_calibration_regression THEN
    RAISE EXCEPTION 'requested calibration tolerance may not weaken governed policy floor';
  END IF;

  min_imp := greatest(pol.minimum_relative_brier_improvement,
    COALESCE(p_requested_minimum_relative_brier_improvement, pol.minimum_relative_brier_improvement));
  max_reg := least(pol.maximum_calibration_regression,
    COALESCE(p_requested_maximum_calibration_regression, pol.maximum_calibration_regression));

  SELECT * INTO challenger FROM public.aicis_model_registry WHERE id::text = p_challenger_model_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'challenger model not found'; END IF;
  SELECT * INTO baseline FROM public.aicis_model_registry WHERE id::text = p_baseline_model_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'baseline model not found'; END IF;
  IF baseline.metadata->>'role' IS DISTINCT FROM 'baseline' THEN
    RAISE EXCEPTION 'baseline model is not governed as role=baseline';
  END IF;

  cm := public.aicis_model_cortex_scope_metrics_v4(p_challenger_model_id, p_domain, p_modality, p_task);
  bm := public.aicis_model_cortex_scope_metrics_v4(p_baseline_model_id, p_domain, p_modality, p_task);
  cn := COALESCE((cm->>'sample_size')::integer, 0);
  bn := COALESCE((bm->>'sample_size')::integer, 0);
  cb := NULLIF(cm->>'brier_score', '')::numeric;
  bb := NULLIF(bm->>'brier_score', '')::numeric;
  ce := NULLIF(cm->>'ece', '')::numeric;
  be := NULLIF(bm->>'ece', '')::numeric;

  IF cn < pol.minimum_verified_samples THEN reasons := array_append(reasons, format('insufficient verified challenger sample size %s/%s', cn, pol.minimum_verified_samples)); END IF;
  IF bn < pol.minimum_verified_samples THEN reasons := array_append(reasons, format('insufficient verified baseline sample size %s/%s', bn, pol.minimum_verified_samples)); END IF;

  IF bb IS NULL OR cb IS NULL OR bb <= 0 THEN
    reasons := array_append(reasons, 'comparable current Brier evidence is unavailable');
  ELSE
    rel_imp := (bb - cb) / bb;
    IF rel_imp < min_imp THEN reasons := array_append(reasons, 'challenger does not meet governed Brier improvement floor'); END IF;
  END IF;

  IF be IS NULL OR ce IS NULL THEN
    reasons := array_append(reasons, 'comparable current ECE evidence is unavailable');
  ELSE
    cal_imp := be - ce;
    IF cal_imp < -max_reg THEN reasons := array_append(reasons, 'challenger exceeds governed calibration-regression tolerance'); END IF;
  END IF;

  eligible := cardinality(reasons) = 0;
  promoted := eligible AND p_confirm_promotion;

  IF promoted THEN
    UPDATE public.aicis_model_registry
    SET production_approved = true,
        updated_at = ts,
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'promoted_against', baseline.model_key,
          'promoted_domain', p_domain,
          'promoted_modality', p_modality,
          'promoted_task', p_task,
          'promoted_at', ts,
          'promotion_policy', 'atomic-governed-current-evidence-v4',
          'promotion_policy_version', pol.policy_version,
          'high_consequence', pol.high_consequence,
          'minimum_verified_samples', pol.minimum_verified_samples,
          'challenger_evidence_set_sha256', cm->>'evidence_set_sha256',
          'baseline_evidence_set_sha256', bm->>'evidence_set_sha256',
          'explicit_admin_confirmation', true
        )
    WHERE id::text = p_challenger_model_id;
  END IF;

  -- Registry update and audit record are one function transaction. Any audit
  -- failure rolls the entire promotion back.
  INSERT INTO public.aicis_cognitive_events (
    event_type, epistemic_status, confidence, confidence_semantics,
    occurred_at, observed_at, time_semantics, producer, payload, provenance
  ) VALUES (
    CASE WHEN promoted THEN 'model.promoted' ELSE 'model.promotion_evaluated' END,
    'derived', NULL,
    'not_issued_promotion_policy_decision_is_not_epistemic_confidence',
    ts, ts, 'promotion_evaluation_time', 'promote_aicis_model_cortex_atomic_v4',
    jsonb_build_object(
      'challenger_model_id', p_challenger_model_id,
      'baseline_model_id', p_baseline_model_id,
      'domain', p_domain,
      'modality', p_modality,
      'task', p_task,
      'policy_version', pol.policy_version,
      'high_consequence', pol.high_consequence,
      'minimum_verified_samples', pol.minimum_verified_samples,
      'challenger_sample_size', cn,
      'baseline_sample_size', bn,
      'challenger_evidence_set_sha256', cm->>'evidence_set_sha256',
      'baseline_evidence_set_sha256', bm->>'evidence_set_sha256',
      'relative_brier_improvement', rel_imp,
      'calibration_improvement', cal_imp,
      'effective_minimum_relative_brier_improvement', min_imp,
      'effective_maximum_calibration_regression', max_reg,
      'eligible', eligible,
      'confirmation_requested', p_confirm_promotion,
      'promoted', promoted,
      'reasons', to_jsonb(reasons)
    ),
    '[]'::jsonb
  );

  RETURN jsonb_build_object(
    'eligible', eligible,
    'confirmation_required', eligible AND NOT p_confirm_promotion,
    'confirmation_requested', p_confirm_promotion,
    'promoted', promoted,
    'policy_version', pol.policy_version,
    'high_consequence', pol.high_consequence,
    'minimum_verified_samples', pol.minimum_verified_samples,
    'challenger_verified_sample_size', cn,
    'baseline_verified_sample_size', bn,
    'challenger_evidence_set_sha256', cm->>'evidence_set_sha256',
    'baseline_evidence_set_sha256', bm->>'evidence_set_sha256',
    'relative_brier_improvement', rel_imp,
    'calibration_improvement', cal_imp,
    'effective_minimum_relative_brier_improvement', min_imp,
    'effective_maximum_calibration_regression', max_reg,
    'promotion_policy', 'atomic-governed-current-evidence-v4',
    'reasons', to_jsonb(reasons)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.promote_aicis_model_cortex_atomic_v4(text,text,text,text,text,boolean,numeric,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_aicis_model_cortex_atomic_v4(text,text,text,text,text,boolean,numeric,numeric) TO service_role;
