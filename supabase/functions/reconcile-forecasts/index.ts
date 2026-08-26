import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, errorResponse, jsonResponse } from "../_shared/resilience.ts";

const FN = "reconcile-forecasts";

// SHA-256 hash utility
async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req);
  if (callerAuth.response) return callerAuth.response;

  const cors = handleCors(req);
  if (cors) return cors;

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    structuredLog("info", FN, "Starting forecast reconciliation");

    // Check kill-switch
    const { data: freezeFlag } = await supabase
      .from("system_flags")
      .select("enabled")
      .eq("flag_key", "freeze_forecasts")
      .limit(1);
    if (freezeFlag?.[0]?.enabled) {
      structuredLog("warn", FN, "Forecasts frozen by kill-switch, skipping reconciliation");
      return jsonResponse({ success: true, message: "System frozen by kill-switch" });
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    const { data: expiredForecasts, error: fetchErr } = await resilientCall(
      `${FN}:fetch-expired`,
      async () => {
        const { data, error } = await supabase
          .from("forecast_archive")
          .select("id, iso3, domain, model_version, performance_index, forecast_90d, forecast_upper_80, forecast_lower_80, forecast_upper_95, forecast_lower_95, confidence_score, created_at")
          .lt("created_at", cutoff.toISOString())
          .limit(200);
        if (error) throw error;
        return { data, error };
      },
      { maxRetries: 2, timeoutMs: 15000 }
    );

    if (fetchErr || !expiredForecasts) {
      throw new Error(`Failed to fetch expired forecasts: ${fetchErr}`);
    }

    const forecastIds = expiredForecasts.map((f: any) => f.id);
    const { data: existing } = await supabase
      .from("forecast_outcomes")
      .select("forecast_archive_id")
      .in("forecast_archive_id", forecastIds.length > 0 ? forecastIds : ["__none__"]);

    const reconciledSet = new Set((existing || []).map((e: any) => e.forecast_archive_id));
    const unreconciled = expiredForecasts.filter((f: any) => !reconciledSet.has(f.id));

    structuredLog("info", FN, `Found ${unreconciled.length} unreconciled forecasts`);

    let reconciled = 0;
    const errors: string[] = [];
    const residualsToInsert: any[] = [];

    for (const forecast of unreconciled) {
      try {
        const { data: latestSnap } = await supabase
          .from("country_performance_snapshots")
          .select("performance_index, snapshot_date")
          .eq("iso3", forecast.iso3)
          .eq("domain", forecast.domain)
          .order("snapshot_date", { ascending: false })
          .limit(1);

        if (!latestSnap || latestSnap.length === 0) continue;

        const realized = latestSnap[0].performance_index;
        const predicted = forecast.forecast_90d;
        if (predicted === null || predicted === undefined) continue;

        const absoluteError = Math.abs(realized - predicted);
        const squaredError = (realized - predicted) ** 2;
        const bias = realized - predicted;
        const inside80 = realized >= (forecast.forecast_lower_80 ?? -Infinity) &&
                         realized <= (forecast.forecast_upper_80 ?? Infinity);
        const inside95 = realized >= (forecast.forecast_lower_95 ?? -Infinity) &&
                         realized <= (forecast.forecast_upper_95 ?? Infinity);

        const { error: insertErr } = await supabase
          .from("forecast_outcomes")
          .insert({
            forecast_archive_id: forecast.id,
            realized_value: realized,
            realized_date: latestSnap[0].snapshot_date,
            absolute_error: Math.round(absoluteError * 100) / 100,
            squared_error: Math.round(squaredError * 100) / 100,
            inside_80_band: inside80,
            inside_95_band: inside95,
            bias: Math.round(bias * 100) / 100,
          });

        if (insertErr) {
          if (insertErr.code === "23505") continue;
          errors.push(`${forecast.iso3}/${forecast.domain}: ${insertErr.message}`);
        } else {
          reconciled++;
          // Compute age for decay weighting
          const forecastAge = Math.round((Date.now() - new Date(forecast.created_at).getTime()) / 86400000);
          residualsToInsert.push({
            model_version: forecast.model_version || "APE-V2.1",
            domain: forecast.domain,
            iso3: forecast.iso3,
            residual: Math.round(bias * 100) / 100,
            predicted_value: predicted,
            realized_value: realized,
            horizon_days: 90,
            decay_weight: Math.round(Math.exp(-0.01 * forecastAge) * 10000) / 10000,
            regime_flag: "normal",
          });
        }
      } catch (err) {
        errors.push(`${forecast.iso3}/${forecast.domain}: ${(err as Error).message}`);
      }
    }

    // Batch insert residuals
    if (residualsToInsert.length > 0) {
      await supabase.from("forecast_residuals").insert(residualsToInsert);
    }

    // Compute aggregate calibration metrics
    const { data: allOutcomes } = await supabase
      .from("forecast_outcomes")
      .select("absolute_error, squared_error, inside_80_band, inside_95_band, bias, realized_value, forecast_archive_id");

    const { data: archiveConfidences } = await supabase
      .from("forecast_archive")
      .select("id, confidence_score")
      .limit(1000);
    const confidenceMap = new Map((archiveConfidences || []).map((a: any) => [a.id, a.confidence_score]));

    if (allOutcomes && allOutcomes.length > 0) {
      const n = allOutcomes.length;
      const mae = allOutcomes.reduce((s: number, o: any) => s + (o.absolute_error || 0), 0) / n;
      const mse = allOutcomes.reduce((s: number, o: any) => s + (o.squared_error || 0), 0) / n;
      const rmse = Math.sqrt(mse);
      const avgBias = allOutcomes.reduce((s: number, o: any) => s + (o.bias || 0), 0) / n;
      const hit80 = allOutcomes.filter((o: any) => o.inside_80_band).length / n;
      const hit95 = allOutcomes.filter((o: any) => o.inside_95_band).length / n;

      const mapeOutcomes = allOutcomes.filter((o: any) => o.realized_value && Math.abs(o.realized_value) > 0.01);
      const mape = mapeOutcomes.length > 0
        ? mapeOutcomes.reduce((s: number, o: any) => s + Math.abs(o.absolute_error / o.realized_value), 0) / mapeOutcomes.length * 100
        : 0;

      const realizedValues = allOutcomes.map((o: any) => o.realized_value).filter((v: any) => v != null);
      const realizedRange = realizedValues.length > 1
        ? Math.max(...realizedValues) - Math.min(...realizedValues) : 1;
      const nrmse = realizedRange > 0 ? rmse / realizedRange : 0;

      // Platt calibration fitting
      let plattA = -1, plattB = 0, plattFitted = false;
      if (allOutcomes.length >= 20) {
        const predictedConfs: number[] = [];
        const actualHits: boolean[] = [];
        for (const o of allOutcomes) {
          const conf = confidenceMap.get(o.forecast_archive_id);
          if (conf !== undefined) {
            predictedConfs.push(conf / 100);
            actualHits.push(!!o.inside_80_band);
          }
        }
        if (predictedConfs.length >= 20) {
          const prior1 = actualHits.filter(h => h).length;
          const prior0 = predictedConfs.length - prior1;
          const hiTarget = (prior1 + 1) / (prior1 + 2);
          const loTarget = 1 / (prior0 + 2);
          const t = actualHits.map(h => h ? hiTarget : loTarget);
          let a = 0, b = Math.log((prior0 + 1) / (prior1 + 1));
          for (let iter = 0; iter < 50; iter++) {
            let h11 = 1e-12, h22 = 1e-12, h21 = 0, g1 = 0, g2 = 0;
            for (let i = 0; i < predictedConfs.length; i++) {
              const fApB = a * predictedConfs[i] + b;
              const p = fApB >= 0 ? Math.exp(-fApB) / (1 + Math.exp(-fApB)) : 1 / (1 + Math.exp(fApB));
              const q = 1 - p;
              const d2 = p * q;
              h11 += predictedConfs[i] * predictedConfs[i] * d2;
              h22 += d2;
              h21 += predictedConfs[i] * d2;
              g1 += predictedConfs[i] * (t[i] - p);
              g2 += t[i] - p;
            }
            if (Math.abs(g1) < 1e-5 && Math.abs(g2) < 1e-5) break;
            const det = h11 * h22 - h21 * h21;
            if (Math.abs(det) < 1e-15) break;
            a += -(h22 * g1 - h21 * g2) / det;
            b += -(-h21 * g1 + h11 * g2) / det;
          }
          plattA = a;
          plattB = b;
          plattFitted = true;
        }
      }

      // Upsert calibration metrics
      const metricsList = [
        { metric_name: "mae", metric_value: Math.round(mae * 100) / 100 },
        { metric_name: "rmse", metric_value: Math.round(rmse * 100) / 100 },
        { metric_name: "nrmse", metric_value: Math.round(nrmse * 1000) / 1000 },
        { metric_name: "mape", metric_value: Math.round(mape * 100) / 100 },
        { metric_name: "avg_bias", metric_value: Math.round(avgBias * 100) / 100 },
        { metric_name: "hit_rate_80", metric_value: Math.round(hit80 * 1000) / 1000 },
        { metric_name: "hit_rate_95", metric_value: Math.round(hit95 * 1000) / 1000 },
      ];

      for (const m of metricsList) {
        await supabase.from("calibration_metrics").upsert({
          model_version: "APE-V2.1",
          metric_name: m.metric_name,
          metric_value: m.metric_value,
          sample_size: n,
          computed_at: new Date().toISOString(),
          calibration_params: plattFitted ? { a: plattA, b: plattB } : null,
        }, { onConflict: "model_version,metric_name" }).select();
      }

      // Upsert calibration profile (respect lock)
      if (plattFitted) {
        const { data: existingProfile } = await supabase
          .from("model_calibration_profiles")
          .select("id, status, locked_until")
          .eq("model_version", "APE-V2.1")
          .eq("status", "active")
          .limit(1);

        const isLocked = existingProfile?.[0]?.locked_until &&
          new Date(existingProfile[0].locked_until) > new Date();

        if (!isLocked) {
          await supabase.from("model_calibration_profiles").upsert({
            id: existingProfile?.[0]?.id || undefined,
            model_version: "APE-V2.1",
            platt_a: plattA,
            platt_b: plattB,
            sample_size: n,
            fitted_at: new Date().toISOString(),
            status: "active",
          }, { onConflict: "model_version" }).select();
        }
      }

      // === AUDIT HASH: cryptographic verification of residual dataset ===
      const { data: allResiduals } = await supabase
        .from("forecast_residuals")
        .select("residual, domain, iso3, horizon_days")
        .eq("model_version", "APE-V2.1")
        .order("created_at", { ascending: true })
        .limit(5000);

      if (allResiduals && allResiduals.length > 0) {
        const residualString = JSON.stringify(allResiduals);
        const hash = await sha256(residualString);

        await supabase.from("calibration_audit_hashes").insert({
          model_version: "APE-V2.1",
          residual_sample_hash: hash,
          residual_count: allResiduals.length,
          hash_algorithm: "SHA-256",
          metadata: {
            platt_a: plattA,
            platt_b: plattB,
            sample_size: n,
            mae, rmse, hit80, hit95,
          },
        });
      }
    }

    // Log telemetry
    await supabase.from("operational_telemetry").insert({
      function_name: FN,
      execution_time_ms: Date.now() - start,
      status: "success",
      items_processed: reconciled,
      metadata: { total_checked: unreconciled.length, errors: errors.length, residuals_stored: residualsToInsert.length },
    });

    structuredLog("info", FN, `Reconciled ${reconciled} forecasts, stored ${residualsToInsert.length} residuals`, undefined, start);
    return jsonResponse({ success: true, reconciled, checked: unreconciled.length, errors: errors.length, residuals: residualsToInsert.length });
  } catch (error) {
    structuredLog("error", FN, (error as Error).message, undefined, start);
    return errorResponse(error);
  }
});
