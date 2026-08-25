-- Notification broadcasts are backend-generated operational records.
-- The legacy INSERT policy allowed any role with table INSERT privilege to
-- create arbitrary broadcast notifications because WITH CHECK (true) had no
-- caller restriction.
DROP POLICY IF EXISTS "System can insert notifications" ON public.user_notifications;
REVOKE INSERT ON public.user_notifications FROM anon, authenticated;

COMMENT ON TABLE public.user_notifications IS
  'In-app notifications. Client roles may read/update according to RLS, but notification creation is restricted to privileged backend workers.';

COMMENT ON COLUMN public.user_notifications.user_id IS
  'NULL represents an in-app broadcast visible through the existing read policy; non-NULL targets a specific user.';
