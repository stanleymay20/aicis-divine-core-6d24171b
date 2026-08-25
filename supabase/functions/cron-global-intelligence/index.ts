import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { structuredLog, handleCors, errorResponse, jsonResponse, corsHeaders } from "../_shared/resilience.ts";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { invokeInternalFunction } from "../_shared/internal-invoke.ts";

const FN = "cron-global-intelligence";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    structuredLog("info", FN, "Starting global data collection cycle");
    const results: Record<string, unknown> = {};
    const errors: string[] = [];

    const functions = [
      "fetch-finance-global",
      "fetch-security-global",
      "fetch-health-global",
      "fetch-food-global",
      "fetch-governance-global",
    ];

    await Promise.all(functions.map(async (functionName) => {
      const result = await invokeInternalFunction(functionName, {}, 45_000);
      if (result.ok) {
        results[functionName] = result.data;
      } else {
        errors.push(`${functionName}: ${result.error ?? `HTTP ${result.status}`}`);
      }
    }));

    const vulnerability = await invokeInternalFunction("calculate-vulnerability", {}, 15_000);
    if (!vulnerability.ok) {
      structuredLog("warn", FN, `Vulnerability calculation failed: ${vulnerability.error ?? vulnerability.status}`);
    }

    const freshnessChecks = [
      { table: "normalized_metrics", label: "Metrics" },
      { table: "normalized_events", label: "Events" },
      { table: "country_performance_snapshots", label: "Snapshots" },
      { table: "crisis_events", label: "Crisis" },
    ];

    for (const check of freshnessChecks) {
      try {
        const { data, error } = await supabase
          .from(check.table)
          .select("created_at")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;

        const lastInsert = data?.created_at ? new Date(data.created_at) : null;
        const hoursAgo = lastInsert ? (Date.now() - lastInsert.getTime()) / 3_600_000 : null;

        if (hoursAgo == null || hoursAgo > 48) {
          const ageLabel = hoursAgo == null ? "no records observed" : `${Math.round(hoursAgo)}h stale`;
          const message = `STALE: ${check.label} (${check.table}) — ${ageLabel}`;
          structuredLog("warn", FN, message);
          await supabase.from("alerts").insert({
            title: `Data Freshness Alert: ${check.label}`,
            message,
            severity: hoursAgo == null || hoursAgo > 168 ? "critical" : "high",
            division: "system",
            metadata: {
              type: "freshness_guardrail",
              table: check.table,
              hours_stale: hoursAgo == null ? null : Math.round(hoursAgo),
            },
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        structuredLog("warn", FN, `Freshness check failed for ${check.table}: ${message}`);
      }
    }

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: errors.length === 0 ? "success" : "partial",
      message: `Global collection done. ${Object.keys(results).length} OK, ${errors.length} errors. ${errors.slice(0, 3).join("; ")}`.slice(0, 500),
    });

    structuredLog("info", FN, `Complete. Errors: ${errors.length}`);
    return jsonResponse({ ok: true, results, errors });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    structuredLog("error", FN, message);
    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: "error",
      message,
    });
    return errorResponse(error);
  }
});
