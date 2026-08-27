-- AICIS global-signal operational truth floor v3
--
-- Operational/routing fields must distinguish "not assessed" from an observed
-- zero/false state. In particular, omission must never imply enrichment success.

ALTER TABLE public.global_signals
  ALTER COLUMN source_rank_score DROP DEFAULT,
  ALTER COLUMN routing_score DROP DEFAULT,
  ALTER COLUMN official_source DROP DEFAULT,
  ALTER COLUMN official_source_present DROP DEFAULT,
  ALTER COLUMN merged_source_count DROP DEFAULT,
  ALTER COLUMN enrichment_status SET DEFAULT 'pending_enrichment',
  ADD COLUMN IF NOT EXISTS source_rank_score_semantics text,
  ADD COLUMN IF NOT EXISTS reported_source_rank_score integer,
  ADD COLUMN IF NOT EXISTS routing_score_semantics text,
  ADD COLUMN IF NOT EXISTS reported_routing_score numeric,
  ADD COLUMN IF NOT EXISTS official_source_semantics text,
  ADD COLUMN IF NOT EXISTS reported_official_source boolean,
  ADD COLUMN IF NOT EXISTS official_source_present_semantics text,
  ADD COLUMN IF NOT EXISTS reported_official_source_present boolean;

UPDATE public.global_signals
SET
  source_rank_score_semantics = COALESCE(
    source_rank_score_semantics,
    CASE WHEN source_rank_score IS NOT NULL THEN 'legacy_source_rank_score_semantics_unverified' END
  ),
  routing_score_semantics = COALESCE(
    routing_score_semantics,
    CASE WHEN routing_score IS NOT NULL THEN 'legacy_routing_score_semantics_unverified' END
  ),
  official_source_semantics = COALESCE(
    official_source_semantics,
    CASE WHEN official_source IS NOT NULL THEN 'legacy_official_source_boolean_semantics_unverified' END
  ),
  official_source_present_semantics = COALESCE(
    official_source_present_semantics,
    CASE WHEN official_source_present IS NOT NULL THEN 'legacy_official_source_present_boolean_semantics_unverified' END
  );

CREATE OR REPLACE FUNCTION public.guard_global_signal_operational_truth_v3()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.source_rank_score IS NOT NULL
     AND public.aicis_signal_semantics_unusable_v1(NEW.source_rank_score_semantics) THEN
    NEW.reported_source_rank_score := COALESCE(NEW.reported_source_rank_score, NEW.source_rank_score);
    NEW.source_rank_score := NULL;
    NEW.source_rank_score_semantics := 'withheld_unlabeled_source_rank_score';
  END IF;

  IF NEW.routing_score IS NOT NULL
     AND public.aicis_signal_semantics_unusable_v1(NEW.routing_score_semantics) THEN
    NEW.reported_routing_score := COALESCE(NEW.reported_routing_score, NEW.routing_score);
    NEW.routing_score := NULL;
    NEW.routing_score_semantics := 'withheld_unlabeled_routing_score';
  END IF;

  IF NEW.official_source IS NOT NULL
     AND public.aicis_signal_semantics_unusable_v1(NEW.official_source_semantics) THEN
    NEW.reported_official_source := COALESCE(NEW.reported_official_source, NEW.official_source);
    NEW.official_source := NULL;
    NEW.official_source_semantics := 'withheld_unlabeled_official_source_boolean';
  END IF;

  IF NEW.official_source_present IS NOT NULL
     AND public.aicis_signal_semantics_unusable_v1(NEW.official_source_present_semantics) THEN
    NEW.reported_official_source_present := COALESCE(
      NEW.reported_official_source_present,
      NEW.official_source_present
    );
    NEW.official_source_present := NULL;
    NEW.official_source_present_semantics := 'withheld_unlabeled_official_source_present_boolean';
  END IF;

  IF TG_OP = 'INSERT' AND (NEW.enrichment_status IS NULL OR btrim(NEW.enrichment_status) = '') THEN
    NEW.enrichment_status := 'pending_enrichment';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_global_signal_operational_truth_v3 ON public.global_signals;
CREATE TRIGGER trg_guard_global_signal_operational_truth_v3
BEFORE INSERT OR UPDATE ON public.global_signals
FOR EACH ROW EXECUTE FUNCTION public.guard_global_signal_operational_truth_v3();

REVOKE ALL ON FUNCTION public.guard_global_signal_operational_truth_v3() FROM PUBLIC;

COMMENT ON COLUMN public.global_signals.source_rank_score IS
  'Nullable routing/source-quality screen. Inspect source_rank_score_semantics; never interpret an absent value as zero.';
COMMENT ON COLUMN public.global_signals.routing_score IS
  'Nullable routing screen. Inspect routing_score_semantics; it is not a probability or confidence measure.';
COMMENT ON COLUMN public.global_signals.official_source IS
  'Nullable source classification. NULL means not established; FALSE requires explicit semantics rather than omission.';
COMMENT ON COLUMN public.global_signals.official_source_present IS
  'Nullable canonical-cluster source classification. NULL means not established; FALSE must not be inferred from absence.';
COMMENT ON COLUMN public.global_signals.enrichment_status IS
  'Operational enrichment state. New omitted values default to pending_enrichment, never enriched.';
COMMENT ON FUNCTION public.guard_global_signal_operational_truth_v3() IS
  'Fail-closed guard preventing unlabelled operational/routing values from masquerading as assessed facts.';