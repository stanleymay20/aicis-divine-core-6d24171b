-- =========================================================
-- LRIL v16 HARDENING
-- =========================================================

-- ---------------------------------------------------------
-- PRIORITY 1: Audit logging in geo resolver (make VOLATILE + log failures)
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lril_resolve_geo_fuzzy_v2(p_text text, p_iso3 text)
 RETURNS TABLE(geo_entity_id uuid, locality text, admin_level_1 text, lat numeric, lon numeric, geo_confidence numeric, match_strength numeric, match_kind text)
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text;
  v_top_phrase text;
  v_found boolean := false;
BEGIN
  IF p_text IS NULL OR length(p_text) < 6 OR p_iso3 IS NULL THEN RETURN; END IF;
  v_norm := lower(unaccent(p_text));

  SELECT phrase INTO v_top_phrase
  FROM public.lril_extract_place_phrases(p_text)
  ORDER BY weight DESC LIMIT 1;

  -- exact / alias
  RETURN QUERY
  WITH phrases AS (SELECT * FROM public.lril_extract_place_phrases(p_text)),
  matches AS (
    SELECT g.id AS gid, g.locality AS gloc, g.admin_level_1 AS gadm,
           g.lat AS glat, g.lon AS glon,
           CASE WHEN p.kind='admin_suffix' THEN 0.85::numeric
                WHEN p.kind='preposition'  THEN 0.78::numeric
                ELSE 0.62::numeric END AS conf,
           p.weight*(1.0+COALESCE(LEAST(g.population,1000000)::numeric/1000000.0,0)) AS strength,
           p.kind AS kind
    FROM phrases p JOIN public.aicis_geo_entities g ON g.iso3=p_iso3
    WHERE lower(coalesce(g.locality,''))=p.phrase
       OR lower(coalesce(g.city,''))=p.phrase
       OR lower(coalesce(g.admin_level_1,''))=p.phrase
    UNION ALL
    SELECT g.id, g.locality, g.admin_level_1, g.lat, g.lon, 0.80::numeric, p.weight, 'alias_exact'
    FROM phrases p
    JOIN public.aicis_geo_aliases a ON lower(unaccent(a.alias))=p.phrase
    JOIN public.aicis_geo_entities g ON g.id=a.geo_entity_id AND g.iso3=p_iso3
  )
  SELECT gid, gloc, gadm, glat, glon, conf, strength, kind FROM matches
  ORDER BY strength DESC, conf DESC LIMIT 1;
  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF v_found THEN RETURN; END IF;

  -- trigram
  RETURN QUERY
  SELECT g.id, g.locality, g.admin_level_1, g.lat, g.lon,
    (0.55+0.20*GREATEST(similarity(lower(unaccent(coalesce(g.locality,''))),v_norm),
                        similarity(lower(unaccent(coalesce(g.city,''))),v_norm)))::numeric,
    GREATEST(similarity(lower(unaccent(coalesce(g.locality,''))),v_norm),
             similarity(lower(unaccent(coalesce(g.city,''))),v_norm))::numeric,
    'trigram'::text
  FROM public.aicis_geo_entities g
  WHERE g.iso3=p_iso3 AND length(coalesce(g.locality,g.city,''))>=4
    AND (similarity(lower(unaccent(coalesce(g.locality,''))),v_norm)>=0.45
      OR similarity(lower(unaccent(coalesce(g.city,'')))    ,v_norm)>=0.45)
  ORDER BY 7 DESC LIMIT 1;
  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF v_found THEN RETURN; END IF;

  -- substring
  RETURN QUERY
  SELECT g.id, g.locality, g.admin_level_1, g.lat, g.lon,
    0.40::numeric, (length(coalesce(g.locality,g.city,g.admin_level_1,''))::numeric/50.0),
    'substring'::text
  FROM public.aicis_geo_entities g
  WHERE g.iso3=p_iso3 AND (
    (length(coalesce(g.locality,''))>=4 AND v_norm LIKE '%'||lower(unaccent(g.locality))||'%')
 OR (length(coalesce(g.city,''))    >=4 AND v_norm LIKE '%'||lower(unaccent(g.city))    ||'%')
 OR (length(coalesce(g.admin_level_1,''))>=5 AND v_norm LIKE '%'||lower(unaccent(g.admin_level_1))||'%'))
  ORDER BY length(coalesce(g.locality,g.city,g.admin_level_1)) DESC LIMIT 1;
  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF v_found THEN RETURN; END IF;

  -- LOG FAILURE (no match found)
  INSERT INTO public.aicis_geo_resolution_audit
    (signal_id, extracted_place, source_name, language, country_hint, attempted_match, match_score, reason_unresolved)
  VALUES
    (NULL, v_top_phrase, NULL, NULL, p_iso3, v_top_phrase, 0, 'no_match_in_gazetteer');
