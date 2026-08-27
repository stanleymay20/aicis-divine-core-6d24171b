-- AICIS global-signal epistemic truth floor v1
--
-- A publisher count is not independent corroboration. A deterministic source-trust
-- screen is not a calibrated probability. New writers must declare semantics;
-- legacy/unlabelled writes are preserved for audit but cannot silently populate
-- canonical confidence/corroboration fields.

ALTER TABLE public.global_signals
  ALTER COLUMN corroboration_count DROP DEFAULT,
  ALTER COLUMN multi_source_confirmed DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS confidence_score_semantics text,
  ADD COLUMN IF NOT EXISTS reported_confidence_score smallint,
  ADD COLUMN IF NOT EXISTS corroboration_count_semantics text,
  ADD COLUMN IF NOT EXISTS source_identifier_count integer CHECK (
    source_identifier_count IS NULL OR source_identifier_count >= 0
  ),
  ADD COLUMN IF NOT EXISTS source_identifier_count_semantics text,
  ADD COLUMN IF NOT EXISTS source_independence_status text,
  ADD COLUMN IF NOT EXISTS independent_origin_count integer CHECK (
    independent_origin_count IS NULL OR independent_origin_count >= 0
  ),
  ADD COLUMN IF NOT EXISTS source_independence_semantics text,
  ADD COLUMN IF NOT EXISTS multi_source_confirmation_semantics text,
  ADD COLUMN IF NOT EXISTS source_record_key text,
  ADD COLUMN IF NOT EXISTS source_origin_key text,
  ADD COLUMN IF NOT EXISTS source_lineage_status text NOT NULL DEFAULT 'unknown'
    CHECK (source_lineage_status IN ('unknown','verified_origin','verified_derived')),
  ADD COLUMN IF NOT EXISTS source_lineage_method text,
  ADD COLUMN IF NOT EXISTS syndication_key text,
  ADD COLUMN IF NOT EXISTS upstream_source_record_keys text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_lineage_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Existing source-name counts are retained descriptively but are not upgraded to
-- independent corroboration. Existing confidence numbers remain available with
-- an explicit legacy label until a governed recompute replaces them.
UPDATE public.global_signals
SET
  source_identifier_count = COALESCE(source_identifier_count, corroboration_count),
  source_identifier_count_semantics = COALESCE(
    source_identifier_count_semantics,
    CASE WHEN corroboration_count IS NOT NULL
      THEN 'legacy_distinct_source_identifier_count_not_source_independence'
      ELSE NULL END
  ),
  corroboration_count_semantics = COALESCE(
    corroboration_count_semantics,
    CASE WHEN corroboration_count IS NOT NULL
      THEN 'legacy_numeric_corroboration_semantics_unverified'
      ELSE NULL END
  ),
  confidence_score_semantics = COALESCE(
    confidence_score_semantics,
    CASE WHEN confidence_score IS NOT NULL
      THEN 'legacy_signal_confidence_score_semantics_unverified'
      ELSE NULL END
  ),
  multi_source_confirmation_semantics = COALESCE(
    multi_source_confirmation_semantics,
    CASE WHEN multi_source_confirmed IS NOT NULL
      THEN 'legacy_boolean_source_confirmation_semantics_unverified'
      ELSE NULL END
  ),
  source_independence_status = COALESCE(source_independence_status, 'not_assessed'),
  source_independence_semantics = COALESCE(
    source_independence_semantics,
    'legacy_source_independence_not_assessed'
  );

CREATE INDEX IF NOT EXISTS idx_global_signals_source_record_key_v1
  ON public.global_signals(source_record_key)
  WHERE source_record_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_global_signals_source_origin_key_v1
  ON public.global_signals(source_origin_key)
  WHERE source_origin_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_global_signals_syndication_key_v1
  ON public.global_signals(syndication_key)
  WHERE syndication_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.aicis_signal_semantics_unusable_v1(p_semantics text)
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
    OR lower(p_semantics) LIKE '%unlabeled%';
$$;

