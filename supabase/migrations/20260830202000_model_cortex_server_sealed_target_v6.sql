-- AICIS Model Cortex Server-Sealed Target Contract v6
--
-- Due-diligence repair: a caller must not be able to backdate issued_at or choose
-- the target fingerprint. The database establishes issuance/creation time and
-- computes the canonical target fingerprint itself.
--
-- This is additive hardening only; it does not create any target contracts by
-- itself and does not activate prediction writers.

CREATE OR REPLACE FUNCTION public.validate_aicis_model_prediction_target_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz;
  v_prediction_exists boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'sealed Model Cortex target contracts are immutable';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.aicis_model_predictions p
    WHERE p.id::text = NEW.prediction_id
  ) INTO v_prediction_exists;

  IF NOT v_prediction_exists THEN
    RAISE EXCEPTION 'Model Cortex prediction % does not exist', NEW.prediction_id;
  END IF;

  -- Server authority establishes when the target became sealed. Caller-supplied
  -- issued_at/created_at/fingerprint values are deliberately ignored so a target
  -- cannot be backdated after learning an outcome.
  v_now := clock_timestamp();
  NEW.issued_at := v_now;
  NEW.created_at := v_now;

  IF NEW.forecast_horizon_at IS NOT NULL AND NEW.forecast_horizon_at < v_now THEN
    RAISE EXCEPTION 'forecast_horizon_at cannot precede server-sealed issuance time';
  END IF;

  NEW.target_fingerprint_sha256 := public.aicis_model_target_fingerprint(
    NEW.prediction_id,
    NEW.issued_at,
    NEW.target_definition,
    NEW.target_semantics,
    NEW.target_version,
    NEW.resolution_rule,
    NEW.resolution_rule_version,
    NEW.forecast_horizon_at
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_aicis_model_prediction_target_contract() FROM PUBLIC;

COMMENT ON FUNCTION public.validate_aicis_model_prediction_target_contract() IS
  'Server-seals Model Cortex target contracts: issued_at and created_at are database time and target_fingerprint_sha256 is database-computed. Caller backdating/fingerprint assertion is not trusted.';

-- The trigger created by evidence-integrity-v2 remains attached to this function
-- name and therefore automatically receives the stronger v6 behavior.
