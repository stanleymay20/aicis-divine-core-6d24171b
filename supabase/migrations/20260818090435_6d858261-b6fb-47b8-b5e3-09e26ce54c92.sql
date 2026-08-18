-- Normal survival function (Abramowitz & Stegun 7.1.26 based), used for p-values.
CREATE OR REPLACE FUNCTION public.normal_two_sided_p(z numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  x double precision := abs(z::double precision);
  t double precision;
  y double precision;
BEGIN
  IF x IS NULL THEN RETURN NULL; END IF;
  IF x > 40 THEN RETURN 0; END IF;
  t := 1.0 / (1.0 + 0.2316419 * x);
  y := 1.0 - (1.0 / sqrt(2 * pi())) * exp(-x * x / 2.0) *
       (0.319381530 * t - 0.356563782 * power(t, 2) + 1.781477937 * power(t, 3)
        - 1.821255978 * power(t, 4) + 1.330274429 * power(t, 5));
  RETURN GREATEST(0, LEAST(1, (2.0 * (1.0 - y))))::numeric;
END;
$$;

-- =====================================================================
-- LAYER 3: INTELLIGENCE EXPERIMENTS / HYPOTHESIS TESTING
-- =====================================================================
CREATE TABLE public.intelligence_hypotheses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hypothesis_key text NOT NULL UNIQUE,
  statement text NOT NULL,
  subject_domain text NOT NULL,
  object_domain text NOT NULL,
  lag_days integer NOT NULL DEFAULT 30,
  scope text NOT NULL DEFAULT 'global',
  scope_iso3 text,
  method text NOT NULL DEFAULT 'lagged_pearson_fisher_v1',
  min_sample_size integer NOT NULL DEFAULT 200,
  min_effect_size numeric NOT NULL DEFAULT 0.15,
  alpha numeric NOT NULL DEFAULT 0.05,
  status text NOT NULL DEFAULT 'proposed',
  rationale text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hypothesis_scope_chk CHECK (scope IN ('global','country')),
  CONSTRAINT hypothesis_status_chk CHECK (status IN ('proposed','testing','supported','not_supported','inconclusive','retired')),
  CONSTRAINT hypothesis_lag_chk CHECK (lag_days >= 0 AND lag_days <= 365),
  CONSTRAINT hypothesis_alpha_chk CHECK (alpha > 0 AND alpha < 1)
);

CREATE INDEX idx_hypotheses_status ON public.intelligence_hypotheses (status, updated_at DESC);

GRANT SELECT ON public.intelligence_hypotheses TO authenticated;
GRANT ALL ON public.intelligence_hypotheses TO service_role;
ALTER TABLE public.intelligence_hypotheses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read hypotheses"
  ON public.intelligence_hypotheses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage hypotheses"
  ON public.intelligence_hypotheses FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Service role manages hypotheses"
  ON public.intelligence_hypotheses FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_hypotheses_updated_at
  BEFORE UPDATE ON public.intelligence_hypotheses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.hypothesis_evaluations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hypothesis_id uuid NOT NULL REFERENCES public.intelligence_hypotheses(id) ON DELETE CASCADE,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  method text NOT NULL,
  sample_size integer NOT NULL,
  country_count integer NOT NULL,
  effect_size numeric,
  fisher_z numeric,
  p_value numeric,
  ci_lower numeric,
  ci_upper numeric,
  verdict text NOT NULL,
  input_max_date date,
  input_stale_days integer,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hypothesis_verdict_chk CHECK (verdict IN ('supported','not_supported','inconclusive'))
);

CREATE INDEX idx_hyp_eval_hypothesis ON public.hypothesis_evaluations (hypothesis_id, evaluated_at DESC);

GRANT SELECT ON public.hypothesis_evaluations TO authenticated;
GRANT SELECT, INSERT ON public.hypothesis_evaluations TO service_role;
ALTER TABLE public.hypothesis_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read hypothesis evaluations"
  ON public.hypothesis_evaluations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role inserts hypothesis evaluations"
  ON public.hypothesis_evaluations FOR INSERT TO service_role WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Table %.% is append-only: % is not permitted',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE TRIGGER trg_hyp_eval_immutable
  BEFORE UPDATE OR DELETE ON public.hypothesis_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

