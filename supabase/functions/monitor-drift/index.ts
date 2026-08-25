import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, structuredLog, jsonResponse, errorResponse } from "../_shared/resilience.ts";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "monitor-drift";
const EWMA_LAMBDA = 0.2;
const SPC_WINDOW = 30;
const MONITORED_MODEL_VERSION = "APE-V2.1";

interface CalibrationMetricRow {
  metric_name: string;
  metric_value: number;
  computed_at: string;
}

interface SpcObservation {
  metric_name: string;
  model_version: string;
  observed_value: number;
  ewma_value: number;
  rolling_mean: number;
  rolling_std: number;
  upper_control: number;
  lower_control: number;
  out_of_control: boolean;
}

interface DriftAlert {
  alert_type: string;
  model_version: string;
  metric_name: string;
  current_value: number;
  baseline_value: number;
  deviation_pct: number;
  severity: "warning" | "critical";
  details: Record<string, unknown>;
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const auth = await requireAdminOrCron(req);
  if (auth.response) return auth.response;

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    structuredLog("info", FN, "Starting SPC-based drift monitoring");

    const { data: metrics, error: metricsError } = await supabase
      .from("calibration_metrics")
      .select("metric_name, metric_value, computed_at")
      .order("computed_at", { ascending: false })
      .limit(200);
    if (metricsError) throw metricsError;

    const metricRows = (metrics ?? []) as CalibrationMetricRow[];
    if (metricRows.length === 0) {
      return jsonResponse({ success: true, message: "No calibration metrics to monitor", authenticated_via: auth.via });
    }

    const byMetric: Record<string, number[]> = {};
    const latestValues: Record<string, number> = {};
    for (const metric of metricRows) {
      const value = Number(metric.metric_value);
      if (!Number.isFinite(value)) continue;
      if (!byMetric[metric.metric_name]) {
        byMetric[metric.metric_name] = [];
        latestValues[metric.metric_name] = value;
      }
      byMetric[metric.metric_name].push(value);
    }

    const alerts: DriftAlert[] = [];
    const spcObservations: SpcObservation[] = [];
    const killSwitchReasons: string[] = [];
    const keyMetrics = ["rmse", "mape", "hit_rate_80", "hit_rate_95", "avg_bias"];

