/**
 * autonomous-accumulator — runs every 30 minutes via pg_cron.
 *
 * Goal: GUARANTEE uninterrupted, autonomous data accumulation by:
 *  1. Inspecting `normalized_metrics` for each free provider's last write.
 *  2. If a provider is overdue (past its expected cadence), invoking its ingestor.
 *  3. Logging every decision to `automation_logs` with status `recovered` / `healthy` / `failed`.
 *
 * This is independent from `pipeline-watchdog` (which works on heartbeats).
 * It targets the *outcome* (rows in normalized_metrics) rather than process liveness,
 * so a silently-failing function still gets restarted.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN = "autonomous-accumulator";

// Provider → expected cadence (hours) and ingestor function name.
const PROVIDERS: { provider: string; max_age_hours: number; fn: string }[] = [
  { provider: "vdem",          max_age_hours: 168, fn: "pull-vdem" },          // weekly
  { provider: "freedom_house", max_age_hours: 168, fn: "pull-freedom-house" }, // weekly
  { provider: "nasa_power",    max_age_hours: 26,  fn: "pull-nasa-power" },    // daily
  { provider: "entsoe",        max_age_hours: 8,   fn: "pull-entsoe" },        // 6h
  { provider: "worldbank",     max_age_hours: 26,  fn: "pull-worldbank" },     // daily
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const URL = Deno.env.get("SUPABASE_URL")!;
  const start = Date.now();

  const summary: any[] = [];

  for (const p of PROVIDERS) {
    try {
      const { data: latest } = await supabase
        .from("normalized_metrics")
        .select("created_at")
        .eq("provider_name", p.provider)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastTs = latest?.created_at ? new Date(latest.created_at).getTime() : 0;
      const ageHours = lastTs ? (Date.now() - lastTs) / 3600000 : 9999;
      const overdue = ageHours > p.max_age_hours;

      if (!overdue) {
        summary.push({ provider: p.provider, status: "healthy", age_hours: +ageHours.toFixed(1) });
        continue;
      }

      // Restart the ingestor (fire-and-forget with 25s timeout).
      const restartUrl = `${URL}/functions/v1/${p.fn}`;
      const resp = await fetch(restartUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SVC}` },
        body: JSON.stringify({ trigger: "autonomous-accumulator" }),
        signal: AbortSignal.timeout(25000),
      }).catch((e) => ({ ok: false, status: 0, statusText: (e as Error).message } as any));

      summary.push({
        provider: p.provider,
        status: resp.ok ? "recovered" : "failed",
        age_hours: +ageHours.toFixed(1),
        fn: p.fn,
        http: resp.status,
      });
    } catch (e) {
      summary.push({ provider: p.provider, status: "error", error: (e as Error).message });
    }
  }

  const recovered = summary.filter((s) => s.status === "recovered").length;
  const healthy = summary.filter((s) => s.status === "healthy").length;
  const failed = summary.filter((s) => s.status === "failed" || s.status === "error").length;

  await supabase.from("automation_logs").insert({
    job_name: FN,
    status: failed > 0 ? "partial" : "success",
    message: `accumulator: ${healthy} healthy, ${recovered} recovered, ${failed} failed in ${Date.now() - start}ms`,
  });

  return new Response(JSON.stringify({ ok: true, summary, healthy, recovered, failed }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
