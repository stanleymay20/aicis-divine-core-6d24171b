import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
// AICIS Training Dataset Builder — Sweep #16 modernized
// Incremental, chunked, resumable, self-continuing training pipeline.
//
// Modes:
//   POST { mode: "incremental", lookback_days?: 14, horizon_days?: 7 }
//     - Auto-computes missing days since watermark, spawns a chunked execution.
//   POST { mode: "chunk", execution_id: "...", country_batch_index?: N }
//     - Processes ONE country batch of the pending day, then self-invokes for next batch/day.
//   POST { mode: "range", start_date, end_date, horizon_days?, chunk_days?, per_country? }
//     - Legacy backfill: bounded batch build with a hard time budget.
//   POST { mode: "resume", execution_id?: "..." }
//     - Resumes the most recent (or specified) non-terminal execution.
//   GET  ?export=csv[&split=train|val|test]
//     - Streams the dataset as CSV.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ==================== CONFIG ====================
const SOFT_TIME_BUDGET_MS = 45_000;   // stop and self-continue past this
const COUNTRY_BATCH_SIZE = 40;         // countries processed per invocation slice
const DEFAULT_HORIZON = 7;
const DEFAULT_LOOKBACK = 14;
const MAX_COUNTRIES = 260;
const FEATURE_COUNT = 22;              // columns in training_dataset_aicis features

