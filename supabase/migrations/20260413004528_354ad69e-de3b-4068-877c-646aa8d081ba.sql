
-- ═══════════════════════════════════════════════════════════════
-- AICIS Unified Ingestion Persistence Layer
-- ═══════════════════════════════════════════════════════════════

-- 1. provider_runs — tracks each ingestion execution
CREATE TABLE public.provider_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name text NOT NULL,
  endpoint text NOT NULL,
  params jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  records_fetched int DEFAULT 0,
  records_normalized int DEFAULT 0,
  records_written int DEFAULT 0,
  records_deduplicated int DEFAULT 0,
  entities_resolved int DEFAULT 0,
  error_count int DEFAULT 0,
  error_summary text,
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_provider_runs_provider ON public.provider_runs (provider_name, started_at DESC);
CREATE INDEX idx_provider_runs_status ON public.provider_runs (status);

ALTER TABLE public.provider_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read provider runs"
  ON public.provider_runs FOR SELECT TO authenticated USING (true);

-- 2. provider_raw_payloads — original data for replay/audit
CREATE TABLE public.provider_raw_payloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_run_id uuid REFERENCES public.provider_runs(id) ON DELETE CASCADE NOT NULL,
  source_record_id text,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_raw_payloads_run ON public.provider_raw_payloads (provider_run_id);
CREATE INDEX idx_raw_payloads_hash ON public.provider_raw_payloads (payload_hash);

ALTER TABLE public.provider_raw_payloads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read raw payloads"
  ON public.provider_raw_payloads FOR SELECT TO authenticated USING (true);

-- 3. normalized_metrics — canonical time-series facts
CREATE TABLE public.normalized_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name text NOT NULL,
  domain text NOT NULL,
  metric_name text NOT NULL,
  entity_id uuid REFERENCES public.canonical_entities(id),
  related_entity_id uuid REFERENCES public.canonical_entities(id),
  location_entity_id uuid REFERENCES public.canonical_entities(id),
  iso3 text,
  period text NOT NULL,
  value double precision NOT NULL,
  unit text,
  confidence double precision DEFAULT 0.5,
  provenance_source text,
  provenance_observed_at timestamptz DEFAULT now(),
  raw_payload_id uuid REFERENCES public.provider_raw_payloads(id),
  provider_run_id uuid REFERENCES public.provider_runs(id),
  dedup_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_normalized_metrics_dedup UNIQUE (dedup_key)
);

CREATE INDEX idx_norm_metrics_entity ON public.normalized_metrics (entity_id, metric_name, period);
CREATE INDEX idx_norm_metrics_domain ON public.normalized_metrics (domain, metric_name);
CREATE INDEX idx_norm_metrics_iso3 ON public.normalized_metrics (iso3, metric_name, period);
CREATE INDEX idx_norm_metrics_provider ON public.normalized_metrics (provider_name, metric_name);

ALTER TABLE public.normalized_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read normalized metrics"
  ON public.normalized_metrics FOR SELECT TO authenticated USING (true);

-- 4. normalized_events — canonical event facts
CREATE TABLE public.normalized_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name text NOT NULL,
  event_type text NOT NULL,
  title text NOT NULL,
  description text,
  entity_id uuid REFERENCES public.canonical_entities(id),
  location_entity_id uuid REFERENCES public.canonical_entities(id),
  iso3 text,
  started_at timestamptz,
  ended_at timestamptz,
  severity double precision,
  confidence double precision DEFAULT 0.5,
  provenance_source text,
  raw_payload_id uuid REFERENCES public.provider_raw_payloads(id),
  provider_run_id uuid REFERENCES public.provider_runs(id),
  dedup_key text NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_normalized_events_dedup UNIQUE (dedup_key)
);

CREATE INDEX idx_norm_events_entity ON public.normalized_events (entity_id, event_type);
CREATE INDEX idx_norm_events_location ON public.normalized_events (location_entity_id);
CREATE INDEX idx_norm_events_iso3 ON public.normalized_events (iso3, event_type);
CREATE INDEX idx_norm_events_time ON public.normalized_events (started_at DESC);

ALTER TABLE public.normalized_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read normalized events"
  ON public.normalized_events FOR SELECT TO authenticated USING (true);

-- 5. entity_metric_links — many-to-many metric ↔ entity
CREATE TABLE public.entity_metric_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_id uuid REFERENCES public.normalized_metrics(id) ON DELETE CASCADE NOT NULL,
  entity_id uuid REFERENCES public.canonical_entities(id) ON DELETE CASCADE NOT NULL,
  link_role text NOT NULL DEFAULT 'subject',
  confidence double precision DEFAULT 1.0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_entity_metric_link UNIQUE (metric_id, entity_id, link_role)
);

CREATE INDEX idx_entity_metric_entity ON public.entity_metric_links (entity_id);

ALTER TABLE public.entity_metric_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read entity metric links"
  ON public.entity_metric_links FOR SELECT TO authenticated USING (true);

-- 6. entity_event_links — many-to-many event ↔ entity
CREATE TABLE public.entity_event_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.normalized_events(id) ON DELETE CASCADE NOT NULL,
  entity_id uuid REFERENCES public.canonical_entities(id) ON DELETE CASCADE NOT NULL,
  link_role text NOT NULL DEFAULT 'subject',
  confidence double precision DEFAULT 1.0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_entity_event_link UNIQUE (event_id, entity_id, link_role)
);

CREATE INDEX idx_entity_event_entity ON public.entity_event_links (entity_id);

ALTER TABLE public.entity_event_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read entity event links"
  ON public.entity_event_links FOR SELECT TO authenticated USING (true);

-- 7. data_provenance — detailed provenance for any fact
CREATE TABLE public.data_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_type text NOT NULL,
  fact_id uuid NOT NULL,
  source_provider text NOT NULL,
  source_endpoint text,
  source_url text,
  source_license text,
  freshness_score double precision DEFAULT 1.0,
  quality_score double precision DEFAULT 0.5,
  confidence double precision DEFAULT 0.5,
  observed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_provenance_fact ON public.data_provenance (fact_type, fact_id);
CREATE INDEX idx_provenance_provider ON public.data_provenance (source_provider);

ALTER TABLE public.data_provenance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read data provenance"
  ON public.data_provenance FOR SELECT TO authenticated USING (true);

-- 8. ingestion_errors — error log per run
CREATE TABLE public.ingestion_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_run_id uuid REFERENCES public.provider_runs(id) ON DELETE CASCADE NOT NULL,
  stage text NOT NULL,
  error_message text NOT NULL,
  error_detail jsonb DEFAULT '{}',
  source_record jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ingestion_errors_run ON public.ingestion_errors (provider_run_id);

ALTER TABLE public.ingestion_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read ingestion errors"
  ON public.ingestion_errors FOR SELECT TO authenticated USING (true);

-- Trigger for normalized_metrics updated_at
CREATE TRIGGER update_normalized_metrics_updated_at
  BEFORE UPDATE ON public.normalized_metrics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
