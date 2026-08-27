-- AICIS Candidate Model Training Registry v1
--
-- Adds immutable model-training manifests and explicit candidate lifecycle
-- metadata. No model is activated by this migration and no training is
-- scheduled automatically.

CREATE TABLE IF NOT EXISTS public.ml_model_training_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version text UNIQUE NOT NULL,
  model_type text NOT NULL,
  model_semantics text NOT NULL,
  horizon_days integer NOT NULL CHECK (horizon_days BETWEEN 1 AND 90),
  feature_version text NOT NULL,
  split_strategy text NOT NULL,
  source_dataset_scope text NOT NULL,
  source_dataset_version text,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','failed','abstained')),
  feature_spec jsonb NOT NULL,
  hyperparameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  standardization jsonb NOT NULL DEFAULT '{}'::jsonb,
  train_rows integer NOT NULL DEFAULT 0,
  validation_rows integer NOT NULL DEFAULT 0,
  test_rows integer NOT NULL DEFAULT 0,
  excluded_rows integer NOT NULL DEFAULT 0,
  train_positive_rate numeric,
  validation_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  test_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  base_rate_reference jsonb NOT NULL DEFAULT '{}'::jsonb,
  manifest_checksum text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  failure_reason text,
  created_by uuid REFERENCES auth.users(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ml_training_runs_status
  ON public.ml_model_training_runs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ml_training_runs_horizon
  ON public.ml_model_training_runs(horizon_days, started_at DESC);

CREATE TABLE IF NOT EXISTS public.ml_model_training_manifest_rows (
  training_run_id uuid NOT NULL REFERENCES public.ml_model_training_runs(id) ON DELETE CASCADE,
  training_row_id uuid NOT NULL REFERENCES public.training_dataset_aicis(id) ON DELETE RESTRICT,
  country_iso3 text NOT NULL,
  domain text NOT NULL,
  snapshot_date date NOT NULL,
  dataset_split text NOT NULL CHECK (dataset_split IN ('train','val','test')),
  feature_version text NOT NULL,
  feature_hash text NOT NULL,
  label integer NOT NULL CHECK (label IN (0,1)),
  feature_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (training_run_id, training_row_id)
);

CREATE INDEX IF NOT EXISTS idx_ml_manifest_run_split
  ON public.ml_model_training_manifest_rows(training_run_id, dataset_split, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_ml_manifest_feature_hash
  ON public.ml_model_training_manifest_rows(feature_hash);

ALTER TABLE public.ml_model_training_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_model_training_manifest_rows ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.ml_model_training_runs,
  public.ml_model_training_manifest_rows TO authenticated;
GRANT ALL ON public.ml_model_training_runs,
  public.ml_model_training_manifest_rows TO service_role;

DROP POLICY IF EXISTS "Operators inspect ML training runs"
  ON public.ml_model_training_runs;
CREATE POLICY "Operators inspect ML training runs"
  ON public.ml_model_training_runs FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'operator'::app_role)
  );

DROP POLICY IF EXISTS "Operators inspect ML training manifests"
  ON public.ml_model_training_manifest_rows;
CREATE POLICY "Operators inspect ML training manifests"
  ON public.ml_model_training_manifest_rows FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'operator'::app_role)
  );

-- service_role bypasses RLS; explicit grants above document the intended writer.

ALTER TABLE public.ml_model_weights
  ADD COLUMN IF NOT EXISTS training_run_id uuid
    REFERENCES public.ml_model_training_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS feature_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS standardization jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS validation_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS test_metrics jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ml_model_weights_training_run
  ON public.ml_model_weights(training_run_id);
CREATE INDEX IF NOT EXISTS idx_ml_model_weights_promotion
  ON public.ml_model_weights(promotion_status, trained_at DESC);

COMMENT ON TABLE public.ml_model_training_runs IS
  'One immutable audit record per attempted candidate training run. A completed run records temporal split counts, feature specification, standardization learned from train only, validation/test metrics and manifest checksum.';
COMMENT ON TABLE public.ml_model_training_manifest_rows IS
  'Immutable feature/label snapshot used by one training run. This preserves exact model inputs even if the mutable source training_dataset_aicis row later changes.';
COMMENT ON COLUMN public.ml_model_weights.training_run_id IS
  'Lineage pointer to the exact candidate training run and immutable manifest that produced these weights.';
