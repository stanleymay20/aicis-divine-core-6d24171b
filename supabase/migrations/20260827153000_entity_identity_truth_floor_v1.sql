-- AICIS Entity Identity Truth Floor v1
--
-- Identity rules:
-- * exact names, aliases and fuzzy similarity are candidate evidence, not proof;
-- * authoritative external identifiers may auto-resolve only after explicit verification;
-- * unknown trust/strength/confidence stays NULL;
-- * merge decisions remain explicit and auditable.

ALTER TABLE public.canonical_entities
  ALTER COLUMN trust_score DROP DEFAULT,
  ALTER COLUMN source_count DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS trust_score_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_status text;

UPDATE public.canonical_entities
SET trust_score_semantics = 'legacy_numeric_semantics_unverified'
WHERE trust_score IS NOT NULL AND trust_score_semantics IS NULL;
UPDATE public.canonical_entities
SET evidence_status = 'legacy_identity_evidence_status_unknown'
WHERE evidence_status IS NULL;

ALTER TABLE public.entity_aliases
  ALTER COLUMN confidence DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS confidence_semantics text,
  ADD COLUMN IF NOT EXISTS verification_status text;

UPDATE public.entity_aliases
SET confidence_semantics = 'legacy_numeric_semantics_unverified'
WHERE confidence IS NOT NULL AND confidence_semantics IS NULL;
UPDATE public.entity_aliases
SET verification_status = 'legacy_verification_status_unknown'
WHERE verification_status IS NULL;

ALTER TABLE public.entity_links
  ALTER COLUMN strength DROP DEFAULT,
  ALTER COLUMN provenance_confidence DROP DEFAULT,
  ALTER COLUMN provenance_observed_at DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS strength_semantics text,
  ADD COLUMN IF NOT EXISTS provenance_confidence_semantics text,
  ADD COLUMN IF NOT EXISTS provenance_time_semantics text,
  ADD COLUMN IF NOT EXISTS verification_status text;

UPDATE public.entity_links
SET strength_semantics = 'legacy_numeric_semantics_unverified'
WHERE strength IS NOT NULL AND strength_semantics IS NULL;
UPDATE public.entity_links
SET provenance_confidence_semantics = 'legacy_numeric_semantics_unverified'
WHERE provenance_confidence IS NOT NULL AND provenance_confidence_semantics IS NULL;
UPDATE public.entity_links
SET provenance_time_semantics = 'legacy_time_semantics_unverified'
WHERE provenance_observed_at IS NOT NULL AND provenance_time_semantics IS NULL;
UPDATE public.entity_links
SET verification_status = 'legacy_verification_status_unknown'
WHERE verification_status IS NULL;

ALTER TABLE public.entity_external_ids
  ADD COLUMN IF NOT EXISTS verification_status text,
  ADD COLUMN IF NOT EXISTS verification_method text;

-- Historical last_verified_at values were written by registration code without
-- evidence that a provider lookup actually verified them, so do not grandfather
-- them into authoritative identity.
UPDATE public.entity_external_ids
SET verification_status = 'legacy_verification_unverified'
WHERE verification_status IS NULL;

ALTER TABLE public.entity_merge_log
  ADD COLUMN IF NOT EXISTS merge_confidence_semantics text,
  ADD COLUMN IF NOT EXISTS decision_status text;

UPDATE public.entity_merge_log
SET merge_confidence_semantics = CASE
      WHEN merge_confidence IS NULL THEN 'not_quantified'
      ELSE 'legacy_numeric_semantics_unverified'
    END
WHERE merge_confidence_semantics IS NULL;
UPDATE public.entity_merge_log
SET decision_status = 'legacy_merge_completed'
WHERE decision_status IS NULL;

ALTER TABLE public.canonical_entities
  ADD CONSTRAINT canonical_entities_trust_score_unit_interval_v1
  CHECK (trust_score IS NULL OR (trust_score >= 0 AND trust_score <= 1)) NOT VALID;
