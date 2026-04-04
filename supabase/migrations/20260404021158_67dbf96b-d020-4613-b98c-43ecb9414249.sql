
-- Phase 16.2: Source Quality + Routing Precision Hardening

-- 1. Extend global_signals with enrichment pipeline + source quality fields
ALTER TABLE public.global_signals
  ADD COLUMN IF NOT EXISTS official_source boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS canonical_source_name text,
  ADD COLUMN IF NOT EXISTS source_rank_score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS event_cluster_id uuid,
  ADD COLUMN IF NOT EXISTS enrichment_status text DEFAULT 'enriched',
  ADD COLUMN IF NOT EXISTS enrichment_attempts integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS enrichment_error text,
  ADD COLUMN IF NOT EXISTS ingested_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz,
  ADD COLUMN IF NOT EXISTS routed_at timestamptz,
  ADD COLUMN IF NOT EXISTS official_source_present boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS merged_source_count integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS routing_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS routing_suppressed_reason text;

-- Index for enrichment queue
CREATE INDEX IF NOT EXISTS idx_global_signals_enrichment_status ON public.global_signals(enrichment_status);
CREATE INDEX IF NOT EXISTS idx_global_signals_event_cluster ON public.global_signals(event_cluster_id);

-- 2. Extend source_trust_scores
ALTER TABLE public.source_trust_scores
  ADD COLUMN IF NOT EXISTS official_source boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS country_jurisdiction text;

-- 3. Routing threshold config table
CREATE TABLE IF NOT EXISTS public.routing_threshold_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name text NOT NULL UNIQUE,
  min_impact integer DEFAULT 70,
  min_confidence integer DEFAULT 60,
  trust_floor text DEFAULT 'tier_3',
  official_boost integer DEFAULT 10,
  multi_source_boost integer DEFAULT 5,
  misinfo_penalty integer DEFAULT 15,
  enabled boolean DEFAULT true,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.routing_threshold_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read routing thresholds"
  ON public.routing_threshold_config FOR SELECT USING (true);

CREATE POLICY "Authenticated users can manage routing thresholds"
  ON public.routing_threshold_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed default routing rules
INSERT INTO public.routing_threshold_config (rule_name, min_impact, min_confidence, trust_floor, official_boost, multi_source_boost, misinfo_penalty, description)
VALUES 
  ('default', 70, 60, 'tier_3', 10, 5, 15, 'Default routing threshold — route signals with impact >= 70 and confidence >= 60'),
  ('high_trust_override', 60, 50, 'tier_1', 15, 10, 20, 'Lower thresholds for Tier 1 / official sources'),
  ('strict_mode', 80, 70, 'tier_2', 5, 3, 25, 'Strict routing — only very high impact/confidence signals')
ON CONFLICT (rule_name) DO NOTHING;

-- 4. Source connector runs table
CREATE TABLE IF NOT EXISTS public.source_connector_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name text NOT NULL,
  source_type text,
  run_status text NOT NULL DEFAULT 'success',
  signals_fetched integer DEFAULT 0,
  signals_new integer DEFAULT 0,
  signals_merged integer DEFAULT 0,
  duration_ms integer DEFAULT 0,
  error_message text,
  run_at timestamptz DEFAULT now()
);

ALTER TABLE public.source_connector_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read connector runs"
  ON public.source_connector_runs FOR SELECT USING (true);

CREATE POLICY "Service role can insert connector runs"
  ON public.source_connector_runs FOR INSERT WITH CHECK (true);

-- 5. Signal quality metrics daily
CREATE TABLE IF NOT EXISTS public.signal_quality_metrics_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date date NOT NULL DEFAULT CURRENT_DATE,
  total_routed integer DEFAULT 0,
  confirmed_count integer DEFAULT 0,
  rejected_count integer DEFAULT 0,
  unclear_count integer DEFAULT 0,
  confirm_rate numeric DEFAULT 0,
  reject_rate numeric DEFAULT 0,
  unclear_rate numeric DEFAULT 0,
  precision_by_category jsonb DEFAULT '{}',
  precision_by_tier jsonb DEFAULT '{}',
  avg_impact_of_routed numeric DEFAULT 0,
  avg_confidence_of_routed numeric DEFAULT 0,
  official_source_pct numeric DEFAULT 0,
  tier1_pct numeric DEFAULT 0,
  tier2_pct numeric DEFAULT 0,
  tier3_pct numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(metric_date)
);

