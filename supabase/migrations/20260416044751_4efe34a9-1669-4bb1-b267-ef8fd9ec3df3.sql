
ALTER TABLE public.automation_logs DROP CONSTRAINT automation_logs_status_check;
ALTER TABLE public.automation_logs ADD CONSTRAINT automation_logs_status_check 
  CHECK (status IN ('running','success','error','timeout','warning','partial','skipped'));
