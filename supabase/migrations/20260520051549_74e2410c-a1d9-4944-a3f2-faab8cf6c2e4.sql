
-- ENUMS
DO $$ BEGIN
  CREATE TYPE public.export_destination_type AS ENUM ('api','webhook','csv','json','ndjson','sdk','batch');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.export_run_status AS ENUM ('queued','running','success','partial','error','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.export_frequency AS ENUM ('manual','5m','15m','hourly','6h','daily','weekly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PRESETS
CREATE TABLE IF NOT EXISTS public.export_profile_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  schema_version text NOT NULL DEFAULT 'v1',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.export_profile_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "presets readable by authenticated" ON public.export_profile_presets
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage presets" ON public.export_profile_presets
  FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- PROFILES
CREATE TABLE IF NOT EXISTS public.export_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  created_by uuid,
  name text NOT NULL,
  description text,
  preset_key text,
  destination_type public.export_destination_type NOT NULL DEFAULT 'api',
  domains text[] NOT NULL DEFAULT ARRAY[]::text[],
  countries text[] NOT NULL DEFAULT ARRAY[]::text[],
  regions text[] NOT NULL DEFAULT ARRAY[]::text[],
  severity_tiers text[] NOT NULL DEFAULT ARRAY['high','critical']::text[],
  min_relevance_score int NOT NULL DEFAULT 50,
  min_confidence_score int NOT NULL DEFAULT 50,
  min_urgency_score int NOT NULL DEFAULT 0,
  frequency public.export_frequency NOT NULL DEFAULT 'manual',
  max_records_per_run int NOT NULL DEFAULT 500,
  include_raw_source boolean NOT NULL DEFAULT false,
  include_recommendations boolean NOT NULL DEFAULT true,
  include_explanations boolean NOT NULL DEFAULT true,
  prefer_clusters boolean NOT NULL DEFAULT true,
  schema_version text NOT NULL DEFAULT 'v1',
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.export_profiles ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_export_profiles_org ON public.export_profiles(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_profiles_enabled ON public.export_profiles(enabled, next_run_at) WHERE enabled;

CREATE POLICY "admins manage profiles" ON public.export_profiles
  FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "creators view own profiles" ON public.export_profiles
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- RUNS
CREATE TABLE IF NOT EXISTS public.export_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.export_profiles(id) ON DELETE CASCADE,
  organization_id uuid,
  export_batch_id uuid NOT NULL DEFAULT gen_random_uuid(),
  status public.export_run_status NOT NULL DEFAULT 'queued',
  trigger_source text NOT NULL DEFAULT 'manual',
  format text NOT NULL DEFAULT 'json',
  records_selected int NOT NULL DEFAULT 0,
  records_exported int NOT NULL DEFAULT 0,
  clusters_exported int NOT NULL DEFAULT 0,
  recommendations_exported int NOT NULL DEFAULT 0,
  duration_ms int,
  payload_size_bytes bigint,
  retry_count int NOT NULL DEFAULT 0,
  cursor_start jsonb,
  cursor_end jsonb,
  storage_path text,
  signed_url_expires_at timestamptz,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.export_runs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_export_runs_profile ON public.export_runs(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_runs_status ON public.export_runs(status, created_at DESC);
CREATE POLICY "admins view runs" ON public.export_runs FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'));
CREATE POLICY "admins manage runs" ON public.export_runs FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- CURSOR STATE
CREATE TABLE IF NOT EXISTS public.export_cursor_state (
  profile_id uuid PRIMARY KEY REFERENCES public.export_profiles(id) ON DELETE CASCADE,
  last_signal_updated_at timestamptz,
  last_signal_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.export_cursor_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage cursors" ON public.export_cursor_state FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- WEBHOOKS
CREATE TABLE IF NOT EXISTS public.export_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  profile_id uuid REFERENCES public.export_profiles(id) ON DELETE CASCADE,
  endpoint_url text NOT NULL,
  secret_hash text NOT NULL,
  event_types text[] NOT NULL DEFAULT ARRAY['export.completed']::text[],
  min_relevance_score int NOT NULL DEFAULT 70,
  retry_policy jsonb NOT NULL DEFAULT '{"max_attempts":5,"backoff_seconds":[60,300,1800,7200,43200]}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  last_success_at timestamptz,
  last_error_at timestamptz,
  consecutive_failures int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.export_webhooks ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_export_webhooks_enabled ON public.export_webhooks(enabled);
CREATE POLICY "admins manage webhooks" ON public.export_webhooks FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- WEBHOOK DELIVERIES
CREATE TABLE IF NOT EXISTS public.export_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid REFERENCES public.export_webhooks(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.export_runs(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  payload_hash text,
  signature text,
  http_status int,
  attempt int NOT NULL DEFAULT 1,
  response_excerpt text,
  delivered_at timestamptz,
  next_retry_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.export_webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON public.export_webhook_deliveries(webhook_id, created_at DESC);
CREATE POLICY "admins view deliveries" ON public.export_webhook_deliveries FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'));
CREATE POLICY "admins manage deliveries" ON public.export_webhook_deliveries FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- API KEYS
CREATE TABLE IF NOT EXISTS public.export_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  created_by uuid,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT ARRAY['exports.read']::text[],
  rate_limit_per_min int NOT NULL DEFAULT 120,
  last_used_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.export_api_keys ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_export_api_keys_prefix ON public.export_api_keys(key_prefix);
CREATE POLICY "admins manage api keys" ON public.export_api_keys FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.export_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  actor_api_key_id uuid REFERENCES public.export_api_keys(id) ON DELETE SET NULL,
  organization_id uuid,
  action text NOT NULL,
  resource_type text,
  resource_id uuid,
  ip text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.export_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_export_audit_org ON public.export_audit_logs(organization_id, created_at DESC);
CREATE POLICY "admins view audit" ON public.export_audit_logs FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'));
CREATE POLICY "system inserts audit" ON public.export_audit_logs FOR INSERT TO authenticated
  WITH CHECK (true);

-- TRIGGER: updated_at on profiles & webhooks
CREATE OR REPLACE FUNCTION public.tg_export_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_export_profiles_updated ON public.export_profiles;
CREATE TRIGGER trg_export_profiles_updated BEFORE UPDATE ON public.export_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_export_touch_updated_at();

DROP TRIGGER IF EXISTS trg_export_webhooks_updated ON public.export_webhooks;
CREATE TRIGGER trg_export_webhooks_updated BEFORE UPDATE ON public.export_webhooks
  FOR EACH ROW EXECUTE FUNCTION public.tg_export_touch_updated_at();

-- CLONE PRESET RPC
CREATE OR REPLACE FUNCTION public.clone_export_preset(_preset_key text, _name text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_preset record;
  v_profile_id uuid;
  v_cfg jsonb;
BEGIN
  IF NOT has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT * INTO v_preset FROM export_profile_presets WHERE preset_key = _preset_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'preset % not found', _preset_key; END IF;
  v_cfg := v_preset.config;
  INSERT INTO export_profiles (
    name, description, preset_key, created_by,
    destination_type, domains, countries, regions, severity_tiers,
    min_relevance_score, min_confidence_score, min_urgency_score,
    frequency, max_records_per_run,
    include_raw_source, include_recommendations, include_explanations,
    prefer_clusters, schema_version
  ) VALUES (
    COALESCE(_name, v_preset.name),
    v_preset.description,
    _preset_key,
    auth.uid(),
    COALESCE((v_cfg->>'destination_type')::export_destination_type, 'api'::export_destination_type),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_cfg->'domains')), ARRAY[]::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_cfg->'countries')), ARRAY[]::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_cfg->'regions')), ARRAY[]::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_cfg->'severity_tiers')), ARRAY['high','critical']::text[]),
    COALESCE((v_cfg->>'min_relevance_score')::int, 50),
    COALESCE((v_cfg->>'min_confidence_score')::int, 50),
    COALESCE((v_cfg->>'min_urgency_score')::int, 0),
    COALESCE((v_cfg->>'frequency')::export_frequency, 'manual'::export_frequency),
    COALESCE((v_cfg->>'max_records_per_run')::int, 500),
    COALESCE((v_cfg->>'include_raw_source')::boolean, false),
    COALESCE((v_cfg->>'include_recommendations')::boolean, true),
    COALESCE((v_cfg->>'include_explanations')::boolean, true),
    COALESCE((v_cfg->>'prefer_clusters')::boolean, true),
    COALESCE(v_preset.schema_version, 'v1')
  ) RETURNING id INTO v_profile_id;
  RETURN v_profile_id;
END $$;

-- SEED QUANTIVIS PRESET
INSERT INTO public.export_profile_presets (preset_key, name, description, config, schema_version)
VALUES (
  'quantivis_decision_intelligence',
  'Quantivis Decision Intelligence',
  'High-relevance clustered intelligence, recommendations, forecasts and entity links for Quantivis OS.',
  jsonb_build_object(
    'destination_type','api',
    'domains', jsonb_build_array('economy','security','energy','health','climate','supply_chain','regulation','geopolitics'),
    'countries', jsonb_build_array(),
    'regions', jsonb_build_array(),
    'severity_tiers', jsonb_build_array('medium','high','critical'),
    'min_relevance_score', 70,
    'min_confidence_score', 60,
    'min_urgency_score', 50,
    'frequency','hourly',
    'max_records_per_run', 500,
    'include_raw_source', false,
    'include_recommendations', true,
    'include_explanations', true,
    'prefer_clusters', true
  ),
  'quantivis.v1'
) ON CONFLICT (preset_key) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      config = EXCLUDED.config,
      schema_version = EXCLUDED.schema_version;
