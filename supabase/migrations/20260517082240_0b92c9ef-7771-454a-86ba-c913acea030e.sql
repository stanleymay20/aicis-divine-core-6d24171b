-- Fix mutable search_path
ALTER FUNCTION public.lril_touch_updated_at() SET search_path = public, pg_temp;

-- Revoke EXECUTE from anon/authenticated on internal admin SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.backfill_event_entity_iso3(integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.backfill_metric_entity_iso3(integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_task_token(text, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_task_token(text, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_source_iq_scorecard(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.count_api_requests_window(uuid, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_all_source_iq() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_normalized_event_country_codes() FROM anon, authenticated;