-- AICIS Validation Foundation Infrastructure
-- Establishes foundational operational trust, forecast validation,
-- calibration tracking, and source validation metrics.

-- -----------------------------------------------------------------------------
-- 1. Validation run ledger
-- -----------------------------------------------------------------------------

create table if not exists public.validation_runs (
  id uuid primary key default gen_random_uuid(),
  validation_type text not null,
  validation_scope text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms bigint,
  records_evaluated bigint default 0,
  validation_status text not null default 'running',
  validation_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_validation_runs_type
on public.validation_runs(validation_type);

create index if not exists idx_validation_runs_status
on public.validation_runs(validation_status);

-- -----------------------------------------------------------------------------
-- 2. Forecast accuracy metrics
-- -----------------------------------------------------------------------------

create table if not exists public.forecast_accuracy_metrics (
  id uuid primary key default gen_random_uuid(),
  validation_run_id uuid references public.validation_runs(id) on delete cascade,
  forecast_surface text not null,
  forecast_category text,
  total_predictions bigint default 0,
  realized_predictions bigint default 0,
  unrealized_predictions bigint default 0,
  accuracy_score numeric,
  precision_score numeric,
  recall_score numeric,
  false_positive_rate numeric,
  false_negative_rate numeric,
  average_lead_time_hours numeric,
  evaluation_window_days integer,
  generated_at timestamptz not null default now()
);

create index if not exists idx_forecast_accuracy_surface
on public.forecast_accuracy_metrics(forecast_surface);

-- -----------------------------------------------------------------------------
-- 3. Calibration metrics
-- -----------------------------------------------------------------------------

create table if not exists public.calibration_metrics (
  id uuid primary key default gen_random_uuid(),
  validation_run_id uuid references public.validation_runs(id) on delete cascade,
  prediction_surface text not null,
  confidence_bucket text not null,
  prediction_count bigint default 0,
  observed_accuracy numeric,
  expected_accuracy numeric,
  calibration_gap numeric,
  brier_score numeric,
  wilson_lower numeric,
  wilson_upper numeric,
  calibration_status text default 'unknown',
  generated_at timestamptz not null default now()
);

create index if not exists idx_calibration_surface
on public.calibration_metrics(prediction_surface);

-- -----------------------------------------------------------------------------
-- 4. Source validation metrics
-- -----------------------------------------------------------------------------

create table if not exists public.source_validation_metrics (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null,
  provider_name text,
  validation_run_id uuid references public.validation_runs(id) on delete cascade,
  freshness_score numeric,
  reliability_score numeric,
  corroboration_score numeric,
  consistency_score numeric,
  completeness_score numeric,
  historical_accuracy_score numeric,
  operational_trust_score numeric,
  degraded_reason text,
  evaluated_at timestamptz not null default now()
);

create index if not exists idx_source_validation_provider
on public.source_validation_metrics(provider_key);

-- -----------------------------------------------------------------------------
-- 5. Propagation validation metrics
-- -----------------------------------------------------------------------------

create table if not exists public.propagation_validation_metrics (
  id uuid primary key default gen_random_uuid(),
  validation_run_id uuid references public.validation_runs(id) on delete cascade,
  propagation_surface text,
  predicted_propagations bigint default 0,
  realized_propagations bigint default 0,
  propagation_accuracy numeric,
  propagation_precision numeric,
  average_spillover_delay_hours numeric,
  cross_border_realization_rate numeric,
  generated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 6. Recommendation validation metrics
-- -----------------------------------------------------------------------------

create table if not exists public.recommendation_validation_metrics (
  id uuid primary key default gen_random_uuid(),
  validation_run_id uuid references public.validation_runs(id) on delete cascade,
  recommendation_surface text,
  recommendations_issued bigint default 0,
  recommendations_followed bigint default 0,
  successful_interventions bigint default 0,
  intervention_effectiveness numeric,
  average_response_time_hours numeric,
  analyst_acceptance_rate numeric,
  generated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 7. Validation scorecard view
-- -----------------------------------------------------------------------------

create or replace view public.validation_trust_scorecard_view as
select
  vr.validation_type,
  vr.validation_status,
  vr.records_evaluated,
  fam.forecast_surface,
  fam.accuracy_score,
  fam.precision_score,
  fam.recall_score,
  cm.brier_score,
  cm.calibration_gap,
  svm.provider_name,
  svm.operational_trust_score,
  pvm.propagation_accuracy,
  rvm.intervention_effectiveness,
  greatest(
    coalesce(fam.accuracy_score, 0),
    coalesce(svm.operational_trust_score, 0)
  ) as overall_validation_signal,
  vr.completed_at
from public.validation_runs vr
left join public.forecast_accuracy_metrics fam
  on fam.validation_run_id = vr.id
left join public.calibration_metrics cm
  on cm.validation_run_id = vr.id
left join public.source_validation_metrics svm
  on svm.validation_run_id = vr.id
left join public.propagation_validation_metrics pvm
  on pvm.validation_run_id = vr.id
left join public.recommendation_validation_metrics rvm
  on rvm.validation_run_id = vr.id;

comment on table public.validation_runs is
'Operational trust and validation execution ledger for AICIS.';

comment on table public.forecast_accuracy_metrics is
'Prospective forecast validation and operational accuracy metrics.';

comment on table public.calibration_metrics is
'Prediction calibration, reliability, and confidence interval metrics.';

comment on table public.source_validation_metrics is
'Continuous source trust intelligence and provider quality scoring.';

comment on table public.propagation_validation_metrics is
'Validation metrics for propagation and spillover intelligence.';

comment on table public.recommendation_validation_metrics is
'Operational usefulness and intervention effectiveness metrics.';

comment on view public.validation_trust_scorecard_view is
'Unified operational validation and trust scorecard surface.';