END;
$function$;

-- ---------------------------------------------------------
-- PRIORITY 2: Expand negative entities + pattern filters
-- ---------------------------------------------------------
INSERT INTO public.aicis_negative_entities (phrase, category) VALUES
  -- politicians / public figures
  ('donald trump','person'),('joe biden','person'),('vladimir putin','person'),
  ('xi jinping','person'),('volodymyr zelensky','person'),('zelensky','person'),
  ('emmanuel macron','person'),('macron','person'),('olaf scholz','person'),
  ('keir starmer','person'),('rishi sunak','person'),('benjamin netanyahu','person'),
  ('netanyahu','person'),('narendra modi','person'),('modi','person'),
  ('elon musk','person'),('elon','person'),('musk','person'),
  ('mark zuckerberg','person'),('jeff bezos','person'),('kim jong un','person'),
  ('mohammed bin salman','person'),('mbs','person'),('lula','person'),
  ('javier milei','person'),('milei','person'),('erdogan','person'),
  ('recep tayyip erdogan','person'),('giorgia meloni','person'),('meloni','person'),
  ('pedro sanchez','person'),('justin trudeau','person'),('trudeau','person'),
  ('anthony albanese','person'),('king charles','person'),('pope francis','person'),
  ('antonio guterres','person'),('kamala harris','person'),('jd vance','person'),
  ('marco rubio','person'),('antony blinken','person'),('sergei lavrov','person'),
  -- generic political phrases
  ('white house','institution'),('downing street','institution'),
  ('kremlin','institution'),('elysee palace','institution'),
  ('supreme court','institution'),('european commission','institution'),
  ('european parliament','institution'),('united nations','institution'),
  ('security council','institution'),('world bank','institution'),
  ('international monetary fund','institution'),('imf','institution'),
  ('nato','institution'),('opec','institution'),('wto','institution'),
  ('federal reserve','institution'),('european central bank','institution'),
  ('state department','institution'),('pentagon','institution'),
  ('home office','institution'),('foreign office','institution'),
  -- media outlets
  ('new york times','media'),('washington post','media'),('wall street journal','media'),
  ('financial times','media'),('the guardian','media'),('the times','media'),
  ('the telegraph','media'),('daily mail','media'),('the sun','media'),
  ('le monde','media'),('le figaro','media'),('der spiegel','media'),
  ('die welt','media'),('el pais','media'),('corriere della sera','media'),
  ('south china morning post','media'),('times of india','media'),('hindustan times','media'),
  ('cnn','media'),('fox news','media'),('msnbc','media'),('cnbc','media'),
  ('nbc news','media'),('cbs news','media'),('abc news','media'),
  ('reuters','media'),('ap news','media'),('axios','media'),('politico','media'),
  ('the atlantic','media'),('the economist','media'),('newsweek','media'),
  ('time magazine','media'),('vox','media'),('vice news','media'),
  ('huffpost','media'),('buzzfeed news','media'),('the intercept','media'),
  ('rt news','media'),('sputnik news','media'),('xinhua','media'),
  ('global times','media'),('press tv','media'),
  -- generic topic phrases
  ('breaking story','generic'),('top story','generic'),('latest update','generic'),
  ('exclusive report','generic'),('developing story','generic'),
  ('press release','generic'),('opinion piece','generic'),('editorial board','generic'),
  ('staff report','generic'),('news desk','generic'),('podcast episode','generic'),
  ('live updates','generic'),('analysis piece','generic')
ON CONFLICT (phrase) DO NOTHING;

