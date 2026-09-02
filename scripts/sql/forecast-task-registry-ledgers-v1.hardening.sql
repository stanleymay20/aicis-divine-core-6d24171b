-- AICIS Forecast Task Registry + Forecast/Resolution Ledgers v1
-- CONTROLLED HARDENING FRAGMENT — MUST BE APPLIED AFTER
-- forecast-task-registry-ledgers-v1.candidate.sql.
--
-- Purpose: replace resolution serialization based on SELECT ... FOR UPDATE with
-- a transaction-scoped advisory lock. The immutable forecast ledger deliberately
-- grants service_role no UPDATE privilege, so scientific resolution serialization
-- must not depend on row-update privileges.

CREATE OR REPLACE FUNCTION public.guard_scientific_forecast_resolution_insert_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_forecast public.scientific_forecast_ledger_v1%ROWTYPE;
  v_task public.scientific_forecast_tasks_v1%ROWTYPE;
  v_last_version integer := 0;
  v_last_status text;
BEGIN
  -- Serialize resolution inserts for the same forecast without requiring UPDATE
  -- privilege on the immutable forecast ledger. Hash collisions can only serialize
  -- unrelated forecasts; they cannot weaken correctness.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.forecast_id::text, 0));

  SELECT * INTO v_forecast
  FROM public.scientific_forecast_ledger_v1
  WHERE id = NEW.forecast_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'forecast % does not exist', NEW.forecast_id;
  END IF;

  SELECT * INTO v_task
  FROM public.scientific_forecast_tasks_v1
  WHERE id = v_forecast.task_registry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'registered forecast task for forecast % does not exist', NEW.forecast_id;
  END IF;

  SELECT r.resolution_version, r.resolution_status
  INTO v_last_version, v_last_status
  FROM public.scientific_forecast_resolution_ledger_v1 r
  WHERE r.forecast_id = NEW.forecast_id
  ORDER BY r.resolution_version DESC
  LIMIT 1;

  v_last_version := COALESCE(v_last_version, 0);
  IF NEW.resolution_version <> v_last_version + 1 THEN
    RAISE EXCEPTION 'resolution version must advance consecutively from % to %', v_last_version, v_last_version + 1;
  END IF;
  IF v_last_version = 0 AND NEW.resolution_status = 'revised' THEN
    RAISE EXCEPTION 'first resolution version cannot be revised';
  END IF;
  IF v_last_version > 0 AND v_last_status IN ('final','revised') AND NEW.resolution_status <> 'revised' THEN
    RAISE EXCEPTION 'a final/revised resolution can only be superseded by a revised resolution';
  END IF;

  -- The database owns resolution time. A caller cannot submit an outcome early
  -- while forging a future resolved_at that falls after the target window.
  NEW.resolved_at := clock_timestamp();

  IF NEW.resolved_at < v_forecast.target_window_end THEN
    RAISE EXCEPTION 'forecast % cannot resolve before its target window closes', NEW.forecast_id;
  END IF;
  IF NEW.ground_truth_authority <> v_task.resolution_authority
     OR NEW.ground_truth_authority_class <> v_task.resolution_authority_class
     OR NEW.revision_policy <> v_task.resolution_revision_policy THEN
    RAISE EXCEPTION 'resolution authority/policy do not match the registered forecast task';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_scientific_forecast_resolution_insert_v1()
  FROM PUBLIC, anon, authenticated, service_role;
