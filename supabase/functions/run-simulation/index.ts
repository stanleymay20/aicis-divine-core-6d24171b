import { requireUserOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASELINE_MAX_AGE_DAYS = 14;
const SHOCK_RELATIVE_SD = 0.2;
const DECAY_MEAN = 0.6;
const DECAY_SD = 0.15;
const IMPACT_THRESHOLD = 0.01;
const MAX_ITERATION_SAMPLES_STORED = 100;

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand: () => number, mean = 0, sd = 1) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function quantile(sortedAsc: number[], q: number): number | null {
  if (sortedAsc.length === 0) return null;
  const position = (sortedAsc.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sortedAsc[low];
  return sortedAsc[low] + (sortedAsc[high] - sortedAsc[low]) * (position - low);
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = finiteNumber(value);
  if (parsed === null) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function randomSeed(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] & 0x7fffffff;
}

function isoDateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function bucketize(sortedAsc: number[], bins: number): number[] {
  if (sortedAsc.length === 0) return [];
  const min = sortedAsc[0];
  const max = sortedAsc[sortedAsc.length - 1];
  const range = max - min || 1;
  const counts = new Array<number>(bins).fill(0);
  for (const value of sortedAsc) {
    const index = Math.min(bins - 1, Math.floor(((value - min) / range) * bins));
    counts[index] += 1;
  }
  return counts;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const callerAuth = await requireUserOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const url = new URL(req.url);
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      try {
        body = await req.json() as Record<string, unknown>;
      } catch {
        return json({ error: "invalid_json_body" }, 400);
      }
    }

    const mode = String(body.mode ?? url.searchParams.get("mode") ?? "list");
    const limit = integerInRange(body.limit ?? url.searchParams.get("limit"), 20, 1, 100);

    if (mode !== "run") {
      const { data: rows, error } = await sb
        .from("simulation_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return json({
        success: true,
        mode: "list",
        epistemic_contract: "synthetic_sensitivity_simulation_not_forecast",
        rows: rows ?? [],
      });
    }

    const scenarioName = typeof body.scenario_name === "string" && body.scenario_name.trim()
      ? body.scenario_name.trim()
      : typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : "Untitled scenario";
    const domain = typeof body.domain === "string" ? body.domain.trim().toLowerCase() : "";
    const magnitude = finiteNumber(body.magnitude);
    const iso3 = typeof body.iso3 === "string" && body.iso3.trim()
      ? body.iso3.trim().toUpperCase()
      : null;
    const direction = typeof body.direction === "string" ? body.direction.trim().toLowerCase() : "";
    const nIterations = integerInRange(body.n_iterations, 500, 100, 2000);
    const seed = integerInRange(body.seed, randomSeed(), 0, 2_147_483_647);
    const repeatedEffectDepth = integerInRange(body.cascade_depth, 3, 1, 5);

    if (!domain) return json({ error: "domain_required" }, 400);
    if (magnitude === null || magnitude <= 0 || magnitude > 1) {
      return json({ error: "magnitude_must_be_greater_than_0_and_at_most_1" }, 400);
    }
    if (iso3 !== null && !/^[A-Z]{3}$/.test(iso3)) {
      return json({ error: "iso3_must_be_three_letters" }, 400);
    }
    if (direction !== "up" && direction !== "down") {
      return json({ error: "direction_must_be_up_or_down" }, 400);
    }

    const requestedInput = {
      domain,
      iso3,
      magnitude,
      direction,
      n_iterations: nIterations,
      seed,
      repeated_effect_depth: repeatedEffectDepth,
    };

    const cutoffDate = isoDateDaysAgo(BASELINE_MAX_AGE_DAYS);
    let baselineQuery = sb
      .from("country_performance_snapshots")
      .select("id,iso3,domain,volatility_index,snapshot_date")
      .eq("domain", domain)
      .gte("snapshot_date", cutoffDate)
      .order("snapshot_date", { ascending: false })
      .limit(1000);
    if (iso3) baselineQuery = baselineQuery.eq("iso3", iso3);

    const { data: baselineRows, error: baselineError } = await baselineQuery;
    if (baselineError) throw baselineError;

    const latestByCountry = new Map<string, {
      id: string;
      iso3: string;
      domain: string;
      volatility_index: unknown;
      snapshot_date: string;
    }>();
    for (const row of baselineRows ?? []) {
      if (!row.iso3 || latestByCountry.has(row.iso3)) continue;
      latestByCountry.set(row.iso3, row);
    }

    const candidates = [...latestByCountry.values()];
    const usableTargets = candidates.flatMap((row) => {
      const volatility = finiteNumber(row.volatility_index);
      if (volatility === null || volatility < 0 || !row.snapshot_date) return [];
      return [{
        id: row.id,
        iso3: row.iso3,
        snapshot_date: row.snapshot_date,
        volatility_index: volatility,
      }];
    });
    const excludedCount = candidates.length - usableTargets.length;

    const abstain = async (reason: string, status = 422) => {
      const { error: abstentionError } = await sb.from("simulation_abstentions").insert({
        scenario_name: scenarioName,
        shock_domain: domain,
        shock_iso3: iso3,
        requested_input: requestedInput,
        reason,
        baseline_candidates: candidates.length,
        baseline_usable: usableTargets.length,
        baseline_excluded: excludedCount,
        evidence_semantics: "simulation_withheld_no_result_issued",
      });
      if (abstentionError) console.warn("simulation abstention insert warning:", abstentionError.message);
      return json({
        success: false,
        mode: "run",
        outcome: "abstained",
        reason,
        baseline_candidates: candidates.length,
        baseline_usable: usableTargets.length,
        baseline_excluded: excludedCount,
        note: "No simulation result was issued; abstention does not imply zero impact.",
      }, status);
    };

    if (usableTargets.length === 0) {
      return await abstain("no_recent_complete_volatility_baseline");
    }
    if (iso3 && usableTargets.length !== 1) {
      return await abstain("requested_country_lacks_recent_complete_volatility_baseline");
    }

    const directionSign = direction === "down" ? -1 : 1;
    const rand = mulberry32(seed);
    const aggregateImpacts: number[] = [];
    const affectedCounts: number[] = [];
    const iterationRows: Array<{
      iteration_index: number;
      global_impact: number;
      affected_count: number;
      per_country: Record<string, number>;
    }> = [];

    for (let iteration = 0; iteration < nIterations; iteration += 1) {
      // These draws are hand-specified sensitivity assumptions. They are not
      // empirically estimated real-world uncertainty distributions.
      const shockScale = Math.max(0, 1 + SHOCK_RELATIVE_SD * gauss(rand));
      const simulatedShock = magnitude * shockScale;
      const decay = Math.max(0, Math.min(1, DECAY_MEAN + DECAY_SD * gauss(rand)));
      const perCountry: Record<string, number> = {};
      let aggregateImpact = 0;
      let affectedCount = 0;

      for (const target of usableTargets) {
        const sensitivity = 0.5 + 0.5 * Math.min(1, target.volatility_index);
        let accumulatedEffect = 0;
        for (let depth = 0; depth < repeatedEffectDepth; depth += 1) {
          accumulatedEffect += simulatedShock * sensitivity * Math.pow(decay, depth);
        }
        const signedImpact = directionSign * accumulatedEffect;
        if (Math.abs(signedImpact) > IMPACT_THRESHOLD) {
          perCountry[target.iso3] = Number(signedImpact.toFixed(4));
          aggregateImpact += Math.abs(signedImpact);
          affectedCount += 1;
        }
      }

      aggregateImpacts.push(aggregateImpact);
      affectedCounts.push(affectedCount);
      if (iteration < MAX_ITERATION_SAMPLES_STORED) {
        iterationRows.push({
          iteration_index: iteration,
          global_impact: aggregateImpact,
          affected_count: affectedCount,
          per_country: perCountry,
        });
      }
    }

    const sorted = [...aggregateImpacts].sort((left, right) => left - right);
    const p10 = quantile(sorted, 0.1);
    const p50 = quantile(sorted, 0.5);
    const p90 = quantile(sorted, 0.9);
    const meanImpact = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    const meanAffected = affectedCounts.reduce((sum, value) => sum + value, 0) / affectedCounts.length;
    const snapshotDates = usableTargets.map((target) => target.snapshot_date).sort();
    const baselineMinDate = snapshotDates[0] ?? null;
    const baselineMaxDate = snapshotDates[snapshotDates.length - 1] ?? null;
    const coverageStatus = excludedCount === 0
      ? "recent_domain_candidates_complete_for_required_volatility"
      : "partial_recent_domain_subset_incomplete_rows_excluded";

    const assumptions = {
      epistemic_status: "synthetic_counterfactual_sensitivity_not_forecast",
      shock_noise: {
        distribution: "normal_scale_around_operator_shock",
        relative_sd: SHOCK_RELATIVE_SD,
        semantics: "hand_specified_sensitivity_assumption_not_empirically_estimated_uncertainty",
      },
      repeated_effect_decay: {
        distribution: "normal_clamped_0_1",
        mean: DECAY_MEAN,
        sd: DECAY_SD,
        semantics: "hand_specified_repeated_effect_assumption_not_learned_graph_propagation",
      },
      sensitivity_transform: {
        formula: "0.5 + 0.5 * min(1, volatility_index)",
        semantics: "deterministic_operator_model_assumption_not_causal_coefficient",
      },
      affected_threshold: {
        absolute_simulated_impact: IMPACT_THRESHOLD,
        semantics: "display_and_count_threshold_not_observed_harm_threshold",
      },
      stored_iteration_sample_count: iterationRows.length,
      total_iteration_count: nIterations,
    };

    const { data: runRow, error: runError } = await sb.from("simulation_runs").insert({
      scenario_name: scenarioName,
      scenario_type: "stochastic_sensitivity",
      shock_domain: domain,
      shock_iso3: iso3,
      shock_magnitude: magnitude,
      shock_direction: direction,
      baseline_snapshot: {
        max_age_days: BASELINE_MAX_AGE_DAYS,
        cutoff_date: cutoffDate,
        targets: usableTargets,
      },
      cascade_results: {
        mean_simulated_aggregate_impact: meanImpact,
        p10,
        p50,
        p90,
      },
      affected_countries: {
        mean_simulated_count: meanAffected,
        max_simulated_count: Math.max(...affectedCounts),
      },
      estimated_global_impact: null,
      simulated_aggregate_impact: meanImpact,
      impact_semantics: "synthetic_aggregate_over_included_targets_not_observed_or_forecast_global_impact",
      confidence: null,
      confidence_semantics: "not_applicable_synthetic_sensitivity_simulation",
      n_iterations: nIterations,
      iteration_count_semantics: "computational_draw_count_not_evidence_sample_size",
      p10,
      p50,
      p90,
      uncertainty_semantics: "synthetic_sensitivity_distribution_quantiles_not_prediction_interval",
      cascade_depth: repeatedEffectDepth,
      cascade_semantics: "synthetic_geometric_repeated_effect_depth_not_graph_cascade",
      seed,
      shock_input: requestedInput,
      result_distribution: {
        bins: 20,
        min: sorted[0] ?? null,
        max: sorted[sorted.length - 1] ?? null,
        histogram: bucketize(sorted, 20),
      },
      distribution_semantics: "monte_carlo_from_hand_specified_noise_assumptions_not_empirical_distribution",
      affected_countries_semantics: "synthetic_target_count_crossing_declared_absolute_impact_threshold",
      simulation_semantics: "stochastic_sensitivity_v2_hand_specified_noise_not_forecast",
      baseline_semantics: "latest_per_iso3_snapshot_with_nonmissing_volatility_within_14_days",
      baseline_snapshot_min_date: baselineMinDate,
      baseline_snapshot_max_date: baselineMaxDate,
      baseline_target_count: usableTargets.length,
      baseline_excluded_count: excludedCount,
      baseline_coverage_status: coverageStatus,
      assumptions,
    }).select().single();

    if (runError) throw runError;

    if (iterationRows.length > 0) {
      const { error: iterationError } = await sb.from("simulation_iterations").insert(
        iterationRows.map((row) => ({ simulation_id: runRow.id, ...row })),
      );
      if (iterationError) console.warn("iteration insert warning:", iterationError.message);
    }

    return json({
      success: true,
      mode: "run",
      epistemic_contract: "synthetic_sensitivity_simulation_not_forecast",
      simulation: runRow,
      note: "p10/p50/p90 describe the declared synthetic draw distribution, not real-world prediction intervals.",
    });
  } catch (error) {
    console.error("run-simulation error:", error);
    return json({ error: error instanceof Error ? error.message : "unknown" }, 500);
  }
});
