import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const JOB_NAME = "cron-daily-mint";
const JOB_TIMEOUT_MS = 55_000;

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
    const { data: logRow } = await supabase.from("automation_logs").insert({
      job_name: JOB_NAME,
      status: "running",
      message: "Starting daily mint job",
    }).select("id").single();
    logId = logRow?.id ?? null;

    const jobPromise = supabase.functions.invoke("sc-mint-epoch", { body: {} });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${JOB_NAME} timed out after ${JOB_TIMEOUT_MS}ms`)), JOB_TIMEOUT_MS)
    );

    const { data, error } = await Promise.race([jobPromise, timeoutPromise]);
    if (error) throw error;

    const durationMs = Date.now() - startedAt;

    if (logId) {
      await supabase.from("automation_logs").update({
        status: "success",
        message: `SC minted: ${JSON.stringify(data)} [${durationMs}ms]`,
      } as any).eq("id", logId);
    }

    return new Response(
      JSON.stringify({ ok: true, data, duration_ms: durationMs }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const durationMs = Date.now() - startedAt;
    const errMsg = (e as Error).message;
    const isTimeout = errMsg.includes("timed out");
    console.error(`Error in ${JOB_NAME}:`, errMsg);

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
