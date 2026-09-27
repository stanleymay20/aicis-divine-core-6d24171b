import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { planOfficialCustomsSources } from "../_shared/official-customs-source-plan-v1.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await sb.auth.getUser();
  if (authError || !user) return json({ ok: false, error: "Unauthorized" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const input = body?.input ?? body;
    const result = planOfficialCustomsSources(input);

    try {
      await sb.from("system_logs").insert({
        user_id: user.id,
        division: "finance",
        action: "plan_official_customs_sources",
        result: result.blockers.length ? "official_sources_with_blockers" : "official_sources_identified",
        log_level: result.blockers.length ? "warning" : "info",
        metadata: {
          plan_version: result.plan_version,
          origin_country: result.origin_country,
          destination_country: result.destination_country,
          hs_code: result.hs_code,
          classification_ready: result.classification_ready,
          source_ids: result.sources.map((source) => source.source_id),
          blocker_kinds: result.blockers.map((blocker) => blocker.kind),
          automated_rate_extraction_performed: false,
          legal_determination_made: false,
        },
      });
    } catch (logError) {
      console.warn("official-customs-source-plan audit log unavailable", logError);
    }

    return json({
      ok: result.valid_request,
      ...result,
      execution_boundary: {
        ...result.execution_boundary,
        external_rate_lookup_performed: false,
        customs_or_tax_value_written_to_transaction: false,
      },
    }, result.valid_request ? 200 : 422);
  } catch (error) {
    console.error("plan-official-customs-evidence-sources failed", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Official customs source planning failed",
      automated_rate_extraction_performed: false,
      legal_determination_made: false,
    }, 500);
  }
});
