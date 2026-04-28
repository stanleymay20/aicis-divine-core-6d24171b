CREATE TABLE IF NOT EXISTS public.quantivis_sync_cursors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL,
  surface TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00Z',
  last_row_count INTEGER NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, surface)
);

CREATE INDEX IF NOT EXISTS idx_qv_sync_cursors_org_surface
  ON public.quantivis_sync_cursors (org_id, surface);

ALTER TABLE public.quantivis_sync_cursors ENABLE ROW LEVEL SECURITY;

-- Service-role only (no user-facing policies). Edge function uses service key.
CREATE POLICY "service role manages sync cursors"
  ON public.quantivis_sync_cursors
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER trg_qv_sync_cursors_updated
  BEFORE UPDATE ON public.quantivis_sync_cursors
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();