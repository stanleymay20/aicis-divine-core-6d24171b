-- Register simple reference models. They are not production-approved by default;
-- benchmark evidence must populate competency before routing can prefer them.

INSERT INTO public.aicis_model_registry (
  model_key, family, version, modalities, tasks, enabled, production_approved, metadata
) VALUES
  (
    'baseline-logistic',
    'linear',
    '1.0.0',
    ARRAY['tabular'],
    ARRAY['classification'],
    true,
    false,
    '{"role":"baseline","execution":"deterministic-local","description":"Auditable logistic reference for tabular binary classification"}'::jsonb
  ),
  (
    'baseline-persistence',
    'linear',
    '1.0.0',
    ARRAY['sequence'],
    ARRAY['forecasting'],
    true,
    false,
    '{"role":"baseline","execution":"deterministic-local","description":"Last-observation persistence reference for temporal forecasting"}'::jsonb
  ),
  (
    'baseline-drift',
    'linear',
    '1.0.0',
    ARRAY['sequence'],
    ARRAY['forecasting'],
    true,
    false,
    '{"role":"baseline","execution":"deterministic-local","description":"One-step linear-drift reference for temporal forecasting"}'::jsonb
  )
ON CONFLICT (model_key, version) DO UPDATE SET
  modalities = EXCLUDED.modalities,
  tasks = EXCLUDED.tasks,
  enabled = EXCLUDED.enabled,
  metadata = EXCLUDED.metadata,
  updated_at = now();

COMMENT ON TABLE public.aicis_model_registry IS
  'Governed specialist model registry. Baseline entries provide minimum performance references that challengers must beat before authority promotion.';
