import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { invokeInternalFunction } from "../_shared/internal-invoke.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

interface CircuitState {
  failures: number;
  lastFailure: number;
  open: boolean;
}

interface SuccessfulPull {
  function: string;
  data: unknown;
}

interface FailedPull {
  function: string;
  error: string;
}

const circuits = new Map<string, CircuitState>();
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_RESET_MS = 60_000;

function isCircuitOpen(key: string): boolean {
  const state = circuits.get(key);
  if (!state || !state.open) return false;
  if (Date.now() - state.lastFailure > CIRCUIT_RESET_MS) {
    state.open = false;
    state.failures = 0;
    return false;
  }
  return true;
}

function recordResult(key: string, success: boolean): void {
  if (success) {
    circuits.set(key, { failures: 0, lastFailure: 0, open: false });
    return;
  }
  const state = circuits.get(key) || { failures: 0, lastFailure: 0, open: false };
  state.failures += 1;
  state.lastFailure = Date.now();
  if (state.failures >= CIRCUIT_THRESHOLD) state.open = true;
  circuits.set(key, state);
}

async function retryCall<T>(fn: () => Promise<T>, retries = 2, baseMs = 400): Promise<T> {
  let last: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, baseMs * Math.pow(2, attempt)));
      }
    }
  }
  throw last ?? new Error("Retry loop failed without an error");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const guard = await requireAdminOrCron(req, corsHeaders);
  if (guard.response) return guard.response;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const results: { successes: SuccessfulPull[]; failures: FailedPull[]; skipped: string[] } = {
      successes: [], failures: [], skipped: []
    };

    const pullFunctions = [
      "pull-coingecko",
      "pull-owid-energy",
      "pull-faostat-food",
      "pull-owid-health",
    ];

    for (const functionName of pullFunctions) {
      if (isCircuitOpen(functionName)) {
        results.skipped.push(functionName);
        console.warn(`${functionName} skipped — circuit open`);
        continue;
      }

      try {
        const data = await retryCall(async () => {
          const invocation = await invokeInternalFunction(functionName, {});
          if (!invocation.ok) {
            throw new Error(invocation.error ?? `${functionName} returned HTTP ${invocation.status}`);
          }
          return invocation.data;
        });
        recordResult(functionName, true);
        results.successes.push({ function: functionName, data });
      } catch (error) {
        recordResult(functionName, false);
        results.failures.push({
          function: functionName,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }

    try {
      const statusUpdate = await invokeInternalFunction("update-division-status", {});
      if (!statusUpdate.ok) throw new Error(statusUpdate.error ?? "Division status update failed");
    } catch (error) {
      console.warn("Division status update failed:", error);
    }

    await supabase.from("automation_logs").insert({
      job_name: "cron-fetch-division-data",
      status: results.failures.length === 0 ? "success" : "partial",
      message: `Fetched ${results.successes.length}/${pullFunctions.length}, skipped ${results.skipped.length}`
    });

    return new Response(
      JSON.stringify({ ok: true, message: "Hourly fetch completed", results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("cron-fetch-division-data error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
