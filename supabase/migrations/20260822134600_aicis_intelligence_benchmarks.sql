-- AICIS Intelligence Benchmark memory.
-- Stores comparable, reproducible evaluation runs for AICIS and external/model baselines.

CREATE TABLE IF NOT EXISTS public.aicis_benchmark_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_name text NOT NULL,
  benchmark_version text NOT NULL,
  system_name text NOT NULL,
  system_version text,
  model_provider text,
  model_name text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','cancelled')),
  case_count int NOT NULL DEFAULT 0 CHECK (case_count >= 0),
  brier_score numeric,
  calibration_error numeric,
  unsupported_claim_rate numeric,
  attribution_precision numeric,
  median_lead_time_hours numeric,
  false_warning_rate numeric,
  causal_accuracy numeric,
  decision_utility numeric,
  composite_score numeric,
  dataset_hash text,
  code_sha text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (brier_score IS NULL OR (brier_score >= 0 AND brier_score <= 1)),
  CHECK (calibration_error IS NULL OR (calibration_error >= 0 AND calibration_error <= 1)),
  CHECK (unsupported_claim_rate IS NULL OR (unsupported_claim_rate >= 0 AND unsupported_claim_rate <= 1)),
  CHECK (attribution_precision IS NULL OR (attribution_precision >= 0 AND attribution_precision <= 1)),
  CHECK (false_warning_rate IS NULL OR (false_warning_rate >= 0 AND false_warning_rate <= 1)),
  CHECK (causal_accuracy IS NULL OR (causal_accuracy >= 0 AND causal_accuracy <= 1)),
  CHECK (decision_utility IS NULL OR (decision_utility >= 0 AND decision_utility <= 1)),
  CHECK (composite_score IS NULL OR (composite_score >= 0 AND composite_score <= 1))
);
CREATE INDEX IF NOT EXISTS aicis_benchmark_runs_lookup_idx
  ON public.aicis_benchmark_runs (benchmark_name, benchmark_version, system_name, completed_at DESC);
CREATE INDEX IF NOT EXISTS aicis_benchmark_runs_score_idx
  ON public.aicis_benchmark_runs (composite_score DESC NULLS LAST, completed_at DESC);

CREATE TABLE IF NOT EXISTS public.aicis_benchmark_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_name text NOT NULL,
  benchmark_version text NOT NULL,
  case_key text NOT NULL,
  case_type text NOT NULL CHECK (case_type IN (
    'factuality','forecast','causal','early-warning','decision','provenance','mixed'
  )),
  cutoff_at timestamptz,
  horizon_at timestamptz,
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_outcome jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  difficulty text CHECK (difficulty IS NULL OR difficulty IN ('easy','medium','hard','adversarial')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (benchmark_name, benchmark_version, case_key)
);
CREATE INDEX IF NOT EXISTS aicis_benchmark_cases_type_idx
  ON public.aicis_benchmark_cases (benchmark_name, benchmark_version, case_type);

CREATE TABLE IF NOT EXISTS public.aicis_benchmark_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.aicis_benchmark_runs(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.aicis_benchmark_cases(id) ON DELETE CASCADE,
  answer_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  score_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  supported_claims int NOT NULL DEFAULT 0 CHECK (supported_claims >= 0),
  unsupported_claims int NOT NULL DEFAULT 0 CHECK (unsupported_claims >= 0),
  cited_claims int NOT NULL DEFAULT 0 CHECK (cited_claims >= 0),
  correct_attributions int NOT NULL DEFAULT 0 CHECK (correct_attributions >= 0),
  predicted_probability numeric,
  actual_binary_outcome int CHECK (actual_binary_outcome IS NULL OR actual_binary_outcome IN (0,1)),
  brier_score numeric,
  lead_time_hours numeric,
  causal_score numeric,
  decision_utility numeric,
  latency_ms bigint,
  cost_estimate numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, case_id),
  CHECK (predicted_probability IS NULL OR (predicted_probability >= 0 AND predicted_probability <= 1)),
  CHECK (brier_score IS NULL OR (brier_score >= 0 AND brier_score <= 1)),
  CHECK (causal_score IS NULL OR (causal_score >= 0 AND causal_score <= 1)),
  CHECK (decision_utility IS NULL OR (decision_utility >= 0 AND decision_utility <= 1))
);
CREATE INDEX IF NOT EXISTS aicis_benchmark_results_run_idx
  ON public.aicis_benchmark_results (run_id, created_at);

ALTER TABLE public.aicis_benchmark_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_benchmark_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_benchmark_results ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.aicis_benchmark_runs, public.aicis_benchmark_cases, public.aicis_benchmark_results TO authenticated;
GRANT ALL ON public.aicis_benchmark_runs, public.aicis_benchmark_cases, public.aicis_benchmark_results TO service_role;

CREATE POLICY "Operators inspect benchmark runs"
  ON public.aicis_benchmark_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "Operators inspect benchmark cases"
  ON public.aicis_benchmark_cases FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "Operators inspect benchmark results"
  ON public.aicis_benchmark_results FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));

CREATE POLICY "Service role manages benchmark runs"
  ON public.aicis_benchmark_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages benchmark cases"
  ON public.aicis_benchmark_cases FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages benchmark results"
  ON public.aicis_benchmark_results FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE VIEW public.aicis_benchmark_leaderboard AS
SELECT DISTINCT ON (benchmark_name, benchmark_version, system_name, coalesce(model_name, ''))
  benchmark_name,
  benchmark_version,
  system_name,
  system_version,
  model_provider,
  model_name,
  case_count,
  brier_score,
  calibration_error,
  unsupported_claim_rate,
  attribution_precision,
  median_lead_time_hours,
  false_warning_rate,
  causal_accuracy,
  decision_utility,
  composite_score,
  completed_at,
  code_sha,
  dataset_hash
FROM public.aicis_benchmark_runs
WHERE status = 'completed'
ORDER BY benchmark_name, benchmark_version, system_name, coalesce(model_name, ''), completed_at DESC;

GRANT SELECT ON public.aicis_benchmark_leaderboard TO authenticated, service_role;
