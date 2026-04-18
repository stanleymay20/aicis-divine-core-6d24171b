CREATE OR REPLACE FUNCTION public.compute_uptime_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_comp RECORD;
BEGIN
  FOR v_comp IN
    SELECT
      component,
      CURRENT_DATE as day,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'healthy') as healthy,
      COUNT(*) FILTER (WHERE status = 'degraded') as degraded,
      COUNT(*) FILTER (WHERE status = 'down') as down,
      AVG(response_time_ms) as avg_ms
    FROM system_health
    WHERE checked_at >= CURRENT_DATE
    GROUP BY component
  LOOP
    INSERT INTO status_uptime_daily (
      component, day, total_checks, healthy_checks, degraded_checks, down_checks,
      uptime_pct, avg_response_ms
    ) VALUES (
      v_comp.component, v_comp.day, v_comp.total, v_comp.healthy,
      v_comp.degraded, v_comp.down,
      ROUND((v_comp.healthy::numeric / GREATEST(v_comp.total, 1)) * 100, 2),
      v_comp.avg_ms
    )
    ON CONFLICT (component, day) DO UPDATE SET
      total_checks = EXCLUDED.total_checks,
      healthy_checks = EXCLUDED.healthy_checks,
      degraded_checks = EXCLUDED.degraded_checks,
      down_checks = EXCLUDED.down_checks,
      uptime_pct = EXCLUDED.uptime_pct,
      avg_response_ms = EXCLUDED.avg_response_ms;
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object('components_updated', v_inserted, 'computed_at', now());
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_components jsonb;
  v_incidents jsonb;
  v_uptime_30d jsonb;
  v_overall text;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(c) ORDER BY c.component), '[]'::jsonb) INTO v_components FROM (
    SELECT DISTINCT ON (component)
      component, status, response_time_ms, checked_at as last_check
    FROM system_health
    WHERE checked_at > now() - interval '1 hour'
    ORDER BY component, checked_at DESC
  ) c;

  SELECT COALESCE(jsonb_agg(row_to_json(i) ORDER BY i.started_at DESC), '[]'::jsonb) INTO v_incidents FROM (
    SELECT id, title, description, status, impact, affected_components, started_at, resolved_at, updates
    FROM status_incidents
    WHERE resolved_at IS NULL OR resolved_at > now() - interval '7 days'
    ORDER BY started_at DESC
    LIMIT 20
  ) i;

  SELECT COALESCE(jsonb_agg(row_to_json(u) ORDER BY u.component, u.day), '[]'::jsonb) INTO v_uptime_30d FROM (
    SELECT component, day, uptime_pct
    FROM status_uptime_daily
    WHERE day > CURRENT_DATE - 30
    ORDER BY component, day
  ) u;

  v_overall := CASE
    WHEN EXISTS (SELECT 1 FROM status_incidents WHERE resolved_at IS NULL AND impact IN ('major','critical')) THEN 'major_outage'
    WHEN EXISTS (SELECT 1 FROM status_incidents WHERE resolved_at IS NULL) THEN 'partial_outage'
    WHEN v_components::text LIKE '%"down"%' THEN 'degraded'
    WHEN v_components::text LIKE '%"degraded"%' THEN 'degraded'
    ELSE 'operational'
  END;

  RETURN jsonb_build_object(
    'overall_status', v_overall,
    'components', v_components,
    'incidents', v_incidents,
    'uptime_30d', v_uptime_30d,
    'checked_at', now()
  );
END;
$$;

-- Also fix auto-block-ips function references to use checked_at
GRANT EXECUTE ON FUNCTION public.get_public_status() TO anon, authenticated;