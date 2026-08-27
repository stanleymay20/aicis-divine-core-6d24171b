import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  structuredLog,
  handleCors,
  corsHeaders,
  errorResponse,
  jsonResponse,
} from "../_shared/resilience.ts";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "generate-predictions";
const VERSION = "v4-truth-floor";
const MODEL_VERSION = "deterministic-snapshot-extrapolation-v4";
const TOP_PER_DOMAIN = 8;

type SnapshotRow = {
  iso3: string | null;
  domain: string | null;
  performance_index: number | null;
  momentum_score: number | null;
  volatility_index: number | null;
  forecast_direction: string | null;
  forecast_90d: unknown;
  confidence_score: number | null;
  snapshot_date: string | null;
};

type TimelinePoint = {
  date: string;
  value: number;
};

type DeterministicForecast = {
  summary: string;
  trend: "increasing" | "decreasing" | "stable";
  risk_level: "critical" | "high" | "medium" | "low";
  risk_level_semantics: "volatility_threshold_heuristic";
  analytical_confidence: null;
  calibration_status: "not_calibrated";
  probability_semantics: "not_probabilistic";
  method: "deterministic_snapshot_extrapolation_v4";
  assumptions: string[];
  key_factors: string[];
  timeline: TimelinePoint[];
  source: "country_performance_snapshots";
  source_snapshot_date: string;
  upstream_confidence_score: number | null;
  upstream_confidence_semantics: "source_field_preserved_not_prediction_confidence";
};

type PredictionDraft = {
  division: string;
  country: string;
  forecast: DeterministicForecast;
  confidence: null;
  volatility_index: number;
  predicted_at: string;
};

