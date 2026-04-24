CREATE OR REPLACE FUNCTION public.enqueue_quantivis_metric_batch(p_limit int DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_last_pushed timestamptz;
  v_records jsonb;
  v_max_seen timestamptz;
  v_count int;
  v_webhook_id uuid;
BEGIN
  v_url := current_setting('app.quantivis_webhook_url', true);
  IF v_url IS NULL OR v_url = '' THEN
    v_url := 'https://itpwpnwzzitkelffttyx.supabase.co/functions/v1/webhook-ingest';
  END IF;

  SELECT COALESCE(to_timestamp(value_int / 1000.0), now() - interval '7 days')
    INTO v_last_pushed
  FROM backfill_state WHERE key = 'quantivis_last_metric_push';
  IF v_last_pushed IS NULL THEN v_last_pushed := now() - interval '7 days'; END IF;

  WITH fresh AS (
    SELECT 
      COALESCE(iso3, 'WLD') AS country,
      to_char(COALESCE(period::date, created_at::date), 'YYYY-MM-DD') AS date,
      metric_name AS indicator,
      value,
      created_at
    FROM normalized_metrics
    WHERE created_at > v_last_pushed
      AND value IS NOT NULL
      AND metric_name IS NOT NULL
    ORDER BY created_at ASC
    LIMIT p_limit
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
  VALUES ('quantivis_last_metric_push', (extract(epoch from v_max_seen) * 1000)::bigint, now())
  ON CONFLICT (key) DO UPDATE SET value_int = EXCLUDED.value_int, updated_at = now();

  RETURN jsonb_build_object('ok', true, 'pushed', v_count, 'webhook_id', v_webhook_id, 'cursor', v_max_seen);
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_quantivis_event_batch(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_last_pushed timestamptz;
  v_records jsonb;
  v_max_seen timestamptz;
  v_count int;
  v_webhook_id uuid;
BEGIN
  v_url := current_setting('app.quantivis_webhook_url', true);
  IF v_url IS NULL OR v_url = '' THEN
    v_url := 'https://itpwpnwzzitkelffttyx.supabase.co/functions/v1/webhook-ingest';
  END IF;

  SELECT COALESCE(to_timestamp(value_int / 1000.0), now() - interval '7 days')
    INTO v_last_pushed
  FROM backfill_state WHERE key = 'quantivis_last_event_push';
  IF v_last_pushed IS NULL THEN v_last_pushed := now() - interval '7 days'; END IF;

  WITH fresh AS (
    SELECT
      COALESCE(country_iso3, iso3, 'WLD') AS country,
      to_char(COALESCE(occurred_at::date, started_at::date, created_at::date), 'YYYY-MM-DD') AS date,
      COALESCE(event_type, 'event') AS indicator,
      COALESCE(severity, 1)::numeric AS value,
      created_at
    FROM normalized_events
    WHERE created_at > v_last_pushed
      AND COALESCE(severity, 0) >= 3
    ORDER BY created_at ASC
    LIMIT p_limit
  )
  SELECT jsonb_agg(jsonb_build_object('country', country, 'date', date, 'indicator', indicator, 'value', value)),
         MAX(created_at), COUNT(*)
  INTO v_records, v_max_seen, v_count FROM fresh;

  IF v_count = 0 OR v_records IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'pushed', 0, 'reason', 'no fresh events');
  END IF;

  INSERT INTO quantivis_webhook_queue (event_type, payload, target_url)
  VALUES ('event_signal', jsonb_build_object('records', v_records), v_url)
  RETURNING id INTO v_webhook_id;

  INSERT INTO backfill_state (key, value_int, updated_at)
  VALUES ('quantivis_last_event_push', (extract(epoch from v_max_seen) * 1000)::bigint, now())
  ON CONFLICT (key) DO UPDATE SET value_int = EXCLUDED.value_int, updated_at = now();

  RETURN jsonb_build_object('ok', true, 'pushed', v_count, 'webhook_id', v_webhook_id);
END;
$$;