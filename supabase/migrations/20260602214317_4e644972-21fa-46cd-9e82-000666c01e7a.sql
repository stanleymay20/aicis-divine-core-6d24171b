
-- Hash-chained ledger writer
CREATE OR REPLACE FUNCTION public.append_ledger_entry(p_type ledger_entry_type, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev text;
  v_hash text;
  v_id   uuid;
  v_canonical text;
BEGIN
  SELECT hash INTO v_prev FROM ledger_entries ORDER BY block_number DESC LIMIT 1;
  v_canonical := COALESCE(v_prev, '') || '|' || p_type::text || '|' || p_payload::text || '|' || now()::text;
  v_hash := encode(digest(v_canonical, 'sha256'), 'hex');
  INSERT INTO ledger_entries (entry_type, payload, hash, previous_hash, verified)
  VALUES (p_type, p_payload, v_hash, v_prev, true)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.append_ledger_entry(ledger_entry_type, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.append_ledger_entry(ledger_entry_type, jsonb) TO service_role;

-- Trigger fns
CREATE OR REPLACE FUNCTION public.trg_ledger_export_run() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status IN ('success','succeeded','completed') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM append_ledger_entry('export'::ledger_entry_type, jsonb_build_object(
      'run_id', NEW.id, 'profile_id', NEW.profile_id, 'status', NEW.status,
      'records', COALESCE(NEW.records_exported, 0), 'finished_at', NEW.completed_at));
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.trg_ledger_recommendation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM append_ledger_entry('recommendation'::ledger_entry_type, jsonb_build_object(
    'id', NEW.id, 'iso3', NEW.iso3, 'domain', NEW.domain,
    'intervention_type', NEW.intervention_type, 'urgency_window', NEW.urgency_window,
    'created_at', NEW.created_at));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.trg_ledger_simulation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM append_ledger_entry('simulation'::ledger_entry_type, jsonb_build_object(
    'id', NEW.id, 'scenario_name', NEW.scenario_name, 'shock_domain', NEW.shock_domain,
    'shock_iso3', NEW.shock_iso3, 'p50', NEW.p50, 'created_at', NEW.created_at));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.trg_ledger_prediction_eval() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM append_ledger_entry('prediction'::ledger_entry_type, jsonb_build_object(
    'id', NEW.id, 'created_at', NEW.created_at));
  RETURN NEW;
END $$;

-- Wire triggers (idempotent)
DROP TRIGGER IF EXISTS ledger_on_export_run ON public.export_runs;
CREATE TRIGGER ledger_on_export_run AFTER INSERT OR UPDATE OF status ON public.export_runs
  FOR EACH ROW EXECUTE FUNCTION trg_ledger_export_run();

DROP TRIGGER IF EXISTS ledger_on_recommendation ON public.risk_action_recommendations;
CREATE TRIGGER ledger_on_recommendation AFTER INSERT ON public.risk_action_recommendations
  FOR EACH ROW EXECUTE FUNCTION trg_ledger_recommendation();

DROP TRIGGER IF EXISTS ledger_on_simulation ON public.simulation_runs;
CREATE TRIGGER ledger_on_simulation AFTER INSERT ON public.simulation_runs
  FOR EACH ROW EXECUTE FUNCTION trg_ledger_simulation();

DROP TRIGGER IF EXISTS ledger_on_prediction_eval ON public.forecast_prospective_evaluations;
CREATE TRIGGER ledger_on_prediction_eval AFTER INSERT ON public.forecast_prospective_evaluations
  FOR EACH ROW EXECUTE FUNCTION trg_ledger_prediction_eval();
