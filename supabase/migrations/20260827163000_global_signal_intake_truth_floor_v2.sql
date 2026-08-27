-- AICIS global-signal intake truth floor v2
--
-- The fast intake layer historically supplied neutral-looking defaults and used
-- publication/detection timestamps interchangeably with event occurrence time.
-- It also grouped reports by lexical similarity before event identity had been
-- established. This migration makes those states explicit and fail-closed.

ALTER TABLE public.global_signals
  ALTER COLUMN confidence_score DROP NOT NULL,
  ALTER COLUMN confidence_score DROP DEFAULT,
  ALTER COLUMN impact_score DROP NOT NULL,
  ALTER COLUMN impact_score DROP DEFAULT,
  ALTER COLUMN urgency_score DROP NOT NULL,
  ALTER COLUMN urgency_score DROP DEFAULT,
  ALTER COLUMN source_count DROP NOT NULL,
  ALTER COLUMN source_count DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS impact_score_semantics text,
  ADD COLUMN IF NOT EXISTS reported_impact_score smallint CHECK (
    reported_impact_score IS NULL OR (reported_impact_score >= 0 AND reported_impact_score <= 100)
  ),
  ADD COLUMN IF NOT EXISTS urgency_score_semantics text,
  ADD COLUMN IF NOT EXISTS reported_urgency_score smallint CHECK (
    reported_urgency_score IS NULL OR (reported_urgency_score >= 0 AND reported_urgency_score <= 100)
  ),
  ADD COLUMN IF NOT EXISTS occurred_at_semantics text,
  ADD COLUMN IF NOT EXISTS reported_occurred_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_published_at_semantics text,
  ADD COLUMN IF NOT EXISTS first_detected_at_semantics text,
  ADD COLUMN IF NOT EXISTS reported_first_detected_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_count_semantics text,
  ADD COLUMN IF NOT EXISTS reported_source_count integer CHECK (
    reported_source_count IS NULL OR reported_source_count >= 0
  ),
  ADD COLUMN IF NOT EXISTS source_grouping_semantics text,
  ADD COLUMN IF NOT EXISTS merged_source_count_semantics text,
  ADD COLUMN IF NOT EXISTS reported_merged_source_count integer CHECK (
    reported_merged_source_count IS NULL OR reported_merged_source_count >= 0
  ),
  ADD COLUMN IF NOT EXISTS unverified_related_source_references jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Historical values are preserved rather than retroactively reclassified as
-- valid. Their semantics remain explicitly legacy/unverified until a governed
-- recomputation establishes something stronger.
UPDATE public.global_signals
SET
  impact_score_semantics = COALESCE(
    impact_score_semantics,
    CASE WHEN impact_score IS NOT NULL THEN 'legacy_impact_score_semantics_unverified' END
  ),
  urgency_score_semantics = COALESCE(
    urgency_score_semantics,
    CASE WHEN urgency_score IS NOT NULL THEN 'legacy_urgency_score_semantics_unverified' END
  ),
  occurred_at_semantics = COALESCE(
    occurred_at_semantics,
    CASE WHEN occurred_at IS NOT NULL THEN 'legacy_occurrence_timestamp_semantics_unverified' END
  ),
  first_detected_at_semantics = COALESCE(
    first_detected_at_semantics,
    'legacy_first_detected_timestamp_semantics_unverified'
  ),
  source_count_semantics = COALESCE(
    source_count_semantics,
    CASE WHEN source_count IS NOT NULL THEN 'legacy_source_count_semantics_unverified' END
  ),
  merged_source_count_semantics = COALESCE(
    merged_source_count_semantics,
    CASE WHEN merged_source_count IS NOT NULL THEN 'legacy_merged_source_count_semantics_unverified' END
  ),
  source_grouping_semantics = COALESCE(
    source_grouping_semantics,
    'legacy_report_grouping_semantics_unverified'
  );

CREATE OR REPLACE FUNCTION public.guard_global_signal_intake_truth_v2()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  ref_count integer := 0;
  grouping_changed boolean := false;
