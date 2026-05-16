-- AICIS surface contract compatibility
-- Purpose:
-- Prevent Atlas / downstream status surfaces from failing when they expect
-- urgency and evidence_tier fields on operational intelligence surfaces.
--
-- This version is intentionally defensive. It avoids static references to optional
-- source columns that may not exist in older deployments.

-- -----------------------------------------------------------------------------
-- 1. Add compatibility columns where the expected source tables exist
-- -----------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.risk_action_recommendations') is not null then
    alter table public.risk_action_recommendations
      add column if not exists urgency text default 'medium',
      add column if not exists evidence_tier text default 'operational';

    update public.risk_action_recommendations
    set urgency = coalesce(urgency, 'medium'),
        evidence_tier = coalesce(evidence_tier, 'operational')
    where urgency is null or evidence_tier is null;
  end if;

  if to_regclass('public.aicis_early_warnings') is not null then
    alter table public.aicis_early_warnings
      add column if not exists urgency text default 'medium',
      add column if not exists evidence_tier text default 'operational';

    update public.aicis_early_warnings
    set urgency = coalesce(urgency, 'medium'),
        evidence_tier = coalesce(evidence_tier, 'operational')
    where urgency is null or evidence_tier is null;
  end if;

  if to_regclass('public.normalized_events') is not null then
    alter table public.normalized_events
      add column if not exists urgency text default 'medium',
      add column if not exists evidence_tier text default 'signal';

    update public.normalized_events
    set urgency = coalesce(urgency, 'medium'),
        evidence_tier = coalesce(evidence_tier, 'signal')
    where urgency is null or evidence_tier is null;
  end if;

  if to_regclass('public.risk_ranking_predictions') is not null then
    alter table public.risk_ranking_predictions
      add column if not exists urgency text default 'medium',
      add column if not exists evidence_tier text default 'forecast';

    update public.risk_ranking_predictions
    set urgency = coalesce(urgency, 'medium'),
        evidence_tier = coalesce(evidence_tier, 'forecast')
    where urgency is null or evidence_tier is null;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Utility helpers for safe dynamic view construction
-- -----------------------------------------------------------------------------

create or replace function public.aicis_column_exists(
  p_table text,
  p_column text
) returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = p_table
      and column_name = p_column
  );
$$;

create or replace function public.aicis_first_existing_column_expr(
  p_table text,
  p_columns text[],
  p_default text
) returns text
language plpgsql
stable
set search_path = public
as $$
declare
  col text;
  exprs text[] := array[]::text[];
begin
  foreach col in array p_columns loop
    if public.aicis_column_exists(p_table, col) then
      exprs := exprs || format('%I::text', col);
    end if;
  end loop;

  exprs := exprs || quote_literal(p_default);
  return 'coalesce(' || array_to_string(exprs, ', ') || ')::text';
end;
$$;

create or replace function public.aicis_first_existing_timestamp_expr(
  p_table text,
  p_columns text[]
) returns text
language plpgsql
stable
set search_path = public
as $$
declare
  col text;
  exprs text[] := array[]::text[];
begin
  foreach col in array p_columns loop
    if public.aicis_column_exists(p_table, col) then
      exprs := exprs || format('%I::timestamptz', col);
    end if;
  end loop;

  exprs := exprs || 'now()';
  return 'coalesce(' || array_to_string(exprs, ', ') || ')::timestamptz';
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Build stable compatibility view dynamically
-- -----------------------------------------------------------------------------

do $$
declare
  parts text[] := array[]::text[];
  stmt text;
  title_expr text;
  summary_expr text;
  generated_expr text;
