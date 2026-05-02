
-- ============================================================
-- CRITICAL BUNDLE: Realtime RLS + Outcome Cockpit + Forecast Realization
-- ============================================================

-- ============================================================
-- A. REALTIME RLS HARDENING
-- ============================================================
-- realtime.messages is owned by supabase_realtime_admin. We can attach
-- a topic-scoped policy to restrict authenticated subscribers to topics
-- that match either:
--   * a public broadcast prefix ("public:")
--   * their own user id  ("user:<auth.uid()>:")
--   * an org/role they belong to (admin/operator)
-- This blocks "subscribe to anyone's private channel" attacks.

ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_can_read_own_topics" ON realtime.messages;
CREATE POLICY "authenticated_can_read_own_topics"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  -- Public broadcast topics anyone authenticated can read
  topic LIKE 'public:%'
  -- Topics namespaced to the current user
  OR topic LIKE ('user:' || auth.uid()::text || ':%')
  OR topic = ('user:' || auth.uid()::text)
  -- Privileged roles can read ops/admin topics
  OR (
    (topic LIKE 'admin:%' OR topic LIKE 'ops:%')
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'))
  )
);

DROP POLICY IF EXISTS "authenticated_can_write_own_topics" ON realtime.messages;
CREATE POLICY "authenticated_can_write_own_topics"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  topic LIKE 'public:%'
  OR topic LIKE ('user:' || auth.uid()::text || ':%')
  OR topic = ('user:' || auth.uid()::text)
  OR (
    (topic LIKE 'admin:%' OR topic LIKE 'ops:%')
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'))
  )
);

-- ============================================================
-- B. OUTCOME CAPTURE COCKPIT — view of actions needing review
-- ============================================================
CREATE OR REPLACE VIEW public.v_outcome_cockpit_queue
WITH (security_invoker = true) AS
SELECT
  rar.id                       AS action_id,
  rar.intervention_title,
  rar.country_iso3,
  rar.domain,
  rar.status,
  rar.accepted_at,
  rar.executed_at,
  rar.outcome_logged_at,
  rar.estimated_roi_eur,
  pra.pilot_run_id,
  CASE
    WHEN rar.linked_outcome_id IS NOT NULL THEN 'logged'
    WHEN pra.pilot_run_id IS NOT NULL AND pra.outcome_logged = false THEN 'pilot_pending'
    WHEN rar.executed_at IS NOT NULL AND rar.executed_at < (now() - interval '7 days') THEN 'executed_overdue'
    WHEN rar.accepted_at IS NOT NULL AND rar.executed_at IS NULL AND rar.accepted_at < (now() - interval '7 days') THEN 'accepted_overdue'
    ELSE 'in_window'
  END AS review_reason,
  GREATEST(
    EXTRACT(EPOCH FROM (now() - COALESCE(rar.executed_at, rar.accepted_at))) / 86400.0,
    0
  )::int AS days_pending
FROM public.risk_action_recommendations rar
LEFT JOIN public.pilot_run_actions pra ON pra.action_id = rar.id
WHERE rar.status IN ('accepted','executed')
  AND rar.linked_outcome_id IS NULL
  AND (
    (rar.executed_at IS NOT NULL AND rar.executed_at < (now() - interval '7 days'))
    OR (rar.accepted_at IS NOT NULL AND rar.executed_at IS NULL AND rar.accepted_at < (now() - interval '7 days'))
    OR (pra.pilot_run_id IS NOT NULL AND pra.outcome_logged = false)
  );

GRANT SELECT ON public.v_outcome_cockpit_queue TO authenticated;

COMMENT ON VIEW public.v_outcome_cockpit_queue IS
  'Outcome Capture Cockpit feed: accepted >7d, executed >7d, or pilot-run actions still missing outcome. security_invoker so caller RLS on base tables applies.';

-- ============================================================
-- C. FORECAST REALIZATION CRON SUPPORT
-- ============================================================

