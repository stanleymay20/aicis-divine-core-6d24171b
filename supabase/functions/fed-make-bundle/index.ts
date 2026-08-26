import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Laplace noise for differential privacy
function laplaceNoise(epsilon: number, sensitivity: number = 1): number {
  const u = Math.random() - 0.5;
  const b = sensitivity / epsilon;
  return -b * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    console.log("Making federation bundle...");

    // Get policy
    const { data: policies } = await supabase
      .from("federation_policies")
      .select("*")
      .eq("enabled", true)
      .single();

    if (!policies) {
      return new Response(JSON.stringify({ ok: false, message: "Federation disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { share_divisions, min_sample, dp_epsilon } = policies;

    // Define window: last 24h
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);

    // Get impact metrics in window
    const { data: metrics } = await supabase
      .from("division_impact_metrics")
      .select("*")
      .gte("captured_at", windowStart.toISOString())
      .lte("captured_at", windowEnd.toISOString());

    // Group by division
    const divisionStats = new Map<string, { sum: number; count: number; values: number[] }>();

    (metrics ?? []).forEach(m => {
      if (!share_divisions.includes(m.division)) return;
      
      const ips = Number(m.impact_per_sc || 0);
      if (!divisionStats.has(m.division)) {
        divisionStats.set(m.division, { sum: 0, count: 0, values: [] });
      }
      const stat = divisionStats.get(m.division)!;
      stat.sum += ips;
      stat.count++;
      stat.values.push(ips);
    });

    // Build signals with DP
    const signals = [];
    for (const [division, stat] of divisionStats.entries()) {
      if (stat.count < min_sample) continue;

      const avg = stat.sum / stat.count;
      const variance = stat.values.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / stat.count;
      const stddev = Math.sqrt(variance);

      // Add Laplace noise
      const noise = laplaceNoise(dp_epsilon * stat.count);
      const noised_avg = avg + noise;

      signals.push({
        division,
        impact_per_sc_avg: noised_avg,
        sample_size: stat.count,
        stddev
      });
    }

    // Fallback for the current single-node planetary mesh: if division ROI metrics
    // are empty, federate aggregate risk/warning evidence so bundle production does
    // not silently stall. This preserves no-PII, aggregate-only sharing.
    if (signals.length === 0) {
      const { data: risks, error: riskError } = await supabase
        .from("risk_ranking_predictions")
        .select("country_iso3,domain,risk_probability,rank_position,generated_at")
        .gte("generated_at", windowStart.toISOString())
        .lte("generated_at", windowEnd.toISOString())
        .order("risk_probability", { ascending: false })
        .limit(200);
      if (riskError) throw riskError;

      const grouped = new Map<string, { sum: number; count: number; max: number }>();
      for (const row of risks ?? []) {
        const key = row.domain ?? "unknown";
        const stat = grouped.get(key) ?? { sum: 0, count: 0, max: 0 };
        const probability = Number(row.risk_probability ?? 0);
        stat.sum += probability;
        stat.count += 1;
        stat.max = Math.max(stat.max, probability);
        grouped.set(key, stat);
      }

      for (const [domain, stat] of grouped.entries()) {
        if (stat.count < Math.max(1, Number(min_sample ?? 1))) continue;
        const avg = stat.sum / stat.count;
        const noised_avg = Math.max(0, Math.min(1, avg + laplaceNoise(Number(dp_epsilon ?? 1) * stat.count, 0.01)));
        signals.push({
          domain,
          signal_type: "aggregate_risk_prior",
          risk_probability_avg: noised_avg,
          risk_probability_max: stat.max,
          sample_size: stat.count,
        });
      }
    }

    if (signals.length === 0) {
      console.log("No signals meet min_sample threshold");
      return new Response(JSON.stringify({ ok: false, message: "No signals meet threshold" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Build payload
    const payload = {
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      node_reliability: 0.92, // Could compute from automation_logs success rate
      signals
    };

    // Hash payload
    const hash = await sha256Hex(JSON.stringify(payload));

    // Insert into outbound queue
    const { error: insertError } = await supabase
      .from("federation_outbound_queue")
      .insert({
        window_start: windowStart.toISOString(),
        window_end: windowEnd.toISOString(),
        payload,
        hash,
        status: "queued"
      });

    if (insertError) throw insertError;

    await supabase.from("system_logs").insert({
      action: "fed_make_bundle",
      result: `Created bundle with ${signals.length} signals`,
      log_level: "info",
      division: "system",
      metadata: { hash, signal_count: signals.length }
    });

    console.log(`Bundle created with ${signals.length} signals`);

    return new Response(
      JSON.stringify({ ok: true, signals: signals.length, hash }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("Error making bundle:", error);
    
    await supabase.from("system_logs").insert({
      action: "fed_make_bundle",
      result: `Error: ${errorMessage}`,
      log_level: "error",
      division: "system"
    });

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
