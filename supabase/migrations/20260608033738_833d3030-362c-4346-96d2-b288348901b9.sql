DROP FUNCTION IF EXISTS public.compute_trust_completion_score();

CREATE OR REPLACE FUNCTION public.compute_trust_completion_score()
RETURNS TABLE(
  signal_citations_pct numeric,
  warning_citations_pct numeric,
  recommendation_citations_pct numeric,
  official_source_pct numeric,
  chain_integrity_pct numeric,
  weighted_score numeric,
  gate_status text,
  hard_fail_eligible boolean,
  signals_total bigint,
  signals_cited bigint,
  warnings_total bigint,
  warnings_cited bigint,
  recs_total bigint,
  recs_cited bigint,
  citations_total bigint,
  citations_official bigint,
  authority_t1_count bigint,
  authority_t2_count bigint,
  authority_t3_count bigint,
  authority_other_count bigint,
  chain_total bigint,
  chain_present bigint,
  computed_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_signals_total bigint;
  v_signals_cited bigint;
  v_warnings_total bigint;
  v_warnings_cited bigint;
  v_recs_total bigint;
  v_recs_cited bigint;
  v_citations_total bigint;
  v_t1 bigint; v_t2 bigint; v_t3 bigint; v_other bigint;
  v_chain_total bigint;
  v_chain_present bigint;
  v_sig_pct numeric;
  v_warn_pct numeric;
  v_rec_pct numeric;
  v_auth_pct numeric;
  v_chain_pct numeric;
  v_score numeric;
  v_gate text;
BEGIN
  SELECT count(*) INTO v_signals_total FROM global_signals WHERE primary_source IS NOT NULL;
  SELECT count(DISTINCT subject_id) INTO v_signals_cited
    FROM intelligence_citations WHERE subject_type = 'global_signals';

  SELECT count(*) INTO v_warnings_total FROM aicis_early_warnings;
  SELECT count(DISTINCT subject_id) INTO v_warnings_cited
    FROM intelligence_citations WHERE subject_type = 'aicis_early_warnings';

  SELECT count(*) INTO v_recs_total FROM risk_action_recommendations;
  SELECT count(DISTINCT subject_id) INTO v_recs_cited
    FROM intelligence_citations WHERE subject_type = 'risk_action_recommendations';

  WITH classified AS (
    SELECT
      CASE
        WHEN r.authority_tier = 1 THEN 1
        WHEN r.authority_tier = 2 THEN 2
        WHEN r.authority_tier = 3 THEN 3
        WHEN c.source_type = 'official' THEN 1
        ELSE 0
      END AS tier_bucket
    FROM intelligence_citations c
    LEFT JOIN source_authority_registry r ON r.publisher_key = c.publisher_key
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE tier_bucket = 1),
    count(*) FILTER (WHERE tier_bucket = 2),
    count(*) FILTER (WHERE tier_bucket = 3),
    count(*) FILTER (WHERE tier_bucket = 0)
  INTO v_citations_total, v_t1, v_t2, v_t3, v_other
  FROM classified;

  v_auth_pct := CASE WHEN v_citations_total > 0
    THEN round(100.0 * (v_t1 * 1.00 + v_t2 * 0.70 + v_t3 * 0.40 + v_other * 0.05) / v_citations_total, 2)
    ELSE 0 END;

  v_chain_total := v_warnings_total + v_recs_total;
  SELECT
    (SELECT count(*) FROM ledger_entries WHERE entry_type::text = 'crisis')
    + (SELECT count(*) FROM ledger_entries WHERE entry_type::text = 'recommendation')
    INTO v_chain_present;

  v_sig_pct   := CASE WHEN v_signals_total  > 0 THEN round(100.0 * v_signals_cited::numeric  / v_signals_total,  2) ELSE 0 END;
  v_warn_pct  := CASE WHEN v_warnings_total > 0 THEN round(100.0 * v_warnings_cited::numeric / v_warnings_total, 2) ELSE 0 END;
  v_rec_pct   := CASE WHEN v_recs_total     > 0 THEN round(100.0 * v_recs_cited::numeric     / v_recs_total,     2) ELSE 0 END;
  v_chain_pct := CASE WHEN v_chain_total    > 0 THEN round(LEAST(100.0, 100.0 * v_chain_present::numeric / v_chain_total), 2) ELSE 0 END;

  v_score := round(
      (v_sig_pct   * 0.40)
    + (v_warn_pct  * 0.20)
    + (v_rec_pct   * 0.20)
    + (v_auth_pct  * 0.10)
    + (v_chain_pct * 0.10)
  , 2);

  v_gate := CASE
    WHEN v_score >= 95 THEN 'PASSED'
    WHEN v_score >= 80 THEN 'NEAR_READY'
    ELSE 'BLOCKED'
  END;

  RETURN QUERY SELECT
    v_sig_pct, v_warn_pct, v_rec_pct, v_auth_pct, v_chain_pct,
    v_score, v_gate, (v_score >= 95),
    v_signals_total, v_signals_cited,
    v_warnings_total, v_warnings_cited,
    v_recs_total, v_recs_cited,
    v_citations_total, (v_t1 + v_t2),
    v_t1, v_t2, v_t3, v_other,
    v_chain_total, v_chain_present,
    now();
END $function$;