DROP POLICY "System can insert notifications" ON public.user_notifications;

CREATE POLICY "Authenticated users can receive notifications"
  ON public.user_notifications FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
