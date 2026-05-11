-- AICIS Confidence, Contradiction, Replay, and Entity Governance Layer
-- Implements confidence architecture, contradiction detection, replay queue,
-- and entity governance queues for merge/alias/conflict review.

create table if not exists public.provider_confidence_profiles (
  provider text primary key,
  trust_tier text not null default 'unrated' check (trust_tier in ('tier_1','tier_2','tier_3','unrated')),
  base_confidence numeric(5,2) not null default 50 check (base_confidence between 0 and 100),
  freshness_decay_hours integer not null default 72,
  duplicate_penalty numeric(5,2) not null default 10 check (duplicate_penalty between 0 and 100),
  misinformation_risk numeric(5,2) not null default 20 check (misinformation_risk between 0 and 100),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.provider_confidence_profiles(provider, trust_tier, base_confidence, freshness_decay_hours, duplicate_penalty, misinformation_risk, notes) values
  ('worldbank', 'tier_1', 92, 720, 2, 5, 'Institutional macroeconomic source'),
  ('eia', 'tier_1', 90, 168, 2, 5, 'Official energy data source'),
  ('nvd', 'tier_1', 90, 168, 2, 10, 'Official vulnerability data source'),
  ('owid', 'tier_1', 88, 720, 3, 5, 'Curated research data source'),
  ('faostat', 'tier_1', 88, 720, 3, 5, 'Official food and agriculture data source'),
  ('gdelt', 'tier_2', 62, 48, 18, 35, 'High-volume media-derived event stream; requires corroboration'),
  ('rss', 'tier_3', 50, 24, 25, 45, 'Generic open-web feed; source quality varies')
on conflict (provider) do update set
  trust_tier = excluded.trust_tier,
  base_confidence = excluded.base_confidence,
  freshness_decay_hours = excluded.freshness_decay_hours,
  duplicate_penalty = excluded.duplicate_penalty,
  misinformation_risk = excluded.misinformation_risk,
  notes = excluded.notes,
  updated_at = now();

create table if not exists public.signal_confidence_evaluations (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid,
  source_provider text,
  source_confidence numeric(5,2),
  entity_confidence numeric(5,2),
  geo_confidence numeric(5,2),
  freshness_score numeric(5,2),
  evidence_score numeric(5,2),
  contradiction_penalty numeric(5,2) not null default 0,
  final_confidence numeric(5,2),
  explanation text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_signal_conf_eval_signal_created on public.signal_confidence_evaluations(signal_id, created_at desc);
create index if not exists idx_signal_conf_eval_final on public.signal_confidence_evaluations(final_confidence);

create table if not exists public.contradiction_clusters (
  id uuid primary key default gen_random_uuid(),
  cluster_key text not null,
  entity_id uuid,
  iso3 text,
  domain text,
  event_type text,
  contradiction_type text not null,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  source_count integer not null default 0,
  conflicting_claims jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(cluster_key, contradiction_type)
);

create index if not exists idx_contradiction_clusters_status on public.contradiction_clusters(status, created_at desc);
create index if not exists idx_contradiction_clusters_iso3 on public.contradiction_clusters(iso3, created_at desc);

create table if not exists public.replay_jobs (
  id uuid primary key default gen_random_uuid(),
  provider text,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),
  replay_scope jsonb not null default '{}'::jsonb,
  cursor_after timestamptz,
  cursor_before timestamptz,
  raw_rows_total integer not null default 0,
  raw_rows_processed integer not null default 0,
  normalized_rows integer not null default 0,
  linked_rows integer not null default 0,
  error_count integer not null default 0,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_replay_jobs_status_created on public.replay_jobs(status, created_at desc);
create index if not exists idx_replay_jobs_provider_created on public.replay_jobs(provider, created_at desc);

create table if not exists public.entity_governance_queue (
  id uuid primary key default gen_random_uuid(),
  queue_type text not null check (queue_type in ('alias_review','merge_review','conflict_review','geo_review')),
  entity_id uuid references public.canonical_entities(id),
  proposed_entity_id uuid references public.canonical_entities(id),
  alias text,
  iso3 text,
  confidence numeric(5,2),
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','approved','rejected','merged','dismissed')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_entity_governance_queue_status on public.entity_governance_queue(status, created_at desc);
create index if not exists idx_entity_governance_queue_type on public.entity_governance_queue(queue_type, created_at desc);

create or replace function public.compute_freshness_score(observed_at timestamptz, decay_hours integer default 72)
returns numeric
language sql
stable
as $$
  select greatest(0, least(100, 100 - ((extract(epoch from (now() - coalesce(observed_at, now()))) / 3600.0) / greatest(decay_hours, 1) * 100)))::numeric(5,2);
$$;

create or replace function public.evaluate_signal_confidence(p_signal_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  with candidates as (
    select
      gs.id as signal_id,
      coalesce(gs.ingestion_source, gs.primary_source, 'unknown') as provider,
      gs.created_at,
      gs.first_detected_at,
      gs.confidence_score,
      gs.source_count,
      gs.evidence_hash,
      gs.source_references,
      gs.affected_countries,
      gs.affected_regions,
      gs.misinformation_risk,
      p.base_confidence,
      p.freshness_decay_hours,
      p.misinformation_risk as provider_misinformation_risk
    from public.global_signals gs
    left join public.provider_confidence_profiles p
      on lower(p.provider) = lower(coalesce(gs.ingestion_source, gs.primary_source, 'unknown'))
    where p_signal_id is null or gs.id = p_signal_id
    order by gs.created_at desc
    limit case when p_signal_id is null then 5000 else 1 end
  ), scored as (
    select
      signal_id,
      provider,
      coalesce(base_confidence, 50)::numeric(5,2) as source_confidence,
      case
        when coalesce(array_length(affected_countries, 1), 0) > 0 or coalesce(array_length(affected_regions, 1), 0) > 0 then 85
        else 45
      end::numeric(5,2) as geo_confidence,
      least(100, greatest(30, coalesce(confidence_score, 50)))::numeric(5,2) as entity_confidence,
      public.compute_freshness_score(coalesce(first_detected_at, created_at), coalesce(freshness_decay_hours, 72)) as freshness_score,
      case
        when evidence_hash is not null and coalesce(source_count, 0) >= 3 then 95
        when evidence_hash is not null and coalesce(source_count, 0) >= 1 then 80
        when coalesce(source_count, 0) >= 2 then 70
        when source_references is not null and jsonb_array_length(coalesce(source_references, '[]'::jsonb)) > 0 then 65
        else 35
      end::numeric(5,2) as evidence_score,
      least(40, greatest(coalesce(misinformation_risk, 0), coalesce(provider_misinformation_risk, 0)) / 2)::numeric(5,2) as contradiction_penalty
    from candidates
  ), final as (
    select
      *,
      greatest(0, least(100,
        (source_confidence * 0.25) +
        (entity_confidence * 0.20) +
        (geo_confidence * 0.20) +
        (freshness_score * 0.15) +
        (evidence_score * 0.20) -
        contradiction_penalty
      ))::numeric(5,2) as final_confidence
    from scored
  ), inserted as (
    insert into public.signal_confidence_evaluations(
      signal_id,
      source_provider,
      source_confidence,
      entity_confidence,
      geo_confidence,
      freshness_score,
      evidence_score,
      contradiction_penalty,
      final_confidence,
      explanation,
      metadata
    )
    select
      signal_id,
      provider,
      source_confidence,
      entity_confidence,
      geo_confidence,
      freshness_score,
      evidence_score,
      contradiction_penalty,
      final_confidence,
      'Weighted confidence evaluation from source, entity, geo, freshness, evidence, and contradiction penalty.',
      jsonb_build_object('version', 'confidence-v1')
    from final
    returning 1
  )
  select count(*) into v_inserted from inserted;

  insert into public.pipeline_health_events(job_name, status, source, inserted_count, message, metadata)
  values (
    'evaluate_signal_confidence',
    'success',
    'database',
    v_inserted,
    'Signal confidence evaluation pass completed',
    jsonb_build_object('evaluated_rows', v_inserted)
  );

  return v_inserted;
end;
$$;

create or replace function public.detect_signal_contradictions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_upserted integer := 0;
begin
  with recent as (
    select
      coalesce(nullif(array_to_string(affected_countries, ','), ''), 'UNKNOWN') as iso3_group,
      category,
      status,
      count(*) as n,
      jsonb_agg(jsonb_build_object('id', id, 'title', title, 'source', primary_source, 'status', status, 'confidence', confidence_score) order by created_at desc) as claims
    from public.global_signals
    where created_at > now() - interval '7 days'
    group by 1, 2, 3
  ), groups as (
    select
      iso3_group,
      category,
      count(distinct status) as distinct_statuses,
      sum(n) as total_claims,
      jsonb_agg(claims) as claim_groups
    from recent
    group by iso3_group, category
    having count(distinct status) > 1 and sum(n) >= 3
  ), upserted as (
    insert into public.contradiction_clusters(
      cluster_key,
      iso3,
      domain,
      contradiction_type,
      severity,
      source_count,
      conflicting_claims
    )
    select
      md5(iso3_group || ':' || category),
      left(iso3_group, 3),
      category,
      'conflicting_statuses',
      case when total_claims >= 20 then 'high' else 'medium' end,
      total_claims,
      claim_groups
    from groups
    on conflict (cluster_key, contradiction_type) do update set
      source_count = excluded.source_count,
      conflicting_claims = excluded.conflicting_claims,
      severity = excluded.severity,
      updated_at = now()
    returning 1
  )
  select count(*) into v_upserted from upserted;

  insert into public.pipeline_health_events(job_name, status, source, inserted_count, message, metadata)
  values (
    'detect_signal_contradictions',
    case when v_upserted > 0 then 'partial' else 'success' end,
    'database',
    v_upserted,
    'Signal contradiction detection completed',
    jsonb_build_object('contradiction_clusters', v_upserted)
  );

  return v_upserted;
end;
$$;

create or replace function public.enqueue_replay_job(
  p_provider text default null,
  p_cursor_after timestamptz default null,
  p_cursor_before timestamptz default null,
  p_scope jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_total integer;
begin
  select count(*) into v_total
  from public.raw_intake_archive ria
  where (p_provider is null or ria.provider = p_provider)
    and (p_cursor_after is null or ria.ingested_at >= p_cursor_after)
    and (p_cursor_before is null or ria.ingested_at <= p_cursor_before);

  insert into public.replay_jobs(provider, replay_scope, cursor_after, cursor_before, raw_rows_total, created_by)
  values (p_provider, p_scope, p_cursor_after, p_cursor_before, v_total, auth.uid())
  returning id into v_id;

  insert into public.audit_events(action, resource_type, resource_id, new_value, reason, metadata)
  values ('replay_job_enqueued', 'replay_job', v_id::text, jsonb_build_object('provider', p_provider, 'rows', v_total), 'Replay job created for forensic reconstruction', p_scope);

  return v_id;
end;
$$;

create or replace function public.detect_entity_governance_candidates()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  with alias_candidates as (
    select
      null::uuid as entity_id,
      null::uuid as proposed_entity_id,
      alias,
      iso3,
      80::numeric as confidence,
      'ISO3 alias is present but should be reviewed for canonical coverage'::text as reason,
      jsonb_build_object('reason', reason) as evidence
    from public.iso3_aliases
    where not exists (
      select 1 from public.entity_governance_queue q
      where q.queue_type = 'alias_review' and q.alias = iso3_aliases.alias and q.status = 'open'
    )
    limit 1000
  ), inserted as (
    insert into public.entity_governance_queue(queue_type, entity_id, proposed_entity_id, alias, iso3, confidence, reason, evidence)
    select 'alias_review', entity_id, proposed_entity_id, alias, iso3, confidence, reason, evidence
    from alias_candidates
    on conflict do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  insert into public.pipeline_health_events(job_name, status, source, inserted_count, message, metadata)
  values (
    'detect_entity_governance_candidates',
    'success',
    'database',
    v_inserted,
    'Entity governance candidate detection completed',
    jsonb_build_object('inserted_candidates', v_inserted)
  );

  return v_inserted;
end;
$$;

create or replace view public.v_latest_signal_confidence as
select distinct on (signal_id)
  signal_id,
  source_provider,
  source_confidence,
  entity_confidence,
  geo_confidence,
  freshness_score,
  evidence_score,
  contradiction_penalty,
  final_confidence,
  explanation,
  created_at
from public.signal_confidence_evaluations
order by signal_id, created_at desc;

create or replace view public.v_entity_governance_summary as
select
  queue_type,
  status,
  count(*)::bigint as item_count,
  max(created_at) as latest_created_at
from public.entity_governance_queue
group by queue_type, status;

select cron.schedule('evaluate_signal_confidence', '*/15 * * * *', $$select public.evaluate_signal_confidence(null);$$)
where not exists (select 1 from cron.job where jobname = 'evaluate_signal_confidence');

select cron.schedule('detect_signal_contradictions', '*/30 * * * *', $$select public.detect_signal_contradictions();$$)
where not exists (select 1 from cron.job where jobname = 'detect_signal_contradictions');

select cron.schedule('detect_entity_governance_candidates', '0 * * * *', $$select public.detect_entity_governance_candidates();$$)
where not exists (select 1 from cron.job where jobname = 'detect_entity_governance_candidates');
