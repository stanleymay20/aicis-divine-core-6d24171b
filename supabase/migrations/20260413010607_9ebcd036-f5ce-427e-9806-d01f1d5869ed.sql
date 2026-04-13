
-- Expand data_provenance for full fact-grade tracking
ALTER TABLE data_provenance 
  ALTER COLUMN fact_id TYPE text USING fact_id::text;

ALTER TABLE data_provenance
  ADD COLUMN IF NOT EXISTS retrieved_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS entity_match_confidence double precision,
  ADD COLUMN IF NOT EXISTS adapter_version text DEFAULT 'v1';

-- Better run analytics + replay/backfill support
ALTER TABLE provider_runs
  ADD COLUMN IF NOT EXISTS records_inserted integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS records_updated integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS run_mode text DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS replay_source_run_id uuid REFERENCES provider_runs(id),
  ADD COLUMN IF NOT EXISTS adapter_version text DEFAULT 'v1';

-- Freshness tracking on facts
ALTER TABLE normalized_metrics
  ADD COLUMN IF NOT EXISTS freshness_score double precision DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;

ALTER TABLE normalized_events
  ADD COLUMN IF NOT EXISTS freshness_score double precision DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;

-- Index for replay/backfill queries
CREATE INDEX IF NOT EXISTS idx_provider_runs_mode ON provider_runs(run_mode);
CREATE INDEX IF NOT EXISTS idx_provider_runs_replay ON provider_runs(replay_source_run_id) WHERE replay_source_run_id IS NOT NULL;

-- Index for freshness queries
CREATE INDEX IF NOT EXISTS idx_metrics_freshness ON normalized_metrics(freshness_score) WHERE freshness_score < 0.5;
CREATE INDEX IF NOT EXISTS idx_events_freshness ON normalized_events(freshness_score) WHERE freshness_score < 0.5;
