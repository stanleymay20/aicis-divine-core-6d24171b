
-- 1) Heal existing drift between iso3 and country_iso3
UPDATE public.normalized_events
   SET country_iso3 = iso3
 WHERE country_iso3 IS NULL AND iso3 IS NOT NULL;

UPDATE public.normalized_events
   SET iso3 = country_iso3
 WHERE iso3 IS NULL AND country_iso3 IS NOT NULL;

-- 2) Keep them in lockstep going forward
CREATE OR REPLACE FUNCTION public.sync_normalized_event_country_codes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.country_iso3 IS NULL AND NEW.iso3 IS NOT NULL THEN
    NEW.country_iso3 := NEW.iso3;
  ELSIF NEW.iso3 IS NULL AND NEW.country_iso3 IS NOT NULL THEN
    NEW.iso3 := NEW.country_iso3;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_event_country_codes ON public.normalized_events;
CREATE TRIGGER trg_sync_event_country_codes
BEFORE INSERT OR UPDATE OF iso3, country_iso3 ON public.normalized_events
FOR EACH ROW EXECUTE FUNCTION public.sync_normalized_event_country_codes();

-- 3) Speed the country-filtered queries the analyst dashboard relies on
CREATE INDEX IF NOT EXISTS idx_normalized_events_country_iso3_occurred_at
  ON public.normalized_events (country_iso3, occurred_at DESC)
  WHERE country_iso3 IS NOT NULL;
