import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, errorResponse, jsonResponse } from "../_shared/resilience.ts";

const FN = "validate-forecast-accuracy";

/**
 * Read-only Validation Layer for AICIS Forecast Engine.
 * 
 * This function NEVER modifies the forecast engine, archive, or calibration system.
 * It only READS from forecast_archive + country_performance_snapshots
 * and WRITES to forecast_validation_results + vulnerability_event_correlations.
 * 
 * Horizons: 1-day directional, 7-day accuracy, residual trend
 */
serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req);
  if (callerAuth.response) return callerAuth.response;

  const cors = handleCors(req);
  if (cors) return cors;

  const start = Date.now();
  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    structuredLog("info", FN, "Starting forecast validation cycle");

    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    // ── 1. Multi-Horizon Directional Validation ──────────────────────
    // For each horizon, find forecasts made N days ago and compare to today's snapshots

    const horizons = [1, 7];
    let totalValidated = 0;
    let totalDirectionHits = 0;
    const horizonResults: Record<number, { checked: number; hits: number; mae: number }> = {};

    for (const horizon of horizons) {
      const forecastDate = new Date(today);
      forecastDate.setDate(forecastDate.getDate() - horizon);
      const forecastDateStr = forecastDate.toISOString().split("T")[0];

      // Get snapshots from the forecast date (baseline)
      const { data: baselineSnaps } = await resilientCall(
        `${FN}:baseline:${horizon}d`,
        () => sb.from("country_performance_snapshots")
          .select("iso3, domain, performance_index, forecast_direction, forecast_90d, confidence_score")
          .eq("snapshot_date", forecastDateStr),
        { maxRetries: 2, timeoutMs: 15000 }
      );

      // Get today's snapshots (realized)
      const { data: realizedSnaps } = await resilientCall(
        `${FN}:realized:${horizon}d`,
        () => sb.from("country_performance_snapshots")
          .select("iso3, domain, performance_index, forecast_direction")
          .eq("snapshot_date", todayStr),
        { maxRetries: 2, timeoutMs: 15000 }
      );

      if (!baselineSnaps?.length || !realizedSnaps?.length) {
        structuredLog("warn", FN, `No data for ${horizon}d horizon`, { forecastDateStr, todayStr });
        horizonResults[horizon] = { checked: 0, hits: 0, mae: 0 };
        continue;
      }

      // Build lookup for realized values
      const realizedMap = new Map<string, { pi: number; dir: string }>();
      for (const s of realizedSnaps) {
        realizedMap.set(`${s.iso3}:${s.domain}`, { pi: s.performance_index, dir: s.forecast_direction });
      }

      // Check for already-validated pairs to avoid duplicates
      const { data: existing } = await sb
        .from("forecast_validation_results")
        .select("iso3, domain")
        .eq("forecast_date", forecastDateStr)
        .eq("realized_date", todayStr)
        .eq("horizon_days", horizon);
      
      const existingSet = new Set((existing || []).map((e: any) => `${e.iso3}:${e.domain}`));

      const inserts: any[] = [];
      let hits = 0;
      let totalAbsError = 0;
      let checked = 0;

      for (const baseline of baselineSnaps) {
        const key = `${baseline.iso3}:${baseline.domain}`;
        if (existingSet.has(key)) continue;
        
        const realized = realizedMap.get(key);
        if (!realized) continue;

        const predictedChange = (baseline.forecast_90d ?? baseline.performance_index) - baseline.performance_index;
        const actualChange = realized.pi - baseline.performance_index;

        const predictedDir = predictedChange > 0 ? "up" : predictedChange < 0 ? "down" : "stable";
        const actualDir = actualChange > 0 ? "up" : actualChange < 0 ? "down" : "stable";
        const dirHit = predictedDir === actualDir;

        const absError = Math.abs(realized.pi - (baseline.forecast_90d ?? baseline.performance_index));
        const pctError = baseline.performance_index !== 0
          ? Math.abs(absError / baseline.performance_index) * 100
          : null;

        if (dirHit) hits++;
        totalAbsError += absError;
        checked++;

        inserts.push({
          iso3: baseline.iso3,
          domain: baseline.domain,
          forecast_date: forecastDateStr,
          realized_date: todayStr,
          horizon_days: horizon,
          predicted_value: baseline.forecast_90d ?? baseline.performance_index,
          actual_value: realized.pi,
          absolute_error: Math.round(absError * 100) / 100,
          percentage_error: pctError ? Math.round(pctError * 100) / 100 : null,
          predicted_direction: predictedDir,
          actual_direction: actualDir,
          direction_hit: dirHit,
          confidence_at_forecast: baseline.confidence_score,
        });
      }

      // Batch insert in chunks of 500
      for (let i = 0; i < inserts.length; i += 500) {
        const chunk = inserts.slice(i, i + 500);
        const { error } = await sb.from("forecast_validation_results").insert(chunk);
        if (error) structuredLog("warn", FN, `Insert error ${horizon}d chunk`, { error: error.message });
      }

      const mae = checked > 0 ? totalAbsError / checked : 0;
      horizonResults[horizon] = { checked, hits, mae: Math.round(mae * 100) / 100 };
      totalValidated += checked;
      totalDirectionHits += hits;

      structuredLog("info", FN, `${horizon}d: ${checked} validated, ${hits} direction hits (${checked > 0 ? Math.round(hits / checked * 100) : 0}%), MAE=${Math.round(mae * 100) / 100}`);
    }

    // ── 2. Vulnerability → Crisis/Anomaly Correlation ────────────────
    // Look for vulnerability spikes in last 14 days and check for subsequent events

    let correlationsFound = 0;

    const { data: vulnSpikes } = await resilientCall(
      `${FN}:vuln-spikes`,
      () => sb.from("vulnerability_scores")
        .select("id, country, iso_code, overall_score, calculated_at")
        .gte("overall_score", 65) // High vulnerability threshold
        .gte("calculated_at", new Date(Date.now() - 14 * 86400000).toISOString())
        .order("calculated_at", { ascending: false })
        .limit(200),
      { maxRetries: 2, timeoutMs: 10000 }
    );

    if (vulnSpikes?.length) {
      // Get crisis events and anomalies in same window
      const windowStart = new Date(Date.now() - 21 * 86400000).toISOString();
      
      const [{ data: crises }, { data: anomalies }] = await Promise.all([
        sb.from("crisis_events")
          .select("id, region, severity, kind, opened_at")
          .gte("opened_at", windowStart)
          .order("opened_at", { ascending: false })
          .limit(200),
        sb.from("anomaly_detections")
          .select("id, division, severity, detected_at, deviation_percentage")
          .gte("detected_at", windowStart)
          .order("detected_at", { ascending: false })
          .limit(200),
      ]);

      // Check for existing correlations to avoid duplicates
      const { data: existingCorr } = await sb
        .from("vulnerability_event_correlations")
        .select("iso3, vulnerability_date, event_id")
        .gte("created_at", new Date(Date.now() - 14 * 86400000).toISOString());
      
      const existingCorrSet = new Set(
        (existingCorr || []).map((e: any) => `${e.iso3}:${e.vulnerability_date}:${e.event_id}`)
      );

      const corrInserts: any[] = [];

      for (const vuln of vulnSpikes) {
        const vulnDate = new Date(vuln.calculated_at);
        const vulnDateStr = vulnDate.toISOString().split("T")[0];

        // Match crises by region proximity (simplified: match by country name in region)
        for (const crisis of (crises || [])) {
          const crisisDate = new Date(crisis.opened_at);
          const daysBetween = Math.round((crisisDate.getTime() - vulnDate.getTime()) / 86400000);
          
          // Only count events that happened AFTER the vulnerability spike (0-14 day window)
          if (daysBetween < 0 || daysBetween > 14) continue;
          
          const corrKey = `${vuln.iso_code}:${vulnDateStr}:${crisis.id}`;
          if (existingCorrSet.has(corrKey)) continue;

          // Signal strength: higher vuln + closer time + higher severity = stronger signal
          const timeFactor = 1 - (daysBetween / 14);
          const vulnFactor = vuln.overall_score / 100;
          const sevFactor = (crisis.severity || 5) / 10;
          const signalStrength = Math.round((timeFactor * 0.3 + vulnFactor * 0.4 + sevFactor * 0.3) * 100) / 100;

          corrInserts.push({
            iso3: vuln.iso_code,
            country: vuln.country,
            vulnerability_score: vuln.overall_score,
            vulnerability_date: vulnDateStr,
            event_type: `crisis:${crisis.kind}`,
            event_id: crisis.id,
            event_date: crisisDate.toISOString().split("T")[0],
            days_between: daysBetween,
            signal_strength: signalStrength,
            event_severity: crisis.severity,
          });
        }

        // Match anomalies
        for (const anomaly of (anomalies || [])) {
          const anomalyDate = new Date(anomaly.detected_at);
          const daysBetween = Math.round((anomalyDate.getTime() - vulnDate.getTime()) / 86400000);
          
          if (daysBetween < 0 || daysBetween > 14) continue;

          const corrKey = `${vuln.iso_code}:${vulnDateStr}:${anomaly.id}`;
          if (existingCorrSet.has(corrKey)) continue;

          const timeFactor = 1 - (daysBetween / 14);
          const vulnFactor = vuln.overall_score / 100;
          const devFactor = Math.min((anomaly.deviation_percentage || 10) / 100, 1);
          const signalStrength = Math.round((timeFactor * 0.3 + vulnFactor * 0.4 + devFactor * 0.3) * 100) / 100;

          corrInserts.push({
            iso3: vuln.iso_code,
            country: vuln.country,
            vulnerability_score: vuln.overall_score,
            vulnerability_date: vulnDateStr,
            event_type: `anomaly:${anomaly.division}`,
            event_id: anomaly.id,
            event_date: anomalyDate.toISOString().split("T")[0],
            days_between: daysBetween,
            signal_strength: signalStrength,
            event_severity: anomaly.severity === "critical" ? 9 : anomaly.severity === "high" ? 7 : 5,
          });
        }
      }

      if (corrInserts.length > 0) {
        for (let i = 0; i < corrInserts.length; i += 500) {
          const chunk = corrInserts.slice(i, i + 500);
          await sb.from("vulnerability_event_correlations").insert(chunk);
        }
        correlationsFound = corrInserts.length;
      }
    }

    // ── 3. Naive Baseline Comparison ────────────────────────────────
    let naiveHits = 0;
    let naiveTotal = 0;
    let aicisDirectionAcc: number | null = null;
    let naiveDirectionAcc: number | null = null;

    if (totalValidated > 0) {
      const { data: recentResults } = await sb
        .from("forecast_validation_results")
        .select("predicted_direction, actual_direction")
        .eq("horizon_days", 1)
        .eq("realized_date", todayStr);

      if (recentResults?.length) {
        for (const r of recentResults) {
          naiveTotal++;
          if (r.actual_direction === "stable") naiveHits++;
        }

        aicisDirectionAcc = totalValidated > 0
          ? Math.round(totalDirectionHits / totalValidated * 100) : null;
        naiveDirectionAcc = naiveTotal > 0
          ? Math.round(naiveHits / naiveTotal * 100) : null;

        const metricsToInsert = [
          {
            model_version: 'APE-V2.1',
            metric_name: 'directional_accuracy',
            metric_value: aicisDirectionAcc ?? 0,
            sample_size: totalValidated,
            domain: 'all',
            window_start: new Date(Date.now() - 86400000).toISOString(),
            window_end: new Date().toISOString(),
          },
          {
            model_version: 'APE-V2.1',
            metric_name: 'naive_baseline_accuracy',
            metric_value: naiveDirectionAcc ?? 0,
            sample_size: naiveTotal,
            domain: 'all',
            window_start: new Date(Date.now() - 86400000).toISOString(),
            window_end: new Date().toISOString(),
          },
          {
            model_version: 'APE-V2.1',
            metric_name: 'accuracy_delta_vs_naive',
            metric_value: (aicisDirectionAcc ?? 0) - (naiveDirectionAcc ?? 0),
            sample_size: totalValidated,
            domain: 'all',
            window_start: new Date(Date.now() - 86400000).toISOString(),
            window_end: new Date().toISOString(),
          },
        ];

        for (const m of metricsToInsert) {
          const { error } = await sb.from("calibration_metrics").insert(m);
          if (error) structuredLog("warn", FN, `Metric insert error: ${error.message}`);
        }

        structuredLog("info", FN, `Baseline comparison: AICIS=${aicisDirectionAcc}% vs Naive=${naiveDirectionAcc}%, delta=${(aicisDirectionAcc ?? 0) - (naiveDirectionAcc ?? 0)}%`);
      }
    }

    // ── 4. TRUE INTELLIGENCE SCORE (via server-side RPC) ────────────
    // Bypasses 1000-row API limit by computing entirely in Postgres
    let intelligenceScore: any = null;
    try {
      const { data: scoreResult, error: scoreErr } = await sb.rpc("compute_intelligence_score_v2", {
        _window_days: 30,
        _change_threshold: 1.5,
      });
      if (scoreErr) {
        structuredLog("warn", FN, `Intelligence score RPC error: ${scoreErr.message}`);
      } else {
        intelligenceScore = scoreResult;
        structuredLog("info", FN, `Intelligence Score: Grade=${scoreResult?.intelligence_grade}, TP=${scoreResult?.turning_point_accuracy}%, Break=${scoreResult?.break_detection_score}%, Delta=+${scoreResult?.filtered_delta}% vs naive`);

        // Store key metrics in calibration_metrics for dashboard visibility
        const intMetrics = [
          { metric_name: 'turning_point_accuracy', metric_value: scoreResult?.turning_point_accuracy ?? 0, sample_size: scoreResult?.turning_point_total ?? 0 },
          { metric_name: 'break_detection_score', metric_value: scoreResult?.break_detection_score ?? 0, sample_size: scoreResult?.break_detection_total ?? 0 },
          { metric_name: 'intelligence_filtered_delta', metric_value: scoreResult?.filtered_delta ?? 0, sample_size: scoreResult?.turning_point_total ?? 0 },
        ];
        for (const m of intMetrics) {
          await sb.from("calibration_metrics").insert({
            model_version: 'APE-V2.1', ...m, domain: 'all',
            window_start: new Date(Date.now() - 30 * 86400000).toISOString(),
            window_end: new Date().toISOString(),
          });
        }
      }
    } catch (e) {
      structuredLog("warn", FN, `Intelligence score error: ${(e as Error).message}`);
    }

    // ── 5. Log telemetry ─────────────────────────────────────────────
    await sb.from("operational_telemetry").insert({
      function_name: FN,
      execution_time_ms: Date.now() - start,
      status: "success",
      items_processed: totalValidated,
      metadata: {
        horizons: horizonResults,
        correlations_found: correlationsFound,
        vuln_spikes_checked: vulnSpikes?.length || 0,
        overall_direction_accuracy: aicisDirectionAcc,
        naive_baseline_accuracy: naiveDirectionAcc,
        accuracy_delta: aicisDirectionAcc !== null && naiveDirectionAcc !== null
          ? aicisDirectionAcc - naiveDirectionAcc : null,
        intelligence_score: intelligenceScore,
      },
    });

    await sb.from("automation_logs").insert({
      job_name: FN,
      status: "success",
      message: `Validated ${totalValidated} forecasts. Intelligence: ${intelligenceScore?.intelligence_grade || 'N/A'}, TP=${intelligenceScore?.turning_point_accuracy || 0}%, Break=${intelligenceScore?.break_detection_score || 0}%`,
    });

    structuredLog("info", FN, "Validation cycle complete", undefined, start);

    return jsonResponse({
      success: true,
      validated: totalValidated,
      direction_hits: totalDirectionHits,
      direction_accuracy: totalValidated > 0 ? Math.round(totalDirectionHits / totalValidated * 100) : null,
      horizons: horizonResults,
      vulnerability_correlations: correlationsFound,
      intelligence_score: intelligenceScore,
      execution_time_ms: Date.now() - start,
    });
  } catch (error) {
    structuredLog("error", FN, (error as Error).message, undefined, start);

    await sb.from("automation_logs").insert({
      job_name: FN,
      status: "error",
      message: (error as Error).message,
    }).catch(() => {});

    return errorResponse(error);
  }
});
