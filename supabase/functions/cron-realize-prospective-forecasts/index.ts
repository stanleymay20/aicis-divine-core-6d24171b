import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { structuredLog, handleCors, errorResponse, jsonResponse } from "../_shared/resilience.ts";

const FN = "cron-realize-prospective-forecasts";
const BATCH_SIZE = 500;

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    structuredLog("info", FN, "Starting prospective forecast realization");

    // Fetch pending evaluations: due and not locked
    const { data: pending, error: fetchErr } = await supabase
      .from("forecast_prospective_evaluations")
      .select("id, domain, iso3, predicted_value, predicted_direction, realization_due_at, horizon_days, model_version")
      .eq("evaluation_locked", false)
      .lte("realization_due_at", new Date().toISOString())
      .order("realization_due_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchErr) throw fetchErr;

    if (!pending || pending.length === 0) {
      structuredLog("info", FN, "No pending forecasts to realize");
      return jsonResponse({ ok: true, realized: 0, missing: 0, skipped: 0 });
    }

    structuredLog("info", FN, `Found ${pending.length} pending forecasts`);

    let realized = 0;
    let missing = 0;
    let errors = 0;

    for (const forecast of pending) {
      try {
        // Find closest actual metric value to realization_due_at
        const dueDate = new Date(forecast.realization_due_at);
        const windowStart = new Date(dueDate.getTime() - 7 * 86400000).toISOString();
        const windowEnd = new Date(dueDate.getTime() + 7 * 86400000).toISOString();

        const { data: actuals, error: metricErr } = await supabase
          .from("normalized_metrics")
          .select("value, period, created_at")
          .eq("domain", forecast.domain)
          .eq("iso3", forecast.iso3)
          .gte("created_at", windowStart)
          .lte("created_at", windowEnd)
          .order("created_at", { ascending: false })
          .limit(5);

        if (metricErr) {
          structuredLog("warn", FN, `Metric fetch error for ${forecast.id}`, { error: metricErr.message });
          errors++;
          continue;
        }

        if (!actuals || actuals.length === 0) {
          // Mark as missing actual data
          await supabase
            .from("forecast_prospective_evaluations")
            .update({
              metadata: {
                status: "missing_actual",
                searched_window: { start: windowStart, end: windowEnd },
                checked_at: new Date().toISOString(),
              },
            })
            .eq("id", forecast.id)
            .eq("evaluation_locked", false); // safety: never touch locked

          missing++;
          continue;
        }

        // Use the closest actual value
        const actual = actuals[0];
        const actualValue = Number(actual.value);

        if (isNaN(actualValue)) {
          missing++;
          continue;
        }

        // Compute realized direction
        const predictedVal = Number(forecast.predicted_value);
        const diff = actualValue - predictedVal;
        const threshold = Math.abs(predictedVal) * 0.01; // 1% change threshold
        const realizedDirection =
          Math.abs(diff) < threshold ? "stable" :
          diff > 0 ? "increasing" : "decreasing";

        // The trigger will auto-compute: direction_hit, absolute_error, evaluation_locked=true
        const { error: updateErr } = await supabase
          .from("forecast_prospective_evaluations")
          .update({
            realized_value: actualValue,
            realized_direction: realizedDirection,
            realized_at: new Date().toISOString(),
            metadata: {
              status: "realized",
              actual_source: "normalized_metrics",
              actual_period: actual.period,
              actual_created_at: actual.created_at,
              realization_engine: FN,
              realized_by_cron_at: new Date().toISOString(),
              forecast_id: forecast.id,
              predicted_value: predictedVal,
              realized_value: actualValue,
              error: Math.abs(actualValue - predictedVal),
              model_version: forecast.model_version,
            },
          })
          .eq("id", forecast.id)
          .eq("evaluation_locked", false); // safety guard

        if (updateErr) {
          structuredLog("warn", FN, `Update error for ${forecast.id}`, { error: updateErr.message });
          errors++;
        } else {
          realized++;
        }
      } catch (rowErr) {
        structuredLog("warn", FN, `Row error: ${(rowErr as Error).message}`);
        errors++;
      }
    }

    // Log summary
    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: errors > 0 ? "warning" : "success",
      message: `Realized: ${realized}, Missing: ${missing}, Errors: ${errors}, Batch: ${pending.length}`,
    });

    structuredLog("info", FN, `Complete: realized=${realized} missing=${missing} errors=${errors}`, undefined, start);

    return jsonResponse({
      ok: true,
      realized,
      missing,
      errors,
      batch_size: pending.length,
      duration_ms: Date.now() - start,
    });
  } catch (e) {
    structuredLog("error", FN, (e as Error).message, undefined, start);
    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: "error",
      message: (e as Error).message,
    });
    return errorResponse(e);
  }
});
