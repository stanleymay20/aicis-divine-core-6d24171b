-- AICIS Telemetry Observation Truth Floor v1
--
-- A source timestamp, analytical confidence score, and anomaly screen are distinct
-- evidence types. Missing values must never become current time or numeric zero.
-- Historical rows are preserved, but legacy analytical scores are quarantined
-- because old table defaults made it impossible to distinguish true zero from
-- omitted/unassessed input.

ALTER TABLE public.telemetry_observations
  ALTER COLUMN observed_at DROP DEFAULT,
  ALTER COLUMN confidence_score DROP DEFAULT,
  ALTER COLUMN anomaly_score DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS observed_at_semantics text,
  ADD COLUMN IF NOT EXISTS reported_confidence_score numeric,
  ADD COLUMN IF NOT EXISTS confidence_score_semantics text,
  ADD COLUMN IF NOT EXISTS reported_anomaly_score numeric,
  ADD COLUMN IF NOT EXISTS anomaly_score_semantics text,
  ADD COLUMN IF NOT EXISTS observation_value_semantics text,
  ADD COLUMN IF NOT EXISTS observation_unit_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unknown';

-- Historical observation timestamps remain available for chronology/audit, but
-- are not retrospectively declared provider observation times. Consumers that
-- require event/source time must inspect observed_at_semantics.
UPDATE public.telemetry_observations
SET observed_at_semantics = COALESCE(
  observed_at_semantics,
  CASE WHEN observed_at IS NOT NULL THEN 'legacy_observation_timestamp_semantics_unverified' END
);

-- Historical confidence/anomaly values may be old schema defaults. Preserve the
-- number for audit and withhold it from the canonical analytical field.
UPDATE public.telemetry_observations
SET
  reported_confidence_score = COALESCE(reported_confidence_score, confidence_score),
  confidence_score = NULL,
  confidence_score_semantics = COALESCE(
    confidence_score_semantics,
    'withheld_legacy_analytical_confidence_semantics_unverified'
  )
WHERE confidence_score IS NOT NULL;

UPDATE public.telemetry_observations
SET
  reported_anomaly_score = COALESCE(reported_anomaly_score, anomaly_score),
  anomaly_score = NULL,
  anomaly_score_semantics = COALESCE(
    anomaly_score_semantics,
    'withheld_legacy_anomaly_score_semantics_unverified'
  )
WHERE anomaly_score IS NOT NULL;

UPDATE public.telemetry_observations
SET evidence_status = 'legacy_unknown'
WHERE evidence_status IS NULL OR evidence_status = 'legacy_unknown';

CREATE OR REPLACE FUNCTION public.aicis_telemetry_semantics_unusable_v1(p_semantics text)
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
    OR lower(p_semantics) LIKE '%unlabeled%'
    OR lower(p_semantics) LIKE '%withheld%';
$$;

REVOKE ALL ON FUNCTION public.aicis_telemetry_semantics_unusable_v1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aicis_telemetry_semantics_unusable_v1(text) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_telemetry_observation_truth_floor_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- A writer may preserve a source/provider timestamp only by declaring what the
  -- timestamp represents. Retrieval/derivation time is allowed when explicitly
  -- labelled as such; it must not be mistaken for source event time.
  IF NEW.observed_at IS NOT NULL
     AND public.aicis_telemetry_semantics_unusable_v1(NEW.observed_at_semantics) THEN
    NEW.reported_observed_at := COALESCE(NEW.reported_observed_at, NEW.observed_at);
    NEW.observed_at := NULL;
    NEW.observed_at_semantics := 'withheld_unlabeled_telemetry_timestamp';
  END IF;

  IF NEW.confidence_score IS NOT NULL
     AND public.aicis_telemetry_semantics_unusable_v1(NEW.confidence_score_semantics) THEN
    NEW.reported_confidence_score := COALESCE(NEW.reported_confidence_score, NEW.confidence_score);
    NEW.confidence_score := NULL;
    NEW.confidence_score_semantics := 'withheld_unlabeled_analytical_confidence';
  END IF;

  IF NEW.anomaly_score IS NOT NULL
     AND public.aicis_telemetry_semantics_unusable_v1(NEW.anomaly_score_semantics) THEN
    NEW.reported_anomaly_score := COALESCE(NEW.reported_anomaly_score, NEW.anomaly_score);
    NEW.anomaly_score := NULL;
    NEW.anomaly_score_semantics := 'withheld_unlabeled_anomaly_score';
  END IF;

  IF NEW.confidence_score IS NULL
     AND (NEW.confidence_score_semantics IS NULL OR btrim(NEW.confidence_score_semantics) = '') THEN
    NEW.confidence_score_semantics := 'not_assessed_at_ingestion';
  END IF;

  IF NEW.anomaly_score IS NULL
     AND (NEW.anomaly_score_semantics IS NULL OR btrim(NEW.anomaly_score_semantics) = '') THEN
    NEW.anomaly_score_semantics := 'not_assessed_at_ingestion';
  END IF;

  IF NEW.observed_at IS NULL
     AND (NEW.observed_at_semantics IS NULL OR btrim(NEW.observed_at_semantics) = '') THEN
    NEW.observed_at_semantics := 'source_observation_time_unknown';
  END IF;

  IF NEW.observation_value_semantics IS NULL OR btrim(NEW.observation_value_semantics) = '' THEN
    NEW.observation_value_semantics := 'writer_semantics_not_declared';
  END IF;

  IF NEW.evidence_status IS NULL OR btrim(NEW.evidence_status) = '' THEN
    NEW.evidence_status := 'unassessed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_telemetry_observation_truth_floor_v1
  ON public.telemetry_observations;
CREATE TRIGGER trg_guard_telemetry_observation_truth_floor_v1
  BEFORE INSERT OR UPDATE ON public.telemetry_observations
  FOR EACH ROW EXECUTE FUNCTION public.guard_telemetry_observation_truth_floor_v1();

REVOKE ALL ON FUNCTION public.guard_telemetry_observation_truth_floor_v1() FROM PUBLIC;

COMMENT ON COLUMN public.telemetry_observations.observed_at IS
  'Nullable source/provider observation time or explicitly labelled derivation/retrieval time. Interpret only through observed_at_semantics; missing time remains NULL.';
COMMENT ON COLUMN public.telemetry_observations.confidence_score IS
  'Nullable analytical confidence only when confidence_score_semantics defines a governed meaning. Provider quality is separate.';
COMMENT ON COLUMN public.telemetry_observations.anomaly_score IS
  'Nullable anomaly/screen score. It is not a probability; interpret only through anomaly_score_semantics.';
COMMENT ON COLUMN public.telemetry_observations.reported_confidence_score IS
  'Raw/legacy numeric confidence preserved when canonical semantics are absent or untrusted.';
COMMENT ON COLUMN public.telemetry_observations.reported_anomaly_score IS
  'Raw/legacy numeric anomaly score preserved when canonical semantics are absent or untrusted.';
COMMENT ON FUNCTION public.guard_telemetry_observation_truth_floor_v1() IS
  'Fail-closed telemetry persistence guard preventing omitted timestamps/confidence/anomaly values from becoming current-time or zero-valued canonical evidence.';
