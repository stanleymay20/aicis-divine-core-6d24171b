/**
 * run-performance-engine-v2 — Production Pipeline
 * 
 * Executes APE-V2.1 across all countries in country_profiles,
 * persists to: forecast_archive, country_performance_snapshots,
 * calibration_metrics, spc_control_observations.
 * Evaluates kill-switch. Logs telemetry.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL_VERSION = "APE-V2.1";
const ENGINE_PARAMS = { alpha: 0.55, beta: 0.3, breakThreshold: 1.5 } as const;

// ─── Engine Math (self-contained, no src/ imports) ──────────────────

function holtSmoothing(series: number[], alpha = ENGINE_PARAMS.alpha, beta = ENGINE_PARAMS.beta) {
  if (series.length === 0) return { level: 0, trend: 0 };
  if (series.length === 1) return { level: series[0], trend: 0 };
  let level = series[0], trend = series[1] - series[0];
  for (let i = 1; i < series.length; i++) {
    const prev = level;
    level = alpha * series[i] + (1 - alpha) * (prev + trend);
    trend = beta * (level - prev) + (1 - beta) * trend;
  }
  return { level, trend };
}

function winsorizeOutliers(values: number[]): number[] {
  if (values.length < 5) return [...values];
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  return values.map(v => Math.max(lo, Math.min(hi, v)));
}

interface MetricEntry { metric: string; value: number; period: string; source: string; unit?: string; }

function fillDataGaps(sorted: MetricEntry[]) {
  if (sorted.length < 2) return { values: sorted.map(m => m.value), gapCount: 0, staleDays: 0 };
  const raw = sorted.map(m => m.value);
  const periods = sorted.map(m => m.period);
  const values = winsorizeOutliers(raw);
  let gapCount = 0;
  const filled: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    const prev = new Date(periods[i - 1] + "-01"), curr = new Date(periods[i] + "-01");
    if (!isNaN(prev.getTime()) && !isNaN(curr.getTime())) {
      const md = (curr.getFullYear() - prev.getFullYear()) * 12 + (curr.getMonth() - prev.getMonth());
      if (md > 1) {
        const g = Math.min(md - 1, 6);
        gapCount += g;
        for (let j = 1; j <= g; j++) filled.push(values[i - 1] + (j / (g + 1)) * (values[i] - values[i - 1]));
      }
    }
    filled.push(values[i]);
  }
  const last = new Date(periods[periods.length - 1].length <= 7 ? periods[periods.length - 1] + "-01" : periods[periods.length - 1]);
  const staleDays = isNaN(last.getTime()) ? 0 : Math.max(0, Math.round((Date.now() - last.getTime()) / 86400000));
  return { values: filled, gapCount, staleDays };
}

function regressionWithSignificance(values: number[]) {
  const n = values.length;
  if (n < 3) return { slope: 0, tStat: 0, significant: false };
  const xMean = (n - 1) / 2, yMean = values.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - xMean) * (values[i] - yMean); den += (i - xMean) ** 2; }
  const slope = den === 0 ? 0 : num / den;
  const sse = values.reduce((s, v, i) => s + (v - (yMean + slope * (i - xMean))) ** 2, 0);
  const se = Math.sqrt(sse / (n - 2) / den);
  const tStat = se > 0 ? slope / se : 0;
  return { slope, tStat: Math.round(tStat * 100) / 100, significant: Math.abs(tStat) >= 1.5 };
}

function computeMomentumV2(values: number[]) {
  const recent = values.slice(-8);
  if (recent.length < 3) return { momentum: 0, tStat: 0 };
  const reg = regressionWithSignificance(recent);
  if (!reg.significant) return { momentum: 0, tStat: reg.tStat };
  const mean = recent.reduce((s, v) => s + v, 0) / recent.length;
  const raw = mean !== 0 ? (reg.slope / Math.abs(mean)) * 100 : 0;
  return { momentum: Math.max(-100, Math.min(100, Math.round(raw * 10) / 10)), tStat: reg.tStat };
}

function computeVolatilityDetailed(values: number[]) {
  const recent = values.slice(-6);
  if (recent.length < 2) return { total: 0, downside: 0, upside: 0, ratio: 1 };
  const mean = recent.reduce((s, v) => s + v, 0) / recent.length;
  const variance = recent.reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length;
  const cv = Math.abs(mean) > 0 ? Math.sqrt(variance) / Math.abs(mean) : 0;
  const total = Math.round(Math.min(100, cv * 200));
  const dsVar = recent.filter(v => v < mean).reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length;
  const downside = Math.round(Math.min(100, (Math.sqrt(dsVar) / (Math.abs(mean) || 1)) * 200));
  const usVar = recent.filter(v => v > mean).reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length;
  const upside = Math.round(Math.min(100, (Math.sqrt(usVar) / (Math.abs(mean) || 1)) * 200));
  const ratio = upside > 0 ? Math.round((downside / upside) * 100) / 100 : (downside > 0 ? 10 : 1);
  return { total, downside, upside, ratio };
}

function normalizeWithBenchmark(value: number, benchmark?: { structural_floor: number; structural_ceiling: number }) {
  if (!benchmark) return Math.max(0, Math.min(100, value));
  const { structural_floor, structural_ceiling } = benchmark;
  if (structural_ceiling === structural_floor) return 50;
  return Math.max(0, Math.min(100, Math.round(((value - structural_floor) / (structural_ceiling - structural_floor)) * 1000) / 10));
}

interface MetricScale { metric_name: string; p05: number; p50: number; p95: number; country_count: number }

const clamp100 = (v: number) => Math.max(0, Math.min(100, v));

/**
 * Scale-aware metric normalizer.
 *
 * Domain benchmarks assume metrics already live on a 0-100 index scale. Many real
 * indicators do not (e.g. World Bank WGI runs -2.5..+2.5, GDP is absolute USD), which
 * silently clamped whole domains to 0. When a metric's measured world-wide range does
 * not sit inside the domain benchmark band, the metric is rescaled against its own
 * empirically observed p05..p95 range (from metric_scale_reference) instead.
 * Direction convention is unchanged: higher raw value = higher index.
 */
function buildMetricNormalizer(
  benchmark?: { structural_floor: number; structural_ceiling: number },
  scale?: MetricScale,
): { fn: (v: number) => number; method: string } {
  if (benchmark && scale) {
    const inBand = scale.p05 >= benchmark.structural_floor - 1e-9 && scale.p95 <= benchmark.structural_ceiling + 1e-9;
    if (inBand) return { fn: (v) => normalizeWithBenchmark(v, benchmark), method: "domain_benchmark" };
  }
  if (scale && scale.p95 > scale.p05) {
    const span = scale.p95 - scale.p05;
    return { fn: (v) => clamp100(Math.round(((v - scale.p05) / span) * 1000) / 10), method: "empirical_p05_p95" };
  }
  if (benchmark) return { fn: (v) => normalizeWithBenchmark(v, benchmark), method: "domain_benchmark" };
  return { fn: (v) => clamp100(v), method: "raw_clamped" };
}


function detectPeriodicity(periods: string[]): string {
  if (periods.length < 2) return "unknown";
  if (periods.some(p => /Q[1-4]/.test(p))) return "quarterly";
  if (periods.some(p => /^\d{4}-\d{2}$/.test(p))) return "monthly";
  if (periods.every(p => /^\d{4}$/.test(p))) return "annual";
  return "monthly";
}

function horizonToPeriods(days: number, periodicity: string): number {
  switch (periodicity) {
    case "monthly": return days / 30;
    case "quarterly": return days / 90;
    case "annual": return days / 365;
    default: return days / 30;
  }
}

function detectStructuralBreakCUSUM(values: number[], alpha = 0.55, beta = 0.3) {
  const n = values.length;
  if (n < 6) return { detected: false, pValue: 1, breakIndex: -1 };
  const residuals: number[] = [];
  let level = values[0], trend = values.length > 1 ? values[1] - values[0] : 0;
  for (let i = 1; i < n; i++) {
    residuals.push(values[i] - (level + trend));
    const prev = level;
    level = alpha * values[i] + (1 - alpha) * (prev + trend);
    trend = beta * (level - prev) + (1 - beta) * trend;
  }
  const rn = residuals.length;
  if (rn < 4) return { detected: false, pValue: 1, breakIndex: -1 };
  const mean = residuals.reduce((s, v) => s + v, 0) / rn;
  const std = Math.sqrt(residuals.reduce((s, v) => s + (v - mean) ** 2, 0) / rn);
  if (std === 0) return { detected: false, pValue: 1, breakIndex: -1 };
  let cum = 0;
  const cusum = residuals.map(r => { cum += (r - mean) / std; return Math.abs(cum); });
  const maxC = Math.max(...cusum);
  const bi = cusum.indexOf(maxC);
  const norm = maxC / Math.sqrt(rn);
  const pValue = Math.min(1, Math.max(0.001, 2 * Math.exp(-2 * norm * norm)));
  return { detected: pValue <= 0.10, pValue: Math.round(pValue * 1000) / 1000, breakIndex: pValue <= 0.10 ? bi + 1 : -1 };
}

interface ResidualEntry { predicted: number; realized: number; residual: number; decayWeight: number; }

function backtestForecast(series: number[], alpha = 0.55, beta = 0.3) {
  if (series.length < 6) return { mae: 0, rmse: 0, mape: 0, forecastBias: 0, stabilityScore: 0.5, residuals: [] as ResidualEntry[] };
  const errors: number[] = [], ape: number[] = [], residuals: ResidualEntry[] = [];
  const now = Date.now();
  for (let i = 4; i < series.length; i++) {
    const h = holtSmoothing(series.slice(0, i), alpha, beta);
    const predicted = h.level + h.trend;
    const actual = series[i];
    const err = actual - predicted;
    errors.push(err);
    if (Math.abs(actual) > 0.01) ape.push(Math.abs(err / actual));
    const ageDays = (series.length - i) * 30; // approximate
    residuals.push({ predicted: r2(predicted), realized: r2(actual), residual: r2(err), decayWeight: r3(Math.exp(-0.01 * ageDays)) });
  }
  if (errors.length === 0) return { mae: 0, rmse: 0, mape: 0, forecastBias: 0, stabilityScore: 0.5, residuals: [] as ResidualEntry[] };
  const mae = errors.reduce((s, v) => s + Math.abs(v), 0) / errors.length;
  const rmse = Math.sqrt(errors.reduce((s, v) => s + v * v, 0) / errors.length);
  const mape = ape.length > 0 ? (ape.reduce((s, v) => s + v, 0) / ape.length) * 100 : 0;
  const bias = errors.reduce((s, v) => s + v, 0) / errors.length;
  const range = Math.max(...series) - Math.min(...series);
  const stability = range > 0 ? Math.max(0, Math.min(1, 1 - rmse / range)) : 0.5;
  return { mae: r2(mae), rmse: r2(rmse), mape: r2(mape), forecastBias: r2(bias), stabilityScore: r3(stability), residuals };
}

function calibrateParameters(series: number[]) {
  if (series.length < 8) return { alpha: 0.55, beta: 0.3 };
  let bestA = 0.55, bestB = 0.3, bestRMSE = Infinity;
  const k = 3, minTrain = Math.max(4, Math.floor(series.length * 0.4));
  for (let a = 0.2; a <= 0.8; a += 0.1) {
    for (let b = 0.05; b <= 0.5; b += 0.1) {
      let totalRMSE = 0, fc = 0;
      for (let f = 0; f < k; f++) {
        const end = minTrain + Math.floor(((series.length - minTrain) / k) * (f + 1));
        if (end > series.length) break;
        const r = backtestForecast(series.slice(0, end), a, b);
        if (r.rmse > 0) { totalRMSE += r.rmse; fc++; }
      }
      if (fc > 0 && totalRMSE / fc < bestRMSE) {
        bestRMSE = totalRMSE / fc;
        bestA = Math.round(a * 100) / 100;
        bestB = Math.round(b * 100) / 100;
      }
    }
  }
  return { alpha: bestA, beta: bestB };
}

function computeSystemicFragilityV2(scores: Record<string, number>, coupling?: any[]) {
  const gov = (scores["governance"] ?? 50) / 100;
  const sec = (scores["security"] ?? 50) / 100;
  const fin = (scores["finance"] ?? 50) / 100;
  const base = (1 - gov) * (1 - sec) * (1 - fin);
  if (!coupling || coupling.length === 0) return Math.round(base * 1000) / 10;
  let prop = 0;
  const def: Record<string, number> = {};
  for (const [d, s] of Object.entries(scores)) def[d] = Math.max(0, (50 - s) / 50);
  for (const c of coupling) {
    const sd = def[c.source_domain] || 0;
    if (sd <= 0.1) continue;
    const tv = 1 - ((scores[c.target_domain] ?? 50) / 100);
    prop += sd * c.coupling_weight * (0.5 + tv * 0.5);
  }
  return Math.round(Math.min(1, base + prop * 0.3) * 1000) / 10;
}

function evaluateSPC(metricName: string, currentValue: number, history: number[], lambda = 0.2) {
  const n = history.length;
  if (n < 5) return { metricName, observedValue: currentValue, ewmaValue: currentValue, rollingMean: currentValue, rollingStd: 0, upperControl: currentValue, lowerControl: currentValue, outOfControl: false };
  const rm = history.reduce((s, v) => s + v, 0) / n;
  const rs = Math.sqrt(history.reduce((s, v) => s + (v - rm) ** 2, 0) / n);
  const ewma = lambda * currentValue + (1 - lambda) * history[history.length - 1];
  return { metricName, observedValue: currentValue, ewmaValue: r3(ewma), rollingMean: r3(rm), rollingStd: r3(rs), upperControl: r3(rm + 3 * rs), lowerControl: r3(rm - 3 * rs), outOfControl: currentValue > rm + 3 * rs || currentValue < rm - 3 * rs };
}

function r2(n: number) { return Math.round(n * 100) / 100; }
function r3(n: number) { return Math.round(n * 1000) / 1000; }

// ─── Domain Performance Compute ─────────────────────────────────────

interface Benchmark { domain: string; structural_floor: number; structural_ceiling: number; percentile_50: number; }

function computeDomainPerformance(
  domain: string, metrics: MetricEntry[], completeness: number,
  benchmark: Benchmark | undefined, stabilityScore: number, params: { alpha: number; beta: number },
  frozen: boolean, scales: Record<string, MetricScale> = {},
) {
  if (frozen || !metrics || metrics.length === 0) {
    const conf = frozen ? 10 : Math.max(10, Math.min(95, Math.round(completeness * 30)));
    return { domain, performanceIndex: 0, momentumScore: 0, momentumTStat: 0, volatilityIndex: 0, volatilityDownside: 0, volatilityUpside: 0, volatilitySkewRatio: 1, riskPressureScore: 50, forecast90d: 0, forecast1y: 0, forecastDirection: "stable" as const, confidenceScore: conf, forecastUpper80: 0, forecastLower80: 0, forecastUpper95: 0, forecastLower95: 0, structuralBreak: false, structuralBreakPValue: 1, dataGapCount: 0, dataStaleDays: 0, normalizationMethods: [] as string[], scaledMetricCount: 0 };
  }

  // Normalize every metric onto a common 0-100 index before any modelling, using the
  // metric's own measured world-wide range when the domain benchmark scale does not apply.
  const methods = new Set<string>();
  let scaledMetricCount = 0;
  const normalized: MetricEntry[] = metrics.map((m) => {
    const { fn, method } = buildMetricNormalizer(benchmark, scales[m.metric]);
    methods.add(method);
    if (method === "empirical_p05_p95") scaledMetricCount++;
    return { ...m, value: fn(m.value) };
  });

  const sorted = [...normalized].sort((a, b) => a.period.localeCompare(b.period));
  const gap = fillDataGaps(sorted);
  const values = gap.values;
  const periods = sorted.map(m => m.period);
  const periodicity = detectPeriodicity(periods);

  const avg = values.slice(-5).reduce((s, v) => s + v, 0) / Math.min(5, values.length);
  const performanceIndex = Math.round(clamp100(avg));
  const { momentum: momentumScore, tStat: momentumTStat } = computeMomentumV2(values);
  const vol = computeVolatilityDetailed(values);
  const brk = detectStructuralBreakCUSUM(values, params.alpha, params.beta);

  let activeParams = params;
  let forecastValues = values;
  let horizonCap = 365;
  if (brk.detected && brk.breakIndex > 0) {
    const post = values.slice(brk.breakIndex);
    forecastValues = post.length >= 4 ? post : values.slice(Math.floor(values.length * 0.5));
    activeParams = forecastValues.length >= 8 ? calibrateParameters(forecastValues) : { alpha: Math.min(0.8, params.alpha + 0.15), beta: Math.min(0.5, params.beta + 0.1) };
    horizonCap = 120;
  }

  let riskPressureScore = Math.round(Math.min(100, vol.total * 0.5 + (100 - performanceIndex) * 0.3 + (momentumScore < 0 ? Math.abs(momentumScore) * 0.2 : 0)));
  if (brk.detected) riskPressureScore = Math.min(100, riskPressureScore + 10);

  const holt = holtSmoothing(forecastValues, activeParams.alpha, activeParams.beta);
  const holtNorm = Math.round(clamp100(holt.level));
  const trendNorm = holt.trend; // series is already on the 0-100 index scale

  const damp = Math.max(0.3, 1 - vol.total / 200);
  const momFactor = momentumScore / 100;
  const p90 = horizonToPeriods(90, periodicity);
  const p1y = horizonToPeriods(Math.min(horizonCap, 365), periodicity);

  const forecast90d = Math.max(0, Math.min(100, Math.round(holtNorm + trendNorm * p90 * damp + momFactor * 5)));
  const forecast1y = Math.max(0, Math.min(100, Math.round(holtNorm + trendNorm * p1y * damp * 0.5 + momFactor * 10 - vol.total * 0.08)));
  const forecastDirection = momentumScore > 5 ? "up" as const : momentumScore < -5 ? "down" as const : "stable" as const;

  const dataDensity = Math.min(1, metrics.length / 20);
  const srcDiv = new Set(metrics.map(m => m.source)).size;
  let conf = Math.round(15 + dataDensity * 25 + stabilityScore * 20 + Math.min(15, srcDiv * 5) + Math.min(15, (metrics.length / 5) * 3) - vol.total * 0.15 - (brk.detected ? 12 : 0) - Math.min(10, gap.gapCount * 2) - (gap.staleDays > 90 ? 8 : gap.staleDays > 30 ? 4 : 0));
  conf = Math.max(10, Math.min(95, conf));

  const errMag = (1 - stabilityScore) * 30 + vol.total * 0.3;
  const forecastUpper80 = Math.min(100, Math.round(forecast90d + errMag * 1.28));
  const forecastLower80 = Math.max(0, Math.round(forecast90d - errMag * 1.28));
  const forecastUpper95 = Math.min(100, Math.round(forecast90d + errMag * 1.96));
  const forecastLower95 = Math.max(0, Math.round(forecast90d - errMag * 1.96));

  return {
    domain, performanceIndex, momentumScore, momentumTStat,
    volatilityIndex: vol.total, volatilityDownside: vol.downside, volatilityUpside: vol.upside, volatilitySkewRatio: vol.ratio,
    riskPressureScore, forecast90d, forecast1y, forecastDirection,
    confidenceScore: conf, forecastUpper80, forecastLower80, forecastUpper95, forecastLower95,
    structuralBreak: brk.detected, structuralBreakPValue: brk.pValue,
    dataGapCount: gap.gapCount, dataStaleDays: gap.staleDays,
  };
}

// ─── Main Handler ───────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startMs = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    const targetIso3s = Array.isArray(body.iso3s)
      ? body.iso3s.map((v: unknown) => String(v).toUpperCase()).filter((v: string) => /^[A-Z0-9]{3}$/.test(v))
      : null;
    const batchSize = Math.max(1, Math.min(100, Number(body.batch_size ?? 80)));
    const offset = Math.max(0, Number(body.offset ?? 0));

    // 1. Check freeze state from DB
    const { data: freezeFlag } = await supabase
      .from("system_flags")
      .select("enabled")
      .eq("flag_key", "freeze_forecasts")
      .single();
    const frozen = freezeFlag?.enabled === true;

    const { data: repairedAnchors, error: anchorErr } = await supabase
      .rpc("ensure_l0_reporting_anchors");
    if (anchorErr) throw new Error(`Failed to ensure local anchors: ${anchorErr.message}`);

    const { data: repairedProfiles, error: profileRepairErr } = await supabase
      .rpc("ensure_country_profiles_from_normalized");
    if (profileRepairErr) throw new Error(`Failed to ensure country profiles: ${profileRepairErr.message}`);

    // 2. Load country profiles
    let profileQuery = supabase
      .from("country_profiles")
      .select("iso3, country_name, kpis", { count: "exact" })
      .order("iso3", { ascending: true });
    if (targetIso3s?.length) profileQuery = profileQuery.in("iso3", targetIso3s);
    else profileQuery = profileQuery.range(offset, offset + batchSize - 1);
    const { data: profiles, error: profErr, count: profileCount } = await profileQuery;
    if (profErr) throw new Error(`Failed to load profiles: ${profErr.message}`);
    const validProfiles = (profiles || []).filter((p: any) => p.iso3 && p.country_name && p.kpis);

    // 3. Load benchmarks, weights, coupling
    const [benchRes, weightRes, couplingRes, historyRes] = await Promise.all([
      supabase.from("global_domain_benchmarks").select("*"),
      supabase.from("domain_weights").select("domain, weight").eq("model_version", MODEL_VERSION),
      supabase.from("domain_coupling_matrix").select("*").eq("model_version", MODEL_VERSION),
      supabase.from("country_performance_snapshots").select("domain, performance_index").order("created_at", { ascending: false }).limit(200),
    ]);

    const benchmarks: Record<string, Benchmark> = {};
    for (const b of benchRes.data || []) benchmarks[b.domain] = b;

    const weights: Record<string, number> = {};
    for (const w of weightRes.data || []) weights[w.domain] = Number(w.weight);
    if (Object.keys(weights).length === 0) {
      Object.assign(weights, { governance: 0.18, health: 0.16, energy: 0.13, finance: 0.15, food: 0.13, security: 0.15, education: 0.05, climate: 0.03, population: 0.02 });
    }

    const couplingMatrix = couplingRes.data || [];

    // Historical RMSE for SPC
    const spcHistory: Record<string, number[]> = {};
    for (const h of historyRes.data || []) {
      if (!spcHistory[h.domain]) spcHistory[h.domain] = [];
      spcHistory[h.domain].push(Number(h.performance_index));
    }

    // 4. Process each country
    const snapshotDate = new Date().toISOString().split("T")[0];
    let countriesProcessed = 0;
    let totalDomains = 0;
    let breakCount = 0;
    const allSPCObs: any[] = [];
    const allSnapshots: any[] = [];
    const allArchive: any[] = [];
    const allCalibMetrics: any[] = [];
    const allResiduals: any[] = [];
    const killSwitchMetrics = { rmseValues: [] as number[], hitCount: 0, totalForecasts: 0, breakRate: 0 };

    for (const profile of validProfiles) {
      const { iso3, country_name, kpis } = profile;
      if (!kpis || typeof kpis !== "object") continue;

      const domainResults: any[] = [];
      const domainScores: Record<string, number> = {};

      for (const [domain, domainData] of Object.entries(kpis as Record<string, any>)) {
        if (!domainData?.metrics || !Array.isArray(domainData.metrics)) continue;

        const metrics: MetricEntry[] = domainData.metrics
          .filter((m: any) => m && typeof m.value === "number" && m.period)
          .map((m: any) => ({ metric: m.metric, value: m.value, period: m.period, source: m.source || "unknown", unit: m.unit }));

        if (metrics.length === 0) continue;

        // Calibrate parameters
        const values = metrics.sort((a, b) => a.period.localeCompare(b.period)).map(m => m.value);
        const calibrated = calibrateParameters(values);
        const bt = backtestForecast(values, calibrated.alpha, calibrated.beta);

        // Collect per-period residuals for empirical interval maturation
        const breakInfo = detectStructuralBreakCUSUM(values, calibrated.alpha, calibrated.beta);
        for (const res of bt.residuals) {
          allResiduals.push({
            iso3, domain, model_version: MODEL_VERSION,
            predicted_value: res.predicted, realized_value: res.realized,
            residual: res.residual, horizon_days: 90,
            decay_weight: res.decayWeight,
            regime_flag: breakInfo.detected ? "post_break" : "stable",
          });
        }

        const dp = computeDomainPerformance(
          domain, metrics, domainData.completeness ?? 0.5,
          benchmarks[domain], bt.stabilityScore, calibrated, frozen,
        );

        domainResults.push(dp);
        domainScores[domain] = dp.performanceIndex;
        totalDomains++;
        if (dp.structuralBreak) breakCount++;

        // Archive entry
        allArchive.push({
          iso3, country_name, domain, model_version: MODEL_VERSION,
          alpha: calibrated.alpha, beta: calibrated.beta,
          performance_index: dp.performanceIndex, forecast_90d: dp.forecast90d,
          forecast_1y: dp.forecast1y, forecast_upper_80: dp.forecastUpper80,
          forecast_lower_80: dp.forecastLower80, forecast_upper_95: dp.forecastUpper95,
          forecast_lower_95: dp.forecastLower95, confidence_score: dp.confidenceScore,
          stability_score: bt.stabilityScore, structural_break_flag: dp.structuralBreak,
          structural_break_p_value: dp.structuralBreakPValue,
          data_stale_days: dp.dataStaleDays,
          data_quality_score: Math.max(0, 100 - dp.dataGapCount * 5 - dp.dataStaleDays * 0.5),
          gap_interpolation_count: dp.dataGapCount,
          training_window_end: metrics[metrics.length - 1]?.period,
          calibration_version: MODEL_VERSION,
          parameter_set_id: `${calibrated.alpha}_${calibrated.beta}`,
        });

        // Calibration metrics
        allCalibMetrics.push(
          { model_version: MODEL_VERSION, domain, metric_name: "rmse", metric_value: bt.rmse, sample_size: values.length, computed_at: new Date().toISOString() },
          { model_version: MODEL_VERSION, domain, metric_name: "mae", metric_value: bt.mae, sample_size: values.length, computed_at: new Date().toISOString() },
          { model_version: MODEL_VERSION, domain, metric_name: "mape", metric_value: bt.mape, sample_size: values.length, computed_at: new Date().toISOString() },
          { model_version: MODEL_VERSION, domain, metric_name: "stability_score", metric_value: bt.stabilityScore, sample_size: values.length, computed_at: new Date().toISOString() },
        );

        // SPC observation
        const spcObs = evaluateSPC(`${iso3}_${domain}_perf`, dp.performanceIndex, spcHistory[domain] || []);
        allSPCObs.push({
          metric_name: spcObs.metricName, model_version: MODEL_VERSION,
          observed_value: spcObs.observedValue, ewma_value: spcObs.ewmaValue,
          rolling_mean: spcObs.rollingMean, rolling_std: spcObs.rollingStd,
          upper_control: spcObs.upperControl, lower_control: spcObs.lowerControl,
          out_of_control: spcObs.outOfControl, observed_at: new Date().toISOString(),
        });

        // Kill-switch tracking
        killSwitchMetrics.rmseValues.push(bt.rmse);
        killSwitchMetrics.totalForecasts++;
      }

      if (domainResults.length === 0) continue;

      // National performance aggregation
      let tw = 0, wp = 0, wm = 0, wv = 0, wr = 0, wf90 = 0, wf1y = 0, wc = 0;
      for (const dp of domainResults) {
        const w = weights[dp.domain] || 0.05;
        tw += w; wp += dp.performanceIndex * w; wm += dp.momentumScore * w;
        wv += dp.volatilityIndex * w; wr += dp.riskPressureScore * w;
        wf90 += dp.forecast90d * w; wf1y += dp.forecast1y * w; wc += dp.confidenceScore * w;
      }
      const n = tw || 1;
      const overallIndex = Math.round(wp / n);
      const momentum = Math.round((wm / n) * 10) / 10;
      const volatility = Math.round(wv / n);
      const fragility = computeSystemicFragilityV2(domainScores, couplingMatrix);
      const riskPressure = Math.round((wr / n) * 0.6 + fragility * 0.4);
      const structBreakCount = domainResults.filter(d => d.structuralBreak).length;
      const confidence = Math.max(10, Math.min(95, Math.round(wc / n - structBreakCount * 3)));
      const forecastDirection = momentum > 3 ? "up" : momentum < -3 ? "down" : "stable";

      // National snapshot
      for (const dp of domainResults) {
        allSnapshots.push({
          iso3, domain: dp.domain, performance_index: dp.performanceIndex,
          momentum_score: dp.momentumScore, momentum_t_stat: dp.momentumTStat,
          volatility_index: dp.volatilityIndex, risk_pressure_score: dp.riskPressureScore,
          forecast_90d: dp.forecast90d, forecast_1y: dp.forecast1y,
          forecast_direction: dp.forecastDirection, confidence_score: dp.confidenceScore,
          snapshot_date: snapshotDate, structural_break_count: structBreakCount,
          systemic_fragility_score: fragility, forecast_stability_score: r3(confidence / 100),
          data_gap_count: dp.dataGapCount, data_stale_days: dp.dataStaleDays,
          break_p_value: dp.structuralBreakPValue,
        });
      }

      countriesProcessed++;
    }

    // 5. Persist all results in batches
    const batchInsert = async (table: string, rows: any[], batchSize = 50) => {
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const { error } = await supabase.from(table).insert(batch);
        if (error) console.error(`Insert ${table} batch ${i}: ${error.message}`);
      }
    };

    await Promise.all([
      batchInsert("forecast_archive", allArchive),
      batchInsert("country_performance_snapshots", allSnapshots),
      batchInsert("calibration_metrics", allCalibMetrics),
      batchInsert("spc_control_observations", allSPCObs),
      batchInsert("forecast_residuals", allResiduals),
    ]);

    // 5b. Write audit chain entries with SHA-256 cryptographic hashing
    async function sha256Hex(data: string): Promise<string> {
      const encoded = new TextEncoder().encode(data);
      const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
      return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    function canonicalize(value: unknown): string {
      if (value === null || value === undefined) return "null";
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      if (typeof value === "string") return JSON.stringify(value);
      if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
      if (typeof value === "object") {
        const keys = Object.keys(value as Record<string, unknown>).sort();
        return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalize((value as Record<string, unknown>)[k])).join(",") + "}";
      }
      return String(value);
    }

    // Full coverage: audit ALL snapshots, not sampled
    const auditEntries = [];
    for (const s of allSnapshots) {
      const inputCanonical = canonicalize({
        iso3: s.iso3, domain: s.domain, snapshot_date: snapshotDate,
        model_version: MODEL_VERSION, ...ENGINE_PARAMS,
        sources: ["country_profiles", "global_indicators"],
      });
      const outputCanonical = canonicalize({
        performance_index: s.performance_index, momentum_score: s.momentum_score,
        forecast_90d: s.forecast_90d, forecast_1y: s.forecast_1y,
        risk_pressure_score: s.risk_pressure_score, confidence_score: s.confidence_score,
      });

      const [inputHash, outputHash] = await Promise.all([
        sha256Hex(inputCanonical),
        sha256Hex(outputCanonical),
      ]);

      auditEntries.push({
        signal_id: `snapshot-${s.iso3}-${s.domain}-${snapshotDate}`,
        signal_type: "forecast_snapshot",
        iso3: s.iso3,
        domain: s.domain,
        generated_at: new Date().toISOString(),
        model_version: MODEL_VERSION,
        data_sources: JSON.stringify(["country_profiles", "global_indicators"]),
        input_hash: inputHash,
        output_hash: outputHash,
        parameters: JSON.stringify(ENGINE_PARAMS),
        reproducible: true,
        notes: `full-coverage audit | ${allSnapshots.length} total snapshots`,
      });
    }
    const auditWriteMs = Date.now();
    if (auditEntries.length > 0) {
      await batchInsert("signal_audit_chain", auditEntries);
    }
    const auditElapsedMs = Date.now() - auditWriteMs;

    // 6. Kill-switch evaluation
    // Kill-switch uses normalized metrics: MAPE > 50% or break rate > 60%
    const avgMAPE = allCalibMetrics.filter(m => m.metric_name === "mape").reduce((s, m) => s + m.metric_value, 0) / Math.max(1, allCalibMetrics.filter(m => m.metric_name === "mape").length);
    const currentBreakRate = totalDomains > 0 ? (breakCount / totalDomains) * 100 : 0;
    const killSwitchTriggered = avgMAPE > 50 || currentBreakRate > 60;
    const killSwitchEvaluated = !targetIso3s?.length && offset === 0 && profileCount !== null && batchSize >= profileCount;

    if (killSwitchEvaluated && killSwitchTriggered && !frozen) {
      // Activate freeze
      await supabase.from("system_flags").update({ enabled: true, updated_at: new Date().toISOString() }).eq("flag_key", "freeze_forecasts");
      // Log critical alert
      await supabase.from("critical_alerts").insert({
        headline: `Kill-Switch Activated: ${avgMAPE > 50 ? "MAPE out of control" : "Break rate >60%"}`,
        level: "critical",
        severity: 10,
        event_type: "kill_switch",
        meta: { avgMAPE: r2(avgMAPE), breakRate: r2(currentBreakRate), countriesProcessed, totalDomains },
      });
    }

    // 7. Log telemetry
    const elapsed = Date.now() - startMs;
    await supabase.from("automation_logs").insert({
      job_name: "run-performance-engine-v2",
      status: "success",
      message: JSON.stringify({
        repairedAnchors: repairedAnchors ?? 0, repairedProfiles: repairedProfiles ?? 0,
        offset, batchSize, profileCount: profileCount ?? null,
        countriesProcessed, totalDomains, breakCount,
        archiveEntries: allArchive.length, snapshotEntries: allSnapshots.length,
        calibrationEntries: allCalibMetrics.length, spcEntries: allSPCObs.length,
        residualEntries: allResiduals.length,
        auditEntries: auditEntries.length, auditWriteMs: auditElapsedMs,
        killSwitchTriggered, killSwitchEvaluated, frozen, elapsedMs: elapsed,
      }),
    });

    const nextOffset = offset + batchSize;
    const autoContinuing = !targetIso3s?.length && profileCount !== null && nextOffset < profileCount;
    if (autoContinuing) {
      fetch(`${supabaseUrl}/functions/v1/run-performance-engine-v2`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ offset: nextOffset, batch_size: batchSize }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({
      success: true, frozen, killSwitchTriggered, killSwitchEvaluated,
      repairedAnchors: repairedAnchors ?? 0, repairedProfiles: repairedProfiles ?? 0,
      offset, batchSize, profileCount: profileCount ?? null, autoContinuing,
      countriesProcessed, totalDomains, breakCount,
      entries: { archive: allArchive.length, snapshots: allSnapshots.length, calibration: allCalibMetrics.length, spc: allSPCObs.length, residuals: allResiduals.length },
      elapsedMs: elapsed,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Engine V2 error:", err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
