-- Phase 1 — Relevance Intelligence operationalization
-- Adds cron scheduling + validation surfaces for relevance scoring and feedback learning.

-- Validation view: score distribution per user/profile.
create or replace view public.relevance_quality_dashboard as
select
  srs.user_id,
  srs.workspace_id,
  count(*)::bigint as total_scored,
  count(*) filter (where srs.relevance_tier = 'critical')::bigint as critical_count,
  count(*) filter (where srs.relevance_tier = 'important')::bigint as important_count,
  count(*) filter (where srs.relevance_tier = 'monitor')::bigint as monitor_count,
  count(*) filter (where srs.relevance_tier = 'discovery')::bigint as discovery_count,
  count(*) filter (where srs.relevance_tier = 'hidden')::bigint as hidden_count,
  round(avg(srs.relevance_score)::numeric, 2) as avg_relevance_score,
  round(percentile_cont(0.5) within group (order by srs.relevance_score)::numeric, 2) as p50_relevance_score,
  round(percentile_cont(0.9) within group (order by srs.relevance_score)::numeric, 2) as p90_relevance_score,
  max(srs.computed_at) as last_scored_at
from public.signal_relevance_scores srs
group by srs.user_id, srs.workspace_id;

-- Validation view: feedback trend and learning signal quality.
create or replace view public.relevance_feedback_dashboard as
select
  usf.user_id,
  date_trunc('day', usf.created_at) as day,
  count(*)::bigint as total_feedback,
  count(*) filter (where usf.feedback_type in ('important', 'save', 'escalate'))::bigint as positive_feedback,
  count(*) filter (where usf.feedback_type in ('not_relevant', 'dismiss'))::bigint as negative_feedback,
  count(*) filter (where usf.feedback_type = 'escalate')::bigint as escalations,
  round(
    100.0 * count(*) filter (where usf.feedback_type in ('not_relevant', 'dismiss')) / greatest(count(*), 1),
    2
  ) as negative_feedback_rate_pct
from public.user_signal_feedback usf
group by usf.user_id, date_trunc('day', usf.created_at);

-- Validation view: interruptive alert candidates after relevance gating.
create or replace view public.relevance_alert_readiness as
select
  srs.user_id,
  srs.workspace_id,
  srs.signal_id,
  gs.title,
  gs.category,
  gs.affected_countries,
  gs.impact_score,
  gs.urgency_score,
  gs.confidence_score,
  gs.source_trust_tier,
  srs.relevance_score,
  srs.relevance_tier,
  srs.relevance_reason,
  srs.computed_at
from public.signal_relevance_scores srs
join public.global_signals gs on gs.id = srs.signal_id
join public.user_relevance_profiles urp
  on urp.user_id = srs.user_id
 and urp.workspace_id is not distinct from srs.workspace_id
where gs.canonical_event_status = 'canonical'
  and (
    srs.relevance_tier = 'critical'
    or srs.relevance_score >= urp.alert_threshold
  )
  and coalesce(gs.source_trust_tier, 'tier_4') <> 'tier_4';

-- Optional validation RPC to summarize Phase 1 health quickly.
create or replace function public.get_relevance_phase1_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'profiles', (select count(*) from public.user_relevance_profiles),
    'scores', (select count(*) from public.signal_relevance_scores),
    'feedback', (select count(*) from public.user_signal_feedback),
    'alert_candidates', (select count(*) from public.relevance_alert_readiness),
    'tier_counts', (
      select coalesce(jsonb_object_agg(relevance_tier, n), '{}'::jsonb)
      from (
        select relevance_tier, count(*)::bigint as n
        from public.signal_relevance_scores
        group by relevance_tier
      ) x
    ),
    'last_scoring_log', (
      select message from public.automation_logs
      where job_name = 'score-signal-relevance'
      order by created_at desc nulls last
      limit 1
    ),
    'last_learning_log', (
      select message from public.automation_logs
      where job_name = 'learn-relevance-profile'
      order by created_at desc nulls last
      limit 1
    )
  ) into result;

  return result;
end;
$$;

-- pg_cron schedules. These use Supabase's net.http_post extension pattern already used elsewhere in the project.
-- Scoring runs frequently because it is deterministic and cheap.
do $$
declare
  project_url text;
  service_key text;
begin
  project_url := current_setting('app.settings.supabase_url', true);
  service_key := current_setting('app.settings.service_role_key', true);

  -- Some environments do not expose app.settings.* at migration time.
  -- In those cases, the cron is intentionally skipped and can be added via SQL after secrets are configured.
  if project_url is not null and service_key is not null and length(project_url) > 0 and length(service_key) > 0 then
    perform cron.unschedule('phase1-score-signal-relevance')
      where exists (select 1 from cron.job where jobname = 'phase1-score-signal-relevance');
    perform cron.unschedule('phase1-learn-relevance-profile')
      where exists (select 1 from cron.job where jobname = 'phase1-learn-relevance-profile');

    perform cron.schedule(
      'phase1-score-signal-relevance',
      '*/5 * * * *',
      format(
        $$select net.http_post(
          url := %L,
          headers := jsonb_build_object('Authorization', 'Bearer ' || %L, 'Content-Type', 'application/json'),
          body := jsonb_build_object('limit', 750, 'bootstrap', false)
        );$$,
        project_url || '/functions/v1/score-signal-relevance',
        service_key
      )
    );

    perform cron.schedule(
      'phase1-learn-relevance-profile',
      '17 * * * *',
      format(
        $$select net.http_post(
          url := %L,
          headers := jsonb_build_object('Authorization', 'Bearer ' || %L, 'Content-Type', 'application/json'),
          body := jsonb_build_object('lookback_hours', 168)
        );$$,
        project_url || '/functions/v1/learn-relevance-profile',
        service_key
      )
    );
  end if;
exception when others then
  insert into public.automation_logs(job_name, status, message)
  values ('phase1-relevance-cron-migration', 'warning', left(sqlerrm, 500));
end $$;