ALTER TABLE public.signal_quality_metrics_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read quality metrics"
  ON public.signal_quality_metrics_daily FOR SELECT USING (true);

CREATE POLICY "Service role can insert quality metrics"
  ON public.signal_quality_metrics_daily FOR INSERT WITH CHECK (true);

CREATE POLICY "Service role can update quality metrics"
  ON public.signal_quality_metrics_daily FOR UPDATE USING (true);

-- 6. Seed additional official/institutional sources
INSERT INTO public.source_trust_scores (source_name, source_type, credibility_weight, verification_level, official_source, country_jurisdiction, notes) VALUES
  ('WHO', 'official_body', 98, 'primary', true, 'INT', 'World Health Organization'),
  ('CDC', 'official_body', 97, 'primary', true, 'US', 'Centers for Disease Control'),
  ('ECDC', 'official_body', 96, 'primary', true, 'EU', 'European Centre for Disease Prevention'),
  ('Federal Reserve', 'official_body', 99, 'primary', true, 'US', 'US Federal Reserve'),
  ('ECB', 'official_body', 98, 'primary', true, 'EU', 'European Central Bank'),
  ('Bank of England', 'official_body', 97, 'primary', true, 'GB', 'Bank of England'),
  ('IMF', 'official_body', 97, 'primary', true, 'INT', 'International Monetary Fund'),
  ('World Bank', 'official_body', 96, 'primary', true, 'INT', 'World Bank Group'),
  ('OECD', 'official_body', 95, 'primary', true, 'INT', 'Organisation for Economic Co-operation'),
  ('CISA', 'official_body', 97, 'primary', true, 'US', 'Cybersecurity and Infrastructure Security Agency'),
  ('US State Department', 'official_body', 98, 'primary', true, 'US', 'US Department of State'),
  ('UK Foreign Office', 'official_body', 96, 'primary', true, 'GB', 'UK Foreign Commonwealth & Development Office'),
  ('NATO', 'official_body', 95, 'primary', true, 'INT', 'North Atlantic Treaty Organization'),
  ('United Nations', 'official_body', 96, 'primary', true, 'INT', 'United Nations'),
  ('Pentagon', 'official_body', 95, 'primary', true, 'US', 'US Department of Defense'),
  ('European Commission', 'official_body', 95, 'primary', true, 'EU', 'European Commission'),
  ('Bloomberg', 'financial', 92, 'primary', false, null, 'Bloomberg News and Terminal'),
  ('Financial Times', 'financial', 91, 'primary', false, null, 'Financial Times'),
  ('Wall Street Journal', 'financial', 90, 'primary', false, null, 'Wall Street Journal'),
  ('The Economist', 'financial', 90, 'primary', false, null, 'The Economist'),
  ('Nikkei', 'financial', 88, 'primary', false, 'JP', 'Nikkei Asia / Nikkei'),
  ('Al Jazeera', 'wire_agency', 82, 'secondary', false, 'QA', 'Al Jazeera Media Network'),
  ('France 24', 'wire_agency', 80, 'secondary', false, 'FR', 'France 24'),
  ('DW', 'wire_agency', 80, 'secondary', false, 'DE', 'Deutsche Welle')
ON CONFLICT (source_name) DO UPDATE SET
  official_source = EXCLUDED.official_source,
  country_jurisdiction = EXCLUDED.country_jurisdiction,
  credibility_weight = GREATEST(source_trust_scores.credibility_weight, EXCLUDED.credibility_weight);

-- Update existing Tier 1 sources with official_source = false where not official
UPDATE public.source_trust_scores SET official_source = false WHERE official_source IS NULL;
