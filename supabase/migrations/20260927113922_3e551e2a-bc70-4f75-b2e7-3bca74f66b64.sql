CREATE OR REPLACE FUNCTION public.trg_ledger_export_run()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status::text = 'success' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM append_ledger_entry('export'::ledger_entry_type, jsonb_build_object(
      'run_id', NEW.id, 'profile_id', NEW.profile_id, 'status', NEW.status::text,
      'records', COALESCE(NEW.records_exported, 0), 'finished_at', NEW.finished_at));
  END IF;
  RETURN NEW;
END $function$;

UPDATE public.export_runs SET status='error', error='zombie_timeout: run never completed (stuck since May 2026)', finished_at=now()
WHERE status='running' AND started_at < now() - interval '1 hour';