import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function retryCall<T>(fn: () => Promise<T> | PromiseLike<T>, retries = 2, baseMs = 400): Promise<T> {
  let last: Error | undefined;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e));
      if (i < retries) await new Promise((resolve) => setTimeout(resolve, baseMs * Math.pow(2, i)));
    }
  }
  throw last;
}

interface CircuitState {
  failures: number;
  lastFailure: number;
  open: boolean;
}

const circuits = new Map<string, CircuitState>();

function isCircuitOpen(key: string): boolean {
  const state = circuits.get(key);
  if (!state?.open) return false;
  if (Date.now() - state.lastFailure > 60_000) {
    state.open = false;
    state.failures = 0;
    return false;
  }
  return true;
}

function recordResult(key: string, ok: boolean): void {
  if (ok) {
    circuits.set(key, { failures: 0, lastFailure: 0, open: false });
    return;
  }
  const state = circuits.get(key) || { failures: 0, lastFailure: 0, open: false };
  state.failures++;
  state.lastFailure = Date.now();
  if (state.failures >= 3) state.open = true;
  circuits.set(key, state);
}

function log(level: string, msg: string, meta?: Record<string, unknown>) {
  const entry = {
    level,
    function: "aicis-self-heal",
    message: msg,
    timestamp: new Date().toISOString(),
    ...meta,
  };
  if (level === "error") console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "POST" },
    });
  }

  const { response: authResponse } = await requireAdminOrCron(req, corsHeaders);
  if (authResponse) return authResponse;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: lastCheck } = await retryCall(() =>
      Promise.resolve(
        supabase
          .from("diagnostics_log")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ).then((result) => {
        if (result.error) throw result.error;
        return result;
      }),
    );

    if (!lastCheck || lastCheck.status === "healthy") {
      log("info", "System stable — no healing required");
      return new Response(JSON.stringify({ ok: true, message: "System stable" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const actions: string[] = [];
    const repairs: Record<string, unknown>[] = [];

    // Preserve incident truth. Old unresolved errors are escalated for review;
    // they are never silently marked resolved just because time elapsed.
    if (!isCircuitOpen("system_errors")) {
      try {
        const { data: errors } = await retryCall(() =>
          Promise.resolve(
            supabase
              .from("system_errors")
              .select("id, component, severity, created_at")
              .eq("resolved", false)
              .order("created_at", { ascending: false })
              .limit(50),
          ).then((result) => {
            if (result.error) throw result.error;
            return result;
          }),
        );

        const oneDayAgo = Date.now() - 86_400_000;
        const agedErrors = (errors ?? []).filter((error: any) => {
          const createdAt = Date.parse(error.created_at ?? "");
          return Number.isFinite(createdAt) && createdAt < oneDayAgo;
        });

        if ((errors?.length ?? 0) > 0) {
          actions.push(`Observed ${errors!.length} unresolved errors`);
        }
        if (agedErrors.length > 0) {
          actions.push(`${agedErrors.length} unresolved errors require operator review`);
          repairs.push({
            component: "system_errors",
            action: "manual_review_required",
            status: "pending",
            count: agedErrors.length,
            oldest_created_at: agedErrors[agedErrors.length - 1]?.created_at ?? null,
          });
        }
        recordResult("system_errors", true);
      } catch (error) {
        recordResult("system_errors", false);
        log("error", "Failed to inspect system errors", { error: String(error) });
      }
    } else {
      actions.push("system_errors circuit open — skipped");
    }

    if (lastCheck.failed_apis && Array.isArray(lastCheck.failed_apis)) {
      for (const api of lastCheck.failed_apis) {
        const name = typeof api?.name === "string" ? api.name.slice(0, 120) : "unknown-api";
        const apiKey = `api_retry_${name}`;
        if (isCircuitOpen(apiKey)) {
          actions.push(`${name} circuit open — skipped`);
          continue;
        }
        actions.push(`Retry required for ${name}`);
        repairs.push({ component: name, action: "retry_required", status: "pending" });
      }
    }

    if (lastCheck.failed_tables && Array.isArray(lastCheck.failed_tables)) {
      for (const rawTable of lastCheck.failed_tables) {
        const table = typeof rawTable === "string" ? rawTable : "";
        if (!/^[a-z][a-z0-9_]{0,62}$/.test(table)) {
          repairs.push({ component: table || "unknown", action: "table_name_rejected", status: "failed" });
          continue;
        }

        try {
          const { error } = await retryCall(() =>
            Promise.resolve(supabase.from(table).select("id").limit(1)),
          );
          if (!error) {
            repairs.push({ component: table, action: "table_recovered", status: "success" });
          } else {
            repairs.push({ component: table, action: "table_check_failed", status: "failed" });
          }
        } catch {
          repairs.push({ component: table, action: "table_check_error", status: "failed" });
        }
      }
    }

    await supabase.from("system_errors").insert({
      component: "self-heal",
      message: "Authenticated repair inspection completed",
      details: { actions, repairs, timestamp: new Date().toISOString() },
      severity: "low",
      resolved: true,
    });

    log("info", "Self-heal inspection completed", {
      actionCount: actions.length,
      repairCount: repairs.length,
    });

    return new Response(JSON.stringify({
      ok: true,
      healed: repairs.some((repair) => repair.status === "success"),
      actions,
      repairs,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    log("error", "Self-heal failed", { error: String(error) });
    return new Response(JSON.stringify({ ok: false, error: "Self-heal inspection failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
