import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { rankOpportunities } from "../_shared/opportunity-engine-v1.mjs";

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
    const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 500) : [];

    const { data: prefsRow, error: prefsError } = await sb
      .from("aicis_relevance_preferences")
      .select("organization_id,organization_name,industries,domains,countries,watched_entities,keywords,risk_priorities,operating_regions,business_functions,alert_preferences")
      .eq("user_id", user.id)
      .maybeSingle();

    if (prefsError) throw prefsError;

    const preferences = prefsRow ?? {
      industries: [],
      domains: [],
      countries: [],
      watched_entities: [],
      keywords: [],
      risk_priorities: [],
      operating_regions: [],
      business_functions: [],
      alert_preferences: {},
    };

    const result = rankOpportunities(candidates, preferences);

    await sb.from("system_logs").insert({
      user_id: user.id,
      division: "finance",
      action: "rank_opportunities",
      result: result.no_transaction_recommended ? "no_transaction" : "ranked",
      log_level: "info",
      metadata: {
        engine_version: result.engine_version,
        evaluated_count: result.evaluated_count,
        eligible_count: result.eligible_count,
        rejected_count: result.rejected_count,
        human_approval_required: true,
      },
    });

    return json({ ok: true, ...result });
  } catch (error) {
    console.error("rank-opportunities failed", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Opportunity ranking failed",
    }, 500);
  }
});