// ==================== HELPERS ====================
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toIso(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return toIso(d);
}
function newExecutionId() {
  return `tr_${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Fire-and-forget self-invocation. Never awaits the response body.
function selfInvoke(supabaseUrl: string, serviceKey: string, body: Record<string, unknown>) {
  const url = `${supabaseUrl}/functions/v1/build-training-dataset`;
  // No await — background continuation
  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
      "apikey": serviceKey,
    },
    body: JSON.stringify(body),
  }).catch((e) => console.error("[self-invoke] error", e));
}

// ==================== CORE ====================
type Supa = ReturnType<typeof createClient>;

async function loadCountries(supabase: Supa): Promise<string[]> {
  const { data } = await supabase
    .from("normalized_metrics")
    .select("iso3")
    .not("iso3", "is", null)
    .gte("provenance_observed_at",
      new Date(Date.now() - 180 * 86400e3).toISOString())
    .limit(50000);
  return Array.from(new Set((data ?? []).map((r: any) => r.iso3))).slice(0, MAX_COUNTRIES) as string[];
}

async function updateExecution(supabase: Supa, executionId: string, patch: Record<string, unknown>) {
  await supabase
    .from("training_executions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("execution_id", executionId);
}

async function finalizeVersion(supabase: Supa, executionId: string) {
  const { data: exec } = await supabase
    .from("training_executions").select("*").eq("execution_id", executionId).maybeSingle();
  if (!exec) return;

  const { data: distRows } = await supabase
    .from("training_dataset_aicis")
    .select("label_did_deteriorate")
    .eq("horizon_days", exec.horizon_days ?? DEFAULT_HORIZON)
    .gte("snapshot_date", exec.window_start)
    .lte("snapshot_date", exec.window_end);

  const total = distRows?.length ?? 0;
  const positives = (distRows ?? []).filter((r: any) => r.label_did_deteriorate === 1).length;
  const positiveRate = total > 0 ? positives / total : 0;

  const version = `v${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${executionId.slice(-6)}`;
  const checksum = await sha256Hex(`${executionId}|${exec.window_start}|${exec.window_end}|${total}`);

  // Demote previous current version
  await supabase.from("training_dataset_versions").update({ is_current: false }).eq("is_current", true);

  await supabase.from("training_dataset_versions").insert({
    dataset_version: version,
    execution_id: executionId,
    window_start: exec.window_start,
    window_end: exec.window_end,
    horizon_days: exec.horizon_days ?? DEFAULT_HORIZON,
    row_count: total,
    feature_count: FEATURE_COUNT,
    positive_rate: positiveRate,
    checksum,
    source_snapshot: {
      records_processed: exec.records_processed,
      chunks_completed: exec.chunks_completed,
      total_chunks: exec.total_chunks,
      mode: exec.mode,
    },
    is_current: true,
  });
}

async function processCountryBatch(
  supabase: Supa,
  execution: any,
  countries: string[],
  pendingDays: string[],
): Promise<{ processed_countries: number; rows_added: number; consumed_days: string[] }> {
  const started = Date.now();
  let rowsAdded = 0;
  let processedCountries = 0;
  const consumedDays: string[] = [];

  for (const day of pendingDays) {
    for (const iso3 of countries) {
      if (Date.now() - started > SOFT_TIME_BUDGET_MS) {
        return { processed_countries: processedCountries, rows_added: rowsAdded, consumed_days: consumedDays };
      }
      try {
        const { data, error } = await supabase.rpc("build_training_dataset_aicis", {
          p_start_date: day,
          p_end_date: day,
          p_horizon_days: execution.horizon_days ?? DEFAULT_HORIZON,
          p_iso3_filter: iso3,
        });
        if (error) {
          console.error(`[chunk] ${day}/${iso3} error:`, error.message);
        } else {
          const stats = Array.isArray(data) ? data[0] : data;
          rowsAdded += Number(stats?.rows_inserted ?? 0);
        }
        processedCountries++;
      } catch (e) {
        console.error(`[chunk] ${day}/${iso3} exception:`, e);
      }
    }
    consumedDays.push(day);
  }
  return { processed_countries: processedCountries, rows_added: rowsAdded, consumed_days: consumedDays };
}

Deno.serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const url = new URL(req.url);

    // ---------- CSV export (unchanged) ----------
    if (url.searchParams.get("export") === "csv") {
      const split = url.searchParams.get("split");
      let q = supabase.from("training_dataset_aicis").select("*")
        .order("snapshot_date", { ascending: true }).limit(50000);
      if (split && split !== "all") q = q.eq("dataset_split", split);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) return new Response("no rows", { status: 404, headers: corsHeaders });
      const cols = Object.keys(data[0]);
      const rows = [cols.join(","), ...data.map((r: any) => cols.map((c) => csvEscape(r[c])).join(","))].join("\n");
      return new Response(`${rows}\n`, {
        headers: {
          ...corsHeaders, "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="aicis_training_${split ?? "all"}.csv"`,
        },
      });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const mode: string = body.mode ?? (body.start_date ? "range" : "incremental");
    const horizon = Number(body.horizon_days ?? DEFAULT_HORIZON);

    // =============== MODE: incremental ===============
    if (mode === "incremental") {
      const lookback = Number(body.lookback_days ?? DEFAULT_LOOKBACK);
      const { data: missing, error: missErr } = await supabase.rpc("training_dataset_missing_days", {
        p_lookback_days: lookback, p_horizon: horizon,
      });
      if (missErr) throw missErr;
      const days: string[] = (missing ?? []).map((r: any) => r.snapshot_date);

      if (days.length === 0) {
        return new Response(JSON.stringify({
          ok: true, mode, message: "training dataset up to date", missing_days: 0,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const executionId = newExecutionId();
      const winStart = days[0];
      const winEnd = days[days.length - 1];
      const totalChunks = days.length; // one chunk == one day

      await supabase.from("training_executions").insert({
        execution_id: executionId,
        mode: "incremental",
        status: "running",
        window_start: winStart,
        window_end: winEnd,
        horizon_days: horizon,
        chunk_size_days: 1,
        total_chunks: totalChunks,
        chunks_completed: 0,
        records_processed: 0,
        last_watermark: null,
        metadata: { pending_days: days, lookback_days: lookback },
      });

      // Fire-and-forget first chunk. Return immediately.
      selfInvoke(supabaseUrl, serviceKey, { mode: "chunk", execution_id: executionId });

      return new Response(JSON.stringify({
        ok: true, mode, execution_id: executionId,
        window: { start: winStart, end: winEnd, horizon_days: horizon },
        total_chunks: totalChunks,
        message: `scheduled ${totalChunks} day-chunks; execution running in background`,
      }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // =============== MODE: resume ===============
    if (mode === "resume") {
      let executionId: string | undefined = body.execution_id;
      if (!executionId) {
        const { data: last } = await supabase.from("training_executions")
          .select("execution_id").eq("status", "running")
          .order("started_at", { ascending: false }).limit(1).maybeSingle();
        executionId = last?.execution_id;
      }
      if (!executionId) {
        return new Response(JSON.stringify({ ok: false, message: "no running execution to resume" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      selfInvoke(supabaseUrl, serviceKey, { mode: "chunk", execution_id: executionId });
      return new Response(JSON.stringify({ ok: true, mode, execution_id: executionId, resumed: true }),
        { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // =============== MODE: chunk ===============
    if (mode === "chunk") {
      const executionId: string = body.execution_id;
      if (!executionId) throw new Error("execution_id required for chunk mode");

      const { data: exec, error: execErr } = await supabase
        .from("training_executions").select("*").eq("execution_id", executionId).maybeSingle();
      if (execErr) throw execErr;
      if (!exec) throw new Error(`execution ${executionId} not found`);
      if (exec.status !== "running") {
        return new Response(JSON.stringify({ ok: true, message: `execution already ${exec.status}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const pending: string[] = (exec.metadata?.pending_days ?? []) as string[];
      if (pending.length === 0) {
        // Nothing left → finalize
        await updateExecution(supabase, executionId, {
          status: "completed",
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - new Date(exec.started_at).getTime(),
        });
        await finalizeVersion(supabase, executionId);
        return new Response(JSON.stringify({ ok: true, message: "completed", execution_id: executionId }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const countries = await loadCountries(supabase);
      // Take first pending day, process countries in slices
      const batchIndex = Number(body.country_batch_index ?? 0);
      const slice = countries.slice(batchIndex, batchIndex + COUNTRY_BATCH_SIZE);
      const day = pending[0];

      const result = await processCountryBatch(supabase, exec, slice, [day]);
      const newRecords = (exec.records_processed ?? 0) + result.rows_added;

      const nextBatchIndex = batchIndex + COUNTRY_BATCH_SIZE;
      const dayComplete = nextBatchIndex >= countries.length;

      let newPending = pending;
      let chunksCompleted = exec.chunks_completed ?? 0;
      let nextInvoke: Record<string, unknown>;

      if (dayComplete) {
        newPending = pending.slice(1);
        chunksCompleted += 1;
        nextInvoke = { mode: "chunk", execution_id: executionId, country_batch_index: 0 };
      } else {
        nextInvoke = { mode: "chunk", execution_id: executionId, country_batch_index: nextBatchIndex };
      }

      const isTerminal = newPending.length === 0 && dayComplete;

      await updateExecution(supabase, executionId, {
        records_processed: newRecords,
        chunks_completed: chunksCompleted,
        last_watermark: day,
        last_country_iso3: slice[slice.length - 1] ?? null,
        metadata: { ...(exec.metadata ?? {}), pending_days: newPending },
        ...(isTerminal ? {
          status: "completed",
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - new Date(exec.started_at).getTime(),
        } : {}),
      });

      if (isTerminal) {
        await finalizeVersion(supabase, executionId);
        return new Response(JSON.stringify({
          ok: true, execution_id: executionId, status: "completed",
          records_processed: newRecords, chunks_completed: chunksCompleted,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Continue in background
      selfInvoke(supabaseUrl, serviceKey, nextInvoke);

      return new Response(JSON.stringify({
        ok: true, execution_id: executionId, status: "running",
        day, batch_index: batchIndex, day_complete: dayComplete,
        rows_added: result.rows_added,
        remaining_days: newPending.length,
      }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // =============== MODE: range (bounded backfill) ===============
    if (mode === "range") {
      const startDate: string = body.start_date;
      const endDate: string = body.end_date;
      const chunkDays = Math.max(1, Math.min(Number(body.chunk_days ?? 1), 7));
      if (!startDate || !endDate) throw new Error("start_date and end_date required for range mode");

      const executionId = newExecutionId();
      // Build day list; enqueue via incremental machinery
      const days: string[] = [];
      let cur = startDate;
      while (cur <= endDate) { days.push(cur); cur = addDays(cur, 1); }

      await supabase.from("training_executions").insert({
        execution_id: executionId,
        mode: "range",
        status: "running",
        window_start: startDate,
        window_end: endDate,
        horizon_days: horizon,
        chunk_size_days: chunkDays,
        total_chunks: days.length,
        chunks_completed: 0,
        records_processed: 0,
        metadata: { pending_days: days, chunk_days: chunkDays },
      });
      selfInvoke(supabaseUrl, serviceKey, { mode: "chunk", execution_id: executionId });

      return new Response(JSON.stringify({
        ok: true, mode, execution_id: executionId,
        window: { start: startDate, end: endDate }, total_chunks: days.length,
      }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error(`unknown mode: ${mode}`);
  } catch (e) {
    console.error("[build-training-dataset] error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