BEGIN
  -- A numeric impact or urgency value is unusable unless the writer declares
  -- what the number actually means. Preserve the raw number for audit.
  IF NEW.impact_score IS NOT NULL
     AND public.aicis_signal_semantics_unusable_v1(NEW.impact_score_semantics) THEN
    NEW.reported_impact_score := COALESCE(NEW.reported_impact_score, NEW.impact_score);
    NEW.impact_score := NULL;
    NEW.impact_score_semantics := 'withheld_unlabeled_impact_score';
  END IF;

  IF NEW.urgency_score IS NOT NULL
     AND public.aicis_signal_semantics_unusable_v1(NEW.urgency_score_semantics) THEN
    NEW.reported_urgency_score := COALESCE(NEW.reported_urgency_score, NEW.urgency_score);
    NEW.urgency_score := NULL;
    NEW.urgency_score_semantics := 'withheld_unlabeled_urgency_score';
  END IF;

  -- Event occurrence time must be explicitly identified as such. A publication
  -- timestamp, retrieval timestamp, or writer guess cannot silently become the
  -- event time.
  IF NEW.occurred_at IS NOT NULL
     AND public.aicis_signal_semantics_unusable_v1(NEW.occurred_at_semantics) THEN
    NEW.reported_occurred_at := COALESCE(NEW.reported_occurred_at, NEW.occurred_at);
    NEW.occurred_at := NULL;
    NEW.occurred_at_semantics := 'withheld_unlabeled_occurrence_timestamp';
  END IF;

  -- first_detected_at is an AICIS operational timestamp. New inserts from older
  -- writers sometimes supplied a source publication timestamp here. Preserve
  -- that raw value, but canonicalize detection to the actual ingestion clock.
  IF TG_OP = 'INSERT' THEN
    IF public.aicis_signal_semantics_unusable_v1(NEW.first_detected_at_semantics) THEN
      NEW.reported_first_detected_at := COALESCE(NEW.reported_first_detected_at, NEW.first_detected_at);
      NEW.first_detected_at := COALESCE(NEW.ingested_at, now());
      NEW.first_detected_at_semantics := 'aicis_system_detection_time_v1';
    END IF;
  ELSIF NEW.first_detected_at IS DISTINCT FROM OLD.first_detected_at
        AND public.aicis_signal_semantics_unusable_v1(NEW.first_detected_at_semantics) THEN
    NEW.reported_first_detected_at := COALESCE(NEW.reported_first_detected_at, NEW.first_detected_at);
    NEW.first_detected_at := OLD.first_detected_at;
    NEW.first_detected_at_semantics := COALESCE(
      OLD.first_detected_at_semantics,
      'preserved_existing_detection_time_unverified_semantics'
    );
  END IF;

  -- source_count remains a descriptive compatibility field. It is never proof
  -- of independent corroboration. Unlabelled values are retained but labelled.
  IF NEW.source_count IS NOT NULL
     AND public.aicis_signal_semantics_unusable_v1(NEW.source_count_semantics) THEN
    NEW.reported_source_count := COALESCE(NEW.reported_source_count, NEW.source_count);
    NEW.source_count_semantics := 'reported_source_identifier_count_not_independence';
  END IF;

  IF NEW.merged_source_count IS NOT NULL
     AND public.aicis_signal_semantics_unusable_v1(NEW.merged_source_count_semantics) THEN
    NEW.reported_merged_source_count := COALESCE(
      NEW.reported_merged_source_count,
      NEW.merged_source_count
    );
    NEW.merged_source_count_semantics := 'reported_grouped_source_identifier_count_unverified_grouping';
  END IF;

  IF jsonb_typeof(COALESCE(NEW.source_references, '[]'::jsonb)) = 'array' THEN
    ref_count := jsonb_array_length(COALESCE(NEW.source_references, '[]'::jsonb));
  END IF;

  IF TG_OP = 'INSERT' THEN
    grouping_changed := ref_count > 1 OR COALESCE(NEW.source_count, 0) > 1 OR COALESCE(NEW.merged_source_count, 0) > 1;
  ELSE
    grouping_changed :=
      NEW.source_references IS DISTINCT FROM OLD.source_references
      OR NEW.source_count IS DISTINCT FROM OLD.source_count
      OR NEW.merged_source_count IS DISTINCT FROM OLD.merged_source_count;
  END IF;

  -- Lexical similarity or publisher multiplicity cannot establish that several
  -- reports describe the same real-world event. Older writers may still attempt
  -- such grouping; quarantine the proposed references rather than accepting the
  -- merge as canonical evidence.
  IF grouping_changed
     AND public.aicis_signal_semantics_unusable_v1(NEW.source_grouping_semantics) THEN
    NEW.unverified_related_source_references := CASE
      WHEN jsonb_typeof(COALESCE(NEW.source_references, '[]'::jsonb)) = 'array'
        THEN COALESCE(NEW.unverified_related_source_references, '[]'::jsonb) || COALESCE(NEW.source_references, '[]'::jsonb)
      ELSE COALESCE(NEW.unverified_related_source_references, '[]'::jsonb)
    END;

    IF TG_OP = 'UPDATE' THEN
      NEW.source_references := OLD.source_references;
      NEW.source_count := OLD.source_count;
      NEW.merged_source_count := OLD.merged_source_count;
      NEW.official_source_present := OLD.official_source_present;
      NEW.source_count_semantics := OLD.source_count_semantics;
      NEW.merged_source_count_semantics := OLD.merged_source_count_semantics;
    ELSE
      -- Keep only the primary report in the canonical record. Other proposed
      -- grouped reports remain preserved in the quarantine audit field.
      IF ref_count > 0 THEN
        NEW.source_references := jsonb_build_array(NEW.source_references -> 0);
        NEW.source_count := 1;
        NEW.merged_source_count := 1;
        NEW.source_identifier_count := 1;
        NEW.source_identifier_count_semantics := 'single_primary_source_identifier_after_grouping_quarantine';
      ELSE
        NEW.source_count := NULL;
        NEW.merged_source_count := NULL;
      END IF;
      NEW.source_count_semantics := 'single_primary_report_after_unverified_grouping_quarantine';
      NEW.merged_source_count_semantics := 'single_primary_report_after_unverified_grouping_quarantine';
    END IF;

    NEW.source_grouping_semantics := 'withheld_unverified_same_event_grouping';
    NEW.multi_source_confirmed := NULL;
    NEW.multi_source_confirmation_semantics := 'withheld_without_verified_same_event_and_independent_origin_proof';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_global_signal_intake_truth_v2 ON public.global_signals;
