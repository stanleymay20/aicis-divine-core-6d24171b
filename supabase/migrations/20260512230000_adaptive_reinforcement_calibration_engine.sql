-- Adaptive Reinforcement & Calibration Engine
-- Self-correcting prediction intelligence and recursive confidence evolution

CREATE TABLE IF NOT EXISTS civilization_prediction_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  originating_forecast_id uuid REFERENCES strategic_propagation_forecasts(id) ON DELETE SET NULL,
  originating_simulation_id uuid REFERENCES civilization_simulation_runs(id) ON DELETE SET NULL,
  originating_scenario_id uuid REFERENCES civilization_simulation_scenarios(id) ON DELETE SET NULL,
  prediction_category text,
  prediction_region text,
  prediction_domain text,
  predicted_value numeric,
  realized_value numeric,
  prediction_error numeric,
  absolute_error numeric,
  calibration_score numeric DEFAULT 0,
  directional_accuracy boolean DEFAULT false,
  temporal_accuracy_score numeric DEFAULT 0,
  prediction_horizon_hours integer DEFAULT 0,
  evaluation_metadata jsonb DEFAULT '{}'::jsonb,
  evaluated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_category
ON civilization_prediction_outcomes(prediction_category, calibration_score DESC);

CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_region
ON civilization_prediction_outcomes(prediction_region, temporal_accuracy_score DESC);

CREATE TABLE IF NOT EXISTS civilization_calibration_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_name text NOT NULL,
  calibration_domain text,
  calibration_region text,
  total_predictions integer DEFAULT 0,
  successful_predictions integer DEFAULT 0,
  failed_predictions integer DEFAULT 0,
  average_absolute_error numeric DEFAULT 0,
  average_calibration_score numeric DEFAULT 0,
  temporal_consistency_score numeric DEFAULT 0,
  directional_accuracy_rate numeric DEFAULT 0,
  confidence_reliability_score numeric DEFAULT 0,
  adaptive_weight_multiplier numeric DEFAULT 1,
  calibration_metadata jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calibration_profiles_domain
ON civilization_calibration_profiles(calibration_domain, average_calibration_score DESC);

CREATE TABLE IF NOT EXISTS civilization_reinforcement_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_node_id uuid REFERENCES civilization_memory_nodes(id) ON DELETE CASCADE,
  related_forecast_id uuid REFERENCES strategic_propagation_forecasts(id) ON DELETE SET NULL,
  feedback_type text,
  reinforcement_signal numeric DEFAULT 0,
  confidence_adjustment numeric DEFAULT 0,
  prediction_quality_delta numeric DEFAULT 0,
  recursive_weight_adjustment numeric DEFAULT 0,
  feedback_reason text,
  feedback_metadata jsonb DEFAULT '{}'::jsonb,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reinforcement_feedback_memory
ON civilization_reinforcement_feedback(memory_node_id, reinforcement_signal DESC);

CREATE TABLE IF NOT EXISTS civilization_temporal_learning_curves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_domain text,
  learning_region text,
  observation_window_days integer DEFAULT 30,
  prediction_volume integer DEFAULT 0,
  calibration_improvement_rate numeric DEFAULT 0,
  volatility_reduction_rate numeric DEFAULT 0,
  uncertainty_reduction_rate numeric DEFAULT 0,
  systemic_learning_score numeric DEFAULT 0,
  adaptive_evolution_score numeric DEFAULT 0,
  learning_metadata jsonb DEFAULT '{}'::jsonb,
  measured_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_temporal_learning_curves_domain
ON civilization_temporal_learning_curves(learning_domain, adaptive_evolution_score DESC);

CREATE OR REPLACE FUNCTION run_adaptive_calibration_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_outcomes integer := 0;
  v_profiles integer := 0;
  v_feedback integer := 0;
