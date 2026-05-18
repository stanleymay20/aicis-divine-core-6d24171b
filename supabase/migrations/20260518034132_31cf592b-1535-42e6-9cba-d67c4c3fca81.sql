-- Safe period -> date parser (handles 'YYYY', 'YYYY-Qn', 'YYYY-MM', 'YYYY-MM-DD', ISO timestamps, NULL)
CREATE OR REPLACE FUNCTION public.safe_period_to_date(p text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  s text := trim(coalesce(p, ''));
  q int;
BEGIN
  IF s = '' THEN RETURN NULL; END IF;
  -- Full ISO date / timestamp
  IF s ~ '^\d{4}-\d{2}-\d{2}' THEN
    BEGIN RETURN substring(s from 1 for 10)::date; EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
  END IF;
  -- Year-Month: YYYY-MM or YYYY-M
  IF s ~ '^\d{4}-\d{1,2}$' THEN
    BEGIN RETURN to_date(s, 'YYYY-MM'); EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
  END IF;
  -- Year-Quarter: YYYY-Qn or YYYYQn
  IF s ~ '^\d{4}[-]?Q[1-4]$' THEN
    q := substring(s from '[1-4]$')::int;
    RETURN make_date(substring(s from 1 for 4)::int, ((q-1)*3)+1, 1);
  END IF;
  -- Bare year
  IF s ~ '^\d{4}$' THEN
    RETURN make_date(s::int, 1, 1);
  END IF;
  -- Last resort
  BEGIN RETURN s::date; EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.safe_period_to_date(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.safe_period_to_date(text) TO authenticated, anon, service_role;

-- Repair Quantivis enqueue
CREATE OR REPLACE FUNCTION public.enqueue_quantivis_metric_batch(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_url text; v_last_pushed timestamptz; v_records jsonb;
  v_max_seen timestamptz; v_count int; v_webhook_id uuid;
BEGIN
  v_url := COALESCE(NULLIF(current_setting('app.quantivis_webhook_url', true), ''),
                    'https://itpwpnwzzitkelffttyx.supabase.co/functions/v1/webhook-ingest');

  SELECT to_timestamp(value_int) INTO v_last_pushed
  FROM backfill_state WHERE key = 'quantivis_last_metric_push';
  IF v_last_pushed IS NULL THEN v_last_pushed := now() - interval '7 days'; END IF;

  WITH fresh AS (
    SELECT COALESCE(iso3, 'WLD') AS country,
           to_char(COALESCE(public.safe_period_to_date(period), created_at::date), 'YYYY-MM-DD') AS date,
           metric_name AS indicator, value, created_at
    FROM normalized_metrics
    WHERE created_at > v_last_pushed AND value IS NOT NULL AND metric_name IS NOT NULL
    ORDER BY created_at ASC LIMIT p_limit
  )
  SELECT jsonb_agg(jsonb_build_object('country', country, 'date', date, 'indicator', indicator, 'value', value)),
         MAX(created_at), COUNT(*)
  INTO v_records, v_max_seen, v_count FROM fresh;

  IF v_count = 0 OR v_records IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'pushed', 0, 'reason', 'no fresh metrics');
  END IF;

  INSERT INTO quantivis_webhook_queue (event_type, payload, target_url)
  VALUES ('metric_update', jsonb_build_object('records', v_records), v_url)
  RETURNING id INTO v_webhook_id;

  INSERT INTO backfill_state (key, value_int, updated_at)
  VALUES ('quantivis_last_metric_push', extract(epoch from v_max_seen)::int, now())
  ON CONFLICT (key) DO UPDATE SET value_int = EXCLUDED.value_int, updated_at = now();

  RETURN jsonb_build_object('ok', true, 'pushed', v_count, 'webhook_id', v_webhook_id);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.enqueue_quantivis_metric_batch(integer) FROM PUBLIC, anon, authenticated;

-- Raise statement timeout for the hourly entity graph refresh
CREATE OR REPLACE FUNCTION public.refresh_quantivis_materialized()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  result jsonb := '{}'::jsonb;
BEGIN
  PERFORM set_config('statement_timeout', '600000', true); -- 10 minutes
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.quantivis_country_dashboard;
    result := result || jsonb_build_object('country_dashboard','ok');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_errors(component, message, severity, details)
    VALUES ('refresh_quantivis_materialized','country_dashboard refresh skipped','low',
            jsonb_build_object('error', SQLERRM));
    result := result || jsonb_build_object('country_dashboard', SQLERRM);
  END;
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.quantivis_entity_graph;
    result := result || jsonb_build_object('entity_graph','ok');
  EXCEPTION WHEN OTHERS THEN
    -- Fall back to non-concurrent refresh if concurrent refresh still cannot complete
    BEGIN
      REFRESH MATERIALIZED VIEW public.quantivis_entity_graph;
      result := result || jsonb_build_object('entity_graph','ok_noconcurrent');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.system_errors(component, message, severity, details)
      VALUES ('refresh_quantivis_materialized','entity_graph refresh skipped','low',
              jsonb_build_object('error', SQLERRM));
      result := result || jsonb_build_object('entity_graph', SQLERRM);
    END;
  END;
  RETURN result;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.refresh_quantivis_materialized() FROM PUBLIC, anon, authenticated;