-- Per-run log
CREATE TABLE IF NOT EXISTS public.forecast_realization_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  rows_realized   integer NOT NULL DEFAULT 0,
  rows_skipped    integer NOT NULL DEFAULT 0,
  limit_count     integer NOT NULL,
  status          text NOT NULL DEFAULT 'running',
  error_message   text
);

ALTER TABLE public.forecast_realization_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "frr_read_priv" ON public.forecast_realization_runs;
CREATE POLICY "frr_read_priv"
ON public.forecast_realization_runs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

DROP POLICY IF EXISTS "frr_service_write" ON public.forecast_realization_runs;
CREATE POLICY "frr_service_write"
ON public.forecast_realization_runs
FOR ALL
TO service_role
USING (true) WITH CHECK (true);

-- Realization function — only realizes due, unlocked, unrealized rows.
-- It does NOT mark future forecasts realized (guarded by realization_due_at <= now()).
-- Auto-locks each realized row (evaluation_locked := true).
CREATE OR REPLACE FUNCTION public.realize_due_prospective_forecasts(limit_count int DEFAULT 500)
RETURNS TABLE (run_id uuid, rows_realized int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run_id uuid;
  v_realized int := 0;
BEGIN
  INSERT INTO public.forecast_realization_runs (limit_count, status)
  VALUES (limit_count, 'running')
  RETURNING id INTO v_run_id;

  WITH due AS (
    SELECT fpe.id, fpe.iso3, fpe.domain, fpe.predicted_value, fpe.predicted_direction
    FROM public.forecast_prospective_evaluations fpe
    WHERE fpe.realized_at IS NULL
      AND fpe.evaluation_locked = false
      AND fpe.realization_due_at <= now()
    ORDER BY fpe.realization_due_at ASC
    LIMIT GREATEST(limit_count, 1)
    FOR UPDATE SKIP LOCKED
  ),
  -- Pull most recent metric value at/after the due moment as the realization
  realized AS (
    SELECT
      d.id,
      d.predicted_value,
      d.predicted_direction,
      (
        SELECT m.value
        FROM public.country_metrics m
        WHERE m.country_iso3 = d.iso3
          AND m.domain = d.domain
          AND m.observed_at >= now() - interval '14 days'
        ORDER BY m.observed_at DESC
        LIMIT 1
      ) AS realized_value
    FROM due d
  )
  UPDATE public.forecast_prospective_evaluations fpe
  SET
    realized_value     = r.realized_value,
    realized_direction = CASE
      WHEN r.realized_value IS NULL THEN NULL
      WHEN r.realized_value > fpe.predicted_value THEN 'up'
      WHEN r.realized_value < fpe.predicted_value THEN 'down'
      ELSE 'flat'
    END,
    direction_hit = CASE
      WHEN r.realized_value IS NULL THEN NULL
      ELSE (
        (r.realized_value > fpe.predicted_value AND fpe.predicted_direction = 'up')
        OR (r.realized_value < fpe.predicted_value AND fpe.predicted_direction = 'down')
        OR (r.realized_value = fpe.predicted_value AND fpe.predicted_direction = 'flat')
      )
    END,
    absolute_error    = CASE WHEN r.realized_value IS NULL THEN NULL ELSE abs(r.realized_value - fpe.predicted_value) END,
    realized_at       = now(),
    evaluation_locked = true
  FROM realized r
  WHERE fpe.id = r.id;

  GET DIAGNOSTICS v_realized = ROW_COUNT;

  UPDATE public.forecast_realization_runs
  SET finished_at = now(),
      rows_realized = v_realized,
      status = 'success'
  WHERE id = v_run_id;

  RETURN QUERY SELECT v_run_id, v_realized;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.forecast_realization_runs
  SET finished_at = now(),
      status = 'failed',
      error_message = SQLERRM
  WHERE id = v_run_id;
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.realize_due_prospective_forecasts(int) TO service_role;

COMMENT ON FUNCTION public.realize_due_prospective_forecasts(int) IS
  'Realize prospective forecasts whose realization_due_at <= now(). Auto-locks rows. Future forecasts are never touched. Logged in forecast_realization_runs.';