begin
  if to_regclass('public.risk_action_recommendations') is not null then
    title_expr := public.aicis_first_existing_column_expr('risk_action_recommendations', array['recommendation_title','action_title','title'], 'Risk action recommendation');
    summary_expr := public.aicis_first_existing_column_expr('risk_action_recommendations', array['recommendation_summary','action_summary','summary','recommended_action'], 'No summary available');
    generated_expr := public.aicis_first_existing_timestamp_expr('risk_action_recommendations', array['created_at','generated_at','updated_at']);

    parts := parts || format($fmt$
      select
        'risk_action_recommendations'::text as source_surface,
        id::text as item_id,
        %s as title,
        %s as summary,
        coalesce(urgency, 'medium')::text as urgency,
        coalesce(evidence_tier, 'operational')::text as evidence_tier,
        %s as generated_at
      from public.risk_action_recommendations
    $fmt$, title_expr, summary_expr, generated_expr);
  end if;

  if to_regclass('public.aicis_early_warnings') is not null then
    title_expr := public.aicis_first_existing_column_expr('aicis_early_warnings', array['warning_title','title'], 'Early warning');
    summary_expr := public.aicis_first_existing_column_expr('aicis_early_warnings', array['warning_summary','summary','description'], 'No summary available');
    generated_expr := public.aicis_first_existing_timestamp_expr('aicis_early_warnings', array['created_at','generated_at','updated_at']);

    parts := parts || format($fmt$
      select
        'aicis_early_warnings'::text as source_surface,
        id::text as item_id,
        %s as title,
        %s as summary,
        coalesce(urgency, 'medium')::text as urgency,
        coalesce(evidence_tier, 'operational')::text as evidence_tier,
        %s as generated_at
      from public.aicis_early_warnings
    $fmt$, title_expr, summary_expr, generated_expr);
  end if;

  if to_regclass('public.normalized_events') is not null then
    title_expr := public.aicis_first_existing_column_expr('normalized_events', array['event_title','title','event_type'], 'Normalized event');
    summary_expr := public.aicis_first_existing_column_expr('normalized_events', array['event_summary','summary','description'], 'No summary available');
    generated_expr := public.aicis_first_existing_timestamp_expr('normalized_events', array['event_timestamp','created_at','generated_at','updated_at']);

    parts := parts || format($fmt$
      select
        'normalized_events'::text as source_surface,
        id::text as item_id,
        %s as title,
        %s as summary,
        coalesce(urgency, 'medium')::text as urgency,
        coalesce(evidence_tier, 'signal')::text as evidence_tier,
        %s as generated_at
      from public.normalized_events
    $fmt$, title_expr, summary_expr, generated_expr);
  end if;

  if to_regclass('public.risk_ranking_predictions') is not null then
    title_expr := public.aicis_first_existing_column_expr('risk_ranking_predictions', array['prediction_title','title'], 'Risk ranking prediction');
    summary_expr := public.aicis_first_existing_column_expr('risk_ranking_predictions', array['prediction_summary','summary'], 'No summary available');
    generated_expr := public.aicis_first_existing_timestamp_expr('risk_ranking_predictions', array['created_at','generated_at','updated_at']);

    parts := parts || format($fmt$
      select
        'risk_ranking_predictions'::text as source_surface,
        id::text as item_id,
        %s as title,
        %s as summary,
        coalesce(urgency, 'medium')::text as urgency,
        coalesce(evidence_tier, 'forecast')::text as evidence_tier,
        %s as generated_at
      from public.risk_ranking_predictions
    $fmt$, title_expr, summary_expr, generated_expr);
  end if;

  if array_length(parts, 1) is null then
    stmt := $sql$
      create or replace view public.aicis_surface_contract_compatibility_view as
      select
        null::text as source_surface,
        null::text as item_id,
        null::text as title,
        null::text as summary,
        null::text as urgency,
        null::text as evidence_tier,
        null::timestamptz as generated_at
      where false
    $sql$;
  else
    stmt := 'create or replace view public.aicis_surface_contract_compatibility_view as ' || array_to_string(parts, ' union all ');
  end if;

  execute stmt;
end $$;

comment on view public.aicis_surface_contract_compatibility_view is
'Compatibility surface for downstream consumers requiring urgency and evidence_tier fields across AICIS surfaces.';

-- -----------------------------------------------------------------------------
-- 4. Contract audit view for quick diagnosis
-- -----------------------------------------------------------------------------

create or replace view public.aicis_surface_contract_audit_view as
select
  surface,
  to_regclass(format('public.%I', surface)) is not null as table_exists,
  public.aicis_column_exists(surface, 'urgency') as has_urgency,
  public.aicis_column_exists(surface, 'evidence_tier') as has_evidence_tier
from (
  values
    ('risk_action_recommendations'),
    ('aicis_early_warnings'),
    ('normalized_events'),
    ('risk_ranking_predictions')
) as surfaces(surface);

comment on view public.aicis_surface_contract_audit_view is
'Quick audit view showing whether AICIS surfaces satisfy downstream contract fields urgency and evidence_tier.';
