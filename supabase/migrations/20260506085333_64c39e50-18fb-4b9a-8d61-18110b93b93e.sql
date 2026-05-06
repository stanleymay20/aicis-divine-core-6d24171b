-- Replace "USING (true) WITH CHECK (true)" service-role policies with explicit role gating.
-- Service role bypasses RLS anyway; this just removes the linter-flagged permissive logic
-- that would otherwise also apply to anon/authenticated.

DO $$
DECLARE
  r record;
  targets jsonb := '[
    {"t":"risk_ml_predictions","p":"risk_ml_predictions_service_write"},
    {"t":"ml_model_weights","p":"ml_weights_service_write"},
    {"t":"risk_action_recommendations","p":"Service role manages recommendations"},
    {"t":"risk_prediction_realizations","p":"Service role manages realizations"},
    {"t":"model_performance_log","p":"Service role manages performance log"},
    {"t":"domain_trust_scores","p":"Service role manages trust scores"},
    {"t":"training_dataset_aicis","p":"Service role manages training dataset"},
    {"t":"risk_propagation_score","p":"propagation_service_write"},
    {"t":"simulation_runs","p":"simulation_service_write"},
    {"t":"quantivis_sync_cursors","p":"service role manages sync cursors"},
    {"t":"signal_source_registry","p":"Service role manages signal source registry"},
    {"t":"forecast_realization_runs","p":"frr_service_write"},
    {"t":"signal_detection_benchmarks","p":"Service role manages signal detection benchmarks"},
    {"t":"signal_coverage_snapshots","p":"Service role manages signal coverage snapshots"},
    {"t":"detection_audit_runs","p":"service_write_detection_audit"},
    {"t":"web_search_sweep_queries","p":"service_manage_sweep_queries"}
  ]'::jsonb;
BEGIN
  FOR r IN SELECT * FROM jsonb_to_recordset(targets) AS x(t text, p text)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.p, r.t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
      r.p, r.t
    );
  END LOOP;
END $$;

-- The single INSERT policy with WITH CHECK(true) on forecast_prospective_evaluations
DROP POLICY IF EXISTS "Service role inserts prospective evaluations" ON public.forecast_prospective_evaluations;
CREATE POLICY "Service role inserts prospective evaluations"
  ON public.forecast_prospective_evaluations
  FOR INSERT TO authenticated
  WITH CHECK (auth.role() = 'service_role');