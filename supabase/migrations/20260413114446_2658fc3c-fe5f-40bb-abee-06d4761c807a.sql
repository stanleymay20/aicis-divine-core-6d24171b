
ALTER TABLE public.backfill_state ENABLE ROW LEVEL SECURITY;

-- Only service role (system) can access this table
CREATE POLICY "Service role only" ON public.backfill_state
  FOR ALL USING (false);