REVOKE ALL ON FUNCTION public.aicis_signal_semantics_unusable_v1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aicis_signal_semantics_unusable_v1(text) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_global_signal_epistemics_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.confidence_score IS NOT NULL
     AND public.aicis_signal_semantics_unusable_v1(NEW.confidence_score_semantics) THEN
    NEW.reported_confidence_score := COALESCE(NEW.reported_confidence_score, NEW.confidence_score);
    NEW.confidence_score := NULL;
    NEW.confidence_score_semantics := 'withheld_unlabeled_signal_score';
  END IF;

  IF NEW.corroboration_count IS NOT NULL
     AND public.aicis_signal_semantics_unusable_v1(NEW.corroboration_count_semantics) THEN
    NEW.source_identifier_count := COALESCE(NEW.source_identifier_count, NEW.corroboration_count);
    NEW.source_identifier_count_semantics := COALESCE(
      NEW.source_identifier_count_semantics,
      'distinct_source_identifier_count_not_source_independence'
    );
    NEW.corroboration_count := NULL;
    NEW.corroboration_count_semantics := 'withheld_without_independent_origin_proof';
  END IF;

  IF NEW.multi_source_confirmed IS NOT NULL
     AND public.aicis_signal_semantics_unusable_v1(NEW.multi_source_confirmation_semantics) THEN
    NEW.multi_source_confirmed := NULL;
    NEW.multi_source_confirmation_semantics := 'withheld_unlabeled_source_confirmation';
  END IF;

  IF NEW.multi_source_confirmed IS TRUE THEN
    IF NEW.source_independence_status IS DISTINCT FROM 'established'
       OR NEW.independent_origin_count IS NULL
       OR NEW.independent_origin_count < 2 THEN
      NEW.multi_source_confirmed := NULL;
      NEW.multi_source_confirmation_semantics := 'withheld_without_independent_origin_proof';
    END IF;
  END IF;

  IF NEW.corroboration_count IS NOT NULL THEN
    IF NEW.source_independence_status IS DISTINCT FROM 'established'
       OR NEW.independent_origin_count IS NULL
       OR NEW.corroboration_count <> NEW.independent_origin_count THEN
      NEW.source_identifier_count := COALESCE(NEW.source_identifier_count, NEW.corroboration_count);
      NEW.corroboration_count := NULL;
      NEW.corroboration_count_semantics := 'withheld_without_independent_origin_proof';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_global_signal_epistemics_v1 ON public.global_signals;
CREATE TRIGGER trg_guard_global_signal_epistemics_v1
BEFORE INSERT OR UPDATE ON public.global_signals
FOR EACH ROW EXECUTE FUNCTION public.guard_global_signal_epistemics_v1();

REVOKE ALL ON FUNCTION public.guard_global_signal_epistemics_v1() FROM PUBLIC;

COMMENT ON COLUMN public.global_signals.confidence_score IS
  'Compatibility numeric signal-evidence score. It is not a calibrated probability; inspect confidence_score_semantics.';
COMMENT ON COLUMN public.global_signals.reported_confidence_score IS
  'Raw numeric score supplied by a writer without usable semantics; retained for audit only.';
COMMENT ON COLUMN public.global_signals.source_identifier_count IS
  'Descriptive count of distinct source identifiers/names in a canonical cluster. It does not establish independent corroboration.';
COMMENT ON COLUMN public.global_signals.corroboration_count IS
  'Nullable independently corroborated origin count only when explicit source lineage establishes independence.';
COMMENT ON COLUMN public.global_signals.multi_source_confirmed IS
  'Nullable confirmation flag. TRUE requires explicit complete source-lineage evidence with at least two independent origins.';
COMMENT ON COLUMN public.global_signals.source_origin_key IS
  'Governed explicit original-source identity. Absence never implies that the current publisher is an original independent source.';
COMMENT ON FUNCTION public.guard_global_signal_epistemics_v1() IS
  'Fail-closed guard preventing unlabeled signal scores or publisher counts from becoming canonical confidence/corroboration evidence.';