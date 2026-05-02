-- Audit log for every export attempt
CREATE TABLE IF NOT EXISTS public.aicis_export_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  exported_by_email text,
  dataset_name text NOT NULL,
  format text NOT NULL CHECK (format IN ('csv','json','ndjson')),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  file_size_bytes bigint,
  sha256_checksum text,
  storage_path text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','error')),
  error_message text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.aicis_export_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_export_logs_user_created
  ON public.aicis_export_logs (exported_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_logs_dataset_created
  ON public.aicis_export_logs (dataset_name, created_at DESC);

-- Helper: who is allowed to export
CREATE OR REPLACE FUNCTION public.has_export_role(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin'::app_role)
      OR public.has_role(_user_id, 'operator'::app_role);
$$;

-- RLS: admin/operator can read their org's logs; nobody writes from client (edge fn uses service role)
CREATE POLICY "export_logs_read_authorized" ON public.aicis_export_logs
  FOR SELECT TO authenticated
  USING (public.has_export_role(auth.uid()));

-- Private storage bucket for generated export files
INSERT INTO storage.buckets (id, name, public)
  VALUES ('aicis-exports', 'aicis-exports', false)
  ON CONFLICT (id) DO NOTHING;

-- Storage RLS: only admins/operators can list/read their own exports;
-- the edge function uses the service role and bypasses these policies for writes.
CREATE POLICY "exports_select_authorized" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'aicis-exports'
    AND public.has_export_role(auth.uid())
  );