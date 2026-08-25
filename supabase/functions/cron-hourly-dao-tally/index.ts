import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type TallyResult = {
  proposal_id: string;
  success: boolean;
  data?: unknown;
  error?: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const guard = await requireAdminOrCron(req, corsHeaders);
  if (guard.response) return guard.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    await supabase.from("automation_logs").insert({
      job_name: "cron-hourly-dao-tally",
      status: "running",
      message: "Starting DAO tally job",
    });

    const { data: proposals, error: fetchError } = await supabase
      .from("dao_proposals")
      .select("id")
      .eq("status", "active")
      .lt("voting_ends", new Date().toISOString());

    if (fetchError) throw fetchError;

    const results: TallyResult[] = [];

    for (const proposal of proposals || []) {
      try {
        const { data, error } = await supabase.functions.invoke("dao-tally", {
          body: { proposal_id: proposal.id },
        });

        if (error) throw error;
        results.push({ proposal_id: proposal.id, success: true, data });
      } catch (error) {
        results.push({
          proposal_id: proposal.id,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }

    const failures = results.filter((result) => !result.success).length;
    await supabase.from("automation_logs").insert({
      job_name: "cron-hourly-dao-tally",
      status: failures === 0 ? "success" : "partial",
      message: `Tallied ${results.length} proposals; ${failures} failed`,
    });

    return new Response(
      JSON.stringify({ ok: failures === 0, tallied: results.length, failures, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in cron-hourly-dao-tally:", error);

    await supabase.from("automation_logs").insert({
      job_name: "cron-hourly-dao-tally",
      status: "error",
      message: errorMessage,
    });

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
