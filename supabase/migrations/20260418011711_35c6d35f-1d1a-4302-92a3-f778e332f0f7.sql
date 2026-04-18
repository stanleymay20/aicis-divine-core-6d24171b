-- 1. SIEM forwarding queue (buffers events for external SIEM systems)
CREATE TABLE IF NOT EXISTS public.siem_forward_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  payload jsonb NOT NULL,
  source_table text,
  source_id uuid,
  forwarded boolean NOT NULL DEFAULT false,
  forwarded_at timestamptz,
  forward_attempts int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_siem_queue_pending ON public.siem_forward_queue(forwarded, created_at) WHERE forwarded = false;
CREATE INDEX IF NOT EXISTS idx_siem_queue_severity ON public.siem_forward_queue(severity, created_at DESC);

ALTER TABLE public.siem_forward_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage SIEM queue" ON public.siem_forward_queue FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 2. SIEM destination configuration
CREATE TABLE IF NOT EXISTS public.siem_forward_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination text NOT NULL, -- 'datadog' | 'splunk' | 'webhook' | 'logflare'
  endpoint_url text NOT NULL,
  auth_header text,
  enabled boolean NOT NULL DEFAULT true,
  min_severity text NOT NULL DEFAULT 'warning', -- info|warning|error|critical
  filter_event_types text[] DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.siem_forward_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage SIEM config" ON public.siem_forward_config FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 3. Auto-block rules
CREATE TABLE IF NOT EXISTS public.ip_auto_block_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name text NOT NULL UNIQUE,
  trigger_type text NOT NULL, -- 'rate_limit_breach' | 'critical_audit' | 'failed_auth' | 'pattern_match'
  threshold_count int NOT NULL DEFAULT 5,
  window_minutes int NOT NULL DEFAULT 15,
  block_duration_hours int NOT NULL DEFAULT 24,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ip_auto_block_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage auto-block rules" ON public.ip_auto_block_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Seed default rules
INSERT INTO public.ip_auto_block_rules (rule_name, trigger_type, threshold_count, window_minutes, block_duration_hours)
VALUES
  ('Rate limit abuse', 'rate_limit_breach', 5, 15, 24),
  ('Critical audit storm', 'critical_audit', 3, 10, 48),
  ('Failed auth burst', 'failed_auth', 10, 5, 12)
ON CONFLICT (rule_name) DO NOTHING;

-- 4. Public status page incidents
CREATE TABLE IF NOT EXISTS public.status_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'investigating', -- investigating|identified|monitoring|resolved
  impact text NOT NULL DEFAULT 'minor', -- none|minor|major|critical
  affected_components text[] NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  updates jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.status_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read incidents" ON public.status_incidents FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins manage incidents" ON public.status_incidents FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 5. Daily uptime aggregates for status page
CREATE TABLE IF NOT EXISTS public.status_uptime_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component text NOT NULL,
  day date NOT NULL,
  total_checks int NOT NULL DEFAULT 0,
  healthy_checks int NOT NULL DEFAULT 0,
  degraded_checks int NOT NULL DEFAULT 0,
  down_checks int NOT NULL DEFAULT 0,
  uptime_pct numeric(5,2) NOT NULL DEFAULT 100.00,
  avg_response_ms numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(component, day)
);

