
-- Add alert and status fields to watchlist_items
ALTER TABLE public.watchlist_items
  ADD COLUMN IF NOT EXISTS alert_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alert_threshold NUMERIC DEFAULT 70,
  ADD COLUMN IF NOT EXISTS last_alerted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_status TEXT NOT NULL DEFAULT 'stable',
  ADD COLUMN IF NOT EXISTS last_risk_value NUMERIC;

-- Add numeric tracking and dedup to watchlist_events
ALTER TABLE public.watchlist_events
  ADD COLUMN IF NOT EXISTS previous_value NUMERIC,
  ADD COLUMN IF NOT EXISTS current_value NUMERIC,
  ADD COLUMN IF NOT EXISTS delta_value NUMERIC,
  ADD COLUMN IF NOT EXISTS event_hash TEXT;

-- Unique constraint to prevent duplicate events for same state
CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_events_dedup
  ON public.watchlist_events (watchlist_item_id, event_hash)
  WHERE event_hash IS NOT NULL;

-- Index for efficient event queries
CREATE INDEX IF NOT EXISTS idx_watchlist_events_item_created
  ON public.watchlist_events (watchlist_item_id, created_at DESC);

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_watchlist_items_status
  ON public.watchlist_items (current_status, priority_level);
