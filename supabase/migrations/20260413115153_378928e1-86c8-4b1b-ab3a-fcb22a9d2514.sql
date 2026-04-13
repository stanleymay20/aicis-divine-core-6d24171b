
CREATE OR REPLACE FUNCTION public.trigger_village_unify()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  curr_offset INT;
BEGIN
  SELECT value_int INTO curr_offset FROM backfill_state WHERE key = 'village_offset';
  IF curr_offset IS NULL THEN
    INSERT INTO backfill_state (key, value_int) VALUES ('village_offset', 0);
    curr_offset := 0;
  END IF;
  IF curr_offset >= 2600000 THEN
    PERFORM cron.unschedule('planetary-village-unify');
    RETURN;
  END IF;
  
  PERFORM net.http_post(
    url := 'https://psonnnuhjjskrdazrakk.supabase.co/functions/v1/planetary-backfill',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzb25ubnVoampza3JkYXpyYWtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2OTU0NzAsImV4cCI6MjA3NTI3MTQ3MH0.7ZqxEzVc9mVLJrbI5HgesAmKaHWlNt9oB4lZta_in6o"}'::jsonb,
    body := format('{"action":"unify_legacy","source":"village_indicators","offset":%s,"limit":1000}', curr_offset)::jsonb
  );
  
  UPDATE backfill_state SET value_int = curr_offset + 1000, updated_at = now() WHERE key = 'village_offset';
END;
$fn$;
