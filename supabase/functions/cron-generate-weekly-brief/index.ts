import { requireAdminOrCron } from "../_shared/auth.ts";
import { invokeInternalFunction } from "../_shared/internal-invoke.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const guard = await requireAdminOrCron(req, corsHeaders);
  if (guard.response) return guard.response;

  try {
    const invocation = await invokeInternalFunction<Record<string, unknown>>("generate-weekly-brief", {});

    if (!invocation.ok) {
      console.error("Weekly brief generation failed:", invocation.error);
      return new Response(JSON.stringify({
        ok: false,
        error: invocation.error ?? `HTTP ${invocation.status}`,
      }), {
        status: invocation.status >= 400 ? invocation.status : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, ...(invocation.data ?? {}) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("cron-generate-weekly-brief error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
