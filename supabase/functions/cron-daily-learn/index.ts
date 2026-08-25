import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { invokeInternalFunction } from "../_shared/internal-invoke.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const JOB_NAME = "cron-daily-learn";
const JOB_TIMEOUT_MS = 55_000;

type LearnResult = {
  evaluation?: { divisions?: number };
  learning?: { updated?: number };
};

type CalibrationResult = {
  version?: string | number;
  samples?: { total?: number };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405, { Allow: "POST" });
  }

  const { response: authResponse } = await requireAdminOrCron(req, corsHeaders);
  if (authResponse) return authResponse;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const startedAt = Date.now();
  let logId: string | null = null;

  try {
    const { data: logRow } = await supabase.from("automation_logs").insert({
      job_name: JOB_NAME,
      status: "running",
      message: "Starting daily learning cycle + decision calibration",
    }).select("id").single();
    logId = typeof logRow?.id === "string" ? logRow.id : null;

    const jobPromise = async () => {
      const learn = await invokeInternalFunction<LearnResult>("auto-learn-cycle", {});
      const calibration = await invokeInternalFunction<CalibrationResult>("calibrate-decision-weights", {});
      return { learn, calibration };
    };

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${JOB_NAME} timed out after ${JOB_TIMEOUT_MS}ms`)), JOB_TIMEOUT_MS)
    );

    const { learn, calibration } = await Promise.race([jobPromise(), timeoutPromise]);
    const messages: string[] = [];

    if (!learn.ok) messages.push(`learn-cycle error: ${learn.error ?? `HTTP ${learn.status}`}`);
    else messages.push(`learn: ${learn.data?.evaluation?.divisions ?? 0} impacts, ${learn.data?.learning?.updated ?? 0} weights`);

    if (!calibration.ok) messages.push(`calibration error: ${calibration.error ?? `HTTP ${calibration.status}`}`);
    else messages.push(`calibration: v${calibration.data?.version ?? "?"}, ${calibration.data?.samples?.total ?? 0} samples`);

    const finalStatus = !learn.ok || !calibration.ok ? "partial" : "success";
    const durationMs = Date.now() - startedAt;

    if (logId) {
      await supabase.from("automation_logs").update({
        status: finalStatus,
        message: `${messages.join(" | ")} [${durationMs}ms]`.slice(0, 1000),
      }).eq("id", logId);
    }

    return json({
      ok: finalStatus === "success",
      learn: learn.data,
      calibration: calibration.data,
      duration_ms: durationMs,
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isTimeout = errorMessage.includes("timed out");
    console.error(`Error in ${JOB_NAME}:`, errorMessage);

    if (logId) {
      await supabase.from("automation_logs").update({
        status: isTimeout ? "timeout" : "error",
        message: `${errorMessage} [${durationMs}ms]`.slice(0, 1000),
      }).eq("id", logId);
    } else {
      await supabase.from("automation_logs").insert({
        job_name: JOB_NAME,
        status: isTimeout ? "timeout" : "error",
        message: `${errorMessage} [${durationMs}ms]`.slice(0, 1000),
      });
    }

    return json({ error: errorMessage, duration_ms: durationMs }, 500);
  }
});

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" },
  });
}
