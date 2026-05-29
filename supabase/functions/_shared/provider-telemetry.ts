// Sweep #10 — Provider Run Telemetry Wrapper.
//
// Standardized, fail-soft telemetry for every ingestion edge function.
// Records one row in `provider_runs` per execution with:
//   provider_name, endpoint, status, started_at, completed_at, duration_ms,
//   records_fetched, records_inserted, records_updated, records_normalized,
//   records_deduplicated, error_count, error_summary, run_mode, params
//
// Design rules:
//  - Telemetry NEVER fails ingestion. All writes are wrapped in try/catch.
//  - Each execution = exactly one provider_runs row (idempotent: created at
//    start, updated at finish or failure).
//  - Scheduler source / execution id are stored under `params`.
//
// Usage:
//   const run = await startProviderRun(supabase, {
//     provider_name: "worldbank",
//     endpoint: "pull-worldbank",
//     scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
//   });
//   try {
//     ...do work...
//     await finishProviderRun(supabase, run, {
//       records_fetched, records_inserted, records_updated,
//     });
//   } catch (e) {
//     await failProviderRun(supabase, run, e);
//     throw e;
//   }

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ProviderRunHandle {
  id: string | null;
  provider_name: string;
  endpoint: string;
  started_at: number; // perf timestamp (ms)
  scheduler_source: string;
  execution_id: string;
}

export interface StartOpts {
  provider_name: string;
  endpoint: string;
  scheduler_source?: string;
  execution_id?: string;
  params?: Record<string, unknown>;
  run_mode?: string;
}

export interface FinishTotals {
  records_fetched?: number;
  records_inserted?: number;
  records_updated?: number;
  records_normalized?: number;
  records_deduplicated?: number;
  entities_resolved?: number;
  error_count?: number;
  error_summary?: string | null;
}

function genId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export async function startProviderRun(
  supabase: SupabaseClient,
  opts: StartOpts,
): Promise<ProviderRunHandle> {
  const execution_id = opts.execution_id ?? genId();
  const scheduler_source = opts.scheduler_source ?? "manual";
  const handle: ProviderRunHandle = {
    id: null,
    provider_name: opts.provider_name,
    endpoint: opts.endpoint,
    started_at: performance.now(),
    scheduler_source,
    execution_id,
  };
  try {
    const { data, error } = await supabase
      .from("provider_runs")
      .insert({
        provider_name: opts.provider_name,
        endpoint: opts.endpoint,
        status: "running",
        run_mode: opts.run_mode ?? "live",
        params: {
          ...(opts.params ?? {}),
          scheduler_source,
          execution_id,
        },
      })
      .select("id")
      .single();
    if (error) {
      console.warn(`[telemetry] start failed for ${opts.provider_name}:`, error.message);
    } else {
      handle.id = (data as { id: string }).id;
    }
  } catch (e) {
    console.warn(`[telemetry] start exception for ${opts.provider_name}:`, e);
  }
  return handle;
}

export async function finishProviderRun(
  supabase: SupabaseClient,
  run: ProviderRunHandle,
  totals: FinishTotals = {},
): Promise<void> {
  if (!run.id) return; // telemetry start failed; silently skip
  const duration_ms = Math.max(0, Math.round(performance.now() - run.started_at));
  try {
    await supabase
      .from("provider_runs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        duration_ms,
        records_fetched: totals.records_fetched ?? 0,
        records_inserted: totals.records_inserted ?? 0,
        records_updated: totals.records_updated ?? 0,
        records_normalized: totals.records_normalized ?? 0,
        records_deduplicated: totals.records_deduplicated ?? 0,
        entities_resolved: totals.entities_resolved ?? 0,
        error_count: totals.error_count ?? 0,
        error_summary: totals.error_summary ?? null,
      })
      .eq("id", run.id);
  } catch (e) {
    console.warn(`[telemetry] finish exception for ${run.provider_name}:`, e);
  }
}

export async function failProviderRun(
  supabase: SupabaseClient,
  run: ProviderRunHandle,
  err: unknown,
  partial: FinishTotals = {},
): Promise<void> {
  if (!run.id) return;
  const duration_ms = Math.max(0, Math.round(performance.now() - run.started_at));
  const message = err instanceof Error ? err.message : String(err);
  try {
    await supabase
      .from("provider_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        duration_ms,
        records_fetched: partial.records_fetched ?? 0,
        records_inserted: partial.records_inserted ?? 0,
        records_updated: partial.records_updated ?? 0,
        records_normalized: partial.records_normalized ?? 0,
        records_deduplicated: partial.records_deduplicated ?? 0,
        entities_resolved: partial.entities_resolved ?? 0,
        error_count: (partial.error_count ?? 0) + 1,
        error_summary: message.slice(0, 2000),
      })
      .eq("id", run.id);
  } catch (e) {
    console.warn(`[telemetry] fail exception for ${run.provider_name}:`, e);
  }
}

/**
 * Convenience wrapper around the lifecycle. Telemetry is fail-soft — if the
 * inner handler throws, we record a `failed` row and rethrow so the caller's
 * existing error-handling path is preserved.
 */
export async function withProviderRun<T>(
  supabase: SupabaseClient,
  opts: StartOpts,
  fn: (ctx: { run: ProviderRunHandle; report: (t: FinishTotals) => void }) => Promise<{ result: T; totals?: FinishTotals }>,
): Promise<T> {
  const run = await startProviderRun(supabase, opts);
  let collected: FinishTotals = {};
  const report = (t: FinishTotals) => {
    collected = { ...collected, ...t };
  };
  try {
    const { result, totals } = await fn({ run, report });
    await finishProviderRun(supabase, run, { ...collected, ...(totals ?? {}) });
    return result;
  } catch (e) {
    await failProviderRun(supabase, run, e, collected);
    throw e;
  }
}
