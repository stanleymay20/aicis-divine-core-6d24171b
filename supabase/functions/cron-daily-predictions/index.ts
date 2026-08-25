import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { invokeInternalFunction } from "../_shared/internal-invoke.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type StepResult<T = unknown> = {
  name: string;
  ok: boolean;
  duration_ms: number;
  result?: T;
  error?: string;
};

type RiskRow = {
  country_iso3: string | null;
  domain: string | null;
  risk_probability: number | null;
};

type CountryRow = {
  id: string;
  iso3: string | null;
};

type LinkRow = {
  source_entity_id: string;
  target_entity_id: string;
  strength: number | null;
  link_type: string;
};

type CrossBorderResult = {
  created: number;
  reason: string;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "details", "hint", "code"]) {
      if (typeof record[key] === "string" && record[key]) return record[key] as string;
    }
  }
  return String(error);
};

async function runStep<T>(
  name: string,
  fn: () => Promise<T>,
  timeoutMs = 90_000,
): Promise<StepResult<T>> {
  const start = Date.now();
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`step "${name}" timed out after ${timeoutMs}ms`)), timeoutMs),
    );
    const result = await Promise.race([fn(), timeout]);
    return { name, ok: true, duration_ms: Date.now() - start, result };
  } catch (error) {
    const message = errorMessage(error);
    console.error(`[cron-daily-predictions] step "${name}" failed: ${message}`);
    return { name, ok: false, duration_ms: Date.now() - start, error: message };
  }
}

async function refreshCrossBorderSignals(
  supabase: ReturnType<typeof createClient>,
): Promise<CrossBorderResult> {
  const { data: latestBatch, error: batchError } = await supabase
    .from("risk_ranking_predictions")
    .select("generation_batch_id")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (batchError) throw batchError;

  if (!latestBatch?.generation_batch_id) return { created: 0, reason: "no_risk_batch" };

  const { data: riskData, error: riskErr } = await supabase
    .from("risk_ranking_predictions")
    .select("country_iso3,domain,risk_probability")
    .eq("generation_batch_id", latestBatch.generation_batch_id)
    .order("risk_probability", { ascending: false })
    .limit(150);
  if (riskErr) throw riskErr;

  const risks = (riskData ?? []) as RiskRow[];
  if (risks.length === 0) return { created: 0, reason: "no_risk_rows" };

  const iso3s = [...new Set(
    risks
      .map((row) => row.country_iso3)
      .filter((iso3): iso3 is string => typeof iso3 === "string" && iso3.length === 3),
  )];
  if (iso3s.length === 0) return { created: 0, reason: "no_country_codes" };

  const { data: countryData, error: countriesErr } = await supabase
    .from("canonical_entities")
    .select("id,iso3")
    .eq("entity_type", "country")
    .in("iso3", iso3s);
  if (countriesErr) throw countriesErr;

  const countries = (countryData ?? []) as CountryRow[];
  const idToIso = new Map<string, string>();
  for (const country of countries) {
    if (country.iso3) idToIso.set(country.id, country.iso3);
  }
  const countryIds = [...idToIso.keys()];
  if (countryIds.length === 0) return { created: 0, reason: "no_country_entities" };

  const { data: linkData, error: linksErr } = await supabase
    .from("entity_links")
    .select("source_entity_id,target_entity_id,strength,link_type")
    .eq("link_type", "borders")
    .in("source_entity_id", countryIds)
    .in("target_entity_id", countryIds);
  if (linksErr) throw linksErr;

  const neighbors = new Map<string, Array<{ iso3: string; strength: number }>>();
  for (const link of (linkData ?? []) as LinkRow[]) {
    const sourceIso = idToIso.get(link.source_entity_id);
    const targetIso = idToIso.get(link.target_entity_id);
    if (!sourceIso || !targetIso) continue;
    const strength = Number.isFinite(Number(link.strength)) ? Number(link.strength) : 0.5;
    neighbors.set(sourceIso, [...(neighbors.get(sourceIso) ?? []), { iso3: targetIso, strength }]);
    neighbors.set(targetIso, [...(neighbors.get(targetIso) ?? []), { iso3: sourceIso, strength }]);
  }

  const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const { error: cleanupError } = await supabase
    .from("cross_border_signals")
    .delete()
    .eq("signal_type", "border_risk_propagation")
    .gte("detected_at", cutoff);
  if (cleanupError) throw cleanupError;

  const rows = risks.flatMap((risk) => {
    if (!risk.country_iso3 || !risk.domain) return [];
    const adjacent = (neighbors.get(risk.country_iso3) ?? []).slice(0, 5);
    return adjacent.map((neighbor) => ({
      signal_type: "border_risk_propagation",
      origin_iso3: risk.country_iso3,
      affected_iso3: [neighbor.iso3],
      domain: risk.domain,
      intensity: Number((Number(risk.risk_probability ?? 0) * Math.max(0.25, neighbor.strength)).toFixed(4)),
      description: `${risk.domain} risk in ${risk.country_iso3} may spill into ${neighbor.iso3}`,
      detected_at: new Date().toISOString(),
      metadata: {
        generated_by: "cron-daily-predictions",
        generation_batch_id: latestBatch.generation_batch_id,
        border_strength: neighbor.strength,
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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const overallStart = Date.now();
  const steps: StepResult[] = [];

  steps.push(await runStep("forecast", async () => {
    const result = await invokeInternalFunction("generate-predictions");
    if (!result.ok) throw new Error(result.error ?? "generate-predictions failed");
    return result.data;
  }));

  steps.push(await runStep("training", async () => {
    const result = await invokeInternalFunction(
      "build-training-dataset",
      { mode: "incremental", lookback_days: 14, horizon_days: 7 },
      30_000,
    );
    if (!result.ok) throw new Error(result.error ?? "build-training-dataset failed");
    return result.data;
  }, 30_000));

  steps.push(await runStep("ranking", async () => {
    const result = await invokeInternalFunction(
      "predict-risk-ranking",
      { mode: "refresh", top_n: 200 },
    );
    if (!result.ok) throw new Error(result.error ?? "predict-risk-ranking failed");
    return result.data;
  }));

  steps.push(await runStep("cross_domain_influence", async () => {
    const { data, error } = await supabase.rpc("compute_cross_domain_influence");
    if (error) throw error;
    return data;
  }));

  steps.push(await runStep("cross_border", () => refreshCrossBorderSignals(supabase), 60_000));

  const failed = steps.filter((step) => !step.ok);
  const succeeded = steps.filter((step) => step.ok);
  const overallStatus = failed.length === 0 ? "success" : succeeded.length > 0 ? "partial" : "error";

  const forecast = asRecord(steps.find((step) => step.name === "forecast")?.result);
  const training = asRecord(steps.find((step) => step.name === "training")?.result);
  const ranking = asRecord(steps.find((step) => step.name === "ranking")?.result);
  const influence = asRecord(steps.find((step) => step.name === "cross_domain_influence")?.result);
  const crossBorder = asRecord(steps.find((step) => step.name === "cross_border")?.result);

  const summary = {
    predictions: Number(forecast.predictions_generated) || 0,
    training: typeof training.execution_id === "string" ? `scheduled:${training.execution_id}` : 0,
    ranking: Number(ranking.rows_inserted) || 0,
    influence: Number(influence.rows_inserted) || 0,
    cross_border: Number(crossBorder.created) || 0,
    failed_steps: failed.map((step) => `${step.name}:${step.error ?? "unknown"}`),
    duration_ms: Date.now() - overallStart,
  };

  const message = failed.length === 0
    ? `predictions=${summary.predictions}, training=${summary.training}, ranking=${summary.ranking}, influence=${summary.influence}, cross_border=${summary.cross_border}`
    : `partial: ok=[${succeeded.map((step) => step.name).join(",")}] failed=[${failed.map((step) => step.name).join(",")}] | ${summary.failed_steps.join(" | ")}`;

  await supabase.from("automation_logs").insert({
    job_name: "cron-daily-predictions",
    status: overallStatus,
    message: message.substring(0, 1000),
  });

  await supabase.rpc("register_pipeline_heartbeat", {
    _pipeline_name: "cron-daily-predictions",
    _success: failed.length === 0,
    _error: failed.length > 0
      ? failed.map((step) => `${step.name}:${step.error ?? "unknown"}`).join(" | ").substring(0, 500)
      : null,
    _metadata: {
      predictions_generated: summary.predictions,
      training_rows: summary.training,
      risk_rows: summary.ranking,
      cross_domain_rows: summary.influence,
      cross_border_rows: summary.cross_border,
      step_durations_ms: Object.fromEntries(steps.map((step) => [step.name, step.duration_ms])),
      failed_steps: summary.failed_steps,
    },
  });

  return new Response(JSON.stringify({
    success: failed.length === 0,
    status: overallStatus,
    summary,
    steps: steps.map((step) => ({
      name: step.name,
      ok: step.ok,
      duration_ms: step.duration_ms,
      error: step.error,
    })),
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
