
-- 1. Source IQ Scorecards (TIQM 6 dimensions)
CREATE TABLE IF NOT EXISTS public.source_iq_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name text NOT NULL,
  measured_at timestamptz NOT NULL DEFAULT now(),
  completeness numeric(5,2) NOT NULL CHECK (completeness BETWEEN 0 AND 100),
  accuracy numeric(5,2) NOT NULL CHECK (accuracy BETWEEN 0 AND 100),
  consistency numeric(5,2) NOT NULL CHECK (consistency BETWEEN 0 AND 100),
  timeliness numeric(5,2) NOT NULL CHECK (timeliness BETWEEN 0 AND 100),
  validity numeric(5,2) NOT NULL CHECK (validity BETWEEN 0 AND 100),
  uniqueness numeric(5,2) NOT NULL CHECK (uniqueness BETWEEN 0 AND 100),
  composite_score numeric(5,2) GENERATED ALWAYS AS (
    (completeness + accuracy + consistency + timeliness + validity + uniqueness) / 6.0
  ) STORED,
  rows_assessed bigint NOT NULL DEFAULT 0,
  notes text
);
CREATE INDEX IF NOT EXISTS idx_iq_source_time ON public.source_iq_scorecards(source_name, measured_at DESC);
ALTER TABLE public.source_iq_scorecards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "iq_read_authenticated" ON public.source_iq_scorecards FOR SELECT TO authenticated USING (true);

-- 2. Entity Identity History (OYSTER pattern)
CREATE TABLE IF NOT EXISTS public.entity_identity_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('create','merge','split','alias_added','attribute_changed','retire')),
  prior_state jsonb,
  new_state jsonb,
  related_entity_ids uuid[],
  reason text,
  actor text,
  performed_at timestamptz NOT NULL DEFAULT now(),
  prev_hash text,
  this_hash text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eih_entity ON public.entity_identity_history(entity_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_eih_operation ON public.entity_identity_history(operation, performed_at DESC);
ALTER TABLE public.entity_identity_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eih_read_authenticated" ON public.entity_identity_history FOR SELECT TO authenticated USING (true);

-- 3. Declarative ER Rules
CREATE TABLE IF NOT EXISTS public.er_rule_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name text NOT NULL UNIQUE,
  entity_class text NOT NULL,
  match_strategy text NOT NULL CHECK (match_strategy IN ('exact_id','exact_name','alias','fuzzy_jaro','fuzzy_qgram','geo_proximity')),
  threshold numeric(4,3) NOT NULL DEFAULT 0.85 CHECK (threshold BETWEEN 0 AND 1),
  priority int NOT NULL DEFAULT 100,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.er_rule_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "er_rules_read_authenticated" ON public.er_rule_definitions FOR SELECT TO authenticated USING (true);

-- Seed default rules
INSERT INTO public.er_rule_definitions (rule_name, entity_class, match_strategy, threshold, priority, fields) VALUES
  ('country_iso3_exact','country','exact_id',1.0,10,'["iso3"]'::jsonb),
  ('country_name_exact','country','exact_name',1.0,20,'["name"]'::jsonb),
  ('country_alias','country','alias',0.95,30,'["aliases"]'::jsonb),
  ('country_fuzzy','country','fuzzy_jaro',0.90,40,'["name"]'::jsonb),
  ('org_name_exact','organization','exact_name',1.0,20,'["name"]'::jsonb),
  ('org_fuzzy','organization','fuzzy_qgram',0.85,40,'["name"]'::jsonb),
  ('locality_geo','locality','geo_proximity',0.85,50,'["lat","lon"]'::jsonb)
ON CONFLICT (rule_name) DO NOTHING;

-- 4. Match-Key Blocking
CREATE TABLE IF NOT EXISTS public.entity_match_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL,
  entity_class text NOT NULL,
  block_key text NOT NULL,
  block_type text NOT NULL CHECK (block_type IN ('soundex','qgram3','prefix4','geohash5')),
  source_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emb_block ON public.entity_match_blocks(block_type, block_key);
CREATE INDEX IF NOT EXISTS idx_emb_entity ON public.entity_match_blocks(entity_id);
ALTER TABLE public.entity_match_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "emb_read_authenticated" ON public.entity_match_blocks FOR SELECT TO authenticated USING (true);

-- 5. Idempotent Task Tokens
CREATE TABLE IF NOT EXISTS public.task_tokens (
  token text PRIMARY KEY,
  job_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('claimed','succeeded','failed','expired')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  payload jsonb,
  result jsonb,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX IF NOT EXISTS idx_tt_job ON public.task_tokens(job_name, claimed_at DESC);
ALTER TABLE public.task_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tt_read_authenticated" ON public.task_tokens FOR SELECT TO authenticated USING (true);

-- claim helper
CREATE OR REPLACE FUNCTION public.claim_task_token(p_token text, p_job text, p_payload jsonb DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.task_tokens(token, job_name, status, payload)
  VALUES (p_token, p_job, 'claimed', p_payload);
  RETURN true;
EXCEPTION WHEN unique_violation THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_task_token(p_token text, p_status text, p_result jsonb DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.task_tokens
  SET status = p_status, completed_at = now(), result = p_result
  WHERE token = p_token;
$$;

-- IQ scorecard auto-compute helper (samples normalized_metrics + normalized_events per source)
CREATE OR REPLACE FUNCTION public.compute_source_iq_scorecard(p_source text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total bigint; v_with_value bigint; v_with_iso3 bigint; v_recent bigint; v_dupes bigint;
  v_completeness numeric; v_accuracy numeric; v_consistency numeric;
  v_timeliness numeric; v_validity numeric; v_uniqueness numeric;
  v_id uuid;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE value IS NOT NULL),
         COUNT(*) FILTER (WHERE iso3 IS NOT NULL AND length(iso3)=3),
         COUNT(*) FILTER (WHERE period::timestamptz > now() - interval '30 days')
    INTO v_total, v_with_value, v_with_iso3, v_recent
  FROM public.normalized_metrics WHERE source = p_source;

  IF v_total = 0 THEN RETURN NULL; END IF;

  SELECT v_total - COUNT(DISTINCT (iso3, metric, period))
    INTO v_dupes FROM public.normalized_metrics WHERE source = p_source;

  v_completeness := round((v_with_value::numeric / v_total) * 100, 2);
  v_validity     := round((v_with_iso3::numeric / v_total) * 100, 2);
  v_timeliness   := round((v_recent::numeric / v_total) * 100, 2);
  v_uniqueness   := round(((v_total - GREATEST(v_dupes,0))::numeric / v_total) * 100, 2);
  v_accuracy     := LEAST(100, v_validity * 0.7 + v_completeness * 0.3);
  v_consistency  := LEAST(100, (v_validity + v_completeness) / 2);

  INSERT INTO public.source_iq_scorecards(
    source_name, completeness, accuracy, consistency, timeliness, validity, uniqueness, rows_assessed
  ) VALUES (
    p_source, v_completeness, v_accuracy, v_consistency, v_timeliness, v_validity, v_uniqueness, v_total
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Compute for all known sources
CREATE OR REPLACE FUNCTION public.refresh_all_source_iq()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT DISTINCT source FROM public.normalized_metrics WHERE source IS NOT NULL LOOP
    PERFORM public.compute_source_iq_scorecard(r.source);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