    for (const metricName of keyMetrics) {
      const history = byMetric[metricName];
      if (!history || history.length < 5) continue;

      const currentValue = latestValues[metricName];
      const window = history.slice(0, SPC_WINDOW);
      const rollingMean = window.reduce((sum, value) => sum + value, 0) / window.length;
      const variance = window.reduce((sum, value) => sum + (value - rollingMean) ** 2, 0) / window.length;
      const rollingStd = Math.sqrt(variance);

      let ewma = window[window.length - 1];
      for (let index = window.length - 2; index >= 0; index--) {
        ewma = EWMA_LAMBDA * window[index] + (1 - EWMA_LAMBDA) * ewma;
      }

      const upperControl = rollingMean + 3 * rollingStd;
      const lowerControl = rollingMean - 3 * rollingStd;
      const outOfControl = rollingStd > 0 && (currentValue > upperControl || currentValue < lowerControl);

      spcObservations.push({
        metric_name: metricName,
        model_version: MONITORED_MODEL_VERSION,
        observed_value: currentValue,
        ewma_value: Math.round(ewma * 10000) / 10000,
        rolling_mean: Math.round(rollingMean * 10000) / 10000,
        rolling_std: Math.round(rollingStd * 10000) / 10000,
        upper_control: Math.round(upperControl * 10000) / 10000,
        lower_control: Math.round(lowerControl * 10000) / 10000,
        out_of_control: outOfControl,
      });

      if (outOfControl) {
        const deviationPct = rollingMean === 0
          ? 0
          : Math.round((Math.abs(currentValue - rollingMean) / Math.abs(rollingMean)) * 10000) / 100;
        alerts.push({
          alert_type: `spc_${metricName}`,
          model_version: MONITORED_MODEL_VERSION,
          metric_name: metricName,
          current_value: currentValue,
          baseline_value: rollingMean,
          deviation_pct: deviationPct,
          severity: metricName === "rmse" || metricName === "hit_rate_80" ? "critical" : "warning",
          details: {
            message: `${metricName} is outside its empirical 3σ control band`,
            ewma,
            lower_control: lowerControl,
            upper_control: upperControl,
            control_type: "EWMA_3sigma",
            sample_size: window.length,
          },
        });
        if (metricName === "rmse") killSwitchReasons.push("RMSE beyond empirical 3σ control band");
      }

      if (metricName === "hit_rate_80" && currentValue < 0.60) {
        killSwitchReasons.push(`Hit80 at ${(currentValue * 100).toFixed(1)}%, below the configured 60% safety threshold`);
      }

      if (metricName === "hit_rate_80" && rollingMean > 0) {
        const divergence = Math.abs(ewma - rollingMean) / rollingMean;
        if (divergence > 0.25) {
          killSwitchReasons.push(`Calibration EWMA divergence ${(divergence * 100).toFixed(1)}% exceeds the configured 25% threshold`);
        }
      }
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const [{ count: recentBreaks }, { count: totalRecent }] = await Promise.all([
      supabase.from("forecast_archive").select("id", { count: "exact", head: true })
        .eq("structural_break_flag", true).gte("created_at", sevenDaysAgo),
      supabase.from("forecast_archive").select("id", { count: "exact", head: true })
        .gte("created_at", sevenDaysAgo),
    ]);

    if ((totalRecent ?? 0) > 10 && (recentBreaks ?? 0) > 0) {
      const breakRate = (recentBreaks ?? 0) / (totalRecent ?? 1);
      if (breakRate > 0.60) {
        killSwitchReasons.push(`Structural-break rate ${(breakRate * 100).toFixed(0)}% exceeds the configured 60% safety threshold`);
      }
      if (breakRate > 0.30) {
        const breakPercent = breakRate * 100;
        alerts.push({
          alert_type: "break_frequency",
          model_version: MONITORED_MODEL_VERSION,
          metric_name: "structural_break_rate",
          current_value: Math.round(breakPercent * 100) / 100,
          baseline_value: 30,
          deviation_pct: Math.round(((breakPercent - 30) / 30) * 10000) / 100,
          severity: breakRate > 0.50 ? "critical" : "warning",
          details: {
            message: `${recentBreaks}/${totalRecent} recent forecasts have structural-break flags`,
            alert_threshold_pct: 30,
            kill_switch_threshold_pct: 60,
          },
        });
      }
    }

    if (spcObservations.length > 0) {
      const { error } = await supabase.from("spc_control_observations").insert(spcObservations);
      if (error) throw error;
    }

    if (killSwitchReasons.length > 0) {
      structuredLog("error", FN, `KILL-SWITCH triggered: ${killSwitchReasons.join("; ")}`);
      const { error: flagError } = await supabase.from("system_flags")
        .update({ enabled: true })
        .eq("flag_key", "freeze_forecasts");
      if (flagError) throw flagError;

      alerts.push({
        alert_type: "kill_switch_activated",
        model_version: MONITORED_MODEL_VERSION,
        metric_name: "system_freeze",
        current_value: killSwitchReasons.length,
        baseline_value: 0,
        deviation_pct: 0,
        severity: "critical",
        details: {
          message: "Automatic forecast freeze activated by configured safety policy",
          reasons: killSwitchReasons,
        },
      });
    }

    let inserted = 0;
    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
    for (const alert of alerts) {
      const { data: existing, error: existingError } = await supabase
        .from("drift_alerts")
        .select("id")
        .eq("alert_type", alert.alert_type)
        .eq("acknowledged", false)
        .gte("created_at", oneDayAgo)
        .limit(1);
      if (existingError) throw existingError;
      if (!existing || existing.length === 0) {
        const { error: insertError } = await supabase.from("drift_alerts").insert(alert);
        if (insertError) throw insertError;
        inserted++;
      }
    }

    await supabase.from("operational_telemetry").insert({
      function_name: FN,
      execution_time_ms: Date.now() - start,
      status: "success",
      items_processed: spcObservations.length,
      metadata: {
        alerts_found: alerts.length,
        alerts_inserted: inserted,
        spc_observations: spcObservations.length,
        kill_switch: killSwitchReasons.length > 0,
        kill_reasons: killSwitchReasons,
        authenticated_via: auth.via,
      },
    });

    structuredLog(
      "info",
      FN,
      `SPC check complete: ${spcObservations.length} observations, ${alerts.length} alerts, kill=${killSwitchReasons.length > 0}`,
      undefined,
      start,
    );
    return jsonResponse({
      success: true,
      spc_observations: spcObservations.length,
      alerts_found: alerts.length,
      alerts_inserted: inserted,
      kill_switch_activated: killSwitchReasons.length > 0,
      kill_reasons: killSwitchReasons,
      authenticated_via: auth.via,
    });
  } catch (error) {
    structuredLog("error", FN, error instanceof Error ? error.message : String(error), undefined, start);
    return errorResponse(error);
  }
});
