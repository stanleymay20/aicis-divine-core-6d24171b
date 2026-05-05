
CREATE OR REPLACE FUNCTION public.reconcile_canonical_clusters()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  before_broken_dupes int;
  before_orphan_groups int;
  after_broken_dupes int;
  after_orphan_groups int;
  promoted int := 0;
  repointed int := 0;
  recomputed int := 0;
  bad_cluster_id uuid;
  new_canonical_id uuid;
  cluster_size int;
  distinct_sources int;
  conf_score int;
  cred numeric;
  prop numeric;
  is_official boolean;
  source_tier text;
  age_hours numeric;
  recency numeric;
  corrob_boost numeric;
  official_boost numeric;
  prop_penalty numeric;
BEGIN
  -- ============ BEFORE counts ============
  SELECT COUNT(*) INTO before_broken_dupes
  FROM global_signals d
  LEFT JOIN global_signals c ON c.id = d.duplicate_of_signal_id
  WHERE d.canonical_event_status = 'duplicate'
    AND (c.id IS NULL OR c.canonical_event_status <> 'canonical');

  SELECT COUNT(DISTINCT d.canonical_event_id) INTO before_orphan_groups
  FROM global_signals d
  WHERE d.canonical_event_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM global_signals c
      WHERE c.id = d.canonical_event_id AND c.canonical_event_status = 'canonical'
    );

  -- ============ Walk every broken cluster ============
  FOR bad_cluster_id IN
    SELECT DISTINCT d.canonical_event_id
    FROM global_signals d
    WHERE d.canonical_event_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM global_signals c
        WHERE c.id = d.canonical_event_id AND c.canonical_event_status = 'canonical'
      )
  LOOP
    -- Pick best row in cluster: existing canonical first, then highest confidence, then oldest
    SELECT id INTO new_canonical_id
    FROM global_signals
    WHERE canonical_event_id = bad_cluster_id
    ORDER BY
      (canonical_event_status = 'canonical') DESC,
      COALESCE(confidence_score, 0) DESC,
      COALESCE(occurred_at, first_detected_at) ASC
    LIMIT 1;

    IF new_canonical_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Promote it
    UPDATE global_signals
    SET canonical_event_status = 'canonical',
        canonical_event_id = new_canonical_id,
        duplicate_of_signal_id = NULL,
        canonicalized_at = COALESCE(canonicalized_at, now())
    WHERE id = new_canonical_id
      AND canonical_event_status IS DISTINCT FROM 'canonical';
    promoted := promoted + 1;

    -- Repoint siblings to the promoted canonical
    UPDATE global_signals
    SET duplicate_of_signal_id = new_canonical_id,
        canonical_event_id = new_canonical_id,
        canonical_event_status = 'duplicate',
        canonicalized_at = COALESCE(canonicalized_at, now())
    WHERE canonical_event_id = bad_cluster_id
      AND id <> new_canonical_id;
    GET DIAGNOSTICS cluster_size = ROW_COUNT;
    repointed := repointed + cluster_size;
  END LOOP;

  -- ============ Repair stray duplicate pointers (cluster id is fine, pointer is not) ============
  UPDATE global_signals d
  SET duplicate_of_signal_id = d.canonical_event_id
  FROM global_signals c
  WHERE d.canonical_event_status = 'duplicate'
    AND d.canonical_event_id IS NOT NULL
    AND c.id = d.canonical_event_id
    AND c.canonical_event_status = 'canonical'
    AND (
      d.duplicate_of_signal_id IS NULL
      OR d.duplicate_of_signal_id <> d.canonical_event_id
    );

  -- ============ Recompute confidence on every canonical we just touched ============
  FOR new_canonical_id, cluster_size, distinct_sources IN
    SELECT
      c.id,
      COUNT(d.id)::int AS sz,
      GREATEST(
        1,
        COUNT(DISTINCT COALESCE(NULLIF(d.canonical_source_name, ''), NULLIF(d.primary_source, ''), 'unknown'))
        + (CASE WHEN COUNT(d.id) FILTER (
            WHERE COALESCE(NULLIF(d.canonical_source_name, ''), NULLIF(d.primary_source, '')) IS NOT DISTINCT FROM
                  COALESCE(NULLIF(c.canonical_source_name, ''), NULLIF(c.primary_source, ''))
          ) > 0 THEN 0 ELSE 1 END)
      )::int AS distinct_src
    FROM global_signals c
    LEFT JOIN global_signals d
      ON d.canonical_event_id = c.id AND d.canonical_event_status = 'duplicate'
    WHERE c.canonical_event_status = 'canonical'
      AND c.canonical_event_id IN (
        SELECT DISTINCT canonical_event_id FROM global_signals
        WHERE canonical_event_id IS NOT NULL
      )
      AND c.id IN (
        -- only canonicals we just promoted or that have at least one duplicate pointing in
        SELECT DISTINCT canonical_event_id FROM global_signals
        WHERE canonical_event_status = 'duplicate'
      )
    GROUP BY c.id
  LOOP
    -- Look up trust for the canonical row
    SELECT
      COALESCE(c.source_credibility_score, 35),
      COALESCE(c.propaganda_risk_score, 30),
      COALESCE(c.official_source, false),
      COALESCE(c.source_trust_tier, 'tier_4'),
      EXTRACT(EPOCH FROM (now() - COALESCE(c.occurred_at, c.first_detected_at))) / 3600.0
    INTO cred, prop, is_official, source_tier, age_hours
    FROM global_signals c
    WHERE c.id = new_canonical_id;

    recency := GREATEST(0, 1 - age_hours / 72.0);
    corrob_boost := LEAST(25, GREATEST(0, distinct_sources - 1) * 8);
    official_boost := CASE WHEN is_official THEN 8 ELSE 0 END;
    prop_penalty := ROUND(prop * 0.25);

    conf_score := GREATEST(5, LEAST(99, ROUND(
      cred * 0.6 + corrob_boost + official_boost + recency * 8 - prop_penalty
    )::int));

    UPDATE global_signals
    SET corroboration_count = distinct_sources,
        multi_source_confirmed = (distinct_sources >= 2),
        confidence_score = conf_score,
        confidence_explanation = jsonb_build_object(
          'role', 'canonical',
          'source_tier', source_tier,
          'source_credibility', cred,
          'propaganda_risk', prop,
          'official_source', is_official,
          'distinct_sources', distinct_sources,
          'recency_factor', round(recency::numeric, 3),
          'corroboration_boost', corrob_boost,
          'official_boost', official_boost,
          'propaganda_penalty', prop_penalty,
          'reconciled_at', now(),
          'formula', '0.6*cred + min(25,(n-1)*8) + officialBoost(8) + recency*8 - 0.25*propRisk'
        )
    WHERE id = new_canonical_id;

    recomputed := recomputed + 1;
  END LOOP;

  -- ============ AFTER counts ============
  SELECT COUNT(*) INTO after_broken_dupes
  FROM global_signals d
  LEFT JOIN global_signals c ON c.id = d.duplicate_of_signal_id
  WHERE d.canonical_event_status = 'duplicate'
    AND (c.id IS NULL OR c.canonical_event_status <> 'canonical');

  SELECT COUNT(DISTINCT d.canonical_event_id) INTO after_orphan_groups
  FROM global_signals d
  WHERE d.canonical_event_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM global_signals c
      WHERE c.id = d.canonical_event_id AND c.canonical_event_status = 'canonical'
    );

  INSERT INTO automation_logs (job_name, status, message)
  VALUES (
    'reconcile-canonical-clusters',
    'success',
    format(
      'before: broken_dupes=%s orphan_groups=%s | promoted=%s repointed=%s recomputed=%s | after: broken_dupes=%s orphan_groups=%s',
      before_broken_dupes, before_orphan_groups, promoted, repointed, recomputed, after_broken_dupes, after_orphan_groups
    )
  );

  RETURN jsonb_build_object(
    'before', jsonb_build_object('broken_dupes', before_broken_dupes, 'orphan_groups', before_orphan_groups),
    'after',  jsonb_build_object('broken_dupes', after_broken_dupes,  'orphan_groups', after_orphan_groups),
    'promoted', promoted,
    'repointed', repointed,
    'recomputed', recomputed
  );
END;
$$;
