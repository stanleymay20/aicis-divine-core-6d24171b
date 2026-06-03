
CREATE OR REPLACE FUNCTION public.compute_trust_completion_score()
RETURNS TABLE (
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
  chain_total bigint,
  chain_present bigint,
  computed_at timestamptz
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_signals_total bigint;
  v_signals_cited bigint;
  v_warnings_total bigint;
  v_warnings_cited bigint;
  v_recs_total bigint;
  v_recs_cited bigint;
  v_citations_total bigint;
  v_citations_official bigint;
  v_chain_total bigint;
  v_chain_present bigint;
  v_sig_pct numeric;
  v_warn_pct numeric;
  v_rec_pct numeric;
  v_off_pct numeric;
  v_chain_pct numeric;
  v_score numeric;
  v_gate text;
BEGIN
  -- Signals: denominator = signals that actually have a source to cite
  SELECT count(*) INTO v_signals_total
    FROM global_signals WHERE primary_source IS NOT NULL;
  SELECT count(DISTINCT subject_id) INTO v_signals_cited
    FROM intelligence_citations WHERE subject_type = 'global_signals';

  -- Warnings
  SELECT count(*) INTO v_warnings_total FROM aicis_early_warnings;
  SELECT count(DISTINCT subject_id) INTO v_warnings_cited
    FROM intelligence_citations WHERE subject_type = 'aicis_early_warnings';

  -- Recommendations
  SELECT count(*) INTO v_recs_total FROM risk_action_recommendations;
  SELECT count(DISTINCT subject_id) INTO v_recs_cited
    FROM intelligence_citations WHERE subject_type = 'risk_action_recommendations';

  -- Official source match: citations resolved to tier-1/2 authority or marked 'official'
  SELECT count(*) INTO v_citations_total FROM intelligence_citations;
  SELECT count(*) INTO v_citations_official
    FROM intelligence_citations c
    LEFT JOIN source_authority_registry r ON r.publisher_key = c.publisher_key
    WHERE c.source_type = 'official'
       OR (r.authority_tier IS NOT NULL AND r.authority_tier <= 2);

  -- Chain integrity: warnings + recs back-chained into ledger_entries
  v_chain_total := v_warnings_total + v_recs_total;
  SELECT
    (SELECT count(*) FROM ledger_entries WHERE entry_type::text = 'crisis')
    + (SELECT count(*) FROM ledger_entries WHERE entry_type::text = 'recommendation')
    INTO v_chain_present;

  v_sig_pct   := CASE WHEN v_signals_total  > 0 THEN round(100.0 * v_signals_cited::numeric  / v_signals_total,  2) ELSE 0 END;
  v_warn_pct  := CASE WHEN v_warnings_total > 0 THEN round(100.0 * v_warnings_cited::numeric / v_warnings_total, 2) ELSE 0 END;
  v_rec_pct   := CASE WHEN v_recs_total     > 0 THEN round(100.0 * v_recs_cited::numeric     / v_recs_total,     2) ELSE 0 END;
  v_off_pct   := CASE WHEN v_citations_total > 0 THEN round(100.0 * v_citations_official::numeric / v_citations_total, 2) ELSE 0 END;
  v_chain_pct := CASE WHEN v_chain_total    > 0 THEN round(LEAST(100.0, 100.0 * v_chain_present::numeric / v_chain_total), 2) ELSE 0 END;

  -- Doctrine weights: 40 / 20 / 20 / 10 / 10
  v_score := round(
      (v_sig_pct   * 0.40)
    + (v_warn_pct  * 0.20)
    + (v_rec_pct   * 0.20)
    + (v_off_pct   * 0.10)
    + (v_chain_pct * 0.10)
  , 2);

  v_gate := CASE
    WHEN v_score >= 95 THEN 'PASSED'
    WHEN v_score >= 80 THEN 'NEAR_READY'
    ELSE 'BLOCKED'
  END;

  RETURN QUERY SELECT
    v_sig_pct, v_warn_pct, v_rec_pct, v_off_pct, v_chain_pct,
    v_score, v_gate, (v_score >= 95),
    v_signals_total, v_signals_cited,
    v_warnings_total, v_warnings_cited,
    v_recs_total, v_recs_cited,
    v_citations_total, v_citations_official,
    v_chain_total, v_chain_present,
    now();
END $$;

GRANT EXECUTE ON FUNCTION public.compute_trust_completion_score() TO anon, authenticated, service_role;