CREATE OR REPLACE FUNCTION public.evaluate_hypothesis(p_hypothesis_id uuid, p_history_days integer DEFAULT 365)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  h public.intelligence_hypotheses%ROWTYPE;
  v_max_date date;
  v_n int := 0;
  v_countries int := 0;
  v_r numeric;
  v_z numeric;
  v_p numeric;
  v_lo numeric;
  v_hi numeric;
  v_verdict text;
  v_hash text;
  v_eval_id uuid;
BEGIN
  SELECT * INTO h FROM public.intelligence_hypotheses WHERE id = p_hypothesis_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hypothesis % not found', p_hypothesis_id; END IF;

  SELECT max(snapshot_date) INTO v_max_date FROM public.country_performance_snapshots;

  WITH a AS (
    SELECT iso3, snapshot_date, performance_index AS va
    FROM public.country_performance_snapshots
    WHERE domain = h.subject_domain
      AND performance_index IS NOT NULL
      AND snapshot_date > v_max_date - p_history_days
      AND (h.scope = 'global' OR iso3 = h.scope_iso3)
  ),
  b AS (
    SELECT iso3, snapshot_date, performance_index AS vb
    FROM public.country_performance_snapshots
    WHERE domain = h.object_domain
      AND performance_index IS NOT NULL
      AND snapshot_date > v_max_date - p_history_days
      AND (h.scope = 'global' OR iso3 = h.scope_iso3)
  ),
  paired AS (
    SELECT a.iso3, a.va, b.vb
    FROM a JOIN b
      ON b.iso3 = a.iso3
     AND b.snapshot_date = a.snapshot_date + h.lag_days
  )
  SELECT count(*)::int, count(DISTINCT iso3)::int, corr(va, vb)::numeric
    INTO v_n, v_countries, v_r
  FROM paired;

  IF v_n >= 4 AND v_r IS NOT NULL AND abs(v_r) < 1 THEN
    v_z := (atanh(v_r::double precision) * sqrt((v_n - 3)::double precision))::numeric;
    v_p := public.normal_two_sided_p(v_z);
    v_lo := tanh(atanh(v_r::double precision) - 1.959964 / sqrt((v_n - 3)::double precision))::numeric;
    v_hi := tanh(atanh(v_r::double precision) + 1.959964 / sqrt((v_n - 3)::double precision))::numeric;
  END IF;

  IF v_n < h.min_sample_size OR v_r IS NULL THEN
    v_verdict := 'inconclusive';
  ELSIF v_p IS NOT NULL AND v_p < h.alpha AND abs(v_r) >= h.min_effect_size THEN
    v_verdict := 'supported';
  ELSE
    v_verdict := 'not_supported';
  END IF;

  v_hash := encode(sha256(convert_to(
    h.hypothesis_key || '|' || h.method || '|' || COALESCE(v_max_date::text,'') || '|' ||
    v_n::text || '|' || COALESCE(round(v_r,8)::text,'null') || '|' || v_verdict, 'UTF8')), 'hex');

  INSERT INTO public.hypothesis_evaluations (
    hypothesis_id, method, sample_size, country_count, effect_size, fisher_z, p_value,
    ci_lower, ci_upper, verdict, input_max_date, input_stale_days, evidence, result_hash)
  VALUES (
    h.id, h.method, v_n, v_countries,
    round(v_r, 6), round(v_z, 6), round(v_p, 8), round(v_lo, 6), round(v_hi, 6),
    v_verdict, v_max_date, (CURRENT_DATE - v_max_date),
    jsonb_build_object(
      'source_table','country_performance_snapshots',
      'subject_domain', h.subject_domain,
      'object_domain', h.object_domain,
      'lag_days', h.lag_days,
      'history_days', p_history_days,
      'min_sample_size', h.min_sample_size,
      'min_effect_size', h.min_effect_size,
      'alpha', h.alpha),
    v_hash)
  RETURNING id INTO v_eval_id;

  UPDATE public.intelligence_hypotheses SET status = v_verdict WHERE id = h.id;

  RETURN jsonb_build_object(
    'evaluation_id', v_eval_id, 'hypothesis_key', h.hypothesis_key,
    'sample_size', v_n, 'country_count', v_countries,
    'effect_size', round(v_r, 6), 'p_value', round(v_p, 8),
    'ci', jsonb_build_array(round(v_lo,6), round(v_hi,6)),
    'verdict', v_verdict, 'result_hash', v_hash);
