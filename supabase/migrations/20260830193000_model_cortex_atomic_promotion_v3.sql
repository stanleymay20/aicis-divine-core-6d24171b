-- AICIS Model Cortex Atomic Promotion v3
--
-- Closes due-diligence defects in promotion governance:
--   * no caller may weaken promotion floors;
--   * high-consequence classification is governed server-side, not request-side;
--   * promotion metrics are recomputed from the current canonical verified set;
--   * the full eligible population is evaluated (no silent 5,000-row truncation);
--   * the evaluation set is fingerprinted;
--   * registry promotion and governance audit event are one transaction.
--
-- This migration is additive and does not promote any model by itself.

-- -----------------------------------------------------------------------------
-- 1. Governed promotion policy. Missing policy means promotion is ineligible.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aicis_model_promotion_policies (
  domain text NOT NULL,
  modality text NOT NULL,
  task text NOT NULL,
  policy_version text NOT NULL,
  high_consequence boolean NOT NULL DEFAULT true,
  minimum_verified_samples integer NOT NULL CHECK (minimum_verified_samples >= 30),
  minimum_relative_brier_improvement numeric NOT NULL
    CHECK (minimum_relative_brier_improvement >= 0 AND minimum_relative_brier_improvement <= 1),
  maximum_calibration_regression numeric NOT NULL
    CHECK (maximum_calibration_regression >= 0 AND maximum_calibration_regression <= 1),
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
  'Server-governed minimum promotion floors. Absence of an active exact scope policy blocks promotion. Request parameters may only tighten these floors.';

-- -----------------------------------------------------------------------------
-- 2. Canonical probability-semantic eligibility contract for evaluation.
--    One database function is authoritative for Model Cortex evaluation.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aicis_probability_semantics_evaluation_eligible(p_semantics text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_semantics IS NULL OR btrim(p_semantics) = '' THEN false
    WHEN lower(p_semantics) LIKE '%not_probability%' THEN false
    WHEN lower(p_semantics) LIKE '%not_probabilistic%' THEN false
    WHEN lower(p_semantics) LIKE '%screen%' THEN false
    WHEN lower(p_semantics) LIKE '%heuristic%' THEN false
    WHEN lower(p_semantics) LIKE '%uncalibrated%' THEN false
    WHEN lower(p_semantics) LIKE '%legacy%' THEN false
    WHEN lower(p_semantics) LIKE '%unknown%' THEN false
    WHEN lower(p_semantics) LIKE '%unspecified%' THEN false
    WHEN lower(p_semantics) LIKE '%probability%' OR lower(p_semantics) LIKE '%probabilistic%' THEN true
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.aicis_probability_semantics_evaluation_eligible(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aicis_probability_semantics_evaluation_eligible(text) TO service_role;

-- -----------------------------------------------------------------------------
-- 3. Complete current-sample metrics + SHA-256 population fingerprint.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aicis_model_cortex_scope_metrics_v4(
  p_model_id text,
  p_domain text,
  p_modality text,
  p_task text
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
      CASE
        WHEN v.probability::text ~ '^([0-9]+(\.[0-9]+)?|\.[0-9]+)$'
          THEN v.probability::numeric
        ELSE NULL
      END AS probability,
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
  ),
  usable AS (
    SELECT *
    FROM eligible
    WHERE probability BETWEEN 0 AND 1
      AND outcome IN (0, 1)
  ),
  totals AS (
    SELECT
      count(*)::integer AS sample_size,
      avg(power(probability - outcome, 2))::numeric AS brier_score,
      encode(
        digest(
          convert_to(
            COALESCE(string_agg(
              concat_ws('|',
                prediction_id,
                probability::text,
                outcome::text,
                target_fingerprint_sha256,
                external_evidence_sha256,
                resolution_id
              ),
              E'\n' ORDER BY prediction_id
            ), ''),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ) AS evidence_set_sha256
    FROM usable
  ),
  binned AS (
    SELECT
      least(9, floor(probability * 10)::integer) AS bin_id,
      count(*)::integer AS n,
      avg(probability)::numeric AS mean_probability,
      avg(outcome)::numeric AS empirical_rate
    FROM usable
    GROUP BY least(9, floor(probability * 10)::integer)
  ),
  calibration AS (
    SELECT CASE
      WHEN (SELECT sample_size FROM totals) < 30 THEN NULL::numeric
      ELSE sum(
        (b.n::numeric / NULLIF((SELECT sample_size FROM totals), 0))
        * abs(b.mean_probability - b.empirical_rate)
      )::numeric
    END AS ece
    FROM binned b
  )
  SELECT jsonb_build_object(
    'sample_size', t.sample_size,
    'brier_score', t.brier_score,
    'ece', c.ece,
    'evidence_set_sha256', t.evidence_set_sha256,
    'evaluation_method', 'externally_verified_target_resolution_probability_metrics_v4_full_population',
    'evaluation_evidence_policy', 'external_verified_target_resolution_v2_sealed_knowledge_time',
    'evaluation_scope', 'model_domain_modality_task',
    'population_truncated', false
  )
  FROM totals t CROSS JOIN calibration c;
$$;

REVOKE ALL ON FUNCTION public.aicis_model_cortex_scope_metrics_v4(text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aicis_model_cortex_scope_metrics_v4(text,text,text,text) TO service_role;

ALTER TABLE public.aicis_model_competency
  ADD COLUMN IF NOT EXISTS evaluation_evidence_set_sha256 text
    CHECK (evaluation_evidence_set_sha256 IS NULL OR evaluation_evidence_set_sha256 ~ '^[0-9a-f]{64}$');

-- Recompute and store current metrics for UI/observability. Promotion itself does
-- not trust this cache; it recomputes metrics again inside the atomic promoter.
CREATE OR REPLACE FUNCTION public.refresh_aicis_model_cortex_competency_v4(
  p_model_id text,
  p_domain text,
  p_modality text,
  p_task text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_metrics jsonb;
  v_sample integer;
  v_brier numeric;
  v_ece numeric;
BEGIN
  v_metrics := public.aicis_model_cortex_scope_metrics_v4(p_model_id, p_domain, p_modality, p_task);
  v_sample := COALESCE((v_metrics->>'sample_size')::integer, 0);
  v_brier := NULLIF(v_metrics->>'brier_score', '')::numeric;
  v_ece := NULLIF(v_metrics->>'ece', '')::numeric;

  UPDATE public.aicis_model_competency
  SET sample_size = v_sample,
      verified_sample_size = v_sample,
      brier_score = v_brier,
      brier_score_semantics = CASE WHEN v_brier IS NULL THEN NULL ELSE 'mean_squared_probability_error_on_externally_verified_target_resolved_binary_outcomes' END,
      ece = v_ece,
      ece_semantics = CASE WHEN v_ece IS NULL THEN NULL ELSE 'ten_equal_width_bin_expected_calibration_error_on_externally_verified_target_resolved_binary_outcomes' END,
      evaluation_status = CASE
        WHEN v_sample = 0 THEN 'no_externally_verified_target_resolved_probability_pairs'
        WHEN v_ece IS NULL THEN 'partial_externally_verified_probabilistic_evaluation'
        ELSE 'externally_verified_probabilistic_outcomes_evaluated_v4_full_population'
      END,
      evaluation_method = v_metrics->>'evaluation_method',
      evaluation_evidence_policy = v_metrics->>'evaluation_evidence_policy',
      evaluation_scope = v_metrics->>'evaluation_scope',
      evaluation_evidence_set_sha256 = v_metrics->>'evidence_set_sha256',
      evaluated_at = now()
  WHERE model_id::text = p_model_id
    AND domain = p_domain
    AND modality = p_modality
    AND task = p_task;

  RETURN v_metrics;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_aicis_model_cortex_competency_v4(text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_aicis_model_cortex_competency_v4(text,text,text,text) TO service_role;

-- -----------------------------------------------------------------------------
-- 4. Atomic governed promotion. Registry update and audit insert either both
--    succeed or both roll back. Current evidence is recomputed under row locks.
-- -----------------------------------------------------------------------------
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
  v_policy public.aicis_model_promotion_policies%ROWTYPE;
  v_challenger public.aicis_model_registry%ROWTYPE;
  v_baseline public.aicis_model_registry%ROWTYPE;
  v_cm jsonb;
  v_bm jsonb;
  v_cn integer;
  v_bn integer;
  v_cb numeric;
  v_bb numeric;
  v_ce numeric;
  v_be numeric;
  v_min_improvement numeric;
  v_max_calibration_regression numeric;
  v_relative_improvement numeric;
  v_calibration_improvement numeric;
  v_reasons text[] := ARRAY[]::text[];
  v_eligible boolean;
  v_promoted boolean := false;
  v_now timestamptz := now();
BEGIN
  IF p_challenger_model_id IS NULL OR p_baseline_model_id IS NULL OR p_challenger_model_id = p_baseline_model_id THEN
    RAISE EXCEPTION 'challenger and baseline must be distinct model ids';
  END IF;

  SELECT * INTO v_policy
  FROM public.aicis_model_promotion_policies
  WHERE domain = p_domain AND modality = p_modality AND task = p_task AND active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active governed promotion policy exists for exact scope';
  END IF;

  IF p_requested_minimum_relative_brier_improvement IS NOT NULL
     AND p_requested_minimum_relative_brier_improvement < v_policy.minimum_relative_brier_improvement THEN
    RAISE EXCEPTION 'requested Brier threshold may not weaken governed policy floor';
  END IF;
  IF p_requested_maximum_calibration_regression IS NOT NULL
     AND p_requested_maximum_calibration_regression > v_policy.maximum_calibration_regression THEN
    RAISE EXCEPTION 'requested calibration tolerance may not weaken governed policy floor';
  END IF;

  v_min_improvement := greatest(
    v_policy.minimum_relative_brier_improvement,
    COALESCE(p_requested_minimum_relative_brier_improvement, v_policy.minimum_relative_brier_improvement)
  );
  v_max_calibration_regression := least(
    v_policy.maximum_calibration_regression,
    COALESCE(p_requested_maximum_calibration_regression, v_policy.maximum_calibration_regression)
  );

  SELECT * INTO v_challenger
  FROM public.aicis_model_registry
  WHERE id::text = p_challenger_model_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'challenger model not found'; END IF;

  SELECT * INTO v_baseline
  FROM public.aicis_model_registry
  WHERE id::text = p_baseline_model_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'baseline model not found'; END IF;
  IF v_baseline.metadata->>'role' IS DISTINCT FROM 'baseline' THEN
    RAISE EXCEPTION 'baseline model is not governed as role=baseline';
  END IF;

  -- Authoritative current-state metrics. No cached competency values are trusted.
  v_cm := public.aicis_model_cortex_scope_metrics_v4(p_challenger_model_id, p_domain, p_modality, p_task);
  v_bm := public.aicis_model_cortex_scope_metrics_v4(p_baseline_model_id, p_domain, p_modality, p_task);
  v_cn := COALESCE((v_cm->>'sample_size')::integer, 0);
  v_bn := COALESCE((v_bm->>'sample_size')::integer, 0);
  v_cb := NULLIF(v_cm->>'brier_score', '')::numeric;
  v_bb := NULLIF(v_bm->>'brier_score', '')::numeric;
  v_ce := NULLIF(v_cm->>'ece', '')::numeric;
  v_be := NULLIF(v_bm->>'ece', '')::numeric;

  IF v_cn < v_policy.minimum_verified_samples THEN
    v_reasons := array_append(v_reasons, format('insufficient verified challenger sample size %s/%s', v_cn, v_policy.minimum_verified_samples));
  END IF;
  IF v_bn < v_policy.minimum_verified_samples THEN
    v_reasons := array_append(v_reasons, format('insufficient verified baseline sample size %s/%s', v_bn, v_policy.minimum_verified_samples));
  END IF;

  IF v_bb IS NULL OR v_cb IS NULL OR v_bb <= 0 THEN
    v_reasons := array_append(v_reasons, 'comparable current Brier evidence is unavailable');
  ELSE
    v_relative_improvement := (v_bb - v_cb) / v_bb;
    IF v_relative_improvement < v_min_improvement THEN
      v_reasons := array_append(v_reasons, 'challenger does not meet governed Brier improvement floor');
    END IF;
  END IF;

  IF v_be IS NULL OR v_ce IS NULL THEN
    v_reasons := array_append(v_reasons, 'comparable current ECE evidence is unavailable');
  ELSE
    v_calibration_improvement := v_be - v_ce;
    IF v_calibration_improvement < -v_max_calibration_regression THEN
      v_reasons := array_append(v_reasons, 'challenger exceeds governed calibration-regression tolerance');
    END IF;
  END IF;

  v_eligible := cardinality(v_reasons) = 0;
  v_promoted := v_eligible AND p_confirm_promotion;

  IF v_promoted THEN
    UPDATE public.aicis_model_registry
    SET production_approved = true,
        updated_at = v_now,
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'promoted_against', v_baseline.model_key,
          'promoted_domain', p_domain,
          'promoted_modality', p_modality,
          'promoted_task', p_task,
          'promoted_at', v_now,
          'promotion_policy', 'atomic-governed-current-evidence-v4',
          'promotion_policy_version', v_policy.policy_version,
          'high_consequence', v_policy.high_consequence,
          'minimum_verified_samples', v_policy.minimum_verified_samples,
          'challenger_evidence_set_sha256', v_cm->>'evidence_set_sha256',
          'baseline_evidence_set_sha256', v_bm->>'evidence_set_sha256',
          'explicit_admin_confirmation', true
        )
    WHERE id::text = p_challenger_model_id;
  END IF;

  -- This insert is intentionally inside the same database function transaction.
  -- Any audit failure rolls the entire promotion back.
  INSERT INTO public.aicis_cognitive_events (
    event_type, epistemic_status, confidence, confidence_semantics,
    occurred_at, observed_at, time_semantics, producer, payload, provenance
  ) VALUES (
    CASE WHEN v_promoted THEN 'model.promoted' ELSE 'model.promotion_evaluated' END,
    'derived',
    NULL,
    'not_issued_promotion_policy_decision_is_not_epistemic_confidence',
    v_now,
    v_now,
    'promotion_evaluation_time',
    'promote_aicis_model_cortex_atomic_v4',
    jsonb_build_object(
      'challenger_model_id', p_challenger_model_id,
      'baseline_model_id', p_baseline_model_id,
      'domain', p_domain,
      'modality', p_modality,
      'task', p_task,
      'policy_version', v_policy.policy_version,
      'high_consequence', v_policy.high_consequence,
      'minimum_verified_samples', v_policy.minimum_verified_samples,
      'challenger_sample_size', v_cn,
      'baseline_sample_size', v_bn,
      'challenger_evidence_set_sha256', v_cm->>'evidence_set_sha256',
      'baseline_evidence_set_sha256', v_bm->>'evidence_set_sha256',
      'relative_brier_improvement', v_relative_improvement,
      'calibration_improvement', v_calibration_improvement,
      'effective_minimum_relative_brier_improvement', v_min_improvement,
      'effective_maximum_calibration_regression', v_max_calibration_regression,
      'eligible', v_eligible,
      'confirmation_requested', p_confirm_promotion,
      'promoted', v_promoted,
      'reasons', to_jsonb(v_reasons)
    ),
    ARRAY[]::text[]
  );

  RETURN jsonb_build_object(
    'eligible', v_eligible,
    'confirmation_required', v_eligible AND NOT p_confirm_promotion,
    'confirmation_requested', p_confirm_promotion,
    'promoted', v_promoted,
    'policy_version', v_policy.policy_version,
    'high_consequence', v_policy.high_consequence,
    'minimum_verified_samples', v_policy.minimum_verified_samples,
    'challenger_verified_sample_size', v_cn,
    'baseline_verified_sample_size', v_bn,
    'challenger_evidence_set_sha256', v_cm->>'evidence_set_sha256',
    'baseline_evidence_set_sha256', v_bm->>'evidence_set_sha256',
    'relative_brier_improvement', v_relative_improvement,
    'calibration_improvement', v_calibration_improvement,
    'effective_minimum_relative_brier_improvement', v_min_improvement,
    'effective_maximum_calibration_regression', v_max_calibration_regression,
    'promotion_policy', 'atomic-governed-current-evidence-v4',
    'reasons', to_jsonb(v_reasons)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.promote_aicis_model_cortex_atomic_v4(text,text,text,text,text,boolean,numeric,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_aicis_model_cortex_atomic_v4(text,text,text,text,text,boolean,numeric,numeric) TO service_role;
