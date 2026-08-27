-- AICIS legacy -> cognitive bus truth floor v2.
--
-- intel_events contains publication/creation timestamps, not a guaranteed real-world
-- event occurrence timestamp. The bridge therefore preserves occurrence time as
-- unknown rather than converting publication/bridge time into event time.

ALTER TABLE public.aicis_cognitive_events
  ALTER COLUMN occurred_at DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS time_semantics text;

UPDATE public.aicis_cognitive_events
SET time_semantics = 'legacy_event_time_semantics_unverified'
WHERE time_semantics IS NULL;

COMMENT ON COLUMN public.aicis_cognitive_events.occurred_at IS
  'Nullable real-world/source event occurrence time. NULL means occurrence time is unknown; observed_at is ingestion/observation time and must not be substituted.';
COMMENT ON COLUMN public.aicis_cognitive_events.time_semantics IS
  'Describes what occurred_at means and whether it is observed, source-reported, derived, or unknown.';

CREATE OR REPLACE FUNCTION public.bridge_intel_event_to_cognitive_bus()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_observed_at timestamptz := now();
BEGIN
  INSERT INTO public.aicis_cognitive_events (
    event_type,
    epistemic_status,
    confidence,
    confidence_semantics,
    occurred_at,
    observed_at,
    time_semantics,
    producer,
    payload,
    provenance
  ) VALUES (
    'event.detected',
    'unverified'::public.aicis_epistemic_status,
    NULL,
    'unknown_legacy_event_unquantified',
    NULL,
    v_observed_at,
    'occurrence_time_unknown; legacy_published_at_is_publication_time_not_event_time',
    COALESCE(NULLIF(NEW.source_system, ''), 'legacy.intel_events'),
    jsonb_build_object(
      'legacy_table', 'intel_events',
      'legacy_id', NEW.id,
      'division', NEW.division,
      'legacy_event_type', NEW.event_type,
      'severity', NEW.severity,
      'title', NEW.title,
      'description', NEW.description,
      'payload', NEW.payload,
      'legacy_published_at', NEW.published_at,
      'legacy_created_at', NEW.created_at,
      'legacy_expires_at', NEW.expires_at,
      'event_occurrence_time_known', false
    ),
    jsonb_build_array(jsonb_build_object(
      'sourceId', 'intel_events:' || NEW.id::text,
      'sourceType', 'legacy-internal-event-record',
      'observedAt', v_observed_at,
      'extractor', 'bridge_intel_event_to_cognitive_bus',
      'extractorVersion', '2',
      'sourceProvenanceStatus', 'legacy_external_provenance_not_guaranteed'
    ))
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bridge_intel_event_to_cognitive_bus() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bridge_intel_event_to_cognitive_bus() TO service_role;