END;
$$;

CREATE OR REPLACE FUNCTION public.evaluate_all_hypotheses()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record; out_arr jsonb := '[]'::jsonb;
BEGIN
  FOR r IN SELECT id FROM public.intelligence_hypotheses WHERE status <> 'retired' ORDER BY created_at LOOP
    out_arr := out_arr || public.evaluate_hypothesis(r.id);
  END LOOP;
  RETURN jsonb_build_object('evaluated', jsonb_array_length(out_arr), 'results', out_arr);
END;
$$;

-- =====================================================================
-- LAYER 4: GLOBAL PREDICTION LEDGER
-- =====================================================================
CREATE TABLE public.prediction_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sequence_number bigserial NOT NULL,
  ledger_key text NOT NULL UNIQUE,
  sealed_at timestamptz NOT NULL DEFAULT now(),
  predicted_at timestamptz NOT NULL,
  source_table text NOT NULL,
  source_row_id uuid,
  subject_kind text NOT NULL DEFAULT 'country_domain',
  subject_key text NOT NULL,
  domain text,
  horizon_days integer NOT NULL,
  target_date date NOT NULL,
  predicted_probability numeric NOT NULL,
  interval_lower numeric,
  interval_upper numeric,
  model_version text NOT NULL,
  method text NOT NULL,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash text NOT NULL,
  previous_hash text NOT NULL,
  chain_hash text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  CONSTRAINT prediction_ledger_prob_chk CHECK (predicted_probability >= 0 AND predicted_probability <= 1),
  CONSTRAINT prediction_ledger_status_chk CHECK (status IN ('open','realized','expired_unscored'))
);

CREATE INDEX idx_pred_ledger_seq ON public.prediction_ledger (sequence_number DESC);
CREATE INDEX idx_pred_ledger_open ON public.prediction_ledger (target_date) WHERE status = 'open';
CREATE INDEX idx_pred_ledger_subject ON public.prediction_ledger (subject_key, domain, predicted_at DESC);
CREATE INDEX idx_pred_ledger_source ON public.prediction_ledger (source_table, source_row_id);

GRANT SELECT ON public.prediction_ledger TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.prediction_ledger TO service_role;
ALTER TABLE public.prediction_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read prediction ledger"
  ON public.prediction_ledger FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role writes prediction ledger"
  ON public.prediction_ledger FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Sealed predictions are immutable except for the status transition.
CREATE OR REPLACE FUNCTION public.protect_prediction_ledger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'prediction_ledger is append-only: DELETE is not permitted';
  END IF;
  IF NEW.ledger_key IS DISTINCT FROM OLD.ledger_key
     OR NEW.predicted_probability IS DISTINCT FROM OLD.predicted_probability
     OR NEW.predicted_at IS DISTINCT FROM OLD.predicted_at
     OR NEW.target_date IS DISTINCT FROM OLD.target_date
     OR NEW.horizon_days IS DISTINCT FROM OLD.horizon_days
     OR NEW.model_version IS DISTINCT FROM OLD.model_version
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.chain_hash IS DISTINCT FROM OLD.chain_hash
     OR NEW.previous_hash IS DISTINCT FROM OLD.previous_hash
     OR NEW.features IS DISTINCT FROM OLD.features THEN
    RAISE EXCEPTION 'Sealed prediction % cannot be modified', OLD.ledger_key;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prediction_ledger_protect
  BEFORE UPDATE OR DELETE ON public.prediction_ledger
  FOR EACH ROW EXECUTE FUNCTION public.protect_prediction_ledger();

