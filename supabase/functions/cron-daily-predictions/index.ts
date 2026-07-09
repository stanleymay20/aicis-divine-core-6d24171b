import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// isoDaysAgo retained for future use — no longer needed after Sweep #16
// switched training to fire-and-forget incremental mode.

/**
 * Run a single async step with isolation, timing, and error capture.
 * Never throws — always returns a structured result so the parent chain continues.
 */
async function runStep<T>(
  name: string,
  fn: () => Promise<T>,
  timeoutMs = 90_000,
): Promise<{ name: string; ok: boolean; duration_ms: number; result?: T; error?: string }> {
  const start = Date.now();
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`step "${name}" timed out after ${timeoutMs}ms`)), timeoutMs),
    );
    const result = await Promise.race([fn(), timeout]);
    return { name, ok: true, duration_ms: Date.now() - start, result };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[cron-daily-predictions] step "${name}" failed: ${error}`);
    return { name, ok: false, duration_ms: Date.now() - start, error };
  }
}

async function refreshCrossBorderSignals(supabase: any) {
  const { data: latestBatch } = await supabase
    .from("risk_ranking_predictions")
    .select("generation_batch_id")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestBatch?.generation_batch_id) {
    return { created: 0, reason: "no_risk_batch" };
  }

  // Take top-N by probability (baseline scorer rarely exceeds 0.55; a hard
  // threshold caused 60+ days of empty cross-border output). Use adaptive
  // threshold: >=0.4 or top 150, whichever yields more coverage.
  const { data: risks, error: riskErr } = await supabase
    .from("risk_ranking_predictions")
    .select("country_iso3, domain, risk_probability")
    .eq("generation_batch_id", latestBatch.generation_batch_id)
    .order("risk_probability", { ascending: false })
    .limit(150);
  if (riskErr) throw riskErr;
  if (!risks || risks.length === 0) return { created: 0, reason: "no_risk_rows" };

  const iso3s = Array.from(new Set(risks.map((r: any) => r.country_iso3).filter(Boolean)));
  const { data: countries, error: countriesErr } = await supabase
    .from("canonical_entities")
    .select("id, iso3")
    .in("entity_type", ["country", "territory"])
    .in("iso3", iso3s);
  if (countriesErr) throw countriesErr;

  const idToIso = new Map((countries ?? []).map((c: any) => [c.id, c.iso3]));
  const countryIds = Array.from(idToIso.keys());
  if (countryIds.length === 0) return { created: 0, reason: "no_country_entities" };

  const { data: links, error: linksErr } = await supabase
    .from("entity_links")
    .select("source_entity_id, target_entity_id, strength, link_type")
    .eq("link_type", "borders")
    .in("source_entity_id", countryIds)
    .in("target_entity_id", countryIds);
  if (linksErr) throw linksErr;

  const neighbors = new Map<string, Array<{ iso3: string; strength: number }>>();
  for (const link of links ?? []) {
    const a = idToIso.get(link.source_entity_id);
    const b = idToIso.get(link.target_entity_id);
    if (!a || !b) continue;
    const strength = Number(link.strength ?? 0.5);
    neighbors.set(a, [...(neighbors.get(a) ?? []), { iso3: b, strength }]);
    neighbors.set(b, [...(neighbors.get(b) ?? []), { iso3: a, strength }]);
  }

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 2);
  await supabase
    .from("cross_border_signals")
    .delete()
    .eq("signal_type", "border_risk_propagation")
    .gte("detected_at", cutoff.toISOString());

  const rows = risks.flatMap((risk: any) => {
    const adjacent = (neighbors.get(risk.country_iso3) ?? []).slice(0, 5);
    return adjacent.map((n) => ({
      signal_type: "border_risk_propagation",
      origin_iso3: risk.country_iso3,
      affected_iso3: [n.iso3],
      domain: risk.domain,
      intensity: Number((Number(risk.risk_probability) * Math.max(0.25, n.strength)).toFixed(4)),
      description: `${risk.domain} risk in ${risk.country_iso3} may spill into ${n.iso3}`,
      detected_at: new Date().toISOString(),
      metadata: {
        generated_by: "cron-daily-predictions",
        generation_batch_id: latestBatch.generation_batch_id,
        border_strength: n.strength,
        base_risk_probability: risk.risk_probability,
      },
    }));
  });

  if (rows.length === 0) return { created: 0, reason: "no_neighbor_links" };

  const { error: insertErr } = await supabase.from("cross_border_signals").insert(rows);
  if (insertErr) throw insertErr;
  return { created: rows.length, reason: "ok" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const overallStart = Date.now();

  // Sequential, isolated steps. One failure cannot kill the chain.
  const steps: Array<{ name: string; ok: boolean; duration_ms: number; result?: any; error?: string }> = [];

  steps.push(await runStep("forecast", () =>
    supabase.functions.invoke("generate-predictions").then((r) => {
      if (r.error) throw r.error;
      return r.data;
    }),
  ));

  // Training: fire-and-forget incremental scheduler (Sweep #16).
  // The builder returns immediately with an execution_id, then self-continues
  // in the background across chunks/countries. This keeps the daily cron under
  // the runtime budget while training freshness catches up asynchronously.
  steps.push(await runStep("training", () =>
    supabase.functions.invoke("build-training-dataset", {
      body: { mode: "incremental", lookback_days: 14, horizon_days: 7 },
    }).then((r) => {
      if (r.error) throw r.error;
      return r.data;
    }),
    30_000, // scheduler-only call; must return within seconds
  ));

  steps.push(await runStep("ranking", () =>
    supabase.functions.invoke("predict-risk-ranking", { body: { mode: "refresh", top_n: 200 } }).then((r) => {
      if (r.error) throw r.error;
      return r.data;
    }),
  ));

  steps.push(await runStep("cross_domain_influence", () =>
    supabase.rpc("compute_cross_domain_influence").then((r) => {
      if (r.error) throw r.error;
      return r.data;
    }),
  ));

  // Cross-border MUST run regardless of upstream failures (uses latest batch in DB).
  steps.push(await runStep("cross_border", () => refreshCrossBorderSignals(supabase), 60_000));

  const failed = steps.filter((s) => !s.ok);
  const succeeded = steps.filter((s) => s.ok);
  const overallStatus = failed.length === 0 ? "success" : (succeeded.length > 0 ? "partial" : "error");

  // Extract metrics for log message
  const forecast = steps.find((s) => s.name === "forecast")?.result;
  const training = steps.find((s) => s.name === "training")?.result;
  const ranking = steps.find((s) => s.name === "ranking")?.result;
  const influence = steps.find((s) => s.name === "cross_domain_influence")?.result;
  const crossBorder = steps.find((s) => s.name === "cross_border")?.result;

  const summary = {
    predictions: forecast?.predictions_generated ?? 0,
    training: training?.execution_id ? `scheduled:${training.execution_id}` : 0,
    ranking: ranking?.rows_inserted ?? 0,
    influence: influence?.rows_inserted ?? 0,
    cross_border: crossBorder?.created ?? 0,
    failed_steps: failed.map((s) => `${s.name}:${s.error}`),
    duration_ms: Date.now() - overallStart,
  };

  const message = failed.length === 0
    ? `predictions=${summary.predictions}, training=${summary.training}, ranking=${summary.ranking}, influence=${summary.influence}, cross_border=${summary.cross_border}`
    : `partial: ok=[${succeeded.map((s) => s.name).join(",")}] failed=[${failed.map((s) => s.name).join(",")}] | ${summary.failed_steps.join(" | ")}`;

  await supabase.from("automation_logs").insert({
    job_name: "cron-daily-predictions",
    status: overallStatus,
    message: message.substring(0, 1000),
  });

  await supabase.rpc("register_pipeline_heartbeat", {
    _pipeline_name: "cron-daily-predictions",
    _success: failed.length === 0,
    _error: failed.length > 0 ? failed.map((s) => `${s.name}:${s.error}`).join(" | ").substring(0, 500) : null,
    _metadata: {
      predictions_generated: summary.predictions,
      training_rows: summary.training,
      risk_rows: summary.ranking,
      cross_domain_rows: summary.influence,
      cross_border_rows: summary.cross_border,
      step_durations_ms: Object.fromEntries(steps.map((s) => [s.name, s.duration_ms])),
      failed_steps: summary.failed_steps,
    },
  });

  // Always return 200 — the cron should not "fail" if partial work was done.
  // Use HTTP body to communicate detailed status.
  return new Response(
    JSON.stringify({
      success: failed.length === 0,
      status: overallStatus,
      summary,
      steps: steps.map((s) => ({ name: s.name, ok: s.ok, duration_ms: s.duration_ms, error: s.error })),
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
