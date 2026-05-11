-- AICIS ML Evaluation, SLO Observability, and Provenance Surfacing
-- Adds evaluation metrics, alert feedback analytics, SLO/anomaly monitoring,
-- and provenance views that frontend surfaces can use to explain intelligence outputs.

create table if not exists public.intelligence_feedback_events (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid,
  recommendation_id uuid,
  organization_id uuid references public.organizations(id),
  user_id uuid references auth.users(id),
  feedback_type text not null check (feedback_type in ('true_positive','false_positive','false_negative','stale','duplicate','wrong_geo','wrong_entity','useful','not_useful')),
  severity text check (severity in ('low','medium','high','critical')),
  comment text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_intel_feedback_signal_created on public.intelligence_feedback_events(signal_id, created_at desc);
create index if not exists idx_intel_feedback_type_created on public.intelligence_feedback_events(feedback_type, created_at desc);
create index if not exists idx_intel_feedback_org_created on public.intelligence_feedback_events(organization_id, created_at desc);

create table if not exists public.model_evaluation_runs (
  id uuid primary key default gen_random_uuid(),
  evaluation_name text not null,
  model_name text,
  model_version text,
  window_start timestamptz not null,
  window_end timestamptz not null,
  sample_size integer not null default 0,
  precision_score numeric(6,4),
  recall_score numeric(6,4),
  f1_score numeric(6,4),
  false_positive_rate numeric(6,4),
  false_negative_rate numeric(6,4),
  calibration_error numeric(6,4),
  routing_quality numeric(6,4),
  confidence_brier_score numeric(6,4),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_model_eval_runs_name_created on public.model_evaluation_runs(evaluation_name, created_at desc);

create table if not exists public.service_level_objectives (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  target_metric text not null,
  target_operator text not null check (target_operator in ('>=','<=','>','<','=')),
  target_value numeric not null,
  severity_on_breach text not null default 'medium' check (severity_on_breach in ('low','medium','high','critical')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.service_level_objectives(name, description, target_metric, target_operator, target_value, severity_on_breach) values
  ('metric_entity_coverage_95', 'Normalized metric entity coverage should stay above 95%', 'normalized_metrics.coverage_pct', '>=', 95, 'high'),
  ('event_geo_coverage_90', 'Normalized event geo coverage should stay above 90%', 'normalized_events.coverage_pct', '>=', 90, 'medium'),
  ('fresh_events_24h', 'Normalized events should receive data within 24h', 'normalized_events.last_24h', '>', 0, 'high'),
  ('fresh_metrics_24h', 'Normalized metrics should receive data within 24h', 'normalized_metrics.last_24h', '>', 0, 'high'),
  ('evidence_hash_coverage_80', 'Signals should have evidence hashes on at least 80% of rows', 'global_signals.evidence_hash_pct', '>=', 80, 'medium')
on conflict (name) do update set
  description = excluded.description,
  target_metric = excluded.target_metric,
  target_operator = excluded.target_operator,
  target_value = excluded.target_value,
  severity_on_breach = excluded.severity_on_breach,
  updated_at = now();

create table if not exists public.observability_anomalies (
  id uuid primary key default gen_random_uuid(),
  anomaly_type text not null,
  severity text not null check (severity in ('low','medium','high','critical')),
  layer text,
  metric_name text,
  observed_value numeric,
  expected_value numeric,
  description text not null,
  status text not null default 'open' check (status in ('open','acknowledged','resolved','dismissed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_observability_anomalies_status_created on public.observability_anomalies(status, created_at desc);
create index if not exists idx_observability_anomalies_layer_created on public.observability_anomalies(layer, created_at desc);

create or replace view public.v_signal_provenance_explainability as
select
  gs.id as signal_id,
  gs.title,
  gs.category,
  gs.status,
  gs.primary_source,
  gs.ingestion_source,
  gs.source_count,
  gs.evidence_hash,
  case when gs.evidence_hash is not null then true else false end as has_evidence_hash,
  case when gs.source_references is not null and jsonb_array_length(coalesce(gs.source_references, '[]'::jsonb)) > 0 then true else false end as has_source_references,
  coalesce(jsonb_array_length(coalesce(gs.source_references, '[]'::jsonb)), 0) as source_reference_count,
  gs.first_detected_at,
  gs.latest_update_at,
  gs.created_at,
  lsc.source_confidence,
  lsc.entity_confidence,
  lsc.geo_confidence,
  lsc.freshness_score,
  lsc.evidence_score,
  lsc.contradiction_penalty,
  lsc.final_confidence,
  case
    when lsc.final_confidence >= 85 then 'high'
    when lsc.final_confidence >= 65 then 'medium'
    when lsc.final_confidence >= 45 then 'low'
    else 'weak'
  end as confidence_tier,
  exists (
    select 1 from public.contradiction_clusters cc
    where cc.status in ('open','reviewing')
      and (
        cc.iso3 = any(gs.affected_countries)
        or cc.domain = gs.category
      )
  ) as has_open_contradiction,
  jsonb_build_object(
    'source_count', gs.source_count,
    'evidence_hash', gs.evidence_hash,
    'source_confidence', lsc.source_confidence,
    'entity_confidence', lsc.entity_confidence,
    'geo_confidence', lsc.geo_confidence,
    'freshness_score', lsc.freshness_score,
    'evidence_score', lsc.evidence_score,
    'contradiction_penalty', lsc.contradiction_penalty,
    'final_confidence', lsc.final_confidence
  ) as provenance_summary
from public.global_signals gs
left join public.v_latest_signal_confidence lsc on lsc.signal_id = gs.id;

create or replace view public.v_intelligence_feedback_quality as
with agg as (
  select
    date_trunc('day', created_at) as day,
    count(*) as total_feedback,
    count(*) filter (where feedback_type = 'true_positive') as true_positive,
    count(*) filter (where feedback_type = 'false_positive') as false_positive,
    count(*) filter (where feedback_type = 'false_negative') as false_negative,
    count(*) filter (where feedback_type = 'useful') as useful,
    count(*) filter (where feedback_type = 'not_useful') as not_useful
  from public.intelligence_feedback_events
  where created_at > now() - interval '90 days'
  group by 1
)
select
  day,
  total_feedback,
  true_positive,
  false_positive,
  false_negative,
  useful,
  not_useful,
  round((true_positive::numeric / greatest(true_positive + false_positive, 1)), 4) as precision_proxy,
  round((true_positive::numeric / greatest(true_positive + false_negative, 1)), 4) as recall_proxy,
  round((useful::numeric / greatest(useful + not_useful, 1)), 4) as usefulness_rate
from agg
order by day desc;

create or replace function public.compute_model_evaluation_run(
  p_window_start timestamptz default now() - interval '7 days',
  p_window_end timestamptz default now(),
  p_evaluation_name text default 'routing-feedback-quality'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  tp numeric;
  fp numeric;
  fn numeric;
  useful numeric;
  not_useful numeric;
  n integer;
  precision_v numeric;
  recall_v numeric;
  f1_v numeric;
  fpr_v numeric;
  fnr_v numeric;
  routing_v numeric;
begin
  select
    count(*)::integer,
    count(*) filter (where feedback_type = 'true_positive')::numeric,
    count(*) filter (where feedback_type = 'false_positive')::numeric,
    count(*) filter (where feedback_type = 'false_negative')::numeric,
    count(*) filter (where feedback_type = 'useful')::numeric,
    count(*) filter (where feedback_type = 'not_useful')::numeric
  into n, tp, fp, fn, useful, not_useful
  from public.intelligence_feedback_events
  where created_at >= p_window_start and created_at <= p_window_end;

  precision_v := tp / greatest(tp + fp, 1);
  recall_v := tp / greatest(tp + fn, 1);
  f1_v := case when precision_v + recall_v = 0 then 0 else 2 * precision_v * recall_v / (precision_v + recall_v) end;
  fpr_v := fp / greatest(tp + fp, 1);
  fnr_v := fn / greatest(tp + fn, 1);
  routing_v := useful / greatest(useful + not_useful, 1);

  insert into public.model_evaluation_runs(
    evaluation_name,
    model_name,
    model_version,
    window_start,
    window_end,
    sample_size,
    precision_score,
    recall_score,
    f1_score,
    false_positive_rate,
    false_negative_rate,
    routing_quality,
    notes,
    metadata
  ) values (
    p_evaluation_name,
    'aicis-routing-relevance-stack',
    'eval-v1',
    p_window_start,
    p_window_end,
    n,
    precision_v,
    recall_v,
    f1_v,
    fpr_v,
    fnr_v,
    routing_v,
    'Proxy evaluation from human/operator feedback events.',
    jsonb_build_object('tp', tp, 'fp', fp, 'fn', fn, 'useful', useful, 'not_useful', not_useful)
  ) returning id into v_id;

  insert into public.pipeline_health_events(job_name, status, source, inserted_count, message, metadata)
  values (
    'compute_model_evaluation_run',
    case when n >= 10 then 'success' else 'degraded' end,
    'database',
    1,
    'Model evaluation run computed from feedback events',
    jsonb_build_object('evaluation_id', v_id, 'sample_size', n, 'precision', precision_v, 'recall', recall_v)
  );

  return v_id;
end;
$$;

create or replace function public.evaluate_slo_breaches()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  with metrics as (
    select layer || '.coverage_pct' as metric_name, layer, coverage_pct::numeric as value from public.v_accumulation_layer_audit
    union all
    select layer || '.last_24h', layer, last_24h::numeric from public.v_accumulation_layer_audit
    union all
    select 'global_signals.evidence_hash_pct', 'global_signals', evidence_hash_pct::numeric from public.v_evidence_coverage_audit
  ), breaches as (
    select
      slo.name,
      slo.target_metric,
      slo.target_operator,
      slo.target_value,
      slo.severity_on_breach,
      m.layer,
      m.value,
      case
        when slo.target_operator = '>=' then not (m.value >= slo.target_value)
        when slo.target_operator = '<=' then not (m.value <= slo.target_value)
        when slo.target_operator = '>' then not (m.value > slo.target_value)
        when slo.target_operator = '<' then not (m.value < slo.target_value)
        when slo.target_operator = '=' then not (m.value = slo.target_value)
        else false
      end as breached
    from public.service_level_objectives slo
    join metrics m on m.metric_name = slo.target_metric
    where slo.enabled
  ), inserted as (
    insert into public.observability_anomalies(anomaly_type, severity, layer, metric_name, observed_value, expected_value, description, metadata)
    select
      'slo_breach',
      severity_on_breach,
      layer,
      target_metric,
      value,
      target_value,
      'SLO breach: ' || name || ' observed=' || value || ' target ' || target_operator || ' ' || target_value,
      jsonb_build_object('slo_name', name, 'operator', target_operator)
    from breaches b
    where breached
      and not exists (
        select 1 from public.observability_anomalies oa
        where oa.status = 'open'
          and oa.anomaly_type = 'slo_breach'
          and oa.metric_name = b.target_metric
      )
    returning 1
  )
  select count(*) into v_inserted from inserted;

  insert into public.pipeline_health_events(job_name, status, source, inserted_count, message, metadata)
  values (
    'evaluate_slo_breaches',
    case when v_inserted > 0 then 'partial' else 'success' end,
    'database',
    v_inserted,
    'SLO breach evaluation completed',
    jsonb_build_object('new_breaches', v_inserted)
  );

  return v_inserted;
end;
$$;

create or replace view public.v_open_observability_anomalies as
select *
from public.observability_anomalies
where status = 'open'
order by
  case severity when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
  created_at desc;

select cron.schedule('compute_model_evaluation_run', '0 * * * *', $$select public.compute_model_evaluation_run(now() - interval '7 days', now(), 'routing-feedback-quality');$$)
where not exists (select 1 from cron.job where jobname = 'compute_model_evaluation_run');

select cron.schedule('evaluate_slo_breaches', '*/15 * * * *', $$select public.evaluate_slo_breaches();$$)
where not exists (select 1 from cron.job where jobname = 'evaluate_slo_breaches');
