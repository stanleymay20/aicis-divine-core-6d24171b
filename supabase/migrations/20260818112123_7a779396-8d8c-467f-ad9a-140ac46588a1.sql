
-- =====================================================================
-- P1: PROSPECTIVE PREDICTION INTEGRITY
-- =====================================================================
ALTER TABLE public.prediction_ledger
  ADD COLUMN IF NOT EXISTS seal_mode text NOT NULL DEFAULT 'retrospective_backfill',
  ADD COLUMN IF NOT EXISTS outcome_knowable_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS prospective_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payload_canonical jsonb,
  ADD COLUMN IF NOT EXISTS hash_version text NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS supersedes_ledger_id uuid,
  ADD COLUMN IF NOT EXISTS superseded_by_ledger_id uuid,
  ADD COLUMN IF NOT EXISTS correction_reason text;

DO $$ BEGIN
  ALTER TABLE public.prediction_ledger
    ADD CONSTRAINT prediction_ledger_seal_mode_chk
    CHECK (seal_mode IN ('prospective','retrospective_backfill'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Honest classification of the existing corpus.
UPDATE public.prediction_ledger
   SET outcome_knowable_at = ((target_date + 1)::timestamp AT TIME ZONE 'UTC'),
       seal_mode = CASE
         WHEN sealed_at < ((target_date + 1)::timestamp AT TIME ZONE 'UTC')
          AND sealed_at <= predicted_at + interval '7 days'
         THEN 'prospective' ELSE 'retrospective_backfill' END,
       prospective_eligible = (
         sealed_at < ((target_date + 1)::timestamp AT TIME ZONE 'UTC')
         AND sealed_at <= predicted_at + interval '7 days')
 WHERE outcome_knowable_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_prediction_ledger_prospective
  ON public.prediction_ledger (prospective_eligible, target_date);

-- ---------------------------------------------------------------------
-- Canonical commitment payload
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prediction_ledger_canonical_payload(
  p_source_table text, p_source_row_id uuid, p_subject_kind text, p_subject_key text,
  p_domain text, p_predicted_at timestamptz, p_sealed_at timestamptz,
  p_horizon_days int, p_target_date date, p_probability numeric,
  p_lo numeric, p_hi numeric, p_model_version text, p_method text,
  p_features jsonb, p_seal_mode text, p_outcome_knowable_at timestamptz)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'v', 2,
    'source_table', p_source_table,
    'source_row_id', p_source_row_id::text,
    'subject_kind', p_subject_kind,
    'subject_key', p_subject_key,
    'domain', COALESCE(p_domain,''),
    'predicted_at', to_char(p_predicted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sealed_at', to_char(p_sealed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'horizon_days', p_horizon_days,
    'target_date', p_target_date::text,
    'outcome_knowable_at', to_char(p_outcome_knowable_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'probability', round(p_probability, 8)::text,
    'interval_lower', COALESCE(round(p_lo,8)::text,''),
    'interval_upper', COALESCE(round(p_hi,8)::text,''),
    'model_version', COALESCE(p_model_version,'unknown'),
    'method', COALESCE(p_method,'unknown'),
    'seal_mode', p_seal_mode,
    'features', COALESCE(p_features,'{}'::jsonb));
$$;

-- ---------------------------------------------------------------------
-- Immutability of committed fields
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prediction_ledger_immutable_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'prediction_ledger entries are append-only; issue a superseding entry instead';
  END IF;
  IF NEW.ledger_key IS DISTINCT FROM OLD.ledger_key
     OR NEW.sequence_number IS DISTINCT FROM OLD.sequence_number
     OR NEW.sealed_at IS DISTINCT FROM OLD.sealed_at
     OR NEW.predicted_at IS DISTINCT FROM OLD.predicted_at
     OR NEW.source_table IS DISTINCT FROM OLD.source_table
     OR NEW.source_row_id IS DISTINCT FROM OLD.source_row_id
     OR NEW.subject_kind IS DISTINCT FROM OLD.subject_kind
     OR NEW.subject_key IS DISTINCT FROM OLD.subject_key
     OR NEW.domain IS DISTINCT FROM OLD.domain
     OR NEW.horizon_days IS DISTINCT FROM OLD.horizon_days
     OR NEW.target_date IS DISTINCT FROM OLD.target_date
     OR NEW.predicted_probability IS DISTINCT FROM OLD.predicted_probability
     OR NEW.interval_lower IS DISTINCT FROM OLD.interval_lower
     OR NEW.interval_upper IS DISTINCT FROM OLD.interval_upper
     OR NEW.model_version IS DISTINCT FROM OLD.model_version
     OR NEW.method IS DISTINCT FROM OLD.method
     OR NEW.features IS DISTINCT FROM OLD.features
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.payload_canonical IS DISTINCT FROM OLD.payload_canonical
     OR NEW.previous_hash IS DISTINCT FROM OLD.previous_hash
     OR NEW.chain_hash IS DISTINCT FROM OLD.chain_hash
     OR NEW.seal_mode IS DISTINCT FROM OLD.seal_mode
     OR NEW.prospective_eligible IS DISTINCT FROM OLD.prospective_eligible
     OR NEW.outcome_knowable_at IS DISTINCT FROM OLD.outcome_knowable_at
  THEN
    RAISE EXCEPTION 'committed prediction fields are immutable after sealing (ledger_key=%)', OLD.ledger_key;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_prediction_ledger_immutable ON public.prediction_ledger;
CREATE TRIGGER trg_prediction_ledger_immutable
  BEFORE UPDATE OR DELETE ON public.prediction_ledger
  FOR EACH ROW EXECUTE FUNCTION public.prediction_ledger_immutable_guard();

-- Outcomes are append-only too.
CREATE OR REPLACE FUNCTION public.prediction_ledger_outcomes_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'prediction_ledger_outcomes is append-only';
END; $$;

DROP TRIGGER IF EXISTS trg_prediction_ledger_outcomes_guard ON public.prediction_ledger_outcomes;
CREATE TRIGGER trg_prediction_ledger_outcomes_guard
  BEFORE UPDATE OR DELETE ON public.prediction_ledger_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.prediction_ledger_outcomes_guard();

-- ---------------------------------------------------------------------
-- Sealing v2: canonical hash + honest seal mode
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seal_predictions_into_ledger(p_limit integer DEFAULT 2000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; v_prev text; v_payload jsonb; v_hash text; v_chain text;
  v_count int := 0; v_prospective int := 0;
  v_mode text; v_knowable timestamptz; v_target date; v_now timestamptz := now();
BEGIN
  SELECT COALESCE(chain_hash,'genesis') INTO v_prev
    FROM public.prediction_ledger ORDER BY sequence_number DESC LIMIT 1;
  v_prev := COALESCE(v_prev,'genesis');

  FOR r IN
    SELECT * FROM (
      SELECT m.id, 'risk_ml_predictions'::text AS src, m.country_iso3, m.domain, m.generated_at,
             m.horizon_days, COALESCE(m.calibrated_score, m.risk_probability) AS prob,
             m.prediction_interval_lower AS lo, m.prediction_interval_upper AS hi,
             m.model_version, COALESCE(m.feature_contributions, m.feature_snapshot,'{}'::jsonb) AS feats,
             'risk_ml_inference'::text AS method
      FROM public.risk_ml_predictions m
      WHERE m.country_iso3 IS NOT NULL AND m.horizon_days IS NOT NULL
        AND COALESCE(m.calibrated_score, m.risk_probability) IS NOT NULL
      UNION ALL
      SELECT p.id, 'risk_ranking_predictions', p.country_iso3, p.domain, p.generated_at,
             p.horizon_days, p.risk_probability, p.confidence_lower, p.confidence_upper,
             p.model_version, COALESCE(p.factors,'{}'::jsonb), 'risk_ranking_baseline'
      FROM public.risk_ranking_predictions p
      WHERE p.country_iso3 IS NOT NULL AND p.horizon_days IS NOT NULL
        AND p.risk_probability IS NOT NULL
    ) s
    WHERE NOT EXISTS (SELECT 1 FROM public.prediction_ledger pl
      WHERE pl.source_table = s.src AND pl.source_row_id = s.id)
    ORDER BY s.generated_at ASC
    LIMIT p_limit
  LOOP
    v_target := (r.generated_at + (r.horizon_days || ' days')::interval)::date;
    v_knowable := ((v_target + 1)::timestamp AT TIME ZONE 'UTC');
    -- prospective only when the outcome cannot already be known at seal time
    -- and the prediction is being sealed promptly after it was produced.
    v_mode := CASE WHEN v_now < v_knowable AND v_now <= r.generated_at + interval '7 days'
                   THEN 'prospective' ELSE 'retrospective_backfill' END;

    v_payload := public.prediction_ledger_canonical_payload(
      r.src, r.id, 'country_domain', r.country_iso3 || '/' || COALESCE(r.domain,'all'),
      r.domain, r.generated_at, v_now, r.horizon_days, v_target,
      LEAST(1, GREATEST(0, round(r.prob,8))), r.lo, r.hi,
      COALESCE(r.model_version,'unknown'), r.method, r.feats, v_mode, v_knowable);

    v_hash := encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
    v_chain := encode(sha256(convert_to(v_prev || v_hash,'UTF8')),'hex');

    INSERT INTO public.prediction_ledger (
      ledger_key, sealed_at, predicted_at, source_table, source_row_id, subject_kind, subject_key,
      domain, horizon_days, target_date, predicted_probability, interval_lower, interval_upper,
      model_version, method, features, payload_hash, payload_canonical, hash_version,
      previous_hash, chain_hash, status, seal_mode, outcome_knowable_at, prospective_eligible)
    VALUES (
      r.src || ':' || r.id::text, v_now, r.generated_at, r.src, r.id,
      'country_domain', r.country_iso3 || '/' || COALESCE(r.domain,'all'),
      r.domain, r.horizon_days, v_target,
      LEAST(1, GREATEST(0, round(r.prob,8))), r.lo, r.hi,
      COALESCE(r.model_version,'unknown'), r.method, r.feats,
      v_hash, v_payload, 'v2', v_prev, v_chain, 'open',
      v_mode, v_knowable, (v_mode = 'prospective'))
    ON CONFLICT (ledger_key) DO NOTHING;

    IF FOUND THEN
      v_prev := v_chain; v_count := v_count + 1;
      IF v_mode = 'prospective' THEN v_prospective := v_prospective + 1; END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('sealed', v_count, 'prospective', v_prospective,
    'retrospective_backfill', v_count - v_prospective,
    'ledger_total', (SELECT count(*) FROM public.prediction_ledger));
END; $$;

-- Corrections must supersede, never edit.
CREATE OR REPLACE FUNCTION public.supersede_prediction_ledger_entry(
  p_ledger_id uuid, p_reason text, p_new_probability numeric DEFAULT NULL,
  p_new_lo numeric DEFAULT NULL, p_new_hi numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; v_prev text; v_payload jsonb; v_hash text; v_chain text;
  v_new_id uuid; v_now timestamptz := now(); v_mode text;
BEGIN
  SELECT * INTO o FROM public.prediction_ledger WHERE id = p_ledger_id;
  IF o.id IS NULL THEN RAISE EXCEPTION 'ledger entry % not found', p_ledger_id; END IF;
  IF o.superseded_by_ledger_id IS NOT NULL THEN
    RAISE EXCEPTION 'ledger entry % is already superseded', p_ledger_id; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'a correction reason is required'; END IF;

  SELECT COALESCE(chain_hash,'genesis') INTO v_prev
    FROM public.prediction_ledger ORDER BY sequence_number DESC LIMIT 1;

  v_mode := CASE WHEN v_now < o.outcome_knowable_at THEN 'prospective' ELSE 'retrospective_backfill' END;
  v_payload := public.prediction_ledger_canonical_payload(
    o.source_table, o.source_row_id, o.subject_kind, o.subject_key, o.domain,
    o.predicted_at, v_now, o.horizon_days, o.target_date,
    COALESCE(p_new_probability, o.predicted_probability),
    COALESCE(p_new_lo, o.interval_lower), COALESCE(p_new_hi, o.interval_upper),
    o.model_version, o.method, o.features, v_mode, o.outcome_knowable_at);
  v_hash := encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
  v_chain := encode(sha256(convert_to(v_prev || v_hash,'UTF8')),'hex');

  INSERT INTO public.prediction_ledger (
    ledger_key, sealed_at, predicted_at, source_table, source_row_id, subject_kind, subject_key,
    domain, horizon_days, target_date, predicted_probability, interval_lower, interval_upper,
    model_version, method, features, payload_hash, payload_canonical, hash_version,
    previous_hash, chain_hash, status, seal_mode, outcome_knowable_at, prospective_eligible,
    supersedes_ledger_id, correction_reason)
  VALUES (
    o.ledger_key || ':correction:' || to_char(v_now,'YYYYMMDDHH24MISSMS'), v_now, o.predicted_at,
    o.source_table, o.source_row_id, o.subject_kind, o.subject_key, o.domain, o.horizon_days,
    o.target_date, COALESCE(p_new_probability, o.predicted_probability),
    COALESCE(p_new_lo, o.interval_lower), COALESCE(p_new_hi, o.interval_upper),
    o.model_version, o.method, o.features, v_hash, v_payload, 'v2', v_prev, v_chain, 'open',
    v_mode, o.outcome_knowable_at, (v_mode = 'prospective'), o.id, p_reason)
  RETURNING id INTO v_new_id;

  UPDATE public.prediction_ledger
     SET superseded_by_ledger_id = v_new_id, status = 'superseded'
   WHERE id = o.id;

  RETURN jsonb_build_object('superseded', o.id, 'replacement', v_new_id, 'reason', p_reason);
END; $$;

-- Realization also records when the outcome was observed.
CREATE OR REPLACE FUNCTION public.realize_prediction_ledger(p_limit integer DEFAULT 5000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_scored int := 0; v_expired int := 0;
BEGIN
  WITH candidates AS (
    SELECT p.id AS ledger_id, p.predicted_probability, r.actual_label, r.realized_at,
           r.performance_index_at_realize, r.id AS realization_id
    FROM public.prediction_ledger p
    JOIN public.risk_prediction_realizations r ON r.prediction_id = p.source_row_id
    WHERE p.status = 'open' AND p.target_date <= CURRENT_DATE
      AND r.actual_label IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.prediction_ledger_outcomes o WHERE o.ledger_id = p.id)
    LIMIT p_limit
  ), ins AS (
    INSERT INTO public.prediction_ledger_outcomes (
      ledger_id, realized_at, actual_label, observed_value, brier_score,
      absolute_error, outcome_source, outcome_evidence, outcome_hash)
    SELECT c.ledger_id, c.realized_at, c.actual_label, c.performance_index_at_realize,
      round(power(c.predicted_probability - c.actual_label, 2), 8),
      round(abs(c.predicted_probability - c.actual_label), 8),
      'risk_prediction_realizations',
      jsonb_build_object('realization_id', c.realization_id),
      encode(sha256(convert_to(c.ledger_id::text || '|' || c.actual_label::text || '|'
        || round(c.predicted_probability, 8)::text,'UTF8')),'hex')
    FROM candidates c
    RETURNING ledger_id, realized_at
  )
  UPDATE public.prediction_ledger p
     SET status = 'realized', outcome_observed_at = ins.realized_at
  FROM ins WHERE p.id = ins.ledger_id;
  GET DIAGNOSTICS v_scored = ROW_COUNT;

  UPDATE public.prediction_ledger p SET status = 'expired_unscored'
  WHERE p.status = 'open' AND p.target_date < CURRENT_DATE - 60
    AND NOT EXISTS (SELECT 1 FROM public.prediction_ledger_outcomes o WHERE o.ledger_id = p.id);
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  RETURN jsonb_build_object('scored', v_scored, 'expired_unscored', v_expired,
    'still_open', (SELECT count(*) FROM public.prediction_ledger WHERE status='open'));
END; $$;

-- Prospective-only performance surface.
CREATE OR REPLACE VIEW public.prospective_prediction_performance
WITH (security_invoker = true) AS
SELECT
  p.domain,
  p.model_version,
  count(*)                                                   AS prospective_predictions,
  count(*) FILTER (WHERE p.target_date <= CURRENT_DATE)      AS due,
  count(o.id)                                                AS scored,
  round(100.0 * count(o.id)
        / NULLIF(count(*) FILTER (WHERE p.target_date <= CURRENT_DATE),0), 2) AS scoring_coverage_pct,
  round(avg(o.brier_score), 6)                               AS brier_score,
  round(avg(p.predicted_probability) FILTER (WHERE o.id IS NOT NULL), 6) AS mean_predicted,
  round(avg(o.actual_label) FILTER (WHERE o.id IS NOT NULL), 6)          AS mean_observed,
  round(abs(COALESCE(avg(p.predicted_probability) FILTER (WHERE o.id IS NOT NULL),0)
          - COALESCE(avg(o.actual_label) FILTER (WHERE o.id IS NOT NULL),0)), 6) AS calibration_gap
FROM public.prediction_ledger p
LEFT JOIN public.prediction_ledger_outcomes o ON o.ledger_id = p.id
WHERE p.prospective_eligible = true
GROUP BY p.domain, p.model_version;

GRANT SELECT ON public.prospective_prediction_performance TO authenticated;

-- =====================================================================
-- P3: WEAK-SIGNAL METHODOLOGY + REVIEW
-- =====================================================================
ALTER TABLE public.weak_signal_detections
  ADD COLUMN IF NOT EXISTS corroboration_quality text NOT NULL DEFAULT 'weak',
  ADD COLUMN IF NOT EXISTS corroborating_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS realized_outcome text,
  ADD COLUMN IF NOT EXISTS realized_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.weak_signal_detections
    ADD CONSTRAINT weak_signal_corroboration_quality_chk
    CHECK (corroboration_quality IN ('none','weak','domain_matched','event_linked'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.weak_signal_detections
    ADD CONSTRAINT weak_signal_review_verdict_chk
    CHECK (review_verdict IS NULL OR review_verdict IN ('true_positive','false_positive','inconclusive'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.review_weak_signal(
  p_detection_id uuid, p_verdict text, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator')) THEN
    RAISE EXCEPTION 'insufficient privileges to review weak signals';
  END IF;
  IF p_verdict NOT IN ('true_positive','false_positive','inconclusive') THEN
    RAISE EXCEPTION 'invalid verdict %', p_verdict;
  END IF;
  UPDATE public.weak_signal_detections
     SET review_verdict = p_verdict, review_notes = p_notes,
         reviewed_by = auth.uid(), reviewed_at = now(), status = 'reviewed', updated_at = now()
   WHERE id = p_detection_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'detection % not found', p_detection_id; END IF;
  RETURN jsonb_build_object('detection_id', p_detection_id, 'verdict', p_verdict);
END; $$;

CREATE OR REPLACE VIEW public.weak_signal_quality
WITH (security_invoker = true) AS
SELECT
  count(*)                                                      AS detections,
  count(*) FILTER (WHERE review_verdict IS NOT NULL)            AS reviewed,
  count(*) FILTER (WHERE review_verdict = 'true_positive')      AS true_positives,
  count(*) FILTER (WHERE review_verdict = 'false_positive')     AS false_positives,
  count(*) FILTER (WHERE corroboration_quality IN ('domain_matched','event_linked')) AS domain_corroborated,
  CASE WHEN count(*) FILTER (WHERE review_verdict IN ('true_positive','false_positive')) >= 20
       THEN round(100.0 * count(*) FILTER (WHERE review_verdict='true_positive')
            / NULLIF(count(*) FILTER (WHERE review_verdict IN ('true_positive','false_positive')),0), 2)
       ELSE NULL END                                            AS precision_pct,
  CASE WHEN count(*) FILTER (WHERE review_verdict IN ('true_positive','false_positive')) >= 20
       THEN 'measured' ELSE 'not_yet_proven' END                AS quality_status
FROM public.weak_signal_detections;

GRANT SELECT ON public.weak_signal_quality TO authenticated;

-- Domain-aware corroboration in detection.
CREATE OR REPLACE FUNCTION public.detect_weak_signals(
  p_window_days integer DEFAULT 14, p_baseline_days integer DEFAULT 180,
  p_anomaly_z numeric DEFAULT 2.5, p_weak_z numeric DEFAULT 1.5,
  p_min_baseline_n integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run_id uuid; v_max_date date; v_stale int;
  v_scanned int := 0; v_written int := 0; v_status text := 'success';
BEGIN
  SELECT max(snapshot_date) INTO v_max_date FROM public.country_performance_snapshots;
  IF v_max_date IS NULL THEN
    INSERT INTO public.weak_signal_runs (status, completed_at, error)
    VALUES ('error', now(), 'No country_performance_snapshots rows available')
    RETURNING id INTO v_run_id;
    RETURN jsonb_build_object('run_id', v_run_id,'status','error','reason','no input data','detections',0);
  END IF;

  v_stale := (CURRENT_DATE - v_max_date);
  IF v_stale > 21 THEN v_status := 'stale_input'; END IF;

  INSERT INTO public.weak_signal_runs (input_max_date, input_stale_days, parameters)
  VALUES (v_max_date, v_stale, jsonb_build_object(
    'window_days', p_window_days,'baseline_days', p_baseline_days,
    'anomaly_z', p_anomaly_z,'weak_z', p_weak_z,'min_baseline_n', p_min_baseline_n,
    'corroboration','domain_category_matched_v2'))
  RETURNING id INTO v_run_id;

  CREATE TEMP TABLE _ws_scored ON COMMIT DROP AS
  WITH recent AS (
    SELECT iso3, domain, avg(performance_index) AS obs, count(*) AS n_recent
    FROM public.country_performance_snapshots
    WHERE snapshot_date > v_max_date - p_window_days AND performance_index IS NOT NULL
    GROUP BY iso3, domain),
  baseline AS (
    SELECT iso3, domain, avg(performance_index) AS mu, stddev_samp(performance_index) AS sd, count(*) AS n
    FROM public.country_performance_snapshots
    WHERE snapshot_date <= v_max_date - p_window_days
      AND snapshot_date > v_max_date - p_window_days - p_baseline_days
      AND performance_index IS NOT NULL
    GROUP BY iso3, domain)
  SELECT r.iso3, r.domain, r.obs, b.mu, b.sd, b.n, ((r.obs - b.mu)/b.sd)::numeric AS z
  FROM recent r JOIN baseline b ON b.iso3 = r.iso3 AND b.domain = r.domain
  WHERE b.sd IS NOT NULL AND b.sd > 0 AND b.n >= p_min_baseline_n;

  -- Domain-specific corroboration: signals must match the domain's event categories,
  -- the same country, and the same detection time window.
  CREATE TEMP TABLE _ws_domain_cat ON COMMIT DROP AS
  SELECT * FROM (VALUES
    ('security','defense_conflict'),('security','social_unrest'),('security','maritime_security'),
    ('security','cybersecurity'),
    ('governance','geopolitical'),('governance','elections'),('governance','legal_regulatory'),
    ('finance','financial_markets'),('finance','economic'),('finance','central_banking'),
    ('health','public_health'),
    ('food','food_agriculture'),
    ('energy','energy'),
    ('climate','climate_disaster'),('climate','water_hydrology'),
    ('population','migration_displacement'),
    ('education','technology'),
    ('infrastructure','infrastructure'),('infrastructure','supply_chain')
  ) AS t(domain, category);

  CREATE TEMP TABLE _ws_src ON COMMIT DROP AS
  SELECT g.geo_admin0_iso3 AS iso3, dc.domain,
         count(DISTINCT g.ingestion_source)::int AS corr_sources,
         count(*)::int AS corr_signals
  FROM public.global_signals g
  JOIN _ws_domain_cat dc ON dc.category = g.category::text
  WHERE g.geo_admin0_iso3 IS NOT NULL
    AND g.ingested_at > now() - (p_window_days || ' days')::interval
  GROUP BY 1,2;

  WITH flagged AS (
    SELECT s.*, (CASE WHEN abs(s.z) >= p_weak_z THEN 1 ELSE 0 END) AS hot FROM _ws_scored s),
  corr AS (
    SELECT f.*, (sum(f.hot) OVER (PARTITION BY f.iso3) - f.hot)::int AS corr_domains FROM flagged f)
  INSERT INTO public.weak_signal_detections (
    run_id, iso3, domain, signal_class, observed_value, baseline_mean, baseline_stddev,
    baseline_sample_size, z_score, window_days, corroborating_domains, corroborating_sources,
    novelty_score, confidence, method, evidence, corroboration_quality, corroborating_evidence)
  SELECT
    v_run_id, c.iso3, c.domain,
    CASE WHEN abs(c.z) >= p_anomaly_z THEN 'anomaly'
         WHEN c.corr_domains >= 2 THEN 'corroborated_cluster'
         ELSE 'weak_signal' END,
    round(c.obs::numeric,4), round(c.mu::numeric,4), round(c.sd::numeric,4), c.n,
    round(c.z,4), p_window_days, c.corr_domains, COALESCE(x.corr_sources,0),
    round(LEAST(1.0, abs(c.z)/6.0),4),
    round(LEAST(1.0,
      (LEAST(1.0, abs(c.z)/p_anomaly_z) * 0.5)
      + (LEAST(1.0, c.corr_domains::numeric/3.0) * 0.25)
      + (LEAST(1.0, COALESCE(x.corr_sources,0)::numeric/5.0) * 0.25)),4),
    'snapshot_zscore_v2',
    jsonb_build_object('source_table','country_performance_snapshots','input_max_date',v_max_date,
      'input_stale_days',v_stale,'baseline_window_days',p_baseline_days),
    CASE WHEN COALESCE(x.corr_sources,0) > 0 THEN 'domain_matched' ELSE 'none' END,
    jsonb_build_object(
      'corroboration_method','global_signals category matched to domain, same country, same window',
      'window_days', p_window_days,
      'matched_categories', (SELECT jsonb_agg(dc.category) FROM _ws_domain_cat dc WHERE dc.domain = c.domain),
      'distinct_sources', COALESCE(x.corr_sources,0),
      'matched_signals', COALESCE(x.corr_signals,0),
      'limitation','signals are matched by country+category+time window, not by verified causal link')
  FROM corr c
  LEFT JOIN _ws_src x ON x.iso3 = c.iso3 AND x.domain = c.domain
  WHERE c.hot = 1
  ON CONFLICT (iso3, domain, signal_class, detected_on) DO NOTHING;

  GET DIAGNOSTICS v_written = ROW_COUNT;
  SELECT count(*) INTO v_scanned FROM _ws_scored;

  UPDATE public.weak_signal_runs
     SET completed_at = now(), status = v_status,
         candidates_scanned = v_scanned, detections_written = v_written
   WHERE id = v_run_id;

  RETURN jsonb_build_object('run_id',v_run_id,'status',v_status,'input_max_date',v_max_date,
    'input_stale_days',v_stale,'candidates_scanned',v_scanned,'detections',v_written);
END; $$;

-- =====================================================================
-- P4: MULTI-AGENT EVIDENCE-GROUNDED ANALYSIS (analysis only, no actuation)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.agent_coordination_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_key text UNIQUE NOT NULL,
  question text NOT NULL,
  subject_kind text NOT NULL DEFAULT 'country',
  subject_key text,
  domains text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid,
  provider text,
  model text,
  evidence_window_days int NOT NULL DEFAULT 30,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.agent_coordination_tasks TO authenticated;
GRANT ALL ON public.agent_coordination_tasks TO service_role;
ALTER TABLE public.agent_coordination_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent tasks readable by authenticated" ON public.agent_coordination_tasks;
CREATE POLICY "agent tasks readable by authenticated" ON public.agent_coordination_tasks
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "agent tasks writable by admins" ON public.agent_coordination_tasks;
CREATE POLICY "agent tasks writable by admins" ON public.agent_coordination_tasks
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.agent_specialist_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.agent_coordination_tasks(id) ON DELETE CASCADE,
  specialist text NOT NULL,
  assessment text NOT NULL,
  key_findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_count int NOT NULL DEFAULT 0,
  confidence numeric NOT NULL DEFAULT 0,
  uncertainty_notes text,
  provider text,
  model text,
  model_version text,
  prompt_hash text,
  latency_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.agent_specialist_analyses TO authenticated;
GRANT ALL ON public.agent_specialist_analyses TO service_role;
ALTER TABLE public.agent_specialist_analyses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent analyses readable by authenticated" ON public.agent_specialist_analyses;
CREATE POLICY "agent analyses readable by authenticated" ON public.agent_specialist_analyses
  FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.agent_disagreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.agent_coordination_tasks(id) ON DELETE CASCADE,
  topic text NOT NULL,
  specialist_a text NOT NULL,
  position_a text NOT NULL,
  specialist_b text NOT NULL,
  position_b text NOT NULL,
  divergence numeric,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.agent_disagreements TO authenticated;
GRANT ALL ON public.agent_disagreements TO service_role;
ALTER TABLE public.agent_disagreements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent disagreements readable by authenticated" ON public.agent_disagreements;
CREATE POLICY "agent disagreements readable by authenticated" ON public.agent_disagreements
  FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.agent_syntheses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL UNIQUE REFERENCES public.agent_coordination_tasks(id) ON DELETE CASCADE,
  executive_summary text NOT NULL,
  agreed_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  preserved_dissent jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_analysis text,
  overall_confidence numeric NOT NULL DEFAULT 0,
  evidence_reference_count int NOT NULL DEFAULT 0,
  provider text, model text, prompt_hash text,
  human_authorization_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.agent_syntheses TO authenticated;
GRANT ALL ON public.agent_syntheses TO service_role;
ALTER TABLE public.agent_syntheses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent syntheses readable by authenticated" ON public.agent_syntheses;
CREATE POLICY "agent syntheses readable by authenticated" ON public.agent_syntheses
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_agent_analyses_task ON public.agent_specialist_analyses(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_disagreements_task ON public.agent_disagreements(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_created ON public.agent_coordination_tasks(created_at DESC);

CREATE OR REPLACE VIEW public.agent_run_quality
WITH (security_invoker = true) AS
SELECT
  t.id AS task_id, t.task_key, t.subject_key, t.status, t.created_at,
  count(DISTINCT a.specialist)                        AS specialists,
  COALESCE(sum(a.evidence_count),0)                   AS total_evidence_refs,
  count(DISTINCT a.specialist) FILTER (WHERE a.evidence_count > 0) AS evidence_cited_specialists,
  (SELECT count(*) FROM public.agent_disagreements d WHERE d.task_id = t.id) AS disagreements,
  (SELECT count(*) FROM public.agent_syntheses s WHERE s.task_id = t.id) AS syntheses,
  (t.status = 'completed'
   AND count(DISTINCT a.specialist) >= 3
   AND count(DISTINCT a.specialist) FILTER (WHERE a.evidence_count > 0) >= 3
   AND (SELECT count(*) FROM public.agent_syntheses s WHERE s.task_id = t.id) = 1
  ) AS quality_run
FROM public.agent_coordination_tasks t
LEFT JOIN public.agent_specialist_analyses a ON a.task_id = t.id
GROUP BY t.id;

GRANT SELECT ON public.agent_run_quality TO authenticated;
