
CREATE OR REPLACE FUNCTION public.backfill_metric_entity_iso3(_batch integer DEFAULT 200000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  updated_count int;
BEGIN
  WITH cte AS (
    SELECT nm.id, ce.id AS entity_id
    FROM public.normalized_metrics nm
    JOIN public.canonical_entities ce
      ON ce.iso3 = nm.iso3
     AND ce.entity_type = 'country'
    WHERE nm.entity_id IS NULL
      AND nm.iso3 IS NOT NULL
    LIMIT _batch
  )
  UPDATE public.normalized_metrics nm
  SET entity_id = cte.entity_id
  FROM cte
  WHERE nm.id = cte.id;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$function$;

-- Same fix for events: link to country entity when iso3 known but entity_id missing
CREATE OR REPLACE FUNCTION public.backfill_event_entity_iso3(_batch integer DEFAULT 100000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  updated_count int;
BEGIN
  WITH cte AS (
    SELECT ne.id, ce.id AS entity_id
    FROM public.normalized_events ne
    JOIN public.canonical_entities ce
      ON ce.iso3 = ne.iso3
     AND ce.entity_type = 'country'
    WHERE ne.entity_id IS NULL
      AND ne.iso3 IS NOT NULL
    LIMIT _batch
  )
  UPDATE public.normalized_events ne
  SET entity_id = cte.entity_id
  FROM cte
  WHERE ne.id = cte.id;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$function$;

-- Schedule events linker every 5 min
SELECT cron.unschedule('backfill-event-entity-iso3-5min') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'backfill-event-entity-iso3-5min'
);
SELECT cron.schedule(
  'backfill-event-entity-iso3-5min',
  '*/5 * * * *',
  $$ SELECT public.backfill_event_entity_iso3(100000); $$
);