CREATE TRIGGER trg_guard_global_signal_intake_truth_v2
BEFORE INSERT OR UPDATE ON public.global_signals
FOR EACH ROW EXECUTE FUNCTION public.guard_global_signal_intake_truth_v2();

REVOKE ALL ON FUNCTION public.guard_global_signal_intake_truth_v2() FROM PUBLIC;

COMMENT ON COLUMN public.global_signals.impact_score IS
  'Nullable impact score. It is unusable without explicit impact_score_semantics and is not a probability.';
COMMENT ON COLUMN public.global_signals.urgency_score IS
  'Nullable urgency score. It is unusable without explicit urgency_score_semantics and is not a probability.';
COMMENT ON COLUMN public.global_signals.source_published_at IS
  'Source-reported publication/update timestamp when explicitly identified as publication time; not event occurrence time.';
COMMENT ON COLUMN public.global_signals.first_detected_at IS
  'AICIS system detection/ingestion timestamp. It must not be populated from source publication or event occurrence time.';
COMMENT ON COLUMN public.global_signals.occurred_at IS
  'Nullable event occurrence time only when the source or a governed derivation explicitly establishes event-time semantics.';
COMMENT ON COLUMN public.global_signals.unverified_related_source_references IS
  'Audit-preserved source references proposed by unverified same-event grouping logic. They do not strengthen canonical evidence.';
COMMENT ON FUNCTION public.guard_global_signal_intake_truth_v2() IS
  'Fail-closed intake guard for unlabeled impact/urgency/timestamps and unverified report grouping.';