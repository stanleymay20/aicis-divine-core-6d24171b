
-- Function to advance WB batch ingestion
CREATE OR REPLACE FUNCTION public.trigger_wb_ingest()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  batch_idx INT;
BEGIN
  SELECT value_int INTO batch_idx FROM backfill_state WHERE key = 'wb_batch_index';
  IF batch_idx IS NULL OR batch_idx >= 73 THEN
    PERFORM cron.unschedule('planetary-wb-ingest');
    RETURN;
  END IF;
  
  PERFORM net.http_post(
    url := 'https://psonnnuhjjskrdazrakk.supabase.co/functions/v1/planetary-backfill',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzb25ubnVoampza3JkYXpyYWtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2OTU0NzAsImV4cCI6MjA3NTI3MTQ3MH0.7ZqxEzVc9mVLJrbI5HgesAmKaHWlNt9oB4lZta_in6o"}'::jsonb,
    body := format('{"action":"bulk_ingest","batch_index":%s,"batch_size":2,"date_range":"2000:2024"}', batch_idx)::jsonb
  );
  
  UPDATE backfill_state SET value_int = batch_idx + 1, updated_at = now() WHERE key = 'wb_batch_index';
END;
$fn$;

-- Function to advance legacy unification
CREATE OR REPLACE FUNCTION public.trigger_legacy_unify()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  curr_offset INT;
BEGIN
  SELECT value_int INTO curr_offset FROM backfill_state WHERE key = 'legacy_offset';
  IF curr_offset IS NULL OR curr_offset >= 95000 THEN
    PERFORM cron.unschedule('planetary-legacy-unify');
    RETURN;
  END IF;
  
  PERFORM net.http_post(
    url := 'https://psonnnuhjjskrdazrakk.supabase.co/functions/v1/planetary-backfill',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzb25ubnVoampza3JkYXpyYWtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2OTU0NzAsImV4cCI6MjA3NTI3MTQ3MH0.7ZqxEzVc9mVLJrbI5HgesAmKaHWlNt9oB4lZta_in6o"}'::jsonb,
    body := format('{"action":"unify_legacy","source":"performance_snapshots","offset":%s,"limit":5000}', curr_offset)::jsonb
  );
  
  UPDATE backfill_state SET value_int = curr_offset + 5000, updated_at = now() WHERE key = 'legacy_offset';
END;
$fn$;

-- Function to advance region promotion
CREATE OR REPLACE FUNCTION public.trigger_region_promote()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  curr_offset INT;
BEGIN
  SELECT value_int INTO curr_offset FROM backfill_state WHERE key = 'region_offset';
  IF curr_offset IS NULL THEN
    INSERT INTO backfill_state (key, value_int) VALUES ('region_offset', 0);
    curr_offset := 0;
  END IF;
  IF curr_offset >= 25000 THEN
    PERFORM cron.unschedule('planetary-promote-regions');
    RETURN;
  END IF;
  
  PERFORM net.http_post(
    url := 'https://psonnnuhjjskrdazrakk.supabase.co/functions/v1/planetary-backfill',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzb25ubnVoampza3JkYXpyYWtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2OTU0NzAsImV4cCI6MjA3NTI3MTQ3MH0.7ZqxEzVc9mVLJrbI5HgesAmKaHWlNt9oB4lZta_in6o"}'::jsonb,
    body := format('{"action":"promote_regions","offset":%s,"limit":2000}', curr_offset)::jsonb
  );
  
  UPDATE backfill_state SET value_int = curr_offset + 2000, updated_at = now() WHERE key = 'region_offset';
END;
$fn$;
