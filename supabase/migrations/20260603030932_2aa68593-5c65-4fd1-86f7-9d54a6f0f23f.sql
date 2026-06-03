
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.ledger_append(
  p_entry_type text,
  p_payload jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev text;
  v_hash text;
  v_canonical text;
  v_id uuid;
BEGIN
  SELECT hash INTO v_prev FROM public.ledger_entries
    ORDER BY block_number DESC NULLS LAST, created_at DESC LIMIT 1;
  IF v_prev IS NULL THEN v_prev := 'genesis'; END IF;

  v_canonical := jsonb_build_object(
    'entry_type', p_entry_type,
    'payload', p_payload,
    'previous_hash', v_prev,
    'ts', extract(epoch from now())::bigint
  )::text;

  v_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  INSERT INTO public.ledger_entries (entry_type, payload, previous_hash, hash, verified)
  VALUES (p_entry_type, p_payload, v_prev, v_hash, false)
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ledger_append failed for %: %', p_entry_type, SQLERRM;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.ledger_trg_early_warning() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ledger_append('early_warning',
    jsonb_build_object('id', NEW.id, 'warning_type', NEW.warning_type,
      'severity', NEW.severity, 'iso3', NEW.iso3, 'domain', NEW.domain,
      'detected_at', NEW.detected_at));
  RETURN NEW;
END;$$;

CREATE OR REPLACE FUNCTION public.ledger_trg_recommendation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ledger_append('recommendation',
    jsonb_build_object('id', NEW.id, 'iso3', NEW.iso3, 'domain', NEW.domain,
      'intervention_type', NEW.intervention_type, 'urgency', NEW.urgency_window,
      'created_at', NEW.created_at));
  RETURN NEW;
END;$$;

CREATE OR REPLACE FUNCTION public.ledger_trg_ranking_prediction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ledger_append('ranking_prediction',
    jsonb_build_object('id', NEW.id, 'iso3', NEW.iso3, 'domain', NEW.domain,
      'risk_probability', NEW.risk_probability, 'model_version', NEW.model_version,
      'predicted_at', NEW.predicted_at));
  RETURN NEW;
END;$$;

CREATE OR REPLACE FUNCTION public.ledger_trg_ml_prediction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ledger_append('ml_prediction',
    jsonb_build_object('id', NEW.id, 'model_id', NEW.model_id,
      'iso3', NEW.iso3, 'domain', NEW.domain, 'probability', NEW.probability,
      'created_at', NEW.created_at));
  RETURN NEW;
END;$$;

CREATE OR REPLACE FUNCTION public.ledger_trg_simulation_run() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ledger_append('simulation_run',
    jsonb_build_object('id', NEW.id, 'scenario_name', NEW.scenario_name,
      'created_at', NEW.created_at));
  RETURN NEW;
END;$$;

DO $do$ BEGIN
  IF to_regclass('public.aicis_early_warnings') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ledger_early_warning ON public.aicis_early_warnings;
    CREATE TRIGGER trg_ledger_early_warning AFTER INSERT ON public.aicis_early_warnings
      FOR EACH ROW EXECUTE FUNCTION public.ledger_trg_early_warning();
  END IF;

  IF to_regclass('public.risk_action_recommendations') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ledger_recommendation ON public.risk_action_recommendations;
    CREATE TRIGGER trg_ledger_recommendation AFTER INSERT ON public.risk_action_recommendations
      FOR EACH ROW EXECUTE FUNCTION public.ledger_trg_recommendation();
  END IF;

  IF to_regclass('public.risk_ranking_predictions') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ledger_ranking_prediction ON public.risk_ranking_predictions;
    CREATE TRIGGER trg_ledger_ranking_prediction AFTER INSERT ON public.risk_ranking_predictions
      FOR EACH ROW EXECUTE FUNCTION public.ledger_trg_ranking_prediction();
  END IF;

  IF to_regclass('public.risk_ml_predictions') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ledger_ml_prediction ON public.risk_ml_predictions;
    CREATE TRIGGER trg_ledger_ml_prediction AFTER INSERT ON public.risk_ml_predictions
      FOR EACH ROW EXECUTE FUNCTION public.ledger_trg_ml_prediction();
  END IF;

  IF to_regclass('public.simulation_runs') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ledger_simulation_run ON public.simulation_runs;
    CREATE TRIGGER trg_ledger_simulation_run AFTER INSERT ON public.simulation_runs
      FOR EACH ROW EXECUTE FUNCTION public.ledger_trg_simulation_run();
  END IF;
END $do$;