ALTER TABLE public.status_uptime_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read uptime" ON public.status_uptime_daily FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins manage uptime" ON public.status_uptime_daily FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 6. Trigger: auto-enqueue critical audit events to SIEM queue
CREATE OR REPLACE FUNCTION public.auto_enqueue_critical_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.severity IN ('error', 'critical', 'warning') THEN
    INSERT INTO siem_forward_queue (event_type, severity, payload, source_table, source_id)
    VALUES (
      'audit.' || NEW.action,
      NEW.severity,
      jsonb_build_object(
        'action', NEW.action,
        'user_id', NEW.user_id,
        'org_id', NEW.org_id,
        'ip_address', NEW.ip_address::text,
        'resource_type', NEW.resource_type,
        'resource_id', NEW.resource_id,
        'metadata', NEW.metadata,
        'timestamp', NEW.created_at
      ),
      'audit_log',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_to_siem ON public.audit_log;
CREATE TRIGGER trg_audit_to_siem
AFTER INSERT ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.auto_enqueue_critical_audit();

-- 7. Auto-block evaluator (called by cron)
CREATE OR REPLACE FUNCTION public.evaluate_auto_block()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule RECORD;
  v_offender RECORD;
  v_blocked_count int := 0;
  v_results jsonb := '[]'::jsonb;
BEGIN
  FOR v_rule IN SELECT * FROM ip_auto_block_rules WHERE enabled = true LOOP
    IF v_rule.trigger_type = 'rate_limit_breach' THEN
      FOR v_offender IN
        SELECT ip_address, COUNT(*) as hits
        FROM rate_limits
        WHERE blocked_until IS NOT NULL
          AND window_start > now() - (v_rule.window_minutes || ' minutes')::interval
          AND ip_address IS NOT NULL
        GROUP BY ip_address
        HAVING COUNT(*) >= v_rule.threshold_count
      LOOP
        -- Skip if already blocked
        IF NOT EXISTS (
          SELECT 1 FROM ip_access_control
          WHERE ip_address = v_offender.ip_address
            AND access_type = 'blacklist'
            AND (expires_at IS NULL OR expires_at > now())
        ) THEN
          INSERT INTO ip_access_control (ip_address, access_type, reason, expires_at, created_by)
          VALUES (
            v_offender.ip_address,
            'blacklist',
            'AUTO-BLOCK: ' || v_rule.rule_name || ' (' || v_offender.hits || ' hits)',
            now() + (v_rule.block_duration_hours || ' hours')::interval,
            NULL
          );
          v_blocked_count := v_blocked_count + 1;
          v_results := v_results || jsonb_build_object(
            'ip', v_offender.ip_address::text,
            'rule', v_rule.rule_name,
            'hits', v_offender.hits
          );
          -- Audit it
          INSERT INTO audit_log (action, severity, ip_address, metadata)
          VALUES ('security.auto_block', 'warning', v_offender.ip_address,
            jsonb_build_object('rule', v_rule.rule_name, 'hits', v_offender.hits));
        END IF;
      END LOOP;
    ELSIF v_rule.trigger_type = 'critical_audit' THEN
      FOR v_offender IN
        SELECT ip_address, COUNT(*) as hits
        FROM audit_log
        WHERE severity IN ('error', 'critical')
          AND created_at > now() - (v_rule.window_minutes || ' minutes')::interval
          AND ip_address IS NOT NULL
        GROUP BY ip_address
        HAVING COUNT(*) >= v_rule.threshold_count
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM ip_access_control
          WHERE ip_address = v_offender.ip_address
            AND access_type = 'blacklist'
            AND (expires_at IS NULL OR expires_at > now())
        ) THEN
          INSERT INTO ip_access_control (ip_address, access_type, reason, expires_at)
          VALUES (
            v_offender.ip_address,
            'blacklist',
            'AUTO-BLOCK: ' || v_rule.rule_name || ' (' || v_offender.hits || ' critical events)',
            now() + (v_rule.block_duration_hours || ' hours')::interval
          );
          v_blocked_count := v_blocked_count + 1;
          v_results := v_results || jsonb_build_object(
            'ip', v_offender.ip_address::text,
            'rule', v_rule.rule_name,
            'hits', v_offender.hits
          );
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'blocked_count', v_blocked_count,
    'blocks', v_results,
    'evaluated_at', now()
  );
END;
$$;

-- 8. Compute daily uptime aggregates
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
    WHERE created_at >= CURRENT_DATE
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

-- 9. Public status snapshot RPC (safe, no auth required)
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
  -- Latest health per component
  SELECT COALESCE(jsonb_agg(row_to_json(c) ORDER BY c.component), '[]'::jsonb) INTO v_components FROM (
    SELECT DISTINCT ON (component)
      component, status, response_time_ms, created_at as last_check
    FROM system_health
    WHERE created_at > now() - interval '1 hour'
    ORDER BY component, created_at DESC
  ) c;

  -- Active incidents
  SELECT COALESCE(jsonb_agg(row_to_json(i) ORDER BY i.started_at DESC), '[]'::jsonb) INTO v_incidents FROM (
    SELECT id, title, description, status, impact, affected_components, started_at, resolved_at, updates
    FROM status_incidents
    WHERE resolved_at IS NULL OR resolved_at > now() - interval '7 days'
    ORDER BY started_at DESC
    LIMIT 20
  ) i;

  -- 30-day uptime
  SELECT COALESCE(jsonb_agg(row_to_json(u) ORDER BY u.component, u.day), '[]'::jsonb) INTO v_uptime_30d FROM (
    SELECT component, day, uptime_pct
    FROM status_uptime_daily
    WHERE day > CURRENT_DATE - 30
    ORDER BY component, day
  ) u;

  -- Overall status
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

GRANT EXECUTE ON FUNCTION public.get_public_status() TO anon, authenticated;