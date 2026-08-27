-- AICIS ML/learning SECURITY DEFINER search-path hardening
--
-- Current Supabase security guidance recommends an empty search_path for
-- SECURITY DEFINER functions and fully qualified object references. These
-- functions already reference application relations/functions through public.*;
-- keep pg_catalog implicit and remove mutable schema lookup from the definer
-- execution context.

ALTER FUNCTION public.realize_risk_predictions(integer)
  SET search_path = '';

ALTER FUNCTION public.infer_risk_probabilities(integer)
  SET search_path = '';

ALTER FUNCTION public.prepare_ml_training_manifest(uuid, integer, text, text)
  SET search_path = '';

ALTER FUNCTION public.promote_ml_model_candidate(text, uuid, text)
  SET search_path = '';

ALTER FUNCTION public.repartition_training_dataset_aicis(integer)
  SET search_path = '';

ALTER FUNCTION public.repartition_training_dataset_on_completion()
  SET search_path = '';

ALTER FUNCTION public.set_training_dataset_version_truth_metadata()
  SET search_path = '';

-- Reassert the privileged RPC ACLs after ALTER FUNCTION so future reviewers can
-- verify the authorization contract in the same migration that hardens lookup.
REVOKE ALL ON FUNCTION public.realize_risk_predictions(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.realize_risk_predictions(integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.infer_risk_probabilities(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.infer_risk_probabilities(integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.prepare_ml_training_manifest(uuid, integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_ml_training_manifest(uuid, integer, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.promote_ml_model_candidate(text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_ml_model_candidate(text, uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.repartition_training_dataset_aicis(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repartition_training_dataset_aicis(integer)
  TO service_role;
