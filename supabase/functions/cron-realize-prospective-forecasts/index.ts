import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { structuredLog, handleCors, errorResponse, jsonResponse, corsHeaders } from "../_shared/resilience.ts";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "cron-realize-prospective-forecasts";
const BATCH_SIZE = 500;

interface DomainPolicy {
  domain: string;
  match_window_days: number;
  direction_threshold_pct: number;
  preferred_period_type: string | null;
  is_active: boolean;
}

const DEFAULT_POLICY: Omit<DomainPolicy, "domain"> = {
  match_window_days: 7,
  direction_threshold_pct: 1.0,
  preferred_period_type: null,
  is_active: true,
};

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    structuredLog("info", FN, "Starting prospective forecast realization");

    const { data: policies, error: policyError } = await supabase
      .from("forecast_domain_match_policies")
      .select("domain,match_window_days,direction_threshold_pct,preferred_period_type,is_active")
      .eq("is_active", true);
    if (policyError) throw policyError;

    const policyMap = new Map<string, DomainPolicy>();
    for (const policy of (policies ?? []) as DomainPolicy[]) {
      policyMap.set(policy.domain, policy);
    }
    structuredLog("info", FN, `Loaded ${policyMap.size} domain policies`);

    const { data: pending, error: fetchErr } = await supabase
      .from("forecast_prospective_evaluations")
      .select("id,domain,iso3,predicted_value,predicted_direction,realization_due_at,horizon_days,model_version")
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
    let policyUsed = 0;
    let fallbackUsed = 0;

    for (const forecast of pending) {
      try {
        const policy = policyMap.get(forecast.domain);
        const windowDays = policy?.match_window_days ?? DEFAULT_POLICY.match_window_days;
        const thresholdPct = policy?.direction_threshold_pct ?? DEFAULT_POLICY.direction_threshold_pct;
        const policyStatus = policy ? "domain_policy" : "default_fallback";

        if (policy) policyUsed += 1;
        else fallbackUsed += 1;

        const dueDate = new Date(forecast.realization_due_at);
        const windowStart = new Date(dueDate.getTime() - windowDays * 86_400_000).toISOString();
        const windowEnd = new Date(dueDate.getTime() + windowDays * 86_400_000).toISOString();

        const { data: actuals, error: metricErr } = await supabase
          .from("normalized_metrics")
          .select("value,period,created_at")
          .eq("domain", forecast.domain)
          .eq("iso3", forecast.iso3)
          .gte("created_at", windowStart)
          .lte("created_at", windowEnd)
          .order("created_at", { ascending: false })
          .limit(5);

        if (metricErr) {
          structuredLog("warn", FN, `Metric fetch error for ${forecast.id}`, { error: metricErr.message });
          errors += 1;
          continue;
        }

        if (!actuals || actuals.length === 0) {
          await supabase
            .from("forecast_prospective_evaluations")
            .update({
              metadata: {
                status: "missing_actual",
                searched_window: { start: windowStart, end: windowEnd },
                checked_at: new Date().toISOString(),
                policy_status: policyStatus,
                match_window_days: windowDays,
              },
            })
            .eq("id", forecast.id)
            .eq("evaluation_locked", false);
          missing += 1;
          continue;
        }

        const actual = actuals[0];
        const actualValue = Number(actual.value);
        if (!Number.isFinite(actualValue)) {
          missing += 1;
          continue;
        }

        const predictedValue = Number(forecast.predicted_value);
        if (!Number.isFinite(predictedValue)) {
          structuredLog("warn", FN, `Invalid predicted value for ${forecast.id}`);
          errors += 1;
          continue;
        }

        const diff = actualValue - predictedValue;
        const threshold = Math.abs(predictedValue) * (thresholdPct / 100);
        const realizedDirection = Math.abs(diff) < threshold
          ? "stable"
          : diff > 0
            ? "increasing"
            : "decreasing";

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
              predicted_value: predictedValue,
              realized_value: actualValue,
              error: Math.abs(actualValue - predictedValue),
              model_version: forecast.model_version,
              policy_status: policyStatus,
              match_window_days: windowDays,
              direction_threshold_pct: thresholdPct,
            },
          })
          .eq("id", forecast.id)
          .eq("evaluation_locked", false);

        if (updateErr) {
          structuredLog("warn", FN, `Update error for ${forecast.id}`, { error: updateErr.message });
          errors += 1;
        } else {
          realized += 1;
        }
      } catch (rowError) {
        const message = rowError instanceof Error ? rowError.message : String(rowError);
        structuredLog("warn", FN, `Row error: ${message}`);
        errors += 1;
      }
    }

    if (fallbackUsed > 0 && pending.length >= 10) {
      const fallbackRate = (fallbackUsed / pending.length) * 100;
      if (fallbackRate > 30) {
        await supabase.from("alerts").insert({
          severity: "medium",
          title: "High fallback rate in forecast realization",
          message: `${fallbackRate.toFixed(0)}% of realized forecasts used default fallback policy (${fallbackUsed}/${pending.length}). Consider adding domain-specific match policies.`,
          division: "forecast-validation",
        });
      }
    }

    if (missing > 0 && pending.length >= 5) {
      const missingRate = (missing / pending.length) * 100;
      if (missingRate > 50) {
        await supabase.from("alerts").insert({
          severity: "high",
          title: "High missing_actual rate in prospective realization",
          message: `${missingRate.toFixed(0)}% of due forecasts had no matching actual data (${missing}/${pending.length}).`,
          division: "forecast-validation",
        });
      }
    }

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: errors > 0 ? "warning" : "success",
      message: `Realized: ${realized}, Missing: ${missing}, Errors: ${errors}, Policy: ${policyUsed}, Fallback: ${fallbackUsed}, Batch: ${pending.length}`,
    });

    structuredLog(
      "info",
      FN,
      `Complete: realized=${realized} missing=${missing} errors=${errors} policy=${policyUsed} fallback=${fallbackUsed}`,
      undefined,
      start,
    );

    return jsonResponse({
      ok: true,
      realized,
      missing,
      errors,
      policy_used: policyUsed,
      fallback_used: fallbackUsed,
      batch_size: pending.length,
      duration_ms: Date.now() - start,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    structuredLog("error", FN, message, undefined, start);
    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: "error",
      message,
    });
    return errorResponse(error);
  }
});
