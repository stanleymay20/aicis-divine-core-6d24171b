-- AICIS surface contract governance
-- Adds a registry and validation function so downstream compatibility is governed,
-- inspectable, and regression-checkable after every deployment.

create table if not exists public.aicis_surface_contract_registry (
  id uuid primary key default gen_random_uuid(),
  surface_name text not null unique,
  source_table text not null,
  required_fields text[] not null default array['title','summary','urgency','evidence_tier','generated_at'],
  fallback_title_fields text[] not null default array['title'],
  fallback_summary_fields text[] not null default array['summary'],
  fallback_timestamp_fields text[] not null default array['created_at','generated_at','updated_at'],
  default_urgency text not null default 'medium',
  default_evidence_tier text not null default 'operational',
  is_enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.aicis_surface_contract_registry (
  surface_name,
  source_table,
  fallback_title_fields,
  fallback_summary_fields,
  fallback_timestamp_fields,
  default_urgency,
  default_evidence_tier,
  notes
) values
  (
    'risk_action_recommendations',
    'risk_action_recommendations',
    array['recommendation_title','action_title','title'],
    array['recommendation_summary','action_summary','summary','recommended_action'],
    array['created_at','generated_at','updated_at'],
    'medium',
    'operational',
    'Risk action recommendation surface consumed by Atlas and executive operational workflows.'
  ),
  (
    'aicis_early_warnings',
    'aicis_early_warnings',
    array['warning_title','title'],
    array['warning_summary','summary','description'],
    array['created_at','generated_at','updated_at'],
    'medium',
    'operational',
    'Early warning surface consumed by upstream status and alerting workflows.'
  ),
  (
    'normalized_events',
    'normalized_events',
    array['event_title','title','event_type'],
    array['event_summary','summary','description'],
    array['event_timestamp','created_at','generated_at','updated_at'],
    'medium',
    'signal',
    'Normalized event surface used as raw operational signal contract.'
  ),
  (
    'risk_ranking_predictions',
    'risk_ranking_predictions',
    array['prediction_title','title'],
    array['prediction_summary','summary'],
    array['created_at','generated_at','updated_at'],
    'medium',
    'forecast',
    'Risk ranking prediction surface used by forecast and status consumers.'
  )
on conflict (surface_name) do update set
  source_table = excluded.source_table,
  fallback_title_fields = excluded.fallback_title_fields,
  fallback_summary_fields = excluded.fallback_summary_fields,
  fallback_timestamp_fields = excluded.fallback_timestamp_fields,
  default_urgency = excluded.default_urgency,
  default_evidence_tier = excluded.default_evidence_tier,
  notes = excluded.notes,
  updated_at = now();

create or replace function public.validate_aicis_surface_contracts()
returns table (
  surface_name text,
  source_table text,
  table_exists boolean,
  has_urgency boolean,
  has_evidence_tier boolean,
  has_title_fallback boolean,
  has_summary_fallback boolean,
  has_timestamp_fallback boolean,
  compatibility_view_exists boolean,
  contract_status text,
  missing_requirements text[]
)
language plpgsql
stable
set search_path = public
as $$
declare
  r record;
  missing text[];
  has_title boolean;
  has_summary boolean;
  has_time boolean;
begin
  for r in
    select *
    from public.aicis_surface_contract_registry
    where is_enabled = true
    order by surface_name
  loop
    missing := array[]::text[];

    table_exists := to_regclass(format('public.%I', r.source_table)) is not null;
    has_urgency := public.aicis_column_exists(r.source_table, 'urgency');
    has_evidence_tier := public.aicis_column_exists(r.source_table, 'evidence_tier');

    select exists (
      select 1 from unnest(r.fallback_title_fields) as c(col)
      where public.aicis_column_exists(r.source_table, c.col)
    ) into has_title;

    select exists (
      select 1 from unnest(r.fallback_summary_fields) as c(col)
      where public.aicis_column_exists(r.source_table, c.col)
    ) into has_summary;

    select exists (
      select 1 from unnest(r.fallback_timestamp_fields) as c(col)
      where public.aicis_column_exists(r.source_table, c.col)
    ) into has_time;

    compatibility_view_exists := to_regclass('public.aicis_surface_contract_compatibility_view') is not null;

    if not table_exists then missing := missing || 'source_table'; end if;
    if table_exists and not has_urgency then missing := missing || 'urgency'; end if;
    if table_exists and not has_evidence_tier then missing := missing || 'evidence_tier'; end if;
    if table_exists and not has_title then missing := missing || 'title_fallback'; end if;
    if table_exists and not has_summary then missing := missing || 'summary_fallback'; end if;
    if table_exists and not has_time then missing := missing || 'timestamp_fallback'; end if;
    if not compatibility_view_exists then missing := missing || 'compatibility_view'; end if;

    surface_name := r.surface_name;
    source_table := r.source_table;
    has_title_fallback := has_title;
    has_summary_fallback := has_summary;
    has_timestamp_fallback := has_time;
    missing_requirements := missing;
    contract_status := case
      when cardinality(missing) = 0 then 'pass'
      when not table_exists then 'skipped_missing_table'
      else 'fail'
    end;

    return next;
  end loop;
end;
$$;

create or replace view public.aicis_surface_contract_validation_view as
select * from public.validate_aicis_surface_contracts();

comment on table public.aicis_surface_contract_registry is
'Governed registry defining downstream AICIS surface contracts and safe fallback mappings.';

comment on function public.validate_aicis_surface_contracts() is
'Validates AICIS downstream surface contracts for required compatibility fields and fallback mappings.';

comment on view public.aicis_surface_contract_validation_view is
'Queryable validation report for AICIS surface compatibility contracts.';