ALTER TABLE public.entity_aliases
  ADD CONSTRAINT entity_aliases_confidence_unit_interval_v1
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)) NOT VALID;
ALTER TABLE public.entity_links
  ADD CONSTRAINT entity_links_strength_unit_interval_v1
  CHECK (strength IS NULL OR (strength >= 0 AND strength <= 1)) NOT VALID;
ALTER TABLE public.entity_links
  ADD CONSTRAINT entity_links_provenance_confidence_unit_interval_v1
  CHECK (provenance_confidence IS NULL OR (provenance_confidence >= 0 AND provenance_confidence <= 1)) NOT VALID;
ALTER TABLE public.entity_merge_log
  ADD CONSTRAINT entity_merge_log_confidence_unit_interval_v1
  CHECK (merge_confidence IS NULL OR (merge_confidence >= 0 AND merge_confidence <= 1)) NOT VALID;

CREATE TABLE IF NOT EXISTS public.entity_resolution_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_name text NOT NULL,
  requested_entity_type text NOT NULL,
  requested_iso3 text,
  candidate_entity_id uuid NOT NULL REFERENCES public.canonical_entities(id) ON DELETE CASCADE,
  match_type text NOT NULL CHECK (match_type IN ('exact_name','alias','fuzzy','iso3')),
  match_score numeric CHECK (match_score IS NULL OR (match_score >= 0 AND match_score <= 1)),
  match_score_semantics text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','accepted','rejected','superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid
);

CREATE INDEX IF NOT EXISTS entity_resolution_candidates_pending_idx
  ON public.entity_resolution_candidates (status, created_at DESC);
CREATE INDEX IF NOT EXISTS entity_resolution_candidates_entity_idx
  ON public.entity_resolution_candidates (candidate_entity_id, created_at DESC);

ALTER TABLE public.entity_resolution_candidates ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.entity_resolution_candidates TO authenticated;
GRANT ALL ON public.entity_resolution_candidates TO service_role;

DROP POLICY IF EXISTS "Operators inspect entity resolution candidates" ON public.entity_resolution_candidates;
CREATE POLICY "Operators inspect entity resolution candidates"
ON public.entity_resolution_candidates FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));