CREATE TABLE public.prediction_ledger_outcomes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ledger_id uuid NOT NULL UNIQUE REFERENCES public.prediction_ledger(id) ON DELETE RESTRICT,
  realized_at timestamptz NOT NULL DEFAULT now(),
  actual_label integer NOT NULL,
  observed_value numeric,
  brier_score numeric NOT NULL,
  absolute_error numeric NOT NULL,
  outcome_source text NOT NULL,
  outcome_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outcome_label_chk CHECK (actual_label IN (0,1))
);

CREATE INDEX idx_pred_outcomes_realized ON public.prediction_ledger_outcomes (realized_at DESC);

GRANT SELECT ON public.prediction_ledger_outcomes TO authenticated;
GRANT SELECT, INSERT ON public.prediction_ledger_outcomes TO service_role;
ALTER TABLE public.prediction_ledger_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read prediction outcomes"
  ON public.prediction_ledger_outcomes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role inserts prediction outcomes"
  ON public.prediction_ledger_outcomes FOR INSERT TO service_role WITH CHECK (true);

CREATE TRIGGER trg_pred_outcomes_immutable
  BEFORE UPDATE OR DELETE ON public.prediction_ledger_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

-- Honest performance: open, expired-unscored and scored are all reported.
CREATE VIEW public.prediction_ledger_performance
WITH (security_invoker = true) AS
SELECT
  p.model_version,
  p.domain,
  count(*) AS sealed_total,
  count(*) FILTER (WHERE p.status = 'open') AS open_awaiting_horizon,
  count(*) FILTER (WHERE p.status = 'expired_unscored') AS expired_unscored,
  count(o.id) AS scored_total,
  round(100.0 * count(o.id) / NULLIF(count(*), 0), 2) AS scored_pct,
  round(avg(o.brier_score), 6) AS mean_brier_score,
  round(avg(o.absolute_error), 6) AS mean_absolute_error,
  round(avg(p.predicted_probability) FILTER (WHERE o.id IS NOT NULL), 6) AS mean_predicted,
  round(avg(o.actual_label::numeric), 6) AS mean_observed,
  min(p.predicted_at) AS first_prediction_at,
  max(p.predicted_at) AS last_prediction_at
FROM public.prediction_ledger p
LEFT JOIN public.prediction_ledger_outcomes o ON o.ledger_id = p.id
GROUP BY p.model_version, p.domain;

GRANT SELECT ON public.prediction_ledger_performance TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.seal_predictions_into_ledger(p_limit integer DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_prev text;
  v_payload text;
  v_payload_hash text;
  v_chain text;
  v_count int := 0;
BEGIN
  SELECT COALESCE(chain_hash, 'genesis') INTO v_prev
    FROM public.prediction_ledger ORDER BY sequence_number DESC LIMIT 1;
  v_prev := COALESCE(v_prev, 'genesis');

  FOR r IN
    SELECT m.id, m.country_iso3, m.domain, m.generated_at, m.horizon_days,
           COALESCE(m.calibrated_score, m.risk_probability) AS prob,
           m.prediction_interval_lower, m.prediction_interval_upper,
           m.model_version, m.feature_contributions, m.feature_snapshot
    FROM public.risk_ml_predictions m
    WHERE m.country_iso3 IS NOT NULL
      AND m.horizon_days IS NOT NULL
      AND COALESCE(m.calibrated_score, m.risk_probability) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.prediction_ledger pl
        WHERE pl.source_table = 'risk_ml_predictions' AND pl.source_row_id = m.id)
    ORDER BY m.generated_at ASC
    LIMIT p_limit
  LOOP
    v_payload := r.country_iso3 || '|' || COALESCE(r.domain,'') || '|' || r.generated_at::text
      || '|' || r.horizon_days::text || '|' || round(r.prob, 8)::text
      || '|' || COALESCE(r.model_version, 'unknown');
    v_payload_hash := encode(sha256(convert_to(v_payload, 'UTF8')), 'hex');
    v_chain := encode(sha256(convert_to(v_prev || v_payload_hash, 'UTF8')), 'hex');

    INSERT INTO public.prediction_ledger (
      ledger_key, predicted_at, source_table, source_row_id, subject_kind, subject_key,
      domain, horizon_days, target_date, predicted_probability, interval_lower, interval_upper,
      model_version, method, features, payload_hash, previous_hash, chain_hash, status)
    VALUES (
      'rmp:' || r.id::text, r.generated_at, 'risk_ml_predictions', r.id,
      'country_domain', r.country_iso3 || '/' || COALESCE(r.domain, 'all'),
      r.domain, r.horizon_days,
      (r.generated_at + (r.horizon_days || ' days')::interval)::date,
      LEAST(1, GREATEST(0, round(r.prob, 8))),
      r.prediction_interval_lower, r.prediction_interval_upper,
      COALESCE(r.model_version, 'unknown'), 'risk_ml_inference',
      COALESCE(r.feature_contributions, r.feature_snapshot, '{}'::jsonb),
      v_payload_hash, v_prev, v_chain, 'open')
    ON CONFLICT (ledger_key) DO NOTHING;

    IF FOUND THEN
      v_prev := v_chain;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'sealed', v_count,
    'ledger_total', (SELECT count(*) FROM public.prediction_ledger),
    'unsealed_remaining', (SELECT count(*) FROM public.risk_ml_predictions m
       WHERE m.country_iso3 IS NOT NULL AND m.horizon_days IS NOT NULL
         AND COALESCE(m.calibrated_score, m.risk_probability) IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.prediction_ledger pl
            WHERE pl.source_table='risk_ml_predictions' AND pl.source_row_id = m.id)));
END;
$$;

CREATE OR REPLACE FUNCTION public.realize_prediction_ledger(p_limit integer DEFAULT 5000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scored int := 0;
  v_expired int := 0;
BEGIN
  WITH candidates AS (
    SELECT p.id AS ledger_id, p.predicted_probability, r.actual_label, r.realized_at,
           r.performance_index_at_realize, r.id AS realization_id
    FROM public.prediction_ledger p
    JOIN public.risk_prediction_realizations r
      ON r.prediction_id = p.source_row_id
    WHERE p.status = 'open'
      AND p.target_date <= CURRENT_DATE
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
        || round(c.predicted_probability, 8)::text, 'UTF8')), 'hex')
    FROM candidates c
    RETURNING ledger_id
  )
  UPDATE public.prediction_ledger p SET status = 'realized'
  FROM ins WHERE p.id = ins.ledger_id;
  GET DIAGNOSTICS v_scored = ROW_COUNT;

  -- Predictions whose horizon elapsed long ago with no outcome are reported, not hidden.
  UPDATE public.prediction_ledger p SET status = 'expired_unscored'
  WHERE p.status = 'open'
    AND p.target_date < CURRENT_DATE - 60
    AND NOT EXISTS (SELECT 1 FROM public.prediction_ledger_outcomes o WHERE o.ledger_id = p.id);
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  RETURN jsonb_build_object('scored', v_scored, 'expired_unscored', v_expired,
    'still_open', (SELECT count(*) FROM public.prediction_ledger WHERE status = 'open'));
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_prediction_ledger_chain(p_limit integer DEFAULT 100000)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record; v_prev text := 'genesis'; v_bad int := 0; v_checked int := 0; v_first_bad text;
BEGIN
  FOR r IN SELECT ledger_key, payload_hash, previous_hash, chain_hash
           FROM public.prediction_ledger ORDER BY sequence_number ASC LIMIT p_limit LOOP
    v_checked := v_checked + 1;
    IF r.previous_hash <> v_prev
       OR r.chain_hash <> encode(sha256(convert_to(r.previous_hash || r.payload_hash, 'UTF8')), 'hex') THEN
      v_bad := v_bad + 1;
      IF v_first_bad IS NULL THEN v_first_bad := r.ledger_key; END IF;
    END IF;
    v_prev := r.chain_hash;
  END LOOP;
  RETURN jsonb_build_object('checked', v_checked, 'broken_links', v_bad,
    'first_broken_key', v_first_bad, 'chain_valid', v_bad = 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.evaluate_hypothesis(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_all_hypotheses() TO service_role;
GRANT EXECUTE ON FUNCTION public.seal_predictions_into_ledger(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.realize_prediction_ledger(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_prediction_ledger_chain(integer) TO authenticated, service_role;