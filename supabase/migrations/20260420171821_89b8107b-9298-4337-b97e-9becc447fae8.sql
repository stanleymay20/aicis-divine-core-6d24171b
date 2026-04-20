
-- Allow any authenticated user to log a decision they execute, while preserving
-- admin-wide management. Inserts must be owned by the calling user (recorded_by).
-- Updates remain admin-only to preserve audit integrity, EXCEPT for the user
-- updating outcomes on rows they themselves recorded.

CREATE POLICY "Authenticated users can log own decisions"
  ON public.decision_outcome_log
  FOR INSERT
  TO authenticated
  WITH CHECK (recorded_by = auth.uid());

CREATE POLICY "Users can update outcomes on own decisions"
  ON public.decision_outcome_log
  FOR UPDATE
  TO authenticated
  USING (recorded_by = auth.uid())
  WITH CHECK (recorded_by = auth.uid());
