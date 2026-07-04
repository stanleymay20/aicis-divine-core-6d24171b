CREATE OR REPLACE FUNCTION public.ledger_trg_early_warning()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.ledger_append('early_warning',
    jsonb_build_object(
      'id', NEW.id,
      'warning_kind', NEW.warning_kind,
      'event_type', NEW.event_type,
      'subtype', NEW.subtype,
      'severity', NEW.severity,
      'iso3', NEW.iso3,
      'first_detected_at', NEW.first_detected_at,
      'last_updated_at', NEW.last_updated_at));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block inserts due to ledger failures
  RETURN NEW;
END;$function$;