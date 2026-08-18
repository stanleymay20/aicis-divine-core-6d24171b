
-- ============ P1: MULTI-AGENT COGNITION ============

ALTER TABLE public.agent_specialist_analyses
  ADD COLUMN IF NOT EXISTS claim text,
  ADD COLUMN IF NOT EXISTS assumptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS counterevidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS error text;

ALTER TABLE public.agent_syntheses
  ADD COLUMN IF NOT EXISTS disputed_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS strongest_evidence text,
  ADD COLUMN IF NOT EXISTS weakest_assumption text,
  ADD COLUMN IF NOT EXISTS missing_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS confidence_lower numeric,
  ADD COLUMN IF NOT EXISTS confidence_upper numeric,
  ADD COLUMN IF NOT EXISTS next_verification_step text,
  ADD COLUMN IF NOT EXISTS degraded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS degradation_reason text,
  ADD COLUMN IF NOT EXISTS specialists_succeeded int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS specialists_failed int NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.agent_evidence_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.agent_coordination_tasks(id) ON DELETE CASCADE,
  analysis_id uuid REFERENCES public.agent_specialist_analyses(id) ON DELETE CASCADE,
  specialist text NOT NULL,
  source_kind text NOT NULL,
  source_table text,
  source_row_id uuid,
  source_url text,
  source_title text,
  excerpt text,
  observed_at timestamptz,
  weight numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.agent_evidence_citations TO authenticated;
GRANT ALL ON public.agent_evidence_citations TO service_role;
ALTER TABLE public.agent_evidence_citations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_evidence_citations_read" ON public.agent_evidence_citations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "agent_evidence_citations_service" ON public.agent_evidence_citations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_agent_citations_task ON public.agent_evidence_citations(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_citations_analysis ON public.agent_evidence_citations(analysis_id);

CREATE TABLE IF NOT EXISTS public.agent_outcome_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.agent_coordination_tasks(id) ON DELETE CASCADE,
  scored_at timestamptz NOT NULL DEFAULT now(),
  outcome_summary text NOT NULL,
  synthesis_correct boolean,
  dissent_was_right boolean,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  scored_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.agent_outcome_scores TO authenticated;
GRANT ALL ON public.agent_outcome_scores TO service_role;
ALTER TABLE public.agent_outcome_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_outcome_scores_read" ON public.agent_outcome_scores
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "agent_outcome_scores_service" ON public.agent_outcome_scores
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Append-only enforcement for the auditable agent record
CREATE OR REPLACE FUNCTION public.agent_append_only_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: % cannot be % (records are audit evidence)', TG_TABLE_NAME, TG_OP;
END $$;

DROP TRIGGER IF EXISTS trg_append_only_analyses ON public.agent_specialist_analyses;
CREATE TRIGGER trg_append_only_analyses BEFORE UPDATE OR DELETE ON public.agent_specialist_analyses
  FOR EACH ROW EXECUTE FUNCTION public.agent_append_only_guard();
DROP TRIGGER IF EXISTS trg_append_only_syntheses ON public.agent_syntheses;
CREATE TRIGGER trg_append_only_syntheses BEFORE UPDATE OR DELETE ON public.agent_syntheses
  FOR EACH ROW EXECUTE FUNCTION public.agent_append_only_guard();
DROP TRIGGER IF EXISTS trg_append_only_citations ON public.agent_evidence_citations;
CREATE TRIGGER trg_append_only_citations BEFORE UPDATE OR DELETE ON public.agent_evidence_citations
  FOR EACH ROW EXECUTE FUNCTION public.agent_append_only_guard();
DROP TRIGGER IF EXISTS trg_append_only_disagreements ON public.agent_disagreements;
CREATE TRIGGER trg_append_only_disagreements BEFORE UPDATE OR DELETE ON public.agent_disagreements
  FOR EACH ROW EXECUTE FUNCTION public.agent_append_only_guard();

-- Quality view (recreated with real quality semantics)
DROP VIEW IF EXISTS public.agent_run_quality;
CREATE VIEW public.agent_run_quality WITH (security_invoker = true) AS
SELECT t.id AS task_id, t.task_key, t.subject_kind, t.subject_key, t.status, t.created_at,
  count(a.id) FILTER (WHERE a.status = 'ok')                      AS specialists_ok,
  count(a.id) FILTER (WHERE a.status <> 'ok')                     AS specialists_failed,
  count(DISTINCT a.specialist) FILTER (WHERE a.status = 'ok')     AS distinct_perspectives,
  count(c.id)                                                     AS citation_count,
  count(DISTINCT a.id) FILTER (WHERE a.status = 'ok' AND a.evidence_count > 0) AS cited_specialists,
  (SELECT count(*) FROM public.agent_disagreements d WHERE d.task_id = t.id)   AS disagreements,
  (SELECT count(*) FROM public.agent_syntheses s WHERE s.task_id = t.id)       AS syntheses,
  (SELECT max(round((s.confidence_upper - s.confidence_lower)::numeric, 3))
     FROM public.agent_syntheses s WHERE s.task_id = t.id)                     AS confidence_span,
  COALESCE(max(a.confidence) FILTER (WHERE a.status = 'ok') - min(a.confidence) FILTER (WHERE a.status = 'ok'), 0) AS perspective_spread
FROM public.agent_coordination_tasks t
LEFT JOIN public.agent_specialist_analyses a ON a.task_id = t.id
LEFT JOIN public.agent_evidence_citations c ON c.task_id = t.id
GROUP BY t.id, t.task_key, t.subject_kind, t.subject_key, t.status, t.created_at;
GRANT SELECT ON public.agent_run_quality TO authenticated, service_role;

-- ============ P2: LEDGER CLASSIFICATION (append-only, no sealed-row rewrites) ============

CREATE TABLE IF NOT EXISTS public.prediction_ledger_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id uuid NOT NULL REFERENCES public.prediction_ledger(id) ON DELETE CASCADE,
  ledger_key text NOT NULL,
  classifier_version text NOT NULL DEFAULT 'v1',
  prospective_status text NOT NULL
    CHECK (prospective_status IN ('prospective_pre_outcome','retrospective_backfill','indeterminate')),
  seal_origin text NOT NULL,
  validation_mode text NOT NULL
    CHECK (validation_mode IN ('predictive_validation','infrastructure_only','unusable')),
  earliest_outcome_at timestamptz,
  sealed_at timestamptz,
  predicted_at timestamptz,
  basis jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence text,
  classified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ledger_id, classifier_version)
);
GRANT SELECT ON public.prediction_ledger_classifications TO authenticated;
GRANT ALL ON public.prediction_ledger_classifications TO service_role;
ALTER TABLE public.prediction_ledger_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plc_read" ON public.prediction_ledger_classifications
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "plc_service" ON public.prediction_ledger_classifications
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_plc_status ON public.prediction_ledger_classifications(prospective_status);

DROP TRIGGER IF EXISTS trg_append_only_plc ON public.prediction_ledger_classifications;
CREATE TRIGGER trg_append_only_plc BEFORE UPDATE OR DELETE ON public.prediction_ledger_classifications
  FOR EACH ROW EXECUTE FUNCTION public.agent_append_only_guard();

CREATE OR REPLACE FUNCTION public.classify_prediction_ledger(p_limit int DEFAULT 100000, p_version text DEFAULT 'v1')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ins int := 0;
BEGIN
  WITH cand AS (
    SELECT p.id, p.ledger_key, p.sealed_at, p.predicted_at, p.target_date, p.seal_mode,
           LEAST(
             COALESCE(p.outcome_observed_at, 'infinity'::timestamptz),
             COALESCE((SELECT min(o.realized_at) FROM public.prediction_ledger_outcomes o WHERE o.ledger_id = p.id), 'infinity'::timestamptz),
             COALESCE(p.outcome_knowable_at, 'infinity'::timestamptz),
             COALESCE((p.target_date + 1)::timestamptz, 'infinity'::timestamptz)
           ) AS earliest_outcome_at
      FROM public.prediction_ledger p
     WHERE NOT EXISTS (SELECT 1 FROM public.prediction_ledger_classifications c
                        WHERE c.ledger_id = p.id AND c.classifier_version = p_version)
     ORDER BY p.sequence_number
     LIMIT p_limit
  ), ins AS (
    INSERT INTO public.prediction_ledger_classifications
      (ledger_id, ledger_key, classifier_version, prospective_status, seal_origin, validation_mode,
       earliest_outcome_at, sealed_at, predicted_at, basis, evidence)
    SELECT c.id, c.ledger_key, p_version,
      CASE
        WHEN c.sealed_at IS NULL OR c.predicted_at IS NULL OR c.earliest_outcome_at = 'infinity'::timestamptz
          THEN 'indeterminate'
        WHEN c.sealed_at < c.earliest_outcome_at AND c.predicted_at < c.earliest_outcome_at
          THEN 'prospective_pre_outcome'
        ELSE 'retrospective_backfill'
      END,
      COALESCE(c.seal_mode, 'unknown'),
      CASE
        WHEN c.sealed_at IS NULL OR c.predicted_at IS NULL OR c.earliest_outcome_at = 'infinity'::timestamptz
          THEN 'unusable'
        WHEN c.sealed_at < c.earliest_outcome_at AND c.predicted_at < c.earliest_outcome_at
          THEN 'predictive_validation'
        ELSE 'infrastructure_only'
      END,
      NULLIF(c.earliest_outcome_at, 'infinity'::timestamptz), c.sealed_at, c.predicted_at,
      jsonb_build_object('sealed_at', c.sealed_at, 'predicted_at', c.predicted_at,
                         'earliest_outcome_at', NULLIF(c.earliest_outcome_at,'infinity'::timestamptz),
                         'target_date', c.target_date, 'seal_mode', c.seal_mode),
      'classified from immutable timestamps: prospective requires sealed_at AND predicted_at strictly before the earliest knowable/observed outcome time'
    FROM cand c
    RETURNING 1
  )
  SELECT count(*) INTO v_ins FROM ins;

  RETURN (SELECT jsonb_build_object('classified_now', v_ins, 'classifier_version', p_version,
    'totals', COALESCE(jsonb_object_agg(t.prospective_status, t.n), '{}'::jsonb))
    FROM (SELECT prospective_status, count(*) n FROM public.prediction_ledger_classifications
           WHERE classifier_version = p_version GROUP BY 1) t);
END $$;

-- Full-chain verification that RECOMPUTES the payload hash, not just link fields
CREATE OR REPLACE FUNCTION public.verify_prediction_ledger_chain_full(p_limit int DEFAULT 200000)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; v_prev text := 'genesis'; v_checked int := 0;
  v_link_bad int := 0; v_payload_bad int := 0; v_payload_checked int := 0;
  v_first_bad text; v_recomputed text;
BEGIN
  FOR r IN SELECT ledger_key, payload_hash, previous_hash, chain_hash, payload_canonical,
                  hash_version, subject_key, domain, predicted_at, horizon_days,
                  predicted_probability, model_version
             FROM public.prediction_ledger ORDER BY sequence_number ASC LIMIT p_limit LOOP
    v_checked := v_checked + 1;

    IF r.payload_canonical IS NOT NULL THEN
      v_recomputed := encode(sha256(convert_to(r.payload_canonical::text, 'UTF8')), 'hex');
      v_payload_checked := v_payload_checked + 1;
    ELSIF r.subject_key IS NOT NULL THEN
      -- v1 canonical form: subject|domain|predicted_at|horizon|probability|model_version
      v_recomputed := encode(sha256(convert_to(
        split_part(r.subject_key,'/',1) || '|' || COALESCE(r.domain,'') || '|' || r.predicted_at::text
        || '|' || r.horizon_days::text || '|' || round(r.predicted_probability, 8)::text
        || '|' || COALESCE(r.model_version,'unknown'), 'UTF8')), 'hex');
      v_payload_checked := v_payload_checked + 1;
    ELSE
      v_recomputed := r.payload_hash;
    END IF;

    IF v_recomputed <> r.payload_hash THEN
      v_payload_bad := v_payload_bad + 1;
      IF v_first_bad IS NULL THEN v_first_bad := r.ledger_key; END IF;
    END IF;

    IF r.previous_hash <> v_prev
       OR r.chain_hash <> encode(sha256(convert_to(r.previous_hash || r.payload_hash, 'UTF8')), 'hex') THEN
      v_link_bad := v_link_bad + 1;
      IF v_first_bad IS NULL THEN v_first_bad := r.ledger_key; END IF;
    END IF;
    v_prev := r.chain_hash;
  END LOOP;

  RETURN jsonb_build_object('checked', v_checked, 'payload_checked', v_payload_checked,
    'broken_links', v_link_bad, 'payload_mismatches', v_payload_bad,
    'first_broken_key', v_first_bad,
    'links_valid', v_link_bad = 0, 'payloads_valid', v_payload_bad = 0,
    'chain_valid', v_link_bad = 0 AND v_payload_bad = 0);
END $$;

-- Performance split: prospective skill is never mixed with backfilled outcomes
CREATE OR REPLACE VIEW public.prediction_ledger_performance_split
WITH (security_invoker = true) AS
SELECT COALESCE(c.prospective_status, 'unclassified') AS prospective_status,
       c.validation_mode, p.model_version, p.domain,
       count(*) AS sealed_total,
       count(*) FILTER (WHERE p.target_date > CURRENT_DATE) AS awaiting_horizon,
       count(*) FILTER (WHERE p.target_date <= CURRENT_DATE) AS matured,
       count(o.id) AS scored_total,
       round(avg(o.brier_score)::numeric, 4) AS mean_brier_score,
       round(avg(o.absolute_error)::numeric, 4) AS mean_absolute_error,
       min(p.predicted_at) AS first_prediction_at,
       max(p.predicted_at) AS last_prediction_at
FROM public.prediction_ledger p
LEFT JOIN public.prediction_ledger_classifications c
       ON c.ledger_id = p.id AND c.classifier_version = 'v1'
LEFT JOIN public.prediction_ledger_outcomes o ON o.ledger_id = p.id
GROUP BY 1,2,3,4;
GRANT SELECT ON public.prediction_ledger_performance_split TO authenticated, service_role;

CREATE OR REPLACE VIEW public.prospective_skill_summary
WITH (security_invoker = true) AS
SELECT count(*) FILTER (WHERE p.target_date <= CURRENT_DATE) AS matured_prospective,
       count(o.id) AS scored_prospective,
       round(avg(o.brier_score)::numeric, 4) AS mean_brier_score,
       count(*) FILTER (WHERE p.target_date > CURRENT_DATE) AS pending_prospective,
       min(p.target_date) FILTER (WHERE p.target_date > CURRENT_DATE) AS next_maturity_date
FROM public.prediction_ledger p
JOIN public.prediction_ledger_classifications c
  ON c.ledger_id = p.id AND c.classifier_version = 'v1'
 AND c.prospective_status = 'prospective_pre_outcome'
LEFT JOIN public.prediction_ledger_outcomes o ON o.ledger_id = p.id;
GRANT SELECT ON public.prospective_skill_summary TO authenticated, service_role;
