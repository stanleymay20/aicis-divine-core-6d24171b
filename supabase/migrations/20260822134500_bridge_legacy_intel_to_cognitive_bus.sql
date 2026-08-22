-- Bridge existing AICIS intelligence publishing into the new cognitive event fabric.
-- Legacy intel_events lack the provenance guarantees required by the cognitive core,
-- so they deliberately enter as UNVERIFIED. Verification/promotion happens later.

CREATE OR REPLACE FUNCTION public.bridge_intel_event_to_cognitive_bus()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.aicis_cognitive_events (
    event_type,
    epistemic_status,
    confidence,
    occurred_at,
    observed_at,
    producer,
    payload,
    provenance
  ) VALUES (
    'event.detected',
    'unverified'::public.aicis_epistemic_status,
    0.50,
    now(),
    now(),
    COALESCE(NULLIF(NEW.source_system, ''), 'legacy.intel_events'),
    jsonb_build_object(
      'legacy_table', 'intel_events',
      'legacy_id', NEW.id,
      'division', NEW.division,
      'legacy_event_type', NEW.event_type,
      'severity', NEW.severity,
      'title', NEW.title,
      'description', NEW.description,
      'payload', NEW.payload
    ),
    '[]'::jsonb
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bridge_intel_event_to_cognitive_bus() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bridge_intel_event_to_cognitive_bus() TO service_role;

DROP TRIGGER IF EXISTS trg_bridge_intel_event_to_cognitive_bus ON public.intel_events;
CREATE TRIGGER trg_bridge_intel_event_to_cognitive_bus
AFTER INSERT ON public.intel_events
FOR EACH ROW
EXECUTE FUNCTION public.bridge_intel_event_to_cognitive_bus();
