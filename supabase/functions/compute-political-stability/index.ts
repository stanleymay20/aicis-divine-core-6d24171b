import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL_VERSION = "PSM-V1.1-VERIFIED-EVENTS";
const MOMENTUM_WINDOW = 30;
const VOLATILITY_WINDOW = 90;
const T_STAT_THRESHOLD = 1.5;

type PoliticalEvent = {
  iso3: string;
  event_date: string;
  event_type: string;
  event_count: number;
  avg_tone: number | null;
  goldstein_scale: number | null;
  source: string;
};

type Election = {
  iso3: string;
  election_date: string;
  election_type: string | null;
};

type StabilityScore = {
  iso3: string;
  score_date: string;
  stability_score: number;
  protest_momentum: number;
  protest_momentum_tstat: number;
  conflict_density: number;
  election_volatility_risk: number;
  volatility_index: number;
  structural_break_flag: boolean;
  structural_break_pvalue: number;
  confidence_score: number;
  days_to_next_election: number | null;
  mode: "shadow";
  model_version: string;
  raw_metrics: Record<string, unknown>;
};

function olsRegression(values: number[]): { slope: number; tstat: number } {
  const n = values.length;
  if (n < 3) return { slope: 0, tstat: 0 };

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let index = 0; index < n; index += 1) {
    sumX += index;
    sumY += values[index];
    sumXY += index * values[index];
    sumXX += index * index;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return { slope: 0, tstat: 0 };
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  let sse = 0;
  for (let index = 0; index < n; index += 1) {
    const predicted = intercept + slope * index;
    sse += (values[index] - predicted) ** 2;
  }
  const residualSe = Math.sqrt(sse / (n - 2));
  const slopeDenominator = Math.sqrt(sumXX - sumX * sumX / n);
  const seSlope = slopeDenominator > 0 ? residualSe / slopeDenominator : 0;
  return { slope, tstat: seSlope > 0 ? slope / seSlope : 0 };
}

function detectCusumBreak(values: number[]): { breakDetected: boolean; pValue: number } {
  const n = values.length;
  if (n < 10) return { breakDetected: false, pValue: 1 };
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const std = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)) || 1;
  let cusum = 0;
  let maxCusum = 0;
  for (const value of values) {
    cusum += (value - mean) / std;
    maxCusum = Math.max(maxCusum, Math.abs(cusum));
  }
  const normalizedMax = maxCusum / Math.sqrt(n);
  const pValue = normalizedMax > 1.36 ? 0.01 : normalizedMax > 1.22 ? 0.05 : normalizedMax > 1.07 ? 0.10 : 0.50;
  return { breakDetected: pValue < 0.05, pValue };
}

function computeVolatility(values: number[]): number {
  if (values.length < 5) return 0;
  const increases: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const difference = values[index] - values[index - 1];
    if (difference > 0) increases.push(difference);
  }
  if (increases.length === 0) return 0;
  const mean = increases.reduce((sum, value) => sum + value, 0) / increases.length;
  return Math.sqrt(increases.reduce((sum, value) => sum + (value - mean) ** 2, 0) / increases.length);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405, { Allow: "POST" });

  const { response: authResponse } = await requireAdminOrCron(req, corsHeaders);
  if (authResponse) return authResponse;

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const lookbackDate = new Date(today.getTime() - VOLATILITY_WINDOW * 86_400_000).toISOString().split("T")[0];

  try {
    const { data: eventData, error: eventError } = await sb
      .from("political_events")
      .select("iso3,event_date,event_type,event_count,avg_tone,goldstein_scale,source")
      .gte("event_date", lookbackDate)
      .neq("source", "gdelt")
      .order("event_date", { ascending: true });
    if (eventError) throw new Error(`Events query failed: ${eventError.message}`);

    const events = (eventData ?? []) as PoliticalEvent[];
    if (events.length === 0) {
      await sb.from("automation_logs").insert({
        job_name: "compute-political-stability",
        status: "success",
        message: "No verified incident events available; legacy GDELT DOC article counts excluded from scoring",
      });
      return json({
        ok: true,
        scores: 0,
        evidence_status: "insufficient_verified_incident_evidence",
        legacy_gdelt_doc_rows_excluded: true,
      });
    }

    const futureDate = new Date(today.getTime() + 180 * 86_400_000).toISOString().split("T")[0];
    const { data: electionData } = await sb
      .from("election_calendar")
      .select("iso3,election_date,election_type")
      .gte("election_date", todayStr)
      .lte("election_date", futureDate);
    const elections = (electionData ?? []) as Election[];

    const electionMap = new Map<string, number>();
    for (const election of elections) {
      const daysTo = Math.max(1, Math.round((new Date(election.election_date).getTime() - today.getTime()) / 86_400_000));
      const current = electionMap.get(election.iso3);
      if (current === undefined || daysTo < current) electionMap.set(election.iso3, daysTo);
    }

    const countryEvents = new Map<string, PoliticalEvent[]>();
    for (const event of events) {
      const list = countryEvents.get(event.iso3) ?? [];
      list.push(event);
      countryEvents.set(event.iso3, list);
    }

    const scores: StabilityScore[] = [];
    for (const [iso3, countryRows] of countryEvents.entries()) {
      const dailyMap = new Map<string, number>();
      for (const event of countryRows) {
        const count = Number(event.event_count);
        if (!Number.isFinite(count) || count < 0) continue;
        dailyMap.set(event.event_date, (dailyMap.get(event.event_date) ?? 0) + count);
      }

      const sortedDates = [...dailyMap.keys()].sort();
      const dailySeries = sortedDates.map((date) => dailyMap.get(date) ?? 0);
      if (dailySeries.length === 0) continue;

      const { slope, tstat } = olsRegression(dailySeries.slice(-MOMENTUM_WINDOW));
      const significantMomentum = Math.abs(tstat) >= T_STAT_THRESHOLD;
      const volatility = computeVolatility(dailySeries);
      const { breakDetected, pValue } = detectCusumBreak(dailySeries);
      const totalEvents = dailySeries.reduce((sum, value) => sum + value, 0);
      const tones = countryRows.map((event) => Number(event.avg_tone)).filter(Number.isFinite);
      const avgTone = tones.length > 0 ? tones.reduce((sum, value) => sum + value, 0) / tones.length : 0;
      const daysToElection = electionMap.get(iso3) ?? null;
      const electionRisk = daysToElection === null ? 0 : Math.min(100, Math.round(100 * Math.exp(-daysToElection / 30)));

      const eventPressure = Math.min(100, totalEvents / 2);
      const tonePressure = Math.min(100, Math.max(0, -avgTone * 10));
      const momentumPressure = significantMomentum && slope > 0 ? Math.min(100, slope * 20) : 0;
      const rawInstability = eventPressure * 0.35 + tonePressure * 0.15 + momentumPressure * 0.25 + electionRisk * 0.15 + volatility * 0.10;
      const stabilityScore = Math.max(0, Math.min(100, Math.round(100 - rawInstability)));
      const dataDensity = sortedDates.length / VOLATILITY_WINDOW;
      const confidence = Math.min(95, Math.round(dataDensity * 80 + 10));

      scores.push({
        iso3,
        score_date: todayStr,
        stability_score: stabilityScore,
        protest_momentum: Math.round(slope * 1000) / 1000,
        protest_momentum_tstat: Math.round(tstat * 100) / 100,
        conflict_density: totalEvents,
        election_volatility_risk: electionRisk,
        volatility_index: Math.round(volatility * 100) / 100,
        structural_break_flag: breakDetected,
        structural_break_pvalue: pValue,
        confidence_score: confidence,
        days_to_next_election: daysToElection,
        mode: "shadow",
        model_version: MODEL_VERSION,
        raw_metrics: {
          evidence_class: "model_estimate_from_verified_incident_rows",
          legacy_gdelt_doc_rows_excluded: true,
          verified_event_sources: [...new Set(countryRows.map((event) => event.source))],
          event_pressure: Math.round(eventPressure * 10) / 10,
          tone_pressure: Math.round(tonePressure * 10) / 10,
          momentum_pressure: Math.round(momentumPressure * 10) / 10,
          avg_tone: Math.round(avgTone * 100) / 100,
          data_density: Math.round(dataDensity * 100) / 100,
          series_length: dailySeries.length,
        },
      });
    }

    if (scores.length > 0) {
      const { error: upsertError } = await sb
        .from("political_stability_scores")
        .upsert(scores, { onConflict: "iso3,score_date,model_version" });
      if (upsertError) throw new Error(`Score upsert failed: ${upsertError.message}`);
    }

    await sb.from("automation_logs").insert({
      job_name: "compute-political-stability",
      status: "success",
      message: `Shadow verified-event model: computed ${scores.length} countries; ${scores.filter((score) => score.structural_break_flag).length} breaks`,
    });

    return json({
      ok: true,
      mode: "shadow",
      model_version: MODEL_VERSION,
      countries_computed: scores.length,
      breaks_detected: scores.filter((score) => score.structural_break_flag).length,
      legacy_gdelt_doc_rows_excluded: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown";
    console.error("compute-political-stability error:", error);
    await sb.from("automation_logs").insert({
      job_name: "compute-political-stability",
      status: "error",
      message: message.slice(0, 1000),
    });
    return json({ error: message }, 500);
  }
});

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" },
  });
}
