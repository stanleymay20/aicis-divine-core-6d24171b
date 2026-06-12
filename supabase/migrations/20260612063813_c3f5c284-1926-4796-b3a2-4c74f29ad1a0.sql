
CREATE OR REPLACE FUNCTION public.ledger_trg_ml_prediction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.ledger_append('ml_prediction',
    jsonb_build_object('id', NEW.id, 'model_version', NEW.model_version,
      'country_iso3', NEW.country_iso3, 'domain', NEW.domain,
      'risk_probability', NEW.risk_probability, 'created_at', NEW.created_at));
  RETURN NEW;
END;$$;

CREATE OR REPLACE FUNCTION public.ledger_trg_ranking_prediction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.ledger_append('ranking_prediction',
    jsonb_build_object('id', NEW.id, 'country_iso3', NEW.country_iso3, 'domain', NEW.domain,
      'risk_probability', NEW.risk_probability, 'model_version', NEW.model_version,
      'generated_at', NEW.generated_at));
  RETURN NEW;
END;$$;

CREATE OR REPLACE FUNCTION public.ledger_trg_recommendation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.ledger_append('recommendation',
    jsonb_build_object('id', NEW.id, 'country_iso3', NEW.country_iso3, 'domain', NEW.domain,
      'intervention_type', NEW.intervention_type, 'urgency', NEW.urgency_window,
      'created_at', NEW.created_at));
  RETURN NEW;
END;$$;

CREATE OR REPLACE FUNCTION public.trg_ledger_recommendation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM append_ledger_entry('recommendation'::ledger_entry_type, jsonb_build_object(
    'id', NEW.id, 'country_iso3', NEW.country_iso3, 'domain', NEW.domain,
    'intervention_type', NEW.intervention_type, 'urgency_window', NEW.urgency_window,
    'created_at', NEW.created_at));
  RETURN NEW;
END $$;
