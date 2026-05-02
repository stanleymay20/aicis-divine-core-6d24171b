CREATE OR REPLACE FUNCTION public.compute_early_warnings()
RETURNS TABLE(warnings_created INT, warnings_updated INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_created INT := 0; v_updated INT := 0; r RECORD; v_existed BOOLEAN;
BEGIN
  -- A. RISING CLUSTERS
  FOR r IN
    WITH cur AS (
      SELECT iso3, event_type, subtype, COUNT(*) AS n_cur, AVG(severity) AS sev_cur,
             AVG(confidence) AS conf_cur, SUM(source_count) AS sc, MAX(start_time) AS last_seen
      FROM aicis_local_events WHERE start_time >= now() - interval '24 hours' AND iso3 IS NOT NULL
      GROUP BY iso3, event_type, subtype HAVING COUNT(*) >= 3
    ),
    prev AS (
      SELECT iso3, event_type, subtype, COUNT(*) AS n_prev FROM aicis_local_events
      WHERE start_time >= now() - interval '48 hours' AND start_time < now() - interval '24 hours' AND iso3 IS NOT NULL
      GROUP BY iso3, event_type, subtype
    )
    SELECT cur.*, COALESCE(prev.n_prev,0) AS n_prev FROM cur LEFT JOIN prev USING (iso3, event_type, subtype)
    WHERE cur.n_cur >= GREATEST(3, COALESCE(prev.n_prev,0) * 1.5)
  LOOP
    SELECT EXISTS(SELECT 1 FROM aicis_early_warnings WHERE dedup_key = 'rising:'||r.iso3||':'||r.event_type||':'||r.subtype||':'||to_char(now(),'YYYY-MM-DD-HH24')) INTO v_existed;
    INSERT INTO aicis_early_warnings (warning_kind, iso3, event_type, subtype, severity, confidence, escalation_probability, time_window_hours, source_count, event_count, metric, recommended_next_action, dedup_key)
    VALUES ('rising_cluster', r.iso3, r.event_type, r.subtype, r.sev_cur, r.conf_cur,
      LEAST(0.95, 0.4 + (r.n_cur::numeric/GREATEST(1,r.n_prev+1))*0.15), 24, r.sc::int, r.n_cur::int,
      jsonb_build_object('n_cur',r.n_cur,'n_prev',r.n_prev,'last_seen',r.last_seen),
      'Open situation room: 24h surge in '||r.subtype||' across '||r.iso3||'. Brief operations + verify with Tier-A sources.',
      'rising:'||r.iso3||':'||r.event_type||':'||r.subtype||':'||to_char(now(),'YYYY-MM-DD-HH24'))
    ON CONFLICT (dedup_key) DO UPDATE SET event_count=EXCLUDED.event_count, source_count=EXCLUDED.source_count, severity=EXCLUDED.severity, confidence=EXCLUDED.confidence, escalation_probability=EXCLUDED.escalation_probability, metric=EXCLUDED.metric, last_updated_at=now();
    IF v_existed THEN v_updated := v_updated + 1; ELSE v_created := v_created + 1; END IF;
  END LOOP;

  -- B. REPEATED LOCALITY
  FOR r IN
    SELECT iso3, locality, event_type, subtype, admin_level_1, COUNT(*) AS n, AVG(severity) AS sev, AVG(confidence) AS conf, SUM(source_count) AS sc
    FROM aicis_local_events WHERE start_time >= now() - interval '7 days' AND iso3 IS NOT NULL AND locality IS NOT NULL
    GROUP BY iso3, locality, admin_level_1, event_type, subtype HAVING COUNT(*) >= 3
  LOOP
    SELECT EXISTS(SELECT 1 FROM aicis_early_warnings WHERE dedup_key = 'repeated:'||r.iso3||':'||r.locality||':'||r.subtype) INTO v_existed;
    INSERT INTO aicis_early_warnings (warning_kind, iso3, locality, admin_level_1, event_type, subtype, severity, confidence, escalation_probability, time_window_hours, source_count, event_count, metric, recommended_next_action, dedup_key)
    VALUES ('repeated_locality', r.iso3, r.locality, r.admin_level_1, r.event_type, r.subtype, r.sev, r.conf,
      LEAST(0.9, 0.35 + r.n*0.05), 168, r.sc::int, r.n::int, jsonb_build_object('repeat_count',r.n),
      'Locality hotspot: '||r.locality||' has '||r.n||' '||r.subtype||' events in 7d. Allocate field verification.',
      'repeated:'||r.iso3||':'||r.locality||':'||r.subtype)
    ON CONFLICT (dedup_key) DO UPDATE SET event_count=EXCLUDED.event_count, severity=EXCLUDED.severity, confidence=EXCLUDED.confidence, escalation_probability=EXCLUDED.escalation_probability, metric=EXCLUDED.metric, last_updated_at=now();
    IF v_existed THEN v_updated := v_updated + 1; ELSE v_created := v_created + 1; END IF;
  END LOOP;

  -- C. SEVERITY SPIKE
  FOR r IN
    WITH cur AS (
      SELECT iso3, event_type, AVG(severity) AS sev_cur, AVG(confidence) AS conf_cur, COUNT(*) AS n
      FROM aicis_local_events WHERE start_time >= now() - interval '24 hours' AND iso3 IS NOT NULL
      GROUP BY iso3, event_type HAVING COUNT(*) >= 2
    ),
    base AS (
      SELECT iso3, event_type, AVG(severity) AS sev_base FROM aicis_local_events
      WHERE start_time >= now() - interval '8 days' AND start_time < now() - interval '24 hours' AND iso3 IS NOT NULL
      GROUP BY iso3, event_type
    )
    SELECT cur.*, COALESCE(base.sev_base,0) AS sev_base FROM cur LEFT JOIN base USING (iso3, event_type)
    WHERE cur.sev_cur >= 0.5 AND cur.sev_cur >= COALESCE(base.sev_base,0) * 1.5 + 0.1
  LOOP
    SELECT EXISTS(SELECT 1 FROM aicis_early_warnings WHERE dedup_key = 'spike:'||r.iso3||':'||r.event_type||':'||to_char(now(),'YYYY-MM-DD')) INTO v_existed;
    INSERT INTO aicis_early_warnings (warning_kind, iso3, event_type, severity, confidence, escalation_probability, time_window_hours, event_count, metric, recommended_next_action, dedup_key)
    VALUES ('severity_spike', r.iso3, r.event_type, r.sev_cur, r.conf_cur,
      LEAST(0.95, 0.5 + (r.sev_cur - r.sev_base)), 24, r.n::int,
      jsonb_build_object('sev_cur',r.sev_cur,'sev_base',r.sev_base),
      'Severity spike in '||r.event_type||' for '||r.iso3||': escalate to executive brief and request Tier-A confirmation.',
      'spike:'||r.iso3||':'||r.event_type||':'||to_char(now(),'YYYY-MM-DD'))
    ON CONFLICT (dedup_key) DO UPDATE SET severity=EXCLUDED.severity, confidence=EXCLUDED.confidence, escalation_probability=EXCLUDED.escalation_probability, metric=EXCLUDED.metric, last_updated_at=now();
    IF v_existed THEN v_updated := v_updated + 1; ELSE v_created := v_created + 1; END IF;
  END LOOP;

  -- D. CROSS-BORDER SPILLOVER (precompute centroids once)
  FOR r IN
    WITH centroid AS (
      SELECT iso3, AVG(lat) AS lat, AVG(lon) AS lon FROM aicis_geo_entities WHERE lat IS NOT NULL AND lon IS NOT NULL GROUP BY iso3
    ),
    base AS (
      SELECT iso3, event_type, subtype, COUNT(*) AS n, AVG(severity) AS sev, AVG(confidence) AS conf
      FROM aicis_local_events WHERE start_time >= now() - interval '48 hours' AND iso3 IS NOT NULL
      GROUP BY iso3, event_type, subtype
    ),
    pairs AS (
      SELECT a.iso3 AS iso_a, b.iso3 AS iso_b, a.event_type, a.subtype,
             a.n + b.n AS total_n, GREATEST(a.sev,b.sev) AS sev, GREATEST(a.conf,b.conf) AS conf,
             6371*acos(LEAST(1,cos(radians(ca.lat))*cos(radians(cb.lat))*cos(radians(cb.lon-ca.lon))+sin(radians(ca.lat))*sin(radians(cb.lat)))) AS dist_km
      FROM base a JOIN base b ON a.event_type=b.event_type AND a.subtype=b.subtype AND a.iso3 < b.iso3
      JOIN centroid ca ON ca.iso3 = a.iso3
      JOIN centroid cb ON cb.iso3 = b.iso3
    )
    SELECT * FROM pairs WHERE dist_km < 2000 LIMIT 200
  LOOP
    SELECT EXISTS(SELECT 1 FROM aicis_early_warnings WHERE dedup_key = 'spillover:'||r.iso_a||':'||r.iso_b||':'||r.subtype) INTO v_existed;
    INSERT INTO aicis_early_warnings (warning_kind, iso3, event_type, subtype, severity, confidence, escalation_probability, time_window_hours, event_count, metric, recommended_next_action, dedup_key)
    VALUES ('cross_border_spillover', r.iso_a||','||r.iso_b, r.event_type, r.subtype, r.sev, r.conf,
      LEAST(0.85, 0.45 + r.total_n*0.03), 48, r.total_n::int,
      jsonb_build_object('iso_a',r.iso_a,'iso_b',r.iso_b,'dist_km',r.dist_km),
      'Cross-border '||r.subtype||' between '||r.iso_a||' and '||r.iso_b||'. Trigger regional coordination.',
      'spillover:'||r.iso_a||':'||r.iso_b||':'||r.subtype)
    ON CONFLICT (dedup_key) DO UPDATE SET event_count=EXCLUDED.event_count, severity=EXCLUDED.severity, confidence=EXCLUDED.confidence, escalation_probability=EXCLUDED.escalation_probability, last_updated_at=now();
    IF v_existed THEN v_updated := v_updated + 1; ELSE v_created := v_created + 1; END IF;
  END LOOP;

  -- E. WEAK SIGNALS
  FOR r IN
    SELECT iso3, locality, event_type, subtype, COUNT(*) AS n, AVG(severity) AS sev, AVG(confidence) AS conf, SUM(source_count) AS sc
    FROM aicis_local_events WHERE start_time >= now() - interval '6 hours' AND iso3 IS NOT NULL AND locality IS NOT NULL
      AND confidence BETWEEN 0.2 AND 0.4
    GROUP BY iso3, locality, event_type, subtype HAVING COUNT(*) >= 2 AND SUM(source_count) >= 2
  LOOP
    SELECT EXISTS(SELECT 1 FROM aicis_early_warnings WHERE dedup_key = 'weak:'||r.iso3||':'||r.locality||':'||r.subtype||':'||to_char(now(),'YYYY-MM-DD-HH24')) INTO v_existed;
    INSERT INTO aicis_early_warnings (warning_kind, iso3, locality, event_type, subtype, severity, confidence, escalation_probability, time_window_hours, source_count, event_count, metric, recommended_next_action, dedup_key)
    VALUES ('weak_signal', r.iso3, r.locality, r.event_type, r.subtype, r.sev, r.conf,
      LEAST(0.6, 0.25 + r.n*0.05), 6, r.sc::int, r.n::int, jsonb_build_object('weak',true),
      'Weak signal in '||r.locality||' ('||r.subtype||'). Request Tier-A corroboration before public escalation.',
      'weak:'||r.iso3||':'||r.locality||':'||r.subtype||':'||to_char(now(),'YYYY-MM-DD-HH24'))
    ON CONFLICT (dedup_key) DO UPDATE SET event_count=EXCLUDED.event_count, severity=EXCLUDED.severity, confidence=EXCLUDED.confidence, escalation_probability=EXCLUDED.escalation_probability, last_updated_at=now();
    IF v_existed THEN v_updated := v_updated + 1; ELSE v_created := v_created + 1; END IF;
  END LOOP;

  -- F. Snapshot
  INSERT INTO aicis_warning_snapshots (total_warnings, by_kind, by_country, avg_escalation, avg_confidence)
  SELECT COUNT(*),
    (SELECT jsonb_object_agg(warning_kind, c) FROM (SELECT warning_kind, COUNT(*) c FROM aicis_early_warnings WHERE status='open' GROUP BY 1) k),
    (SELECT jsonb_object_agg(iso3, c) FROM (SELECT iso3, COUNT(*) c FROM aicis_early_warnings WHERE status='open' AND iso3 IS NOT NULL GROUP BY 1 ORDER BY c DESC LIMIT 25) ct),
    AVG(escalation_probability), AVG(confidence)
  FROM aicis_early_warnings WHERE status='open';

  RETURN QUERY SELECT v_created, v_updated;
END $$;