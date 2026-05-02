CREATE TABLE IF NOT EXISTS public.aicis_geo_stoplist (
  phrase text PRIMARY KEY,
  category text NOT NULL DEFAULT 'noise',
  added_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.aicis_geo_stoplist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lril_stoplist_read ON public.aicis_geo_stoplist;
CREATE POLICY lril_stoplist_read ON public.aicis_geo_stoplist
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.aicis_geo_stoplist(phrase, category) VALUES
  ('premium times','media'),('egypt independent','media'),
  ('morocco news','media'),('hespress english','media'),
  ('australian broadcasting','media'),('al jazeera','media'),
  ('sky news','media'),('bbc news','media'),('the guardian','media'),
  ('the times','media'),('the post','media'),('washington post','media'),
  ('new york','media'),('new york times','media'),('reuters africa','media'),
  ('news agency','media'),('news network','media'),('press release','media'),
  ('supreme court','institution'),('white house','institution'),
  ('homeland security','institution'),('national security','institution'),
  ('european union','institution'),('united nations','institution'),
  ('security council','institution'),('foreign ministry','institution'),
  ('central bank','institution'),('federal reserve','institution'),
  ('fifa congress','institution'),('world bank','institution'),
  ('human rights','institution'),('red cross','institution'),
  ('rocha moya','person'),('ruben rocha','person'),
  ('michelle grattan','person'),('gianni infantino','person'),
  ('donald trump','person'),('joe biden','person'),
  ('vladimir putin','person'),('xi jinping','person'),
  ('camp mystic','event'),('may day','event'),
  ('cold war','event'),('world war','event'),
  ('climate change','event')
ON CONFLICT (phrase) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.aicis_geo_resolution_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid REFERENCES public.aicis_raw_local_signals(id) ON DELETE CASCADE,
  extracted_place text NOT NULL,
  source_name text,
  language text,
  country_hint text,
  attempted_match text,
  match_score numeric,
  reason_unresolved text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.aicis_geo_resolution_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lril_geo_audit_read ON public.aicis_geo_resolution_audit;
CREATE POLICY lril_geo_audit_read ON public.aicis_geo_resolution_audit
  FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_geo_audit_created ON public.aicis_geo_resolution_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_geo_audit_phrase  ON public.aicis_geo_resolution_audit(extracted_place);
CREATE INDEX IF NOT EXISTS idx_geo_audit_iso3    ON public.aicis_geo_resolution_audit(country_hint);

CREATE OR REPLACE VIEW public.aicis_unresolved_place_candidates
WITH (security_invoker = true) AS
SELECT
  extracted_place,
  country_hint,
  COUNT(*) AS mention_count,
  MAX(created_at) AS last_seen,
  array_agg(DISTINCT source_name) FILTER (WHERE source_name IS NOT NULL) AS sources,
  array_agg(DISTINCT reason_unresolved) AS reasons
FROM public.aicis_geo_resolution_audit
WHERE created_at > now() - interval '14 days'
GROUP BY extracted_place, country_hint
ORDER BY mention_count DESC;

CREATE OR REPLACE FUNCTION public.lril_extract_place_phrases(p_text text)
RETURNS TABLE(phrase text, kind text, weight numeric)
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  v_text text;
  v_match text[];
  v_phrase text;
BEGIN
  IF p_text IS NULL OR length(p_text) < 6 THEN RETURN; END IF;
  v_text := regexp_replace(p_text, '\s+', ' ', 'g');

  FOR v_match IN
    SELECT regexp_matches(
      v_text,
      '\y(?:in|at|near|outside|inside|around|from|across)\s+([[:upper:]][[:alpha:]\-]{2,}(?:\s+[[:upper:]][[:alpha:]\-]{2,}){0,2})',
      'g'
    )
  LOOP
    v_phrase := lower(unaccent(v_match[1]));
    CONTINUE WHEN length(v_phrase) < 4;
    CONTINUE WHEN EXISTS(SELECT 1 FROM public.aicis_geo_stoplist sl WHERE sl.phrase = v_phrase);
    phrase := v_phrase; kind := 'preposition'; weight := 1.0;
    RETURN NEXT;
  END LOOP;

  FOR v_match IN
    SELECT regexp_matches(
      v_text,
      '\y([[:upper:]][[:alpha:]\-]{2,}(?:\s+[[:upper:]][[:alpha:]\-]{2,}){0,2})\s+(district|province|region|county|city|town|village|township|state|governorate|prefecture|department|municipality|suburb)\y',
      'g'
    )
  LOOP
    v_phrase := lower(unaccent(v_match[1]));
    CONTINUE WHEN length(v_phrase) < 4;
    CONTINUE WHEN EXISTS(SELECT 1 FROM public.aicis_geo_stoplist sl WHERE sl.phrase = v_phrase);
    phrase := v_phrase; kind := 'admin_suffix'; weight := 1.4;
    RETURN NEXT;
  END LOOP;

  FOR v_match IN
    SELECT regexp_matches(
      v_text,
      '\y([[:upper:]][[:alpha:]\-]{3,}\s+[[:upper:]][[:alpha:]\-]{3,})\y',
      'g'
    )
  LOOP
    v_phrase := lower(unaccent(v_match[1]));
    CONTINUE WHEN EXISTS(SELECT 1 FROM public.aicis_geo_stoplist sl WHERE sl.phrase = v_phrase);
    phrase := v_phrase; kind := 'proper_bigram'; weight := 0.5;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Real-alias expansion: phrases mentioned >= 3 times that trigram-match
-- an existing geo entity in the same iso3 with similarity >= 0.7
WITH candidates AS (
  SELECT
    ph.phrase AS phr,
    s.country_hint AS iso3,
    COUNT(*) AS hits
  FROM public.aicis_raw_local_signals s
  CROSS JOIN LATERAL public.lril_extract_place_phrases(s.raw_text) ph
  WHERE s.processed_at IS NOT NULL
    AND s.ingested_at > now() - interval '14 days'
    AND s.country_hint IS NOT NULL
    AND length(ph.phrase) BETWEEN 4 AND 40
  GROUP BY ph.phrase, s.country_hint
  HAVING COUNT(*) >= 3
),
matched AS (
  SELECT DISTINCT ON (c.phr, c.iso3)
    g.id AS geo_entity_id,
    c.phr AS alias,
    GREATEST(
      similarity(lower(unaccent(coalesce(g.locality,''))), c.phr),
      similarity(lower(unaccent(coalesce(g.city,''))),     c.phr)
    ) AS sim
  FROM candidates c
  JOIN public.aicis_geo_entities g
    ON g.iso3 = c.iso3
   AND (
        similarity(lower(unaccent(coalesce(g.locality,''))), c.phr) >= 0.70
     OR similarity(lower(unaccent(coalesce(g.city,'')))    , c.phr) >= 0.70
   )
  ORDER BY c.phr, c.iso3, sim DESC
)
INSERT INTO public.aicis_geo_aliases(geo_entity_id, alias, language)
SELECT m.geo_entity_id, m.alias, 'en'
FROM matched m
WHERE NOT EXISTS (
  SELECT 1 FROM public.aicis_geo_aliases a
  WHERE a.geo_entity_id = m.geo_entity_id
    AND lower(unaccent(a.alias)) = m.alias
);

-- Reset 72h backlog for reprocessing under v14 logic
UPDATE public.aicis_raw_local_signals s
SET processed_at = NULL
FROM public.aicis_local_events e
WHERE e.created_at > now() - interval '72 hours'
  AND (e.geo_entity_id IS NULL OR e.confidence < 0.55)
  AND e.raw_signal_ids @> to_jsonb(ARRAY[s.id::text]);