type ForecastAbstentionInsert = {
  requested_by: null;
  affected_divisions: string[];
  reason: string;
  evidence_counts: Record<string, unknown>;
  evidence_sufficiency: null;
  source_independence: Record<string, unknown>;
  calibration_context: unknown[];
  model_provider: "deterministic_local";
  model_name: string;
  metadata: Record<string, unknown>;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function validIso3(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function normalizedDomain(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function missingRequiredFields(row: SnapshotRow): string[] {
  const missing: string[] = [];
  if (!validIso3(row.iso3)) missing.push("iso3");
  if (!normalizedDomain(row.domain)) missing.push("domain");
  if (finiteNumber(row.performance_index) === null) missing.push("performance_index");
  if (finiteNumber(row.momentum_score) === null) missing.push("momentum_score");
  if (finiteNumber(row.volatility_index) === null) missing.push("volatility_index");
  if (!row.snapshot_date) missing.push("snapshot_date");
  return missing;
}

function toAbstention(
  row: SnapshotRow,
  reason: string,
  missingFields: string[],
): ForecastAbstentionInsert {
  return {
    requested_by: null,
    affected_divisions: normalizedDomain(row.domain) ? [normalizedDomain(row.domain) as string] : [],
    reason,
    evidence_counts: {
      country_iso3: validIso3(row.iso3),
      source_snapshot_date: row.snapshot_date,
      missing_required_fields: missingFields,
      missing_required_field_count: missingFields.length,
    },
    evidence_sufficiency: null,
    source_independence: {
      status: "not_assessed",
      reason: "single_snapshot_source",
    },
    calibration_context: [],
    model_provider: "deterministic_local",
    model_name: MODEL_VERSION,
    metadata: {
      function: FN,
      version: VERSION,
      source: "country_performance_snapshots",
      abstention_semantics: "no_prediction_issued",
    },
  };
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const { response: authResponse } = await requireAdminOrCron(req, corsHeaders);
  if (authResponse) return authResponse;

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    structuredLog("info", FN, "Starting evidence-gated deterministic trajectory generation");

    const recentCutoff = new Date(Date.now() - 14 * 86_400_000).toISOString().split("T")[0];
    const { data: snapshotData, error: snapshotError } = await supabase
      .from("country_performance_snapshots")
      .select("iso3, domain, performance_index, momentum_score, volatility_index, forecast_direction, forecast_90d, confidence_score, snapshot_date")
      .gte("snapshot_date", recentCutoff)
      .order("snapshot_date", { ascending: false })
      .limit(2000);

    if (snapshotError) throw snapshotError;

    const snapshots = (snapshotData ?? []) as unknown as SnapshotRow[];
    structuredLog("info", FN, `Fetched ${snapshots.length} recent snapshots`);

    // Keep the newest observed row for each subject. If the newest row is
    // incomplete we abstain rather than silently falling back to an older row.
    const latestByKey = new Map<string, SnapshotRow>();
    const structurallyInvalid: SnapshotRow[] = [];

    for (const snapshot of snapshots) {
      const iso3 = validIso3(snapshot.iso3);
      const domain = normalizedDomain(snapshot.domain);
      if (!iso3 || !domain) {
        structurallyInvalid.push(snapshot);
        continue;
      }
      const key = `${domain}::${iso3}`;
      if (!latestByKey.has(key)) latestByKey.set(key, snapshot);
    }

    const abstentions: ForecastAbstentionInsert[] = structurallyInvalid.map((snapshot) =>
      toAbstention(snapshot, "invalid_subject_identity", missingRequiredFields(snapshot))
    );

    const byDomain = new Map<string, SnapshotRow[]>();
    for (const snapshot of latestByKey.values()) {
      const missing = missingRequiredFields(snapshot);
      if (missing.length > 0) {
        abstentions.push(toAbstention(snapshot, "required_snapshot_fields_missing", missing));
        continue;
      }

      const domain = normalizedDomain(snapshot.domain) as string;
      const list = byDomain.get(domain) ?? [];
      list.push(snapshot);
      byDomain.set(domain, list);
    }

    const targets: SnapshotRow[] = [];
    for (const list of byDomain.values()) {
      // Every surviving row has an observed momentum_score. Ranking therefore
      // never converts missing momentum into zero.
      list.sort((left, right) => {
        const leftMomentum = finiteNumber(left.momentum_score) as number;
        const rightMomentum = finiteNumber(right.momentum_score) as number;
        return Math.abs(rightMomentum) - Math.abs(leftMomentum);
      });
      targets.push(...list.slice(0, TOP_PER_DOMAIN));
    }

    structuredLog(
      "info",
      FN,
      `Selected ${targets.length} complete-evidence targets across ${byDomain.size} domains; ${abstentions.length} abstentions queued`,
    );

    const predictions: PredictionDraft[] = [];
    const today = new Date();

    for (const target of targets) {
      const iso3 = validIso3(target.iso3);
      const domain = normalizedDomain(target.domain);
      const baseValue = finiteNumber(target.performance_index);
      const momentum = finiteNumber(target.momentum_score);
      const volatility = finiteNumber(target.volatility_index);

      // These values were already checked above. Keep a defensive abstention in
      // case a future schema/runtime change violates that invariant.
      if (!iso3 || !domain || baseValue === null || momentum === null || volatility === null || !target.snapshot_date) {
        abstentions.push(toAbstention(target, "required_snapshot_fields_missing_at_generation", missingRequiredFields(target)));
        continue;
      }

      const futureDate30 = new Date(today);
      const futureDate60 = new Date(today);
      const futureDate90 = new Date(today);
      futureDate30.setDate(today.getDate() + 30);
      futureDate60.setDate(today.getDate() + 60);
      futureDate90.setDate(today.getDate() + 90);

      // Deterministic policy trajectory. This is intentionally NOT described as
      // a calibrated probability or statistical confidence interval.
      const direction: DeterministicForecast["trend"] =
        momentum > 0.05 ? "increasing" : momentum < -0.05 ? "decreasing" : "stable";
      const ninetyDayDelta = momentum * 10;
      const value30 = Math.max(0, Math.min(100, baseValue + ninetyDayDelta * (30 / 90)));
      const value60 = Math.max(0, Math.min(100, baseValue + ninetyDayDelta * (60 / 90)));
      const value90 = Math.max(0, Math.min(100, baseValue + ninetyDayDelta));

      const riskLevel: DeterministicForecast["risk_level"] =
        volatility > 0.7 ? "critical" :
        volatility > 0.5 ? "high" :
        volatility > 0.3 ? "medium" : "low";

      const upstreamConfidence = finiteNumber(target.confidence_score);
      const forecast: DeterministicForecast = {
        summary: `${iso3} ${domain}: deterministic ${direction} screening trajectory over 90 days; this is not a calibrated probability forecast`,
        trend: direction,
        risk_level: riskLevel,
        risk_level_semantics: "volatility_threshold_heuristic",
        analytical_confidence: null,
        calibration_status: "not_calibrated",
        probability_semantics: "not_probabilistic",
        method: "deterministic_snapshot_extrapolation_v4",
        assumptions: [
          "90-day index delta is defined by the deterministic policy rule momentum_score × 10",
          "30-day and 60-day trajectory points are linear fractions of the 90-day policy delta",
          "values are bounded to the source index range 0–100",
          "no missing input is replaced with a default number",
        ],
        key_factors: [
          `performance_index=${baseValue.toFixed(2)}`,
          `momentum_score=${momentum.toFixed(4)}`,
          `volatility_index=${volatility.toFixed(4)}`,
        ],
        timeline: [
          { date: formatDate(futureDate30), value: Number(value30.toFixed(2)) },
          { date: formatDate(futureDate60), value: Number(value60.toFixed(2)) },
          { date: formatDate(futureDate90), value: Number(value90.toFixed(2)) },
        ],
        source: "country_performance_snapshots",
        source_snapshot_date: target.snapshot_date,
        upstream_confidence_score: upstreamConfidence,
        upstream_confidence_semantics: "source_field_preserved_not_prediction_confidence",
      };

      predictions.push({
        division: domain,
        country: iso3,
        forecast,
        confidence: null,
        volatility_index: volatility,
        predicted_at: new Date().toISOString(),
      });
    }

    let inserted = 0;
    let prospectiveInserted = 0;

    for (const prediction of predictions) {
      const { data: predictionRow, error } = await supabase
        .from("predictions")
        .insert({
          division: prediction.division,
          country: prediction.country,
          forecast: prediction.forecast,
          confidence: null,
          volatility_index: prediction.volatility_index,
          predicted_at: prediction.predicted_at,
        })
        .select("id")
        .single();

      if (error) {
        structuredLog("warn", FN, "predictions insert failed", {
          error: error.message,
          division: prediction.division,
          country: prediction.country,
        });
        continue;
      }
      inserted += 1;

      const horizons = [30, 60, 90] as const;
      for (let index = 0; index < horizons.length; index += 1) {
        const timelinePoint = prediction.forecast.timeline[index];
        if (!timelinePoint || !Number.isFinite(timelinePoint.value)) {
          abstentions.push({
            requested_by: null,
            affected_divisions: [prediction.division],
            reason: "prospective_evaluation_timeline_value_missing",
            evidence_counts: {
              country_iso3: prediction.country,
              horizon_days: horizons[index],
            },
            evidence_sufficiency: null,
            source_independence: { status: "not_assessed", reason: "single_snapshot_source" },
            calibration_context: [],
            model_provider: "deterministic_local",
            model_name: MODEL_VERSION,
            metadata: {
              function: FN,
              version: VERSION,
              forecast_id: predictionRow?.id ?? null,
              abstention_semantics: "no_prospective_evaluation_issued",
            },
          });
          continue;
        }

        const predictedAt = new Date();
        const dueAt = new Date(predictedAt);
        dueAt.setDate(dueAt.getDate() + horizons[index]);

        const { error: prospectiveError } = await supabase
          .from("forecast_prospective_evaluations")
          .insert({
            forecast_id: predictionRow?.id ?? null,
            domain: prediction.division,
            iso3: prediction.country,
            model_version: MODEL_VERSION,
            horizon_days: horizons[index],
            predicted_value: timelinePoint.value,
            predicted_direction: prediction.forecast.trend,
            predicted_at: predictedAt.toISOString(),
            realization_due_at: dueAt.toISOString(),
            evaluation_window: `${horizons[index]}d`,
            metadata: {
              source: FN,
              version: VERSION,
              forecast_id: predictionRow?.id ?? null,
              source_snapshot_date: prediction.forecast.source_snapshot_date,
              prediction_semantics: "deterministic_heuristic_trajectory",
              analytical_confidence: null,
              calibration_status: "not_calibrated",
            },
          });

        if (!prospectiveError) {
          prospectiveInserted += 1;
        } else {
          structuredLog("warn", FN, "prospective evaluation insert failed", {
            error: prospectiveError.message,
            division: prediction.division,
            country: prediction.country,
            horizon_days: horizons[index],
          });
        }
      }
    }

    if (abstentions.length > 0) {
      const { error: abstentionError } = await supabase
        .from("forecast_abstentions")
        .insert(abstentions);
      if (abstentionError) throw abstentionError;
    }

    await supabase.from("system_logs").insert({
      division: "intelligence",
      action: "generate_predictions",
      result: "success",
      log_level: "info",
      metadata: {
        predictions_generated: inserted,
        prospective_evaluations: prospectiveInserted,
        abstentions_recorded: abstentions.length,
        domains_processed: byDomain.size,
        version: VERSION,
        model_version: MODEL_VERSION,
        probability_semantics: "not_probabilistic",
        analytical_confidence: null,
        synthetic_missing_value_fallbacks: false,
      },
    });

    structuredLog(
      "info",
      FN,
      `Generated ${inserted} deterministic trajectories, ${prospectiveInserted} prospective evaluations, ${abstentions.length} abstentions`,
      undefined,
      start,
    );

    return jsonResponse({
      success: true,
      predictions_generated: inserted,
      prospective_evaluations: prospectiveInserted,
      abstentions_recorded: abstentions.length,
      total_candidates: latestByKey.size + structurallyInvalid.length,
      domains: byDomain.size,
      version: VERSION,
      model_version: MODEL_VERSION,
      semantics: {
        probabilistic: false,
        calibrated: false,
        analytical_confidence: null,
        synthetic_missing_value_fallbacks: false,
      },
    });
  } catch (error) {
    structuredLog(
      "error",
      FN,
      error instanceof Error ? error.message : String(error),
      undefined,
      start,
    );
    return errorResponse(error);
  }
});
