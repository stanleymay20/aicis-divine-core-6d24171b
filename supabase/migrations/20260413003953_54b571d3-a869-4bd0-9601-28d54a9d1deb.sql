
-- 1. Add normalized_name column to canonical_entities
ALTER TABLE public.canonical_entities
  ADD COLUMN IF NOT EXISTS normalized_name text;

-- Populate from existing data
UPDATE public.canonical_entities
SET normalized_name = lower(trim(canonical_name));

-- Create index for exact matching on normalized_name
CREATE INDEX IF NOT EXISTS idx_canonical_entities_normalized_name
  ON public.canonical_entities (normalized_name);

-- Trigger to auto-set normalized_name on insert/update
CREATE OR REPLACE FUNCTION public.set_normalized_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  NEW.normalized_name := lower(trim(NEW.canonical_name));
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_normalized_name
  BEFORE INSERT OR UPDATE OF canonical_name ON public.canonical_entities
  FOR EACH ROW EXECUTE FUNCTION public.set_normalized_name();

-- 2. Add provenance fields to entity_links
ALTER TABLE public.entity_links
  ADD COLUMN IF NOT EXISTS provenance_source text,
  ADD COLUMN IF NOT EXISTS provenance_confidence numeric DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS provenance_observed_at timestamptz DEFAULT now();

-- 3. Unique constraint on external IDs (prevent duplicates)
ALTER TABLE public.entity_external_ids
  ADD CONSTRAINT uq_entity_external_ids_provider_extid UNIQUE (provider, external_id);

-- 4. Prevent self-links
ALTER TABLE public.entity_links
  ADD CONSTRAINT chk_no_self_link CHECK (source_entity_id != target_entity_id);

-- 5. Prevent self-merges
ALTER TABLE public.entity_merge_log
  ADD CONSTRAINT chk_no_self_merge CHECK (winner_id != loser_id);