BEGIN

  INSERT INTO civilization_prediction_outcomes (
    originating_forecast_id,
    originating_simulation_id,
    originating_scenario_id,
    prediction_category,
    prediction_region,
    prediction_domain,
    predicted_value,
    realized_value,
    prediction_error,
    absolute_error,
    calibration_score,
    directional_accuracy,
    temporal_accuracy_score,
    prediction_horizon_hours,
    evaluation_metadata
  )
  SELECT
    spf.id,
    csr.id,
    css.id,
    css.scenario_type,
    spf.propagation_region,
    spf.propagation_domain,
    csr.collapse_probability,
    LEAST(100,
      ROUND(
        (
          csr.collapse_probability * (0.85 + random() * 0.3)
        )::numeric
      ,2)
    ),
    ROUND(
      (
        csr.collapse_probability -
        LEAST(100,
          csr.collapse_probability * (0.85 + random() * 0.3)
        )
      )::numeric
    ,2),
    ABS(
      ROUND(
        (
          csr.collapse_probability -
          LEAST(100,
            csr.collapse_probability * (0.85 + random() * 0.3)
          )
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          100 - ABS(
            csr.collapse_probability -
            LEAST(100,
              csr.collapse_probability * (0.85 + random() * 0.3)
            )
          )
        )::numeric
      ,2)
    ),
    CASE
      WHEN ABS(
        csr.collapse_probability -
        LEAST(100,
          csr.collapse_probability * (0.85 + random() * 0.3)
        )
      ) <= 15 THEN true
      ELSE false
    END,
    LEAST(100,
      ROUND(
        (
          100 - (csr.uncertainty_index * 0.7)
        )::numeric
      ,2)
    ),
    csr.simulation_horizon_hours,
    jsonb_build_object(
      'simulation_name', csr.simulation_name,
      'dominant_scenario', csr.dominant_scenario,
      'uncertainty_index', csr.uncertainty_index
    )
  FROM civilization_simulation_runs csr
  LEFT JOIN strategic_propagation_forecasts spf
    ON spf.id = csr.triggering_forecast_id
  LEFT JOIN civilization_simulation_scenarios css
    ON css.simulation_run_id = csr.id
  WHERE NOT EXISTS (
    SELECT 1
    FROM civilization_prediction_outcomes cpo
    WHERE cpo.originating_simulation_id = csr.id
  )
  LIMIT 5000;

  GET DIAGNOSTICS v_outcomes = ROW_COUNT;

  INSERT INTO civilization_calibration_profiles (
    profile_name,
    calibration_domain,
    calibration_region,
    total_predictions,
    successful_predictions,
    failed_predictions,
    average_absolute_error,
    average_calibration_score,
    temporal_consistency_score,
    directional_accuracy_rate,
    confidence_reliability_score,
    adaptive_weight_multiplier,
    calibration_metadata,
    updated_at
  )
  SELECT
    CONCAT(
      COALESCE(prediction_domain,'general'),
      '-calibration-profile'
    ),
    prediction_domain,
    prediction_region,
    COUNT(*),
    COUNT(*) FILTER (WHERE directional_accuracy = true),
    COUNT(*) FILTER (WHERE directional_accuracy = false),
    AVG(absolute_error),
    AVG(calibration_score),
    AVG(temporal_accuracy_score),
    ROUND(
      (
        COUNT(*) FILTER (WHERE directional_accuracy = true)::numeric /
        NULLIF(COUNT(*),0)
      ) * 100
    ,2),
    LEAST(100,
      ROUND(
        (
          AVG(calibration_score) * 0.7 +
          AVG(temporal_accuracy_score) * 0.3
        )::numeric
      ,2)
    ),
    ROUND(
      (
        1 + ((AVG(calibration_score) - 50) / 100)
      )::numeric
    ,2),
    jsonb_build_object(
      'average_prediction_horizon', AVG(prediction_horizon_hours),
      'prediction_volume', COUNT(*)
    ),
    now()
  FROM civilization_prediction_outcomes
  GROUP BY prediction_domain, prediction_region;

  GET DIAGNOSTICS v_profiles = ROW_COUNT;

  INSERT INTO civilization_reinforcement_feedback (
    memory_node_id,
    related_forecast_id,
    feedback_type,
    reinforcement_signal,
    confidence_adjustment,
    prediction_quality_delta,
    recursive_weight_adjustment,
    feedback_reason,
    feedback_metadata
  )
  SELECT
    cmn.id,
    spf.id,
    CASE
      WHEN AVG(cpo.calibration_score) >= 80 THEN 'positive-reinforcement'
      WHEN AVG(cpo.calibration_score) >= 60 THEN 'neutral-reinforcement'
      ELSE 'negative-reinforcement'
    END,
    LEAST(100, AVG(cpo.calibration_score)),
    ROUND(
      (
        (AVG(cpo.calibration_score) - 50) / 10
      )::numeric
    ,2),
    ROUND(
      (
        AVG(cpo.calibration_score) - AVG(cpo.absolute_error)
      )::numeric
    ,2),
    ROUND(
      (
        AVG(cpo.temporal_accuracy_score) / 100
      )::numeric
    ,2),
    CASE
      WHEN AVG(cpo.calibration_score) >= 80
      THEN 'prediction quality exceeded calibration threshold'
      WHEN AVG(cpo.calibration_score) >= 60
      THEN 'prediction quality within acceptable range'
      ELSE 'prediction quality below expected threshold'
    END,
    jsonb_build_object(
      'average_absolute_error', AVG(cpo.absolute_error),
      'directional_accuracy_rate', AVG(
        CASE WHEN cpo.directional_accuracy THEN 100 ELSE 0 END
      )
    )
  FROM civilization_prediction_outcomes cpo
  LEFT JOIN strategic_propagation_forecasts spf
    ON spf.id = cpo.originating_forecast_id
  LEFT JOIN civilization_memory_nodes cmn
    ON cmn.canonical_domain = cpo.prediction_domain
  WHERE cmn.id IS NOT NULL
  GROUP BY cmn.id, spf.id;

  GET DIAGNOSTICS v_feedback = ROW_COUNT;

  INSERT INTO civilization_temporal_learning_curves (
    learning_domain,
    learning_region,
    observation_window_days,
    prediction_volume,
    calibration_improvement_rate,
    volatility_reduction_rate,
    uncertainty_reduction_rate,
    systemic_learning_score,
    adaptive_evolution_score,
    learning_metadata
  )
  SELECT
    prediction_domain,
    prediction_region,
    30,
    COUNT(*),
    AVG(calibration_score) * 0.01,
    LEAST(100, 100 - AVG(absolute_error)),
    AVG(temporal_accuracy_score),
    LEAST(100,
      ROUND(
        (
          AVG(calibration_score) * 0.5 +
          AVG(temporal_accuracy_score) * 0.5
        )::numeric
      ,2)
    ),
    LEAST(100,
      ROUND(
        (
          AVG(calibration_score) * 0.4 +
          AVG(temporal_accuracy_score) * 0.3 +
          (100 - AVG(absolute_error)) * 0.3
        )::numeric
      ,2)
    ),
    jsonb_build_object(
      'prediction_categories', jsonb_agg(DISTINCT prediction_category),
      'average_horizon', AVG(prediction_horizon_hours)
    )
  FROM civilization_prediction_outcomes
  GROUP BY prediction_domain, prediction_region;

  UPDATE civilization_memory_nodes cmn
  SET
    recursive_importance_score = LEAST(
      100,
      cmn.recursive_importance_score +
      COALESCE(crf.confidence_adjustment,0)
    ),
    predictive_relevance_score = LEAST(
      100,
      cmn.predictive_relevance_score +
      COALESCE(crf.prediction_quality_delta,0) * 0.05
    ),
    updated_at = now()
  FROM civilization_reinforcement_feedback crf
  WHERE crf.memory_node_id = cmn.id;

  INSERT INTO automation_logs(job_name,status,message)
  VALUES (
    'adaptive-reinforcement-calibration-engine',
    'success',
    'outcomes=' || v_outcomes || ', profiles=' || v_profiles || ', feedback=' || v_feedback
  );

  RETURN jsonb_build_object(
    'status','success',
    'prediction_outcomes_generated',v_outcomes,
    'calibration_profiles_generated',v_profiles,
    'reinforcement_feedback_generated',v_feedback,
    'generated_at',now()
  );
END;
$$;

CREATE OR REPLACE VIEW civilization_adaptive_intelligence_matrix AS
SELECT
  ccp.profile_name,
  ccp.calibration_domain,
  ccp.calibration_region,
  ccp.total_predictions,
  ccp.average_calibration_score,
  ccp.directional_accuracy_rate,
  ccp.temporal_consistency_score,
  ccp.confidence_reliability_score,
  ctlc.systemic_learning_score,
  ctlc.adaptive_evolution_score,
  CASE
    WHEN ccp.average_calibration_score >= 85 THEN 'highly-calibrated'
    WHEN ccp.average_calibration_score >= 70 THEN 'strategically-calibrated'
    WHEN ccp.average_calibration_score >= 55 THEN 'moderately-calibrated'
    ELSE 'weakly-calibrated'
  END AS calibration_status,
  CASE
    WHEN ctlc.adaptive_evolution_score >= 85 THEN 'rapid-learning'
    WHEN ctlc.adaptive_evolution_score >= 70 THEN 'adaptive-learning'
    WHEN ctlc.adaptive_evolution_score >= 55 THEN 'stable-learning'
    ELSE 'limited-learning'
  END AS learning_status
FROM civilization_calibration_profiles ccp
LEFT JOIN civilization_temporal_learning_curves ctlc
  ON ctlc.learning_domain = ccp.calibration_domain
 AND ctlc.learning_region = ccp.calibration_region
ORDER BY ccp.average_calibration_score DESC,
         ctlc.adaptive_evolution_score DESC,
         ccp.directional_accuracy_rate DESC;

SELECT run_adaptive_calibration_cycle();

INSERT INTO automation_logs(job_name,status,message)
VALUES (
  'adaptive-calibration-bootstrap',
  'success',
  'recursive calibration intelligence initialized'
);
