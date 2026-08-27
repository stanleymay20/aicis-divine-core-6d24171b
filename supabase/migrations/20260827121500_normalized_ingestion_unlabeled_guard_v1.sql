-- AICIS Normalized Ingestion Unlabeled-Value Guard v1
--
-- Compatibility bridge for legacy/existing provider writers.
-- Writers may still send historical confidence/freshness/time fields before every
-- adapter has been upgraded to the new semantic contract. We preserve those raw
-- values but do not allow an unlabeled value to masquerade as canonical evidence.

ALTER TABLE public.normalized_metrics
  ADD COLUMN IF NOT EXISTS reported_confidence double precision,
  ADD COLUMN IF NOT EXISTS reported_freshness_score double precision,
  ADD COLUMN IF NOT EXISTS reported_provenance_observed_at timestamptz;

ALTER TABLE public.normalized_events
  ADD COLUMN IF NOT EXISTS reported_confidence double precision,
  ADD COLUMN IF NOT EXISTS reported_freshness_score double precision,
  ADD COLUMN IF NOT EXISTS reported_started_at timestamptz;

ALTER TABLE public.entity_metric_links
  ADD COLUMN IF NOT EXISTS reported_confidence double precision;

ALTER TABLE public.entity_event_links
  ADD COLUMN IF NOT EXISTS reported_confidence double precision;

ALTER TABLE public.data_provenance
  ADD COLUMN IF NOT EXISTS reported_freshness_score double precision,
  ADD COLUMN IF NOT EXISTS reported_quality_score double precision,
  ADD COLUMN IF NOT EXISTS reported_confidence double precision,
  ADD COLUMN IF NOT EXISTS reported_entity_match_confidence double precision;

