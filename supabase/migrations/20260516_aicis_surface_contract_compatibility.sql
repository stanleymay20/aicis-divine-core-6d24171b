-- AICIS surface contract compatibility
-- Purpose:
-- Prevent Atlas / downstream status surfaces from failing when they expect
-- urgency and evidence_tier fields on operational intelligence surfaces.
--
-- This migration is intentionally defensive:
-- 1. It adds missing compatibility columns only where likely source tables exist.
-- 2. It backfills safe defaults.
-- 3. It creates a stable compatibility view that downstream consumers can query.
-- 4. It avoids destructive changes to existing domain logic.

-- -----------------------------------------------------------------------------
-- 1. Safe helper: add compatibility columns only if a table exists
-- -----------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.risk_action_recommendations') is not null then
    alter table public.risk_action_recommendations
      add column if not exists urgency text default 'medium',
      add column if not exists evidence_tier text default 'operational';

    update public.risk_action_recommendations
    set
      urgency = coalesce(urgency, 'medium'),
      evidence_tier = coalesce(evidence_tier, 'operational')
    where urgency is null or evidence_tier is null;
  end if;

  if to_regclass('public.aicis_early_warnings') is not null then
    alter table public.aicis_early_warnings
      add column if not exists urgency text default 'medium',
      add column if not exists evidence_tier text default 'operational';

    update public.aicis_early_warnings
    set
      urgency = coalesce(urgency, 'medium'),
      evidence_tier = coalesce(evidence_tier, 'operational')
    where urgency is null or evidence_tier is null;
  end if;

  if to_regclass('public.normalized_events') is not null then
    alter table public.normalized_events
      add column if not exists urgency text default 'medium',
      add column if not exists evidence_tier text default 'signal';

    update public.normalized_events
    set
      urgency = coalesce(urgency, 'medium'),
      evidence_tier = coalesce(evidence_tier, 'signal')
    where urgency is null or evidence_tier is null;
  end if;

  if to_regclass('public.risk_ranking_predictions') is not null then
    alter table public.risk_ranking_predictions
      add column if not exists urgency text default 'medium',
      add column if not exists evidence_tier text default 'forecast';

    update public.risk_ranking_predictions
    set
      urgency = coalesce(urgency, 'medium'),
      evidence_tier = coalesce(evidence_tier, 'forecast')
    where urgency is null or evidence_tier is null;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Normalize urgency values from common severity/risk conventions where present
-- -----------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.risk_action_recommendations') is not null then
    update public.risk_action_recommendations
    set urgency = case
      when lower(coalesce(urgency, '')) in ('critical', 'urgent', 'high') then 'high'
      when lower(coalesce(urgency, '')) in ('low', 'monitor') then 'low'
      else 'medium'
    end
    where urgency is not null;
  end if;

  if to_regclass('public.aicis_early_warnings') is not null then
    update public.aicis_early_warnings
    set urgency = case
      when lower(coalesce(urgency, '')) in ('critical', 'urgent', 'high') then 'high'
      when lower(coalesce(urgency, '')) in ('low', 'monitor') then 'low'
      else 'medium'
    end
    where urgency is not null;
  end if;

  if to_regclass('public.normalized_events') is not null then
    update public.normalized_events
    set urgency = case
      when lower(coalesce(urgency, '')) in ('critical', 'urgent', 'high') then 'high'
      when lower(coalesce(urgency, '')) in ('low', 'monitor') then 'low'
      else 'medium'
    end
    where urgency is not null;
  end if;

  if to_regclass('public.risk_ranking_predictions') is not null then
    update public.risk_ranking_predictions
    set urgency = case
      when lower(coalesce(urgency, '')) in ('critical', 'urgent', 'high') then 'high'
      when lower(coalesce(urgency, '')) in ('low', 'monitor') then 'low'
      else 'medium'
    end
    where urgency is not null;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Stable downstream compatibility surface
-- -----------------------------------------------------------------------------
-- This view gives Atlas and other clients one safe surface that always exposes:
-- source_surface, item_id, title, summary, urgency, evidence_tier, generated_at.
-- If underlying tables are unavailable, the view still exists and returns zero rows.

