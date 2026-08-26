import { requireUserOrTrustedWorker } from "../_shared/auth.ts";
// Monte Carlo simulation engine — N iterations with p10/p50/p90 distributions.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mulberry32 — deterministic PRNG seeded from `seed`
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Normal sample via Box-Muller, given uniform PRNG
function gauss(rand: () => number, mean = 0, sd = 1) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

serve(async (req) => {
  const callerAuth = await requireUserOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const url = new URL(req.url);
    let mode = url.searchParams.get("mode") ?? "list";
    let name = "Untitled scenario";
    let domain = "";
    let magnitude = 0.1;
    let iso3: string | null = null;
    let direction = "down";
    let nIterations = 500;
    let seed = Math.floor(Date.now() % 2_147_483_647);
    let cascadeDepth = 3;
    let limit = 20;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        mode = body.mode ?? mode;
        name = body.scenario_name ?? body.name ?? name;
        domain = body.domain ?? "";
        magnitude = Math.max(0, Math.min(1, Number(body.magnitude ?? 0.1)));
        iso3 = body.iso3 ?? null;
        direction = body.direction ?? "down";
        nIterations = Math.max(50, Math.min(2000, Number(body.n_iterations ?? 500)));
        seed = Number(body.seed ?? seed);
        cascadeDepth = Math.max(1, Math.min(5, Number(body.cascade_depth ?? 3)));
        limit = Number(body.limit ?? 20);
      } catch { /* ignore */ }
    } else {
      limit = Number(url.searchParams.get("limit") ?? "20");
    }

    if (mode === "run") {
      if (!domain) return json({ error: "domain is required" }, 400);

      // Pull baseline snapshot — latest performance for affected scope
      let baselineQ = sb
        .from("country_performance_snapshots")
        .select("iso3, domain, performance_index, momentum_score, volatility_index")
        .eq("domain", domain)
        .order("snapshot_date", { ascending: false })
        .limit(220);
      if (iso3) baselineQ = baselineQ.eq("iso3", iso3);

      const { data: baseline } = await baselineQ;
      const targets = (baseline ?? []).slice(0, iso3 ? 1 : 50);

      if (targets.length === 0) {
        return json({ error: `No baseline snapshots for domain=${domain}` }, 400);
      }

      const dirSign = direction === "down" ? -1 : 1;
      const rand = mulberry32(seed);

      // Per-iteration: sample shock noise + cascade decay, compute global impact
      const globalImpacts: number[] = [];
      const affectedCounts: number[] = [];
      const iterRows: Array<{ iteration_index: number; global_impact: number; affected_count: number; per_country: Record<string, number> }> = [];

      for (let i = 0; i < nIterations; i++) {
        // Sample shock magnitude with 20% relative noise
        const shock = magnitude * (1 + 0.2 * gauss(rand));
        // Cascade decay factor per hop (random walk)
        const decay = 0.6 + 0.15 * gauss(rand);

        const perCountry: Record<string, number> = {};
        let totalImpact = 0;
        let affected = 0;

        for (const t of targets) {
          // First-order impact: shock * sensitivity (volatility-weighted)
          const sensitivity = 0.5 + 0.5 * Math.min(1, Number(t.volatility_index ?? 0));
          // Multi-hop dampening
          let cumImpact = 0;
          for (let hop = 0; hop < cascadeDepth; hop++) {
            cumImpact += shock * sensitivity * Math.pow(Math.max(0, Math.min(1, decay)), hop);
          }
          const impact = dirSign * cumImpact;
          if (Math.abs(impact) > 0.01) {
            perCountry[t.iso3] = Number(impact.toFixed(4));
            totalImpact += Math.abs(impact);
            affected++;
          }
        }

        globalImpacts.push(totalImpact);
        affectedCounts.push(affected);
        // Sample only first 100 iterations to per-iteration table to control row growth
        if (i < 100) {
          iterRows.push({ iteration_index: i, global_impact: totalImpact, affected_count: affected, per_country: perCountry });
        }
      }

      const sorted = [...globalImpacts].sort((a, b) => a - b);
      const p10 = quantile(sorted, 0.1);
      const p50 = quantile(sorted, 0.5);
      const p90 = quantile(sorted, 0.9);
      const meanImpact = sorted.reduce((s, v) => s + v, 0) / sorted.length;
      const meanAffected = Math.round(affectedCounts.reduce((s, v) => s + v, 0) / affectedCounts.length);

      const distribution = {
        bins: 20,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        histogram: bucketize(sorted, 20),
      };

      // Insert simulation_runs row
      const { data: runRow, error: runErr } = await sb
        .from("simulation_runs")
        .insert({
          scenario_name: name,
          scenario_type: "monte_carlo",
          shock_domain: domain,
          shock_iso3: iso3,
          shock_magnitude: magnitude,
          shock_direction: direction,
          baseline_snapshot: { targets: targets.map(t => t.iso3), n: targets.length },
          cascade_results: { mean_impact: meanImpact, p10, p50, p90 },
          affected_countries: { count: meanAffected, max: Math.max(...affectedCounts) },
          estimated_global_impact: meanImpact,
          confidence: Math.min(0.95, 0.5 + nIterations / 4000),
          n_iterations: nIterations,
          p10, p50, p90,
          cascade_depth: cascadeDepth,
          seed,
          shock_input: { domain, iso3, magnitude, direction, cascade_depth: cascadeDepth },
          result_distribution: distribution,
        })
        .select()
        .single();

      if (runErr) throw runErr;

      // Insert iteration samples
      if (iterRows.length > 0) {
        const { error: iterErr } = await sb
          .from("simulation_iterations")
          .insert(iterRows.map(r => ({ simulation_id: runRow.id, ...r })));
        if (iterErr) console.warn("iteration insert warning:", iterErr.message);
      }

      return json({ success: true, mode, simulation: runRow });
    }

    // mode === "list"
    const { data: rows, error } = await sb
      .from("simulation_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return json({ success: true, mode, rows: rows ?? [] });
  } catch (e) {
    console.error("run-simulation error:", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function bucketize(sortedAsc: number[], bins: number): number[] {
  if (sortedAsc.length === 0) return [];
  const min = sortedAsc[0], max = sortedAsc[sortedAsc.length - 1];
  const range = max - min || 1;
  const counts = new Array(bins).fill(0);
  for (const v of sortedAsc) {
    const idx = Math.min(bins - 1, Math.floor(((v - min) / range) * bins));
    counts[idx]++;
  }
  return counts;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