CREATE OR REPLACE FUNCTION public.aicis_semantics_are_unlabeled(p_semantics text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_semantics IS NULL
    OR btrim(p_semantics) = ''
    OR lower(p_semantics) LIKE '%legacy%'
    OR lower(p_semantics) LIKE '%unknown%'
    OR lower(p_semantics) LIKE '%unverified%'
    OR lower(p_semantics) LIKE '%unspecified%'
    OR lower(p_semantics) LIKE '%not_quantified%';
$$;

REVOKE ALL ON FUNCTION public.aicis_semantics_are_unlabeled(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aicis_semantics_are_unlabeled(text) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_normalized_metric_truth_floor_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.confidence IS NOT NULL AND public.aicis_semantics_are_unlabeled(NEW.confidence_semantics) THEN
    NEW.reported_confidence := COALESCE(NEW.reported_confidence, NEW.confidence);
    NEW.confidence := NULL;
    NEW.confidence_semantics := 'withheld_unlabeled_numeric_confidence';
  END IF;

  IF NEW.freshness_score IS NOT NULL AND public.aicis_semantics_are_unlabeled(NEW.freshness_semantics) THEN
    NEW.reported_freshness_score := COALESCE(NEW.reported_freshness_score, NEW.freshness_score);
    NEW.freshness_score := NULL;
    NEW.freshness_semantics := 'withheld_unlabeled_freshness_score';
  END IF;

  IF NEW.provenance_observed_at IS NOT NULL
     AND public.aicis_semantics_are_unlabeled(NEW.provenance_observed_at_semantics) THEN
    NEW.reported_provenance_observed_at := COALESCE(
      NEW.reported_provenance_observed_at,
      NEW.provenance_observed_at
    );
    NEW.provenance_observed_at := NULL;
    NEW.provenance_observed_at_semantics := 'withheld_unlabeled_source_observation_time';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_normalized_metric_truth_floor_v1 ON public.normalized_metrics;
CREATE TRIGGER trg_guard_normalized_metric_truth_floor_v1
BEFORE INSERT OR UPDATE ON public.normalized_metrics
FOR EACH ROW EXECUTE FUNCTION public.guard_normalized_metric_truth_floor_v1();

CREATE OR REPLACE FUNCTION public.guard_normalized_event_truth_floor_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.confidence IS NOT NULL AND public.aicis_semantics_are_unlabeled(NEW.confidence_semantics) THEN
    NEW.reported_confidence := COALESCE(NEW.reported_confidence, NEW.confidence);
    NEW.confidence := NULL;
    NEW.confidence_semantics := 'withheld_unlabeled_numeric_confidence';
  END IF;

  IF NEW.freshness_score IS NOT NULL AND public.aicis_semantics_are_unlabeled(NEW.freshness_semantics) THEN
    NEW.reported_freshness_score := COALESCE(NEW.reported_freshness_score, NEW.freshness_score);
    NEW.freshness_score := NULL;
    NEW.freshness_semantics := 'withheld_unlabeled_freshness_score';
  END IF;

  IF NEW.started_at IS NOT NULL AND public.aicis_semantics_are_unlabeled(NEW.started_at_semantics) THEN
    NEW.reported_started_at := COALESCE(NEW.reported_started_at, NEW.started_at);
    NEW.started_at := NULL;
    NEW.started_at_semantics := 'withheld_unlabeled_source_event_start_time';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_normalized_event_truth_floor_v1 ON public.normalized_events;
CREATE TRIGGER trg_guard_normalized_event_truth_floor_v1
BEFORE INSERT OR UPDATE ON public.normalized_events
FOR EACH ROW EXECUTE FUNCTION public.guard_normalized_event_truth_floor_v1();

CREATE OR REPLACE FUNCTION public.guard_entity_metric_link_truth_floor_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.confidence IS NOT NULL AND public.aicis_semantics_are_unlabeled(NEW.confidence_semantics) THEN
    NEW.reported_confidence := COALESCE(NEW.reported_confidence, NEW.confidence);
    NEW.confidence := NULL;
    NEW.confidence_semantics := 'withheld_unlabeled_entity_link_confidence';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_entity_metric_link_truth_floor_v1 ON public.entity_metric_links;
CREATE TRIGGER trg_guard_entity_metric_link_truth_floor_v1
BEFORE INSERT OR UPDATE ON public.entity_metric_links
FOR EACH ROW EXECUTE FUNCTION public.guard_entity_metric_link_truth_floor_v1();

CREATE OR REPLACE FUNCTION public.guard_entity_event_link_truth_floor_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.confidence IS NOT NULL AND public.aicis_semantics_are_unlabeled(NEW.confidence_semantics) THEN
    NEW.reported_confidence := COALESCE(NEW.reported_confidence, NEW.confidence);
    NEW.confidence := NULL;
    NEW.confidence_semantics := 'withheld_unlabeled_entity_link_confidence';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_entity_event_link_truth_floor_v1 ON public.entity_event_links;
CREATE TRIGGER trg_guard_entity_event_link_truth_floor_v1
BEFORE INSERT OR UPDATE ON public.entity_event_links
FOR EACH ROW EXECUTE FUNCTION public.guard_entity_event_link_truth_floor_v1();

CREATE OR REPLACE FUNCTION public.guard_data_provenance_truth_floor_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.freshness_score IS NOT NULL AND public.aicis_semantics_are_unlabeled(NEW.freshness_semantics) THEN
    NEW.reported_freshness_score := COALESCE(NEW.reported_freshness_score, NEW.freshness_score);
    NEW.freshness_score := NULL;
    NEW.freshness_semantics := 'withheld_unlabeled_freshness_score';
  END IF;

  IF NEW.quality_score IS NOT NULL AND public.aicis_semantics_are_unlabeled(NEW.quality_semantics) THEN
    NEW.reported_quality_score := COALESCE(NEW.reported_quality_score, NEW.quality_score);
    NEW.quality_score := NULL;
    NEW.quality_semantics := 'withheld_unlabeled_quality_score';
  END IF;

  IF NEW.confidence IS NOT NULL AND public.aicis_semantics_are_unlabeled(NEW.confidence_semantics) THEN
    NEW.reported_confidence := COALESCE(NEW.reported_confidence, NEW.confidence);
    NEW.confidence := NULL;
    NEW.confidence_semantics := 'withheld_unlabeled_numeric_confidence';
  END IF;

  IF NEW.entity_match_confidence IS NOT NULL
     AND public.aicis_semantics_are_unlabeled(NEW.entity_match_confidence_semantics) THEN
    NEW.reported_entity_match_confidence := COALESCE(
      NEW.reported_entity_match_confidence,
      NEW.entity_match_confidence
    );
    NEW.entity_match_confidence := NULL;
    NEW.entity_match_confidence_semantics := 'withheld_unlabeled_entity_match_confidence';
  END IF;

  IF NEW.observed_at_semantics IS NULL OR btrim(NEW.observed_at_semantics) = '' THEN
    NEW.observed_at_semantics := 'system_ingestion_observation_time';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_data_provenance_truth_floor_v1 ON public.data_provenance;
CREATE TRIGGER trg_guard_data_provenance_truth_floor_v1
BEFORE INSERT OR UPDATE ON public.data_provenance
FOR EACH ROW EXECUTE FUNCTION public.guard_data_provenance_truth_floor_v1();

COMMENT ON COLUMN public.normalized_metrics.reported_confidence IS
  'Raw numeric confidence received from a writer when canonical semantics were absent/untrusted. Preserved for audit only.';
COMMENT ON COLUMN public.normalized_metrics.reported_provenance_observed_at IS
  'Raw timestamp received in the source-observation field when time semantics were absent/untrusted. Preserved for audit only.';
COMMENT ON COLUMN public.normalized_events.reported_started_at IS
  'Raw event-start timestamp received without trusted source-time semantics. Preserved for audit only; canonical started_at is withheld.';
COMMENT ON FUNCTION public.aicis_semantics_are_unlabeled(text) IS
  'Returns true for absent/legacy/unknown/unverified/unspecified numeric or time semantics so legacy writers cannot silently create trusted canonical evidence.';