create or replace view public.aicis_surface_contract_compatibility_view as
select * from (
  select
    'risk_action_recommendations'::text as source_surface,
    id::text as item_id,
    coalesce(recommendation_title, action_title, title, 'Risk action recommendation')::text as title,
    coalesce(recommendation_summary, action_summary, summary, recommended_action, 'No summary available')::text as summary,
    coalesce(urgency, 'medium')::text as urgency,
    coalesce(evidence_tier, 'operational')::text as evidence_tier,
    coalesce(created_at, generated_at, now())::timestamptz as generated_at
  from public.risk_action_recommendations
  where to_regclass('public.risk_action_recommendations') is not null
) recommendations
union all
select * from (
  select
    'aicis_early_warnings'::text as source_surface,
    id::text as item_id,
    coalesce(warning_title, title, 'Early warning')::text as title,
    coalesce(warning_summary, summary, description, 'No summary available')::text as summary,
    coalesce(urgency, 'medium')::text as urgency,
    coalesce(evidence_tier, 'operational')::text as evidence_tier,
    coalesce(created_at, generated_at, now())::timestamptz as generated_at
  from public.aicis_early_warnings
  where to_regclass('public.aicis_early_warnings') is not null
) warnings
union all
select * from (
  select
    'normalized_events'::text as source_surface,
    id::text as item_id,
    coalesce(event_title, title, event_type, 'Normalized event')::text as title,
    coalesce(event_summary, summary, description, 'No summary available')::text as summary,
    coalesce(urgency, 'medium')::text as urgency,
    coalesce(evidence_tier, 'signal')::text as evidence_tier,
    coalesce(event_timestamp, created_at, generated_at, now())::timestamptz as generated_at
  from public.normalized_events
  where to_regclass('public.normalized_events') is not null
) events
union all
select * from (
  select
    'risk_ranking_predictions'::text as source_surface,
    id::text as item_id,
    coalesce(prediction_title, title, 'Risk ranking prediction')::text as title,
    coalesce(prediction_summary, summary, 'No summary available')::text as summary,
    coalesce(urgency, 'medium')::text as urgency,
    coalesce(evidence_tier, 'forecast')::text as evidence_tier,
    coalesce(created_at, generated_at, now())::timestamptz as generated_at
  from public.risk_ranking_predictions
  where to_regclass('public.risk_ranking_predictions') is not null
) predictions;

comment on view public.aicis_surface_contract_compatibility_view is
'Compatibility surface for downstream consumers requiring urgency and evidence_tier fields across AICIS surfaces.';

-- -----------------------------------------------------------------------------
-- 4. Contract audit view for quick diagnosis
-- -----------------------------------------------------------------------------

create or replace view public.aicis_surface_contract_audit_view as
select
  'risk_action_recommendations'::text as surface,
  to_regclass('public.risk_action_recommendations') is not null as table_exists,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'risk_action_recommendations'
      and column_name = 'urgency'
  ) as has_urgency,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'risk_action_recommendations'
      and column_name = 'evidence_tier'
  ) as has_evidence_tier
union all
select
  'aicis_early_warnings',
  to_regclass('public.aicis_early_warnings') is not null,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'aicis_early_warnings' and column_name = 'urgency'),
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'aicis_early_warnings' and column_name = 'evidence_tier')
union all
select
  'normalized_events',
  to_regclass('public.normalized_events') is not null,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'normalized_events' and column_name = 'urgency'),
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'normalized_events' and column_name = 'evidence_tier')
union all
select
  'risk_ranking_predictions',
  to_regclass('public.risk_ranking_predictions') is not null,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'risk_ranking_predictions' and column_name = 'urgency'),
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'risk_ranking_predictions' and column_name = 'evidence_tier');

comment on view public.aicis_surface_contract_audit_view is
'Quick audit view showing whether AICIS surfaces satisfy downstream contract fields urgency and evidence_tier.';
