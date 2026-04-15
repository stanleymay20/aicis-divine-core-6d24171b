
-- Generate critical alerts from conflict signals
INSERT INTO critical_alerts (headline, level, iso3, country, event_type, severity, meta, triggered_at)
SELECT 
  COALESCE(cs.conflict_type, 'Conflict') || ' — ' || cs.country_iso3 || ' (' || cs.region || ')',
  CASE 
    WHEN cs.escalation_probability >= 0.7 THEN 'urgent'
    WHEN cs.escalation_probability >= 0.4 THEN 'high'
    ELSE 'medium'
  END,
  cs.country_iso3,
  cs.country_iso3,
  COALESCE(cs.conflict_type, 'conflict_signal'),
  COALESCE(cs.conflict_intensity, 5)::int,
  jsonb_build_object(
    'source', 'conflict_signals',
    'signal_id', cs.id,
    'escalation_probability', cs.escalation_probability,
    'diplomatic_tension', cs.diplomatic_tension
  ),
  COALESCE(cs.created_at, now())
FROM conflict_signals cs
WHERE cs.escalation_probability >= 0.4
  OR cs.conflict_intensity >= 7
ON CONFLICT DO NOTHING;

-- Flag overdue execution items  
UPDATE decision_outcome_log
SET execution_status = 'overdue'
WHERE execution_status = 'not_started'
  AND created_at < now() - (COALESCE(review_sla_hours, 24) * interval '1 hour');

-- Clean up zombie jobs
SELECT cleanup_zombie_jobs();
