REVOKE EXECUTE ON FUNCTION public.backfill_event_entity_iso3(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backfill_metric_entity_iso3(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_task_token(text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_task_token(text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_source_iq_scorecard(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.count_api_requests_window(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_all_source_iq() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_normalized_event_country_codes() FROM PUBLIC;