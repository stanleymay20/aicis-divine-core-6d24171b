import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  requireAdminOrTrustedWorker,
  requireUserOrTrustedWorker,
} from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Compatibility identifier retained so any genuinely observed calibration bins
// produced for the existing deterministic scorer remain addressable. The scorer
// is NOT represented as a trained/validated ML model: no committed training path
// has been proven for these fixed coefficients.
const MODEL_VERSION = "logistic-baseline-v1";
const MODEL_SEMANTICS = "fixed_logistic_screen";
const MIN_CALIBRATION_SAMPLE = 30;
const MAX_SOURCE_AGE_DAYS = 14;

const WEIGHTS = {
  intercept: -0.4,
  zscore: 0.6,
  trend7: -0.5,
  trend30: -0.4,
  vol: 0.7,
  events7: 0.05,
  evSeverity: 0.3,
  neighbor: 0.4,
  crossDomain: 0.3,
} as const;

const REQUIRED_FEATURES = [
  "metric_zscore_vs_90d",
  "metric_trend_7d",
  "metric_trend_30d",
  "metric_volatility_30d",
  "events_count_7d",
  "event_severity_avg_7d",
  "neighbor_risk_score",
  "cross_domain_pressure",
] as const;

type RequiredFeatureName = typeof REQUIRED_FEATURES[number];
type Mode = "list" | "infer";

type TrainingRow = {
  country_iso3: string | null;
  domain: string | null;
  metric_zscore_vs_90d: number | null;
  metric_trend_7d: number | null;
  metric_trend_30d: number | null;
  metric_volatility_30d: number | null;
  events_count_7d: number | null;
  event_severity_avg_7d: number | null;
  neighbor_risk_score: number | null;
  cross_domain_pressure: number | null;
  feature_hash: string | null;
  snapshot_date: string | null;
};

type CalibrationRow = {
  domain: string | null;
  bin_lower: number;
  bin_upper: number;
  predicted_mean: number;
  empirical_rate: number;
  sample_count: number;
  computed_at: string | null;
};

type CalibrationBin = {
  lo: number;
  hi: number;
  predictedMean: number;
  empiricalRate: number;
  sampleCount: number;
  computedAt: string | null;
};

type Features = {
  z: number;
  t7: number;
  t30: number;
  v: number;
  e7: number;
  es: number;
  nb: number;
  cd: number;
};

type AbstentionInsert = {
  generation_batch_id: string;
  country_iso3: string | null;
  domain: string | null;
  horizon_days: number;
  source_kind: "training_dataset_aicis";
  source_snapshot_date: string | null;
  reason: string;
  missing_features: string[];
  feature_snapshot: Record<string, unknown>;
  model_version: string;
  model_semantics: string;
};

type InferenceInsert = {
  id: string;
  country_iso3: string;
  domain: string;
  horizon_days: number;
  risk_probability: number;
  baseline_score: number;
  raw_score: number;
  calibrated_score: number | null;
  prediction_interval_lower: number | null;
  prediction_interval_upper: number | null;
  model_version: string;
  generation_batch_id: string;
  generated_at: string;
  feature_snapshot: Features;
  feature_contributions: Record<string, number>;
  audit_hash: string;
  evidence_status: "sufficient";
  probability_semantics:
    | "uncalibrated_logistic_screen_score"
    | "empirical_bin_calibrated_probability";
  calibration_status:
    | "not_available"
    | "insufficient_sample"
    | "empirical_bin_sufficient";
  calibration_sample_size: number | null;
  calibration_computed_at: string | null;
  interval_semantics: "wilson_95_empirical_calibration_bin_rate" | null;
  source_kind: "training_dataset_aicis";
  source_snapshot_date: string;
  feature_completeness: 1;
  model_semantics: "fixed_logistic_screen";
};

type AuditInsert = {
  prediction_id: string;
  feature_hash: string;
  model_version: string;
  weights_hash: string;
  combined_hash: string;
  previous_audit_hash: string | null;
  generated_at: string;
};

type RequestConfig = {
  mode: Mode;
  horizon: number;
  topN: number;
  domain?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number") return null;
  return Number.isFinite(value) ? value : null;
}

function clip01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function parseSnapshotDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sourceAgeDays(value: string | null, now = new Date()): number | null {
  const sourceDate = parseSnapshotDate(value);
  if (!sourceDate) return null;
  return Math.floor((now.getTime() - sourceDate.getTime()) / 86_400_000);
}

function missingFeatureNames(row: TrainingRow): RequiredFeatureName[] {
  return REQUIRED_FEATURES.filter((name) => finiteNumber(row[name]) === null);
}

function toFeatures(row: TrainingRow): Features | null {
  const z = finiteNumber(row.metric_zscore_vs_90d);
  const t7 = finiteNumber(row.metric_trend_7d);
  const t30 = finiteNumber(row.metric_trend_30d);
  const v = finiteNumber(row.metric_volatility_30d);
  const e7 = finiteNumber(row.events_count_7d);
  const es = finiteNumber(row.event_severity_avg_7d);
  const nb = finiteNumber(row.neighbor_risk_score);
  const cd = finiteNumber(row.cross_domain_pressure);

  if ([z, t7, t30, v, e7, es, nb, cd].some((value) => value === null)) {
    return null;
  }

  return {
    z: z as number,
    t7: t7 as number,
    t30: t30 as number,
    v: v as number,
    e7: e7 as number,
    es: es as number,
    nb: nb as number,
    cd: cd as number,
  };
}

function wilson95(rate: number, sampleCount: number): { lower: number; upper: number } | null {
  if (!Number.isFinite(rate) || !Number.isFinite(sampleCount) || sampleCount <= 0) return null;

  const p = clip01(rate);
  const n = sampleCount;
  const z = 1.959963984540054;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denominator;

  return {
    lower: clip01(center - margin),
    upper: clip01(center + margin),
  };
}

async function sha256Hex(value: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function parseRequest(req: Request): Promise<RequestConfig> {
  const url = new URL(req.url);
  let mode: Mode = url.searchParams.get("mode") === "infer" ? "infer" : "list";
  let horizon = Number(url.searchParams.get("horizon") ?? "7");
  let topN = Number(url.searchParams.get("top_n") ?? "100");
  let domain = url.searchParams.get("domain") ?? undefined;

  if (req.method === "POST") {
    try {
      const body = asRecord(await req.json());
      if (body.mode === "infer" || body.mode === "list") mode = body.mode;
      if (body.horizon !== undefined) horizon = Number(body.horizon);
      if (body.top_n !== undefined) topN = Number(body.top_n);
      if (typeof body.domain === "string" && body.domain.trim()) domain = body.domain.trim();
    } catch {
      // An empty/invalid JSON body does not manufacture input; query/default
      // values remain in force and are validated below.
    }
  }

  if (![7, 30, 90].includes(horizon)) horizon = 7;
  if (!Number.isFinite(topN)) topN = 100;
  topN = Math.max(1, Math.min(500, Math.floor(topN)));

  return { mode, horizon, topN, domain };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const config = await parseRequest(req);

  // Reading analytical output is user-facing. Creating a new global batch uses
  // service-role privilege and is therefore restricted to an administrator or
  // an explicitly trusted scheduler/service-role caller.
  if (config.mode === "infer") {
    const auth = await requireAdminOrTrustedWorker(req, corsHeaders);
    if (auth.response) return auth.response;
  } else {
    const auth = await requireUserOrTrustedWorker(req, corsHeaders);
    if (auth.response) return auth.response;
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    if (config.mode === "infer") {
      const { data: trainingData, error: rowError } = await sb
        .from("training_dataset_aicis")
        .select("country_iso3, domain, metric_zscore_vs_90d, metric_trend_7d, metric_trend_30d, metric_volatility_30d, events_count_7d, event_severity_avg_7d, neighbor_risk_score, cross_domain_pressure, feature_hash, snapshot_date")
        .eq("horizon_days", config.horizon)
        .order("snapshot_date", { ascending: false })
        .limit(5000);
      if (rowError) throw rowError;

      const rows = (trainingData ?? []) as unknown as TrainingRow[];

      const { data: calibrationData, error: calibrationError } = await sb
        .from("model_calibration_bins")
        .select("domain, bin_lower, bin_upper, predicted_mean, empirical_rate, sample_count, computed_at")
        .eq("model_version", MODEL_VERSION);
      if (calibrationError) throw calibrationError;

      const calibrationRows = (calibrationData ?? []) as unknown as CalibrationRow[];
      const calibrationByDomain = new Map<string, CalibrationBin[]>();

      for (const row of calibrationRows) {
        const lo = finiteNumber(row.bin_lower);
        const hi = finiteNumber(row.bin_upper);
        const predictedMean = finiteNumber(row.predicted_mean);
        const empiricalRate = finiteNumber(row.empirical_rate);
        const sampleCount = finiteNumber(row.sample_count);
        if (lo === null || hi === null || predictedMean === null || empiricalRate === null || sampleCount === null) {
          continue;
        }

        const key = row.domain ?? "*";
        const bins = calibrationByDomain.get(key) ?? [];
        bins.push({
          lo,
          hi,
          predictedMean,
          empiricalRate: clip01(empiricalRate),
          sampleCount: Math.max(0, Math.floor(sampleCount)),
          computedAt: row.computed_at,
        });
        calibrationByDomain.set(key, bins);
      }

      for (const bins of calibrationByDomain.values()) {
        bins.sort((left, right) => left.lo - right.lo);
      }

      const weightsHash = await sha256Hex(JSON.stringify(WEIGHTS));
      const batchId = crypto.randomUUID();
      const generatedAt = new Date().toISOString();
      const now = new Date();

      const { data: lastAudit } = await sb
        .from("ml_inference_audit")
        .select("combined_hash")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      let previousHash: string | null = lastAudit?.combined_hash ?? null;

      const seen = new Set<string>();
      const inferences: InferenceInsert[] = [];
      const audits: AuditInsert[] = [];
      const abstentions: AbstentionInsert[] = [];
      let calibratedRows = 0;
      let uncalibratedRows = 0;

      if (rows.length === 0) {
        abstentions.push({
          generation_batch_id: batchId,
          country_iso3: null,
          domain: config.domain ?? null,
          horizon_days: config.horizon,
          source_kind: "training_dataset_aicis",
          source_snapshot_date: null,
          reason: "no_training_rows_for_horizon",
          missing_features: [...REQUIRED_FEATURES],
          feature_snapshot: {},
          model_version: MODEL_VERSION,
          model_semantics: MODEL_SEMANTICS,
        });
      }

      for (const row of rows) {
        const country = typeof row.country_iso3 === "string" ? row.country_iso3.trim().toUpperCase() : "";
        const rowDomain = typeof row.domain === "string" ? row.domain.trim() : "";
        if (!country || !rowDomain) continue;
        if (config.domain && rowDomain !== config.domain) continue;

        const key = `${country}|${rowDomain}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const missing = missingFeatureNames(row);
        const ageDays = sourceAgeDays(row.snapshot_date, now);
        const featureSnapshot = Object.fromEntries(
          REQUIRED_FEATURES.map((name) => [name, row[name]]),
        ) as Record<string, unknown>;

        if (ageDays === null) {
          abstentions.push({
            generation_batch_id: batchId,
            country_iso3: country,
            domain: rowDomain,
            horizon_days: config.horizon,
            source_kind: "training_dataset_aicis",
            source_snapshot_date: row.snapshot_date,
            reason: "source_snapshot_date_unknown",
            missing_features: missing,
            feature_snapshot: featureSnapshot,
            model_version: MODEL_VERSION,
            model_semantics: MODEL_SEMANTICS,
          });
          continue;
        }

        if (ageDays > MAX_SOURCE_AGE_DAYS) {
          abstentions.push({
            generation_batch_id: batchId,
            country_iso3: country,
            domain: rowDomain,
            horizon_days: config.horizon,
            source_kind: "training_dataset_aicis",
            source_snapshot_date: row.snapshot_date,
            reason: `stale_source_snapshot_over_${MAX_SOURCE_AGE_DAYS}_days`,
            missing_features: missing,
            feature_snapshot: featureSnapshot,
            model_version: MODEL_VERSION,
            model_semantics: MODEL_SEMANTICS,
          });
          continue;
        }

        if (missing.length > 0) {
          abstentions.push({
            generation_batch_id: batchId,
            country_iso3: country,
            domain: rowDomain,
            horizon_days: config.horizon,
            source_kind: "training_dataset_aicis",
            source_snapshot_date: row.snapshot_date,
            reason: "required_features_missing",
            missing_features: missing,
            feature_snapshot: featureSnapshot,
            model_version: MODEL_VERSION,
            model_semantics: MODEL_SEMANTICS,
          });
          continue;
        }

        const features = toFeatures(row);
        if (!features || !row.snapshot_date) continue;

        const logit =
          WEIGHTS.intercept +
          WEIGHTS.zscore * features.z +
          WEIGHTS.trend7 * features.t7 +
          WEIGHTS.trend30 * features.t30 +
          WEIGHTS.vol * features.v +
          WEIGHTS.events7 * Math.log1p(Math.max(0, features.e7)) +
          WEIGHTS.evSeverity * features.es +
          WEIGHTS.neighbor * features.nb +
          WEIGHTS.crossDomain * features.cd;

        const raw = clip01(sigmoid(logit));
        const bins = calibrationByDomain.get(rowDomain) ?? calibrationByDomain.get("*") ?? [];
        const calibrationBin = bins.find((bin) => raw >= bin.lo && raw <= bin.hi) ?? null;

        let calibratedScore: number | null = null;
        let riskScore = raw;
        let probabilitySemantics: InferenceInsert["probability_semantics"] = "uncalibrated_logistic_screen_score";
        let calibrationStatus: InferenceInsert["calibration_status"] = "not_available";
        let calibrationSampleSize: number | null = null;
        let calibrationComputedAt: string | null = null;
        let intervalLower: number | null = null;
        let intervalUpper: number | null = null;
        let intervalSemantics: InferenceInsert["interval_semantics"] = null;

        if (calibrationBin) {
          calibrationSampleSize = calibrationBin.sampleCount;
          calibrationComputedAt = calibrationBin.computedAt;

          if (calibrationBin.sampleCount >= MIN_CALIBRATION_SAMPLE) {
            calibratedScore = calibrationBin.empiricalRate;
            riskScore = calibratedScore;
            probabilitySemantics = "empirical_bin_calibrated_probability";
            calibrationStatus = "empirical_bin_sufficient";

            const interval = wilson95(calibrationBin.empiricalRate, calibrationBin.sampleCount);
            if (interval) {
              intervalLower = interval.lower;
              intervalUpper = interval.upper;
              intervalSemantics = "wilson_95_empirical_calibration_bin_rate";
            }
            calibratedRows += 1;
          } else {
            calibrationStatus = "insufficient_sample";
            uncalibratedRows += 1;
          }
        } else {
          uncalibratedRows += 1;
        }

        const featureHash = row.feature_hash ?? await sha256Hex(JSON.stringify(features));
        const combinedPayload = [
          featureHash,
          MODEL_VERSION,
          MODEL_SEMANTICS,
          weightsHash,
          raw.toFixed(8),
          calibratedScore === null ? "uncalibrated" : calibratedScore.toFixed(8),
          probabilitySemantics,
          calibrationSampleSize ?? "no_calibration_sample",
        ].join("|");
        const combinedHash = await sha256Hex(`${previousHash ?? ""}|${combinedPayload}`);
        const predictionId = crypto.randomUUID();

        inferences.push({
          id: predictionId,
          country_iso3: country,
          domain: rowDomain,
          horizon_days: config.horizon,
          risk_probability: riskScore,
          baseline_score: raw,
          raw_score: raw,
          calibrated_score: calibratedScore,
          prediction_interval_lower: intervalLower,
          prediction_interval_upper: intervalUpper,
          model_version: MODEL_VERSION,
          generation_batch_id: batchId,
          generated_at: generatedAt,
          feature_snapshot: features,
          feature_contributions: {
            zscore: WEIGHTS.zscore * features.z,
            trend_7d: WEIGHTS.trend7 * features.t7,
            trend_30d: WEIGHTS.trend30 * features.t30,
            volatility: WEIGHTS.vol * features.v,
            events_7d: WEIGHTS.events7 * Math.log1p(Math.max(0, features.e7)),
            event_severity: WEIGHTS.evSeverity * features.es,
            neighbor_risk: WEIGHTS.neighbor * features.nb,
            cross_domain: WEIGHTS.crossDomain * features.cd,
          },
          audit_hash: combinedHash,
          evidence_status: "sufficient",
          probability_semantics: probabilitySemantics,
          calibration_status: calibrationStatus,
          calibration_sample_size: calibrationSampleSize,
          calibration_computed_at: calibrationComputedAt,
          interval_semantics: intervalSemantics,
          source_kind: "training_dataset_aicis",
          source_snapshot_date: row.snapshot_date,
          feature_completeness: 1,
          model_semantics: "fixed_logistic_screen",
        });

        audits.push({
          prediction_id: predictionId,
          feature_hash: featureHash,
          model_version: MODEL_VERSION,
          weights_hash: weightsHash,
          combined_hash: combinedHash,
          previous_audit_hash: previousHash,
          generated_at: generatedAt,
        });
        previousHash = combinedHash;
      }

      const chunk = <T,>(items: T[], size: number): T[][] => {
        const output: T[][] = [];
        for (let index = 0; index < items.length; index += size) {
          output.push(items.slice(index, index + size));
        }
        return output;
      };

      for (const batch of chunk(inferences, 500)) {
        const { error } = await sb.from("risk_ml_predictions").insert(batch);
        if (error) throw error;
      }

      for (const batch of chunk(audits, 500)) {
        const { error } = await sb.from("ml_inference_audit").insert(batch);
        if (error) console.warn("audit insert warning:", error.message);
      }

      for (const batch of chunk(abstentions, 500)) {
        const { error } = await sb.from("ml_inference_abstentions").insert(batch);
        if (error) throw error;
      }

      return json({
        success: true,
        mode: config.mode,
        batch_id: batchId,
        rows_inserted: inferences.length,
        abstentions_recorded: abstentions.length,
        calibrated_rows: calibratedRows,
        uncalibrated_rows: uncalibratedRows,
        model_version: MODEL_VERSION,
        model_semantics: MODEL_SEMANTICS,
        weights_hash: weightsHash,
        calibration_policy: {
          minimum_empirical_bin_sample: MIN_CALIBRATION_SAMPLE,
          interval_semantics: "wilson_95_empirical_calibration_bin_rate",
        },
        evidence_policy: {
          source: "training_dataset_aicis",
          maximum_source_age_days: MAX_SOURCE_AGE_DAYS,
          all_required_features_must_be_observed: true,
          synthetic_feature_fallbacks: false,
        },
      });
    }

    const { data: latest, error: latestError } = await sb
      .from("risk_ml_predictions")
      .select("generation_batch_id, generated_at")
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw latestError;

    if (!latest) return json({ success: true, mode: config.mode, rows: [] });

    let query = sb
      .from("risk_ml_predictions")
      .select("*")
      .eq("generation_batch_id", latest.generation_batch_id)
      .limit(2000);
    if (config.domain) query = query.eq("domain", config.domain);

    const { data: resultRows, error: rowsError } = await query;
    if (rowsError) throw rowsError;

    const sortedRows = [...(resultRows ?? [])]
      .sort((left, right) => {
        const leftScore = finiteNumber(left.calibrated_score) ?? finiteNumber(left.risk_probability) ?? -1;
        const rightScore = finiteNumber(right.calibrated_score) ?? finiteNumber(right.risk_probability) ?? -1;
        return rightScore - leftScore;
      })
      .slice(0, config.topN);

    return json({
      success: true,
      mode: config.mode,
      generated_at: latest.generated_at,
      rows: sortedRows,
    });
  } catch (error) {
    console.error("run-ml-inference error:", error);
    return json({ error: error instanceof Error ? error.message : "unknown" }, 500);
  }
});
