
-- Watchlist items table
CREATE TABLE public.watchlist_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  watch_type TEXT NOT NULL DEFAULT 'country',
  country_iso3 TEXT,
  region_id UUID REFERENCES public.admin_regions(id),
  hotspot_key TEXT,
  label TEXT NOT NULL,
  priority_level TEXT NOT NULL DEFAULT 'normal',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT watchlist_items_watch_type_check CHECK (watch_type IN ('country', 'region', 'hotspot'))
);

ALTER TABLE public.watchlist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own watchlist" ON public.watchlist_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own watchlist" ON public.watchlist_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own watchlist" ON public.watchlist_items FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own watchlist" ON public.watchlist_items FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_watchlist_items_updated_at
  BEFORE UPDATE ON public.watchlist_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_watchlist_items_user ON public.watchlist_items(user_id);
CREATE INDEX idx_watchlist_items_type ON public.watchlist_items(watch_type);

-- Watchlist events table
CREATE TABLE public.watchlist_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  watchlist_item_id UUID NOT NULL REFERENCES public.watchlist_items(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_summary TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.watchlist_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own watchlist events" ON public.watchlist_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.watchlist_items wi WHERE wi.id = watchlist_item_id AND wi.user_id = auth.uid()));
CREATE POLICY "Users can create own watchlist events" ON public.watchlist_events FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.watchlist_items wi WHERE wi.id = watchlist_item_id AND wi.user_id = auth.uid()));

CREATE INDEX idx_watchlist_events_item ON public.watchlist_events(watchlist_item_id);
CREATE INDEX idx_watchlist_events_created ON public.watchlist_events(created_at DESC);
