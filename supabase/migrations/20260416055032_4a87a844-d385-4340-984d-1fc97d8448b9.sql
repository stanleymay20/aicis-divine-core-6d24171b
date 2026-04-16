
-- Domain match policy table
CREATE TABLE public.forecast_domain_match_policies (
  domain text PRIMARY KEY,
  actual_source_table text NOT NULL DEFAULT 'normalized_metrics',
  value_field text NOT NULL DEFAULT 'value',
  timestamp_field text NOT NULL DEFAULT 'created_at',
  match_window_days integer NOT NULL DEFAULT 7,
  preferred_period_type text,
  direction_threshold_pct numeric NOT NULL DEFAULT 1.0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.forecast_domain_match_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read match policies"
  ON public.forecast_domain_match_policies FOR SELECT USING (true);

-- Seed major domains
INSERT INTO public.forecast_domain_match_policies (domain, match_window_days, direction_threshold_pct, preferred_period_type, notes) VALUES
  ('economic', 14, 1.5, 'quarterly', 'Economic indicators often lag; wider window'),
  ('health', 7, 1.0, 'monthly', 'Health data typically monthly'),
  ('education', 14, 2.0, 'annual', 'Education data is annual, wider threshold'),
  ('governance', 10, 1.5, 'annual', 'Governance indices update annually'),
  ('infrastructure', 10, 2.0, 'annual', 'Infrastructure metrics slow-moving'),
  ('environment', 7, 1.0, 'monthly', 'Environmental data monthly'),
  ('trade', 7, 1.0, 'monthly', 'Trade data monthly frequency'),
  ('conflict', 3, 0.5, 'daily', 'Conflict data near real-time'),
  ('political_stability', 10, 1.5, 'quarterly', 'Political stability updates quarterly');

-- Enhanced match quality audit
CREATE OR REPLACE FUNCTION public.audit_prospective_match_quality()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total bigint;
  v_within_1d bigint; v_within_3d bigint; v_within_7d bigint;
  v_avg_delay numeric;
  v_null_actuals bigint; v_missing_iso3 bigint;
  v_quality numeric;
  v_samples jsonb;
  v_policy_backed bigint; v_fallback bigint;
  v_fallback_domains jsonb;
  v_domain_delays jsonb;
  v_suspicious jsonb;
BEGIN
  SELECT COUNT(*) INTO v_total FROM forecast_prospective_evaluations WHERE evaluation_locked = true;
  IF v_total = 0 THEN
    RETURN jsonb_build_object('sample_size', 0, 'quality_score', 0);
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE metadata->>'actual_created_at' IS NOT NULL AND
      ABS(EXTRACT(EPOCH FROM (realized_at - (metadata->>'actual_created_at')::timestamptz)) / 86400) <= 1),
    COUNT(*) FILTER (WHERE metadata->>'actual_created_at' IS NOT NULL AND
      ABS(EXTRACT(EPOCH FROM (realized_at - (metadata->>'actual_created_at')::timestamptz)) / 86400) <= 3),
    COUNT(*) FILTER (WHERE metadata->>'actual_created_at' IS NOT NULL AND
      ABS(EXTRACT(EPOCH FROM (realized_at - (metadata->>'actual_created_at')::timestamptz)) / 86400) <= 7),
    COALESCE(AVG(CASE WHEN metadata->>'actual_created_at' IS NOT NULL THEN
      ABS(EXTRACT(EPOCH FROM (realized_at - (metadata->>'actual_created_at')::timestamptz)) / 86400) END), 0),
    COUNT(*) FILTER (WHERE realized_value IS NULL),
    COUNT(*) FILTER (WHERE iso3 IS NULL OR iso3 = '')
  INTO v_within_1d, v_within_3d, v_within_7d, v_avg_delay, v_null_actuals, v_missing_iso3
  FROM forecast_prospective_evaluations WHERE evaluation_locked = true;

  -- Policy vs fallback
  SELECT
    COUNT(*) FILTER (WHERE metadata->>'policy_status' IS NULL OR metadata->>'policy_status' = 'domain_policy'),
    COUNT(*) FILTER (WHERE metadata->>'policy_status' = 'default_fallback')
  INTO v_policy_backed, v_fallback
  FROM forecast_prospective_evaluations WHERE evaluation_locked = true;

  -- Domains using fallback
  SELECT COALESCE(jsonb_agg(DISTINCT domain), '[]'::jsonb)
  INTO v_fallback_domains
  FROM forecast_prospective_evaluations
  WHERE evaluation_locked = true AND metadata->>'policy_status' = 'default_fallback';

  -- Avg delay by domain
  SELECT COALESCE(jsonb_agg(jsonb_build_object('domain', d, 'avg_delay', ROUND(ad::numeric, 1), 'count', cnt)), '[]'::jsonb)
  INTO v_domain_delays
  FROM (
    SELECT domain AS d,
      AVG(CASE WHEN metadata->>'actual_created_at' IS NOT NULL THEN
        ABS(EXTRACT(EPOCH FROM (realized_at - (metadata->>'actual_created_at')::timestamptz)) / 86400) END) AS ad,
      COUNT(*) AS cnt
    FROM forecast_prospective_evaluations WHERE evaluation_locked = true
    GROUP BY domain
  ) sub;

  -- Suspicious domains: high missing_actual or high delay
  SELECT COALESCE(jsonb_agg(jsonb_build_object('domain', d, 'missing_rate', ROUND(mr::numeric, 1), 'avg_delay', ROUND(ad::numeric, 1), 'reason', r)), '[]'::jsonb)
  INTO v_suspicious
  FROM (
    SELECT domain AS d,
      COUNT(*) FILTER (WHERE metadata->>'status' = 'missing_actual')::numeric / NULLIF(COUNT(*), 0) * 100 AS mr,
      AVG(CASE WHEN metadata->>'actual_created_at' IS NOT NULL THEN
        ABS(EXTRACT(EPOCH FROM (realized_at - (metadata->>'actual_created_at')::timestamptz)) / 86400) END) AS ad,
      CASE
        WHEN COUNT(*) FILTER (WHERE metadata->>'status' = 'missing_actual')::numeric / NULLIF(COUNT(*), 0) > 0.3 THEN 'high_missing_actual'
        WHEN AVG(CASE WHEN metadata->>'actual_created_at' IS NOT NULL THEN
          ABS(EXTRACT(EPOCH FROM (realized_at - (metadata->>'actual_created_at')::timestamptz)) / 86400) END) > 5 THEN 'high_delay'
        ELSE NULL
      END AS r
    FROM forecast_prospective_evaluations
    GROUP BY domain
    HAVING COUNT(*) FILTER (WHERE metadata->>'status' = 'missing_actual')::numeric / NULLIF(COUNT(*), 0) > 0.3
       OR AVG(CASE WHEN metadata->>'actual_created_at' IS NOT NULL THEN
          ABS(EXTRACT(EPOCH FROM (realized_at - (metadata->>'actual_created_at')::timestamptz)) / 86400) END) > 5
  ) sub;

  v_quality := GREATEST(0, LEAST(100,
    ROUND((v_within_3d::numeric / NULLIF(v_total, 0) * 50) +
          (GREATEST(0, 30 - v_avg_delay) / 30 * 30) +
          ((v_total - v_null_actuals - v_missing_iso3)::numeric / NULLIF(v_total, 0) * 20))
  ));

  -- Sample rows
  SELECT COALESCE(jsonb_agg(row_to_json(sub)), '[]'::jsonb) INTO v_samples FROM (
    SELECT id AS forecast_id, domain, iso3, realization_due_at,
      metadata->>'actual_created_at' AS actual_created_at,
      CASE WHEN metadata->>'actual_created_at' IS NOT NULL THEN
        ROUND(ABS(EXTRACT(EPOCH FROM (realized_at - (metadata->>'actual_created_at')::timestamptz)) / 86400)::numeric, 1) END AS delay_days,
      COALESCE(metadata->>'policy_status', 'domain_policy') AS policy_status,
      CASE WHEN realized_value IS NOT NULL THEN 'matched' ELSE 'missing' END AS status
    FROM forecast_prospective_evaluations WHERE evaluation_locked = true
    ORDER BY realized_at DESC LIMIT 10
  ) sub;

  RETURN jsonb_build_object(
    'sample_size', v_total,
    'matched_within_1d', v_within_1d, 'matched_within_3d', v_within_3d, 'matched_within_7d', v_within_7d,
    'average_match_delay_days', ROUND(v_avg_delay, 1),
    'rows_with_null_actuals', v_null_actuals, 'rows_with_missing_iso3', v_missing_iso3,
    'quality_score', v_quality,
    'policy_backed_matches', v_policy_backed, 'fallback_matches', v_fallback,
    'fallback_rate_pct', CASE WHEN v_total > 0 THEN ROUND(v_fallback::numeric / v_total * 100, 1) ELSE 0 END,
    'fallback_domains', v_fallback_domains,
    'domain_delays', v_domain_delays,
    'suspicious_domains', v_suspicious,
    'samples', v_samples
  );
END;
$$;