-- Negative-pattern function: returns true if phrase looks like junk
CREATE OR REPLACE FUNCTION public.lril_is_negative_phrase(p_phrase text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $$
DECLARE v text;
BEGIN
  IF p_phrase IS NULL THEN RETURN true; END IF;
  v := lower(trim(p_phrase));
  IF length(v) < 3 THEN RETURN true; END IF;
  -- ends in media-suffix words
  IF v ~ '(news|times|post|report|index|tribune|gazette|herald|journal|chronicle|magazine|daily|weekly|review|press|wire|bulletin)\s*$' THEN
    RETURN true;
  END IF;
  -- contains action verbs (likely a verb-bigram, not a place)
  IF v ~ '\m(ordered|killed|shot|stabbed|dismember|attacked|raped|arrested|charged|sentenced|fired|arrested|launched|bombed|raided|murdered|assaulted|robbed|kidnapped|rescued|injured|wounded|protested|demanded|announced|claimed|denied|warned|threatened|accused)\M' THEN
    RETURN true;
  END IF;
  -- generic title prefixes (e.g., "president biden")
  IF v ~ '^(president|prime minister|minister|secretary|senator|governor|mayor|chancellor|king|queen|prince|pope|sheikh|ayatollah|general|admiral|colonel|judge|justice|chief|director|ceo|chairman)\s' THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

-- ---------------------------------------------------------
-- PRIORITY 3+4: Repaired + tuned compute_early_warnings
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_early_warnings()
 RETURNS TABLE(warnings_created integer, warnings_updated integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_created INT := 0; v_updated INT := 0; r RECORD; v_existed BOOLEAN;
BEGIN
  -- A. RISING CLUSTERS (n_cur >= 5 OR severity >= 0.65)
  FOR r IN
    WITH cur AS (
      SELECT iso3, event_type, subtype, COUNT(*) AS n_cur, AVG(severity) AS sev_cur,
             AVG(confidence) AS conf_cur, SUM(source_count) AS sc, MAX(start_time) AS last_seen
      FROM aicis_local_events WHERE start_time >= now() - interval '24 hours' AND iso3 IS NOT NULL
      GROUP BY iso3, event_type, subtype
      HAVING COUNT(*) >= 5 OR AVG(severity) >= 0.65
    ),
    prev AS (
      SELECT iso3, event_type, subtype, COUNT(*) AS n_prev FROM aicis_local_events
      WHERE start_time >= now() - interval '48 hours' AND start_time < now() - interval '24 hours' AND iso3 IS NOT NULL
      GROUP BY iso3, event_type, subtype
    )
    SELECT cur.*, COALESCE(prev.n_prev,0) AS n_prev FROM cur LEFT JOIN prev USING (iso3, event_type, subtype)
    WHERE cur.n_cur >= GREATEST(5, COALESCE(prev.n_prev,0) * 1.5)
       OR cur.sev_cur >= 0.65
  LOOP
    SELECT EXISTS(SELECT 1 FROM aicis_early_warnings WHERE dedup_key='rising:'||r.iso3||':'||r.event_type||':'||r.subtype||':'||to_char(now(),'YYYY-MM-DD-HH24')) INTO v_existed;
    INSERT INTO aicis_early_warnings (warning_kind, iso3, event_type, subtype, severity, confidence, escalation_probability, time_window_hours, source_count, event_count, metric, recommended_next_action, dedup_key)
    VALUES ('rising_cluster', r.iso3, r.event_type, r.subtype, r.sev_cur, r.conf_cur,
      LEAST(0.95, 0.4 + (r.n_cur::numeric/GREATEST(1,r.n_prev+1))*0.15), 24, r.sc::int, r.n_cur::int,
      jsonb_build_object('n_cur',r.n_cur,'n_prev',r.n_prev,'last_seen',r.last_seen),
      'Open situation room: 24h surge in '||r.subtype||' across '||r.iso3||'. Brief operations + verify with Tier-A sources.',
      'rising:'||r.iso3||':'||r.event_type||':'||r.subtype||':'||to_char(now(),'YYYY-MM-DD-HH24'))
    ON CONFLICT (dedup_key) DO UPDATE SET event_count=EXCLUDED.event_count, source_count=EXCLUDED.source_count, severity=EXCLUDED.severity, confidence=EXCLUDED.confidence, escalation_probability=EXCLUDED.escalation_probability, metric=EXCLUDED.metric, last_updated_at=now();
    IF v_existed THEN v_updated:=v_updated+1; ELSE v_created:=v_created+1; END IF;
  END LOOP;

  -- B. REPEATED LOCALITY (confidence >= 0.55)
  FOR r IN
    SELECT iso3, locality, event_type, subtype, admin_level_1, COUNT(*) AS n, AVG(severity) AS sev, AVG(confidence) AS conf, SUM(source_count) AS sc
    FROM aicis_local_events
    WHERE start_time >= now() - interval '7 days' AND iso3 IS NOT NULL AND locality IS NOT NULL
    GROUP BY iso3, locality, admin_level_1, event_type, subtype
    HAVING COUNT(*) >= 3 AND AVG(confidence) >= 0.55
  LOOP
    SELECT EXISTS(SELECT 1 FROM aicis_early_warnings WHERE dedup_key='repeated:'||r.iso3||':'||r.locality||':'||r.subtype) INTO v_existed;
    INSERT INTO aicis_early_warnings (warning_kind, iso3, locality, admin_level_1, event_type, subtype, severity, confidence, escalation_probability, time_window_hours, source_count, event_count, metric, recommended_next_action, dedup_key)
    VALUES ('repeated_locality', r.iso3, r.locality, r.admin_level_1, r.event_type, r.subtype, r.sev, r.conf,
      LEAST(0.9, 0.35 + r.n*0.05), 168, r.sc::int, r.n::int, jsonb_build_object('repeat_count',r.n),
      'Locality hotspot: '||r.locality||' has '||r.n||' '||r.subtype||' events in 7d. Allocate field verification.',
      'repeated:'||r.iso3||':'||r.locality||':'||r.subtype)
    ON CONFLICT (dedup_key) DO UPDATE SET event_count=EXCLUDED.event_count, severity=EXCLUDED.severity, confidence=EXCLUDED.confidence, escalation_probability=EXCLUDED.escalation_probability, metric=EXCLUDED.metric, last_updated_at=now();
    IF v_existed THEN v_updated:=v_updated+1; ELSE v_created:=v_created+1; END IF;
  END LOOP;

  -- C. SEVERITY SPIKE (min event count >= 3)
  FOR r IN
    WITH cur AS (
      SELECT iso3, event_type, AVG(severity) AS sev_cur, AVG(confidence) AS conf_cur, COUNT(*) AS n
      FROM aicis_local_events WHERE start_time >= now() - interval '24 hours' AND iso3 IS NOT NULL
      GROUP BY iso3, event_type HAVING COUNT(*) >= 3
    ),
    base AS (
      SELECT iso3, event_type, AVG(severity) AS sev_base FROM aicis_local_events
      WHERE start_time >= now() - interval '8 days' AND start_time < now() - interval '24 hours' AND iso3 IS NOT NULL
      GROUP BY iso3, event_type
    )
    SELECT cur.*, COALESCE(base.sev_base,0) AS sev_base FROM cur LEFT JOIN base USING (iso3, event_type)
    WHERE cur.sev_cur >= 0.5 AND cur.sev_cur >= COALESCE(base.sev_base,0)*1.5+0.1
  LOOP
    SELECT EXISTS(SELECT 1 FROM aicis_early_warnings WHERE dedup_key='spike:'||r.iso3||':'||r.event_type||':'||to_char(now(),'YYYY-MM-DD')) INTO v_existed;
    INSERT INTO aicis_early_warnings (warning_kind, iso3, event_type, severity, confidence, escalation_probability, time_window_hours, event_count, metric, recommended_next_action, dedup_key)
    VALUES ('severity_spike', r.iso3, r.event_type, r.sev_cur, r.conf_cur,
      LEAST(0.95, 0.5+(r.sev_cur-r.sev_base)), 24, r.n::int,
      jsonb_build_object('sev_cur',r.sev_cur,'sev_base',r.sev_base),
      'Severity spike in '||r.event_type||' for '||r.iso3||': escalate to executive brief and request Tier-A confirmation.',
      'spike:'||r.iso3||':'||r.event_type||':'||to_char(now(),'YYYY-MM-DD'))
    ON CONFLICT (dedup_key) DO UPDATE SET severity=EXCLUDED.severity, confidence=EXCLUDED.confidence, escalation_probability=EXCLUDED.escalation_probability, metric=EXCLUDED.metric, last_updated_at=now();
    IF v_existed THEN v_updated:=v_updated+1; ELSE v_created:=v_created+1; END IF;
  END LOOP;

  -- D. CROSS-BORDER SPILLOVER (severity >= 0.5, BOTH countries >= 2 events, exclude generic, cap per subtype)
  FOR r IN
    WITH centroid AS (
      SELECT iso3, AVG(lat) AS lat, AVG(lon) AS lon
      FROM aicis_geo_entities WHERE lat IS NOT NULL AND lon IS NOT NULL GROUP BY iso3
    ),
    base AS (
      SELECT iso3, event_type, subtype, COUNT(*) AS n, AVG(severity) AS sev, AVG(confidence) AS conf
      FROM aicis_local_events
      WHERE start_time >= now() - interval '48 hours' AND iso3 IS NOT NULL
        AND subtype IS NOT NULL
        AND lower(coalesce(subtype,'')) NOT IN ('general','other','misc','unknown','news','update','report','statement')
      GROUP BY iso3, event_type, subtype
      HAVING COUNT(*) >= 2 AND AVG(severity) >= 0.5
    ),
    pairs AS (
      SELECT a.iso3 AS iso_a, b.iso3 AS iso_b, a.event_type, a.subtype,
             a.n + b.n AS total_n, GREATEST(a.sev,b.sev) AS sev, GREATEST(a.conf,b.conf) AS conf,
             6371*acos(LEAST(1,cos(radians(ca.lat))*cos(radians(cb.lat))*cos(radians(cb.lon-ca.lon))+sin(radians(ca.lat))*sin(radians(cb.lat)))) AS dist_km,
             ROW_NUMBER() OVER (PARTITION BY a.event_type, a.subtype
                                ORDER BY GREATEST(a.sev,b.sev) DESC, (a.n+b.n) DESC) AS rn
      FROM base a
      JOIN base b ON a.event_type=b.event_type AND a.subtype=b.subtype AND a.iso3<b.iso3
      JOIN centroid ca ON ca.iso3=a.iso3
      JOIN centroid cb ON cb.iso3=b.iso3
      WHERE a.sev >= 0.5 AND b.sev >= 0.5
    )
    SELECT * FROM pairs WHERE dist_km < 1500 AND rn <= 5 LIMIT 50
  LOOP
    SELECT EXISTS(SELECT 1 FROM aicis_early_warnings WHERE dedup_key='spillover:'||r.iso_a||':'||r.iso_b||':'||r.subtype) INTO v_existed;
    INSERT INTO aicis_early_warnings (warning_kind, iso3, event_type, subtype, severity, confidence, escalation_probability, time_window_hours, event_count, metric, recommended_next_action, dedup_key)
    VALUES ('cross_border_spillover', r.iso_a||','||r.iso_b, r.event_type, r.subtype, r.sev, r.conf,
      LEAST(0.85, 0.45 + r.total_n*0.03), 48, r.total_n::int,
      jsonb_build_object('iso_a',r.iso_a,'iso_b',r.iso_b,'dist_km',r.dist_km),
      'Cross-border '||r.subtype||' between '||r.iso_a||' and '||r.iso_b||'. Trigger regional coordination.',
      'spillover:'||r.iso_a||':'||r.iso_b||':'||r.subtype)
    ON CONFLICT (dedup_key) DO UPDATE SET event_count=EXCLUDED.event_count, severity=EXCLUDED.severity, confidence=EXCLUDED.confidence, escalation_probability=EXCLUDED.escalation_probability, last_updated_at=now();
    IF v_existed THEN v_updated:=v_updated+1; ELSE v_created:=v_created+1; END IF;
  END LOOP;

  -- E. WEAK SIGNALS (>= 2 independent sources, source_count >= 2)
  FOR r IN
    SELECT iso3, locality, event_type, subtype, COUNT(*) AS n, AVG(severity) AS sev, AVG(confidence) AS conf, SUM(source_count) AS sc
    FROM aicis_local_events
    WHERE start_time >= now() - interval '6 hours' AND iso3 IS NOT NULL AND locality IS NOT NULL
      AND confidence BETWEEN 0.2 AND 0.4
    GROUP BY iso3, locality, event_type, subtype
    HAVING COUNT(*) >= 2 AND SUM(source_count) >= 2
  LOOP
    SELECT EXISTS(SELECT 1 FROM aicis_early_warnings WHERE dedup_key='weak:'||r.iso3||':'||r.locality||':'||r.subtype||':'||to_char(now(),'YYYY-MM-DD-HH24')) INTO v_existed;
    INSERT INTO aicis_early_warnings (warning_kind, iso3, locality, event_type, subtype, severity, confidence, escalation_probability, time_window_hours, source_count, event_count, metric, recommended_next_action, dedup_key)
    VALUES ('weak_signal', r.iso3, r.locality, r.event_type, r.subtype, r.sev, r.conf,
      LEAST(0.6, 0.25+r.n*0.05), 6, r.sc::int, r.n::int, jsonb_build_object('weak',true),
      'Weak signal in '||r.locality||' ('||r.subtype||'). Request Tier-A corroboration before public escalation.',
      'weak:'||r.iso3||':'||r.locality||':'||r.subtype||':'||to_char(now(),'YYYY-MM-DD-HH24'))
    ON CONFLICT (dedup_key) DO UPDATE SET event_count=EXCLUDED.event_count, severity=EXCLUDED.severity, confidence=EXCLUDED.confidence, escalation_probability=EXCLUDED.escalation_probability, last_updated_at=now();
    IF v_existed THEN v_updated:=v_updated+1; ELSE v_created:=v_created+1; END IF;
  END LOOP;

  -- F. Snapshot
  INSERT INTO aicis_warning_snapshots (total_warnings, by_kind, by_country, avg_escalation, avg_confidence)
  SELECT COUNT(*),
    (SELECT jsonb_object_agg(warning_kind,c) FROM (SELECT warning_kind,COUNT(*) c FROM aicis_early_warnings WHERE status='open' GROUP BY 1) k),
    (SELECT jsonb_object_agg(iso3,c) FROM (SELECT iso3,COUNT(*) c FROM aicis_early_warnings WHERE status='open' AND iso3 IS NOT NULL GROUP BY 1 ORDER BY c DESC LIMIT 25) ct),
    AVG(escalation_probability), AVG(confidence)
  FROM aicis_early_warnings WHERE status='open';

  RETURN QUERY SELECT v_created, v_updated;
END $function$;

-- ---------------------------------------------------------
-- PRIORITY 5: Evidence views
-- ---------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lril_unresolved_geo_evidence
WITH (security_invoker = true) AS
SELECT
  a.country_hint AS iso3,
  a.extracted_place,
  a.reason_unresolved,
  COUNT(*) AS occurrences,
  MAX(a.created_at) AS last_seen,
  MIN(a.created_at) AS first_seen
FROM public.aicis_geo_resolution_audit a
WHERE a.extracted_place IS NOT NULL
  AND length(a.extracted_place) >= 3
  AND NOT public.lril_is_negative_phrase(a.extracted_place)
  AND NOT EXISTS (SELECT 1 FROM public.aicis_negative_entities ne WHERE ne.phrase = lower(a.extracted_place))
GROUP BY a.country_hint, a.extracted_place, a.reason_unresolved
ORDER BY COUNT(*) DESC;

CREATE OR REPLACE VIEW public.v_lril_warning_quality
WITH (security_invoker = true) AS
SELECT
  warning_kind,
  COUNT(*) AS total,
  AVG(confidence) AS avg_confidence,
  AVG(severity) AS avg_severity,
  AVG(escalation_probability) AS avg_escalation,
  AVG(event_count) AS avg_event_count,
  AVG(source_count) AS avg_source_count,
  COUNT(*) FILTER (WHERE confidence >= 0.6) AS high_conf_count,
  COUNT(*) FILTER (WHERE confidence < 0.4)  AS low_conf_count,
  COUNT(*) FILTER (WHERE status='open') AS open_count
FROM public.aicis_early_warnings
WHERE first_detected_at > now() - interval '7 days'
GROUP BY warning_kind
ORDER BY total DESC;

CREATE OR REPLACE VIEW public.v_lril_warning_false_positive_risk
WITH (security_invoker = true) AS
SELECT
  w.id, w.warning_kind, w.iso3, w.locality, w.subtype,
  w.confidence, w.severity, w.event_count, w.source_count,
  w.first_detected_at,
  CASE
    WHEN w.confidence < 0.35 THEN 'high'
    WHEN w.confidence < 0.5  THEN 'medium'
    WHEN w.event_count <= 1  THEN 'medium'
    WHEN w.source_count <= 1 THEN 'medium'
    ELSE 'low'
  END AS fp_risk_tier,
  -- composite false-positive score: low conf + low evidence
  ROUND(
    GREATEST(0, 1 - w.confidence) * 0.5
    + GREATEST(0, 1 - LEAST(w.event_count, 5)::numeric / 5) * 0.3
    + GREATEST(0, 1 - LEAST(w.source_count, 3)::numeric / 3) * 0.2
  , 3) AS fp_score
FROM public.aicis_early_warnings w
WHERE w.status = 'open'
ORDER BY fp_score DESC;