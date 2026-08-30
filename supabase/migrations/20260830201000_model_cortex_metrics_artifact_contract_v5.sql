-- AICIS Model Cortex Metrics Artifact Contract v5
--
-- Makes the canonical-artifact evidence requirement explicit in metric lineage.
-- The underlying evaluation view already fails closed unless the external outcome
-- is bound to an immutable server-hashed canonical evidence artifact.

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
      v.external_evidence_artifact_id,
      v.evidence_binding_version,
      v.resolution_id
    FROM public.aicis_verified_model_outcome_evaluations v
    WHERE v.model_id = p_model_id
      AND v.domain = p_domain
      AND v.modality = p_modality
      AND v.task = p_task
      AND v.evidence_binding_version = 'canonical-artifact-v1'
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
                external_evidence_artifact_id,
                evidence_binding_version,
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
    'evaluation_method', 'externally_verified_target_resolution_probability_metrics_v5_full_population_artifact_bound',
    'evaluation_evidence_policy', 'external_verified_target_resolution_v3_canonical_artifact',
    'evaluation_scope', 'model_domain_modality_task',
    'canonical_artifact_binding_required', true,
    'population_truncated', false
  )
  FROM totals t CROSS JOIN calibration c;
$$;

REVOKE ALL ON FUNCTION public.aicis_model_cortex_scope_metrics_v4(text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aicis_model_cortex_scope_metrics_v4(text,text,text,text)
  TO service_role;

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
        WHEN v_sample = 0 THEN 'no_canonical_artifact_bound_verified_probability_pairs'
        WHEN v_ece IS NULL THEN 'partial_canonical_artifact_bound_probabilistic_evaluation'
        ELSE 'canonical_artifact_bound_probabilistic_outcomes_evaluated_v5_full_population'
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

REVOKE ALL ON FUNCTION public.refresh_aicis_model_cortex_competency_v4(text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_aicis_model_cortex_competency_v4(text,text,text,text)
  TO service_role;
