-- Enable realtime on critical_alerts
ALTER PUBLICATION supabase_realtime ADD TABLE public.critical_alerts;

-- Enable realtime on alerts table (already used but ensure publication)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'alerts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;
  END IF;
END $$;
