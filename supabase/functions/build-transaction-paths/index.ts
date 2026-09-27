import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { buildTransactionPaths } from "../_shared/transaction-path-builder-v1.mjs";
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
    const input = body.input ?? body;

    const built = buildTransactionPaths(input);

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

    const ranked = rankOpportunities(built.candidates, preferences);

    await sb.from("system_logs").insert({
      user_id: user.id,
      division: "finance",
      action: "build_transaction_paths",
      result: ranked.no_transaction_recommended ? "built_no_transaction" : "built_and_ranked",
      log_level: "info",
      metadata: {
        builder_version: built.builder_version,
        engine_version: ranked.engine_version,
        candidates_built: built.candidates.length,
        paths_rejected: built.rejected_paths.length,
        eligible_ranked: ranked.eligible_count,
        no_transaction_recommended: ranked.no_transaction_recommended,
        human_approval_required: true,
      },
    });

    return json({
      ok: true,
      build: built,
      ranking: ranked,
      execution_boundary: {
        human_approval_required: true,
        external_execution_performed: false,
        contracts_signed: false,
        money_moved: false,
      },
    });
  } catch (error) {
    console.error("build-transaction-paths failed", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Transaction path build failed",
    }, 500);
  }
});