-- 6. Ranked fuzzy search function with trigram scoring
CREATE OR REPLACE FUNCTION public.similarity_search_entities(
  search_name text,
  search_type text DEFAULT NULL,
  min_similarity real DEFAULT 0.3,
  max_results int DEFAULT 10
)
RETURNS TABLE(
  id uuid,
  entity_type text,
  canonical_name text,
  display_name text,
  iso3 text,
  lat float8,
  lon float8,
  trust_score float8,
  source_count int,
  similarity real,
  match_source text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  -- Union canonical name matches with alias matches, rank by similarity
  WITH canonical_hits AS (
    SELECT
      ce.id, ce.entity_type::text, ce.canonical_name, ce.display_name,
      ce.iso3, ce.lat, ce.lon, ce.trust_score::float8, ce.source_count::int,
      similarity(ce.normalized_name, lower(trim(search_name))) AS sim,
      'canonical'::text AS match_src
    FROM canonical_entities ce
    WHERE (search_type IS NULL OR ce.entity_type::text = search_type)
      AND similarity(ce.normalized_name, lower(trim(search_name))) >= min_similarity
  ),
  alias_hits AS (
    SELECT
      ce.id, ce.entity_type::text, ce.canonical_name, ce.display_name,
      ce.iso3, ce.lat, ce.lon, ce.trust_score::float8, ce.source_count::int,
      similarity(lower(trim(ea.alias)), lower(trim(search_name))) AS sim,
      'alias'::text AS match_src
    FROM entity_aliases ea
    JOIN canonical_entities ce ON ce.id = ea.entity_id
    WHERE (search_type IS NULL OR ce.entity_type::text = search_type)
      AND similarity(lower(trim(ea.alias)), lower(trim(search_name))) >= min_similarity
  ),
  combined AS (
    SELECT * FROM canonical_hits
    UNION ALL
    SELECT * FROM alias_hits
  )
  SELECT DISTINCT ON (combined.id)
    combined.id, combined.entity_type, combined.canonical_name,
    combined.display_name, combined.iso3, combined.lat, combined.lon,
    combined.trust_score, combined.source_count, combined.sim, combined.match_src
  FROM combined
  ORDER BY combined.id, combined.sim DESC
  LIMIT max_results;
$$;

-- 7. Transactional merge with survivorship rules
CREATE OR REPLACE FUNCTION public.merge_entities_tx(
  _winner_id uuid,
  _loser_id uuid,
  _reason text,
  _confidence numeric DEFAULT 0.9,
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
  -- Block self-merge
  IF _winner_id = _loser_id THEN
    RAISE EXCEPTION 'Cannot merge entity with itself';
  END IF;

  -- Lock both rows
  SELECT * INTO v_winner FROM canonical_entities WHERE id = _winner_id FOR UPDATE;
  SELECT * INTO v_loser FROM canonical_entities WHERE id = _loser_id FOR UPDATE;

  IF v_winner IS NULL THEN RAISE EXCEPTION 'Winner entity not found'; END IF;
  IF v_loser IS NULL THEN RAISE EXCEPTION 'Loser entity not found'; END IF;

  -- Survivorship: pick best geo, trust, metadata
  UPDATE canonical_entities SET
    lat = COALESCE(v_winner.lat, v_loser.lat),
    lon = COALESCE(v_winner.lon, v_loser.lon),
    iso3 = COALESCE(v_winner.iso3, v_loser.iso3),
    display_name = COALESCE(v_winner.display_name, v_loser.display_name),
    trust_score = GREATEST(COALESCE(v_winner.trust_score, 0), COALESCE(v_loser.trust_score, 0)),
    source_count = COALESCE(v_winner.source_count, 0) + COALESCE(v_loser.source_count, 0),
    metadata = COALESCE(v_winner.metadata, '{}'::jsonb) || COALESCE(v_loser.metadata, '{}'::jsonb),
    last_resolved_at = now()
  WHERE id = _winner_id;

  -- Move aliases (skip conflicts)
  UPDATE entity_aliases SET entity_id = _winner_id
  WHERE entity_id = _loser_id
    AND NOT EXISTS (
      SELECT 1 FROM entity_aliases ea2
      WHERE ea2.entity_id = _winner_id AND ea2.alias = entity_aliases.alias AND ea2.alias_type = entity_aliases.alias_type
    );
  DELETE FROM entity_aliases WHERE entity_id = _loser_id;

  -- Move external IDs (skip conflicts)
  UPDATE entity_external_ids SET entity_id = _winner_id
  WHERE entity_id = _loser_id
    AND NOT EXISTS (
      SELECT 1 FROM entity_external_ids e2
      WHERE e2.entity_id = _winner_id AND e2.provider = entity_external_ids.provider AND e2.external_id = entity_external_ids.external_id
    );
  DELETE FROM entity_external_ids WHERE entity_id = _loser_id;

  -- Move links (skip self-links that would result)
  UPDATE entity_links SET source_entity_id = _winner_id
  WHERE source_entity_id = _loser_id AND target_entity_id != _winner_id;
  UPDATE entity_links SET target_entity_id = _winner_id
  WHERE target_entity_id = _loser_id AND source_entity_id != _winner_id;
  DELETE FROM entity_links WHERE source_entity_id = _loser_id OR target_entity_id = _loser_id;

  -- Immutable merge log
  INSERT INTO entity_merge_log (winner_id, loser_id, merge_reason, merged_by, merge_confidence)
  VALUES (_winner_id, _loser_id, _reason, _merged_by, _confidence);

  -- Delete loser
  DELETE FROM canonical_entities WHERE id = _loser_id;

  v_result := jsonb_build_object(
    'ok', true, 'winner_id', _winner_id, 'loser_id', _loser_id,
    'merged', true, 'survivorship_applied', true
  );
  RETURN v_result;
END;
$$;

-- 8. Graph traversal function for depth > 1
CREATE OR REPLACE FUNCTION public.traverse_entity_graph(
  _entity_id uuid,
  _depth int DEFAULT 1
)
RETURNS TABLE(
  entity_id uuid,
  canonical_name text,
  entity_type text,
  link_type text,
  direction text,
  depth int,
  connected_entity_id uuid,
  connected_name text,
  connected_type text,
  strength numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE graph AS (
    -- Seed: direct outgoing
    SELECT
      el.source_entity_id AS eid,
      ce_s.canonical_name AS ename,
      ce_s.entity_type::text AS etype,
      el.link_type::text AS ltype,
      'outgoing'::text AS dir,
      1 AS d,
      el.target_entity_id AS ceid,
      ce_t.canonical_name AS cname,
      ce_t.entity_type::text AS ctype,
      el.strength
    FROM entity_links el
    JOIN canonical_entities ce_s ON ce_s.id = el.source_entity_id
    JOIN canonical_entities ce_t ON ce_t.id = el.target_entity_id
    WHERE el.source_entity_id = _entity_id

    UNION ALL

    -- Seed: direct incoming
    SELECT
      el.target_entity_id,
      ce_t.canonical_name,
      ce_t.entity_type::text,
      el.link_type::text,
      'incoming'::text,
      1,
      el.source_entity_id,
      ce_s.canonical_name,
      ce_s.entity_type::text,
      el.strength
    FROM entity_links el
    JOIN canonical_entities ce_s ON ce_s.id = el.source_entity_id
    JOIN canonical_entities ce_t ON ce_t.id = el.target_entity_id
    WHERE el.target_entity_id = _entity_id

    UNION ALL

    -- Recurse outgoing from connected
    SELECT
      el.source_entity_id,
      ce_s.canonical_name,
      ce_s.entity_type::text,
      el.link_type::text,
      'outgoing'::text,
      g.d + 1,
      el.target_entity_id,
      ce_t.canonical_name,
      ce_t.entity_type::text,
      el.strength
    FROM graph g
    JOIN entity_links el ON el.source_entity_id = g.ceid
    JOIN canonical_entities ce_s ON ce_s.id = el.source_entity_id
    JOIN canonical_entities ce_t ON ce_t.id = el.target_entity_id
    WHERE g.d < _depth AND el.target_entity_id != _entity_id
  )
  SELECT DISTINCT ON (graph.ceid, graph.ltype, graph.dir)
    graph.eid, graph.ename, graph.etype, graph.ltype,
    graph.dir, graph.d, graph.ceid, graph.cname, graph.ctype, graph.strength
  FROM graph
  ORDER BY graph.ceid, graph.ltype, graph.dir, graph.d;
END;
$$;