DROP POLICY IF EXISTS "Admins review entity resolution candidates" ON public.entity_resolution_candidates;
CREATE POLICY "Admins review entity resolution candidates"
ON public.entity_resolution_candidates FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(),'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "Service manages entity resolution candidates" ON public.entity_resolution_candidates;
CREATE POLICY "Service manages entity resolution candidates"
ON public.entity_resolution_candidates FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.merge_entities_tx(
  _winner_id uuid,
  _loser_id uuid,
  _reason text,
  _confidence numeric DEFAULT NULL,
  _merged_by text DEFAULT 'system'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_winner canonical_entities%ROWTYPE;
  v_loser canonical_entities%ROWTYPE;
  v_result jsonb;
BEGIN
  IF _winner_id = _loser_id THEN
    RAISE EXCEPTION 'Cannot merge entity with itself';
  END IF;
  IF _confidence IS NOT NULL AND (_confidence < 0 OR _confidence > 1) THEN
    RAISE EXCEPTION 'Merge confidence must be between 0 and 1';
  END IF;

  SELECT * INTO v_winner FROM canonical_entities WHERE id = _winner_id FOR UPDATE;
  SELECT * INTO v_loser FROM canonical_entities WHERE id = _loser_id FOR UPDATE;
  IF v_winner IS NULL THEN RAISE EXCEPTION 'Winner entity not found'; END IF;
  IF v_loser IS NULL THEN RAISE EXCEPTION 'Loser entity not found'; END IF;

  UPDATE canonical_entities SET
    lat = COALESCE(v_winner.lat, v_loser.lat),
    lon = COALESCE(v_winner.lon, v_loser.lon),
    iso3 = COALESCE(v_winner.iso3, v_loser.iso3),
    display_name = COALESCE(v_winner.display_name, v_loser.display_name),
    trust_score = CASE
      WHEN v_winner.trust_score IS NULL AND v_loser.trust_score IS NULL THEN NULL
      WHEN v_winner.trust_score IS NULL THEN v_loser.trust_score
      WHEN v_loser.trust_score IS NULL THEN v_winner.trust_score
      ELSE GREATEST(v_winner.trust_score, v_loser.trust_score)
    END,
    trust_score_semantics = CASE
      WHEN v_winner.trust_score IS NULL AND v_loser.trust_score IS NULL THEN NULL
      WHEN v_winner.trust_score IS NULL THEN v_loser.trust_score_semantics
      WHEN v_loser.trust_score IS NULL THEN v_winner.trust_score_semantics
      WHEN v_winner.trust_score >= v_loser.trust_score THEN v_winner.trust_score_semantics
      ELSE v_loser.trust_score_semantics
    END,
    source_count = CASE
      WHEN v_winner.source_count IS NULL OR v_loser.source_count IS NULL THEN NULL
      ELSE v_winner.source_count + v_loser.source_count
    END,
    metadata = COALESCE(v_winner.metadata, '{}'::jsonb) || COALESCE(v_loser.metadata, '{}'::jsonb),
    last_resolved_at = now(),
    evidence_status = 'merged_identity_requires_preserved_audit_lineage'
  WHERE id = _winner_id;

  UPDATE entity_aliases SET entity_id = _winner_id
  WHERE entity_id = _loser_id
    AND NOT EXISTS (
      SELECT 1 FROM entity_aliases ea2
      WHERE ea2.entity_id = _winner_id
        AND ea2.alias = entity_aliases.alias
        AND ea2.alias_type = entity_aliases.alias_type
    );
  DELETE FROM entity_aliases WHERE entity_id = _loser_id;

  UPDATE entity_external_ids SET entity_id = _winner_id
  WHERE entity_id = _loser_id
    AND NOT EXISTS (
      SELECT 1 FROM entity_external_ids e2
      WHERE e2.entity_id = _winner_id
        AND e2.provider = entity_external_ids.provider
        AND e2.external_id = entity_external_ids.external_id
    );
  DELETE FROM entity_external_ids WHERE entity_id = _loser_id;

  UPDATE entity_links SET source_entity_id = _winner_id
  WHERE source_entity_id = _loser_id AND target_entity_id != _winner_id;
  UPDATE entity_links SET target_entity_id = _winner_id
  WHERE target_entity_id = _loser_id AND source_entity_id != _winner_id;
  DELETE FROM entity_links WHERE source_entity_id = _loser_id OR target_entity_id = _loser_id;

  INSERT INTO entity_merge_log (
    winner_id, loser_id, merge_reason, merged_by, merge_confidence,
    merge_confidence_semantics, decision_status
  ) VALUES (
    _winner_id, _loser_id, _reason, _merged_by, _confidence,
    CASE WHEN _confidence IS NULL
      THEN 'not_quantified'
      ELSE 'caller_supplied_numeric_semantics_unspecified'
    END,
    'explicit_merge_completed'
  );

  DELETE FROM canonical_entities WHERE id = _loser_id;

  v_result := jsonb_build_object(
    'ok', true,
    'winner_id', _winner_id,
    'loser_id', _loser_id,
    'merged', true,
    'survivorship_applied', true,
    'merge_confidence', _confidence,
    'merge_confidence_semantics', CASE WHEN _confidence IS NULL
      THEN 'not_quantified'
      ELSE 'caller_supplied_numeric_semantics_unspecified'
    END
  );
  RETURN v_result;
END;
$$;

COMMENT ON COLUMN public.canonical_entities.trust_score IS
  'Nullable explicitly quantified trust/quality measure. NULL means not quantified; inspect trust_score_semantics.';
COMMENT ON COLUMN public.entity_aliases.confidence IS
  'Nullable alias confidence. Exact text equality is not identity proof and must not imply confidence 1.';
COMMENT ON COLUMN public.entity_links.strength IS
  'Nullable relationship strength. NULL means not quantified; inspect strength_semantics.';
COMMENT ON TABLE public.entity_resolution_candidates IS
  'Review queue for name/alias/fuzzy/ISO identity candidates. Candidate similarity is not identity confidence.';
