import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const JOB_NAME = "cron-daily-learn";
const JOB_TIMEOUT_MS = 55_000; // 55s hard ceiling

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const startedAt = Date.now();
  let logId: string | null = null;

  try {
    // Log start with ID for later update
    const { data: logRow } = await supabase.from("automation_logs").insert({
      job_name: JOB_NAME,
      status: "running",
      message: "Starting daily learning cycle + decision calibration",
    }).select("id").single();
    logId = logRow?.id ?? null;

    // Timeout race
    const jobPromise = async () => {
      const { data: learnData, error: learnErr } = await supabase.functions.invoke("auto-learn-cycle", { body: {} });
      const { data: calData, error: calErr } = await supabase.functions.invoke("calibrate-decision-weights", { body: {} });
      return { learnData, learnErr, calData, calErr };
    };

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${JOB_NAME} timed out after ${JOB_TIMEOUT_MS}ms`)), JOB_TIMEOUT_MS)
    );

    const { learnData, learnErr, calData, calErr } = await Promise.race([jobPromise(), timeoutPromise]);

    const messages: string[] = [];
    if (learnErr) messages.push(`learn-cycle error: ${learnErr.message}`);
    else messages.push(`learn: ${learnData?.evaluation?.divisions || 0} impacts, ${learnData?.learning?.updated || 0} weights`);

    if (calErr) messages.push(`calibration error: ${calErr.message}`);
    else messages.push(`calibration: v${calData?.version || '?'}, ${calData?.samples?.total || 0} samples`);

    const finalStatus = learnErr || calErr ? "partial" : "success";
    const durationMs = Date.now() - startedAt;

    // Update the original log row with final state
    if (logId) {
      await supabase.from("automation_logs").update({
        status: finalStatus,
        message: `${messages.join(" | ")} [${durationMs}ms]`,
      } as any).eq("id", logId);
    }

    return new Response(
      JSON.stringify({ ok: true, learn: learnData, calibration: calData, duration_ms: durationMs }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const durationMs = Date.now() - startedAt;
    const errMsg = (e as Error).message;
    const isTimeout = errMsg.includes("timed out");
    console.error(`Error in ${JOB_NAME}:`, errMsg);

    // Always reach a terminal state
    if (logId) {
      await supabase.from("automation_logs").update({
        status: isTimeout ? "timeout" : "error",
        message: `${errMsg} [${durationMs}ms]`,
      } as any).eq("id", logId);
    } else {
      await supabase.from("automation_logs").insert({
        job_name: JOB_NAME,
        status: isTimeout ? "timeout" : "error",
        message: `${errMsg} [${durationMs}ms]`,
      });
    }

    return new Response(
      JSON.stringify({ error: errMsg, duration_ms: durationMs }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
