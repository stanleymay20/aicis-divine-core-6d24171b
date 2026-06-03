
CREATE TABLE IF NOT EXISTS public.data_residency_manifest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_kind text NOT NULL CHECK (resource_kind IN ('table','bucket','edge_function')),
  resource_name text NOT NULL,
  residency_region text NOT NULL CHECK (residency_region IN ('EU','UK','CA','JP','US','GLOBAL')),
  sovereign_mode_visibility text NOT NULL CHECK (sovereign_mode_visibility IN ('global','regional','national','isolated','public')),
  contains_pii boolean NOT NULL DEFAULT false,
  aggregation_level text,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_kind, resource_name)
);
GRANT SELECT ON public.data_residency_manifest TO anon, authenticated;
GRANT ALL ON public.data_residency_manifest TO service_role;
ALTER TABLE public.data_residency_manifest ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drm_public_read" ON public.data_residency_manifest FOR SELECT USING (true);
CREATE POLICY "drm_service_all" ON public.data_residency_manifest FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.data_residency_manifest(resource_kind, resource_name, residency_region, sovereign_mode_visibility, contains_pii, aggregation_level, notes) VALUES
  ('table','normalized_metrics','GLOBAL','public',false,'country-domain','Canonical metric layer'),
  ('table','community_metrics','GLOBAL','public',false,'community-aggregate','Aggregated, no PII'),
  ('table','village_indicators','GLOBAL','public',false,'sub-national','Public-use microdata aggregates'),
  ('table','global_signals','GLOBAL','public',false,'event','GDELT-class public events'),
  ('table','normalized_events','GLOBAL','public',false,'event','Normalized public events'),
  ('table','risk_scores','GLOBAL','public',false,'country-domain','Computed risk'),
  ('table','aicis_early_warnings','GLOBAL','public',false,'country-domain','Public warnings'),
  ('table','risk_action_recommendations','GLOBAL','regional',false,'country-domain','Recommendations'),
  ('table','risk_ranking_predictions','GLOBAL','public',false,'country-domain','Ranked predictions'),
  ('table','risk_ml_predictions','GLOBAL','regional',false,'country-domain','ML output'),
  ('table','forecast_prospective_evaluations','GLOBAL','public',false,'country-domain','Forecast validation'),
  ('table','intelligence_citations','GLOBAL','public',false,'citation','Public source references'),
  ('table','ledger_entries','GLOBAL','public',false,'audit','Hash-chained audit trail'),
  ('table','federation_signing_keys','GLOBAL','public',false,'key','Public keys only'),
  ('table','federation_signed_bundles','GLOBAL','public',false,'audit','Signed bundle metadata'),
  ('table','simulation_runs','GLOBAL','regional',false,'scenario','Simulation history'),
  ('table','simulation_templates','GLOBAL','public',false,'scenario','Reusable scenarios'),
  ('table','profiles','EU','isolated',true,'user','User profile data; PII'),
  ('table','user_roles','EU','isolated',true,'user','Role assignments'),
  ('table','organizations','EU','national',false,'org','Tenant data'),
  ('table','organization_subscriptions','EU','national',false,'org','Billing'),
  ('table','billing_events','EU','isolated',false,'org','Billing events'),
  ('table','system_logs','EU','national',false,'system','Operational logs'),
  ('table','accountability_nodes','GLOBAL','regional',false,'node','Federation peers'),
  ('table','data_residency_manifest','GLOBAL','public',false,'manifest','This manifest itself')
ON CONFLICT (resource_kind, resource_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.simulation_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text UNIQUE NOT NULL,
  scenario_name text NOT NULL,
  category text NOT NULL,
  description text,
  affected_iso3 text[],
  affected_domains text[],
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_shock_magnitude numeric DEFAULT 1.0,
  default_horizon_days int DEFAULT 90,
  expected_propagation_paths jsonb,
  citation_keys text[],
  created_by uuid,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_simt_category ON public.simulation_templates (category);
GRANT SELECT ON public.simulation_templates TO anon, authenticated;
GRANT INSERT, UPDATE ON public.simulation_templates TO authenticated;
GRANT ALL ON public.simulation_templates TO service_role;
ALTER TABLE public.simulation_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "simt_public_read" ON public.simulation_templates FOR SELECT USING (is_public = true OR auth.uid() IS NOT NULL);
CREATE POLICY "simt_auth_insert" ON public.simulation_templates FOR INSERT TO authenticated WITH CHECK (created_by IS NULL OR auth.uid() = created_by);
CREATE POLICY "simt_owner_update" ON public.simulation_templates FOR UPDATE TO authenticated USING (auth.uid() = created_by);
CREATE POLICY "simt_service_all" ON public.simulation_templates FOR ALL TO service_role USING (true) WITH CHECK (true);

DO $do$ BEGIN
  IF to_regclass('public.simulation_runs') IS NOT NULL THEN
    BEGIN ALTER TABLE public.simulation_runs ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.simulation_templates(id); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END $do$;
