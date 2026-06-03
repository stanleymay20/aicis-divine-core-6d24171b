
CREATE TABLE IF NOT EXISTS public.source_authority_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_key text UNIQUE NOT NULL,
  publisher_name text NOT NULL,
  publisher_type text NOT NULL,
  authority_tier int NOT NULL CHECK (authority_tier BETWEEN 1 AND 4),
  default_confidence_weight numeric NOT NULL DEFAULT 0.75,
  jurisdiction text,
  base_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.source_authority_registry TO anon, authenticated;
GRANT ALL ON public.source_authority_registry TO service_role;
ALTER TABLE public.source_authority_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sar_public_read" ON public.source_authority_registry FOR SELECT USING (true);
CREATE POLICY "sar_service_all" ON public.source_authority_registry FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.intelligence_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  publisher_key text REFERENCES public.source_authority_registry(publisher_key) ON DELETE SET NULL,
  source_name text NOT NULL,
  source_url text,
  source_type text,
  published_at timestamptz,
  quote text,
  source_hash text,
  citation_snapshot_hash text,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  confidence_weight numeric NOT NULL DEFAULT 0.5,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_citations_subject ON public.intelligence_citations (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_citations_publisher ON public.intelligence_citations (publisher_key);
GRANT SELECT, INSERT ON public.intelligence_citations TO authenticated;
GRANT SELECT ON public.intelligence_citations TO anon;
GRANT ALL ON public.intelligence_citations TO service_role;
ALTER TABLE public.intelligence_citations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ic_public_read" ON public.intelligence_citations FOR SELECT USING (true);
CREATE POLICY "ic_auth_insert" ON public.intelligence_citations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "ic_service_all" ON public.intelligence_citations FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.citation_enforcement_policy (
  subject_type text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('disabled','warning_only','soft_fail','hard_fail')),
  min_tier int NOT NULL DEFAULT 2,
  min_citations int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.citation_enforcement_policy TO anon, authenticated;
GRANT ALL ON public.citation_enforcement_policy TO service_role;
ALTER TABLE public.citation_enforcement_policy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cep_public_read" ON public.citation_enforcement_policy FOR SELECT USING (true);
CREATE POLICY "cep_service_all" ON public.citation_enforcement_policy FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.citation_enforcement_policy(subject_type, mode, min_tier, min_citations) VALUES
  ('early_warning','warning_only',2,1),
  ('recommendation','soft_fail',2,1),
  ('forecast','soft_fail',2,1),
  ('ml_prediction','disabled',2,1)
ON CONFLICT (subject_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.assert_citation(p_subject_type text, p_subject_id uuid)
RETURNS TABLE(ok boolean, mode text, severity text, message text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_policy record; v_count int; v_max_tier int;
BEGIN
  SELECT * INTO v_policy FROM public.citation_enforcement_policy WHERE subject_type = p_subject_type;
  IF NOT FOUND OR v_policy.mode = 'disabled' THEN
    RETURN QUERY SELECT true, 'disabled'::text, 'info'::text, 'enforcement disabled'::text; RETURN;
  END IF;
  SELECT count(*), min(coalesce(sar.authority_tier, 4)) INTO v_count, v_max_tier
  FROM public.intelligence_citations ic
  LEFT JOIN public.source_authority_registry sar ON sar.publisher_key = ic.publisher_key
  WHERE ic.subject_type = p_subject_type AND ic.subject_id = p_subject_id;
  IF v_count >= v_policy.min_citations AND coalesce(v_max_tier, 4) <= v_policy.min_tier THEN
    RETURN QUERY SELECT true, v_policy.mode, 'info'::text,
      format('%s citations meet tier %s', v_count, v_policy.min_tier); RETURN;
  END IF;
  RETURN QUERY SELECT false, v_policy.mode,
    CASE v_policy.mode WHEN 'hard_fail' THEN 'error' ELSE 'warning' END,
    format('have %s citations (best tier %s); need %s tier %s',
      v_count, coalesce(v_max_tier, 4), v_policy.min_citations, v_policy.min_tier);
END;$fn$;

CREATE OR REPLACE VIEW public.intelligence_citation_strength
WITH (security_invoker = true) AS
SELECT ic.subject_type, ic.subject_id,
  count(*) AS citation_count,
  min(coalesce(sar.authority_tier, 4)) AS best_tier,
  round(avg(ic.confidence_weight)::numeric, 3) AS avg_confidence,
  bool_or(ic.source_hash IS NOT NULL) AS has_provenance_hash
FROM public.intelligence_citations ic
LEFT JOIN public.source_authority_registry sar ON sar.publisher_key = ic.publisher_key
GROUP BY ic.subject_type, ic.subject_id;
GRANT SELECT ON public.intelligence_citation_strength TO anon, authenticated, service_role;
