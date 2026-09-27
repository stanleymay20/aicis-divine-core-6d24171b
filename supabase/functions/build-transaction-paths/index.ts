import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { buildTransactionPaths } from "../_shared/transaction-path-builder-v1.mjs";
import { rankOpportunities } from "../_shared/opportunity-engine-v1.mjs";
import { optimizeOpportunityPortfolio } from "../_shared/opportunity-portfolio-optimizer-v1.mjs";
import { evaluateStrategicOptions } from "../_shared/strategic-doctrine-engine-v1.mjs";

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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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
    const body = asRecord(await req.json().catch(() => ({})));
    const rawInput = asRecord(body.input ?? body);

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

    const alertPreferences = asRecord(preferences.alert_preferences);
    const opportunityProfile = asRecord(alertPreferences.opportunity_profile);
    const configuredBaseCurrency = typeof opportunityProfile.base_currency === "string"
      ? opportunityProfile.base_currency.trim().toUpperCase()
      : "";
    const input = {
      ...rawInput,
      comparison_currency: rawInput.comparison_currency || (/^[A-Z]{3}$/.test(configuredBaseCurrency) ? configuredBaseCurrency : undefined),
    };
    const built = buildTransactionPaths(input);
    const ranked = rankOpportunities(built.candidates, preferences);
    const portfolio = optimizeOpportunityPortfolio(ranked, preferences);

    const strategicContext = asRecord(rawInput.strategic_context);
    const suppliedActorState = asRecord(strategicContext.actor_state);
    const terrain = asRecord(strategicContext.terrain);
    const timing = asRecord(strategicContext.timing);
    const configuredCapital = typeof opportunityProfile.capital_available === "number"
      ? opportunityProfile.capital_available
      : null;
    const actorState = {
      capabilities: Array.isArray(suppliedActorState.capabilities)
        ? suppliedActorState.capabilities
        : Array.isArray(opportunityProfile.strategic_capabilities)
          ? opportunityProfile.strategic_capabilities
          : [],
      licenses: Array.isArray(suppliedActorState.licenses)
        ? suppliedActorState.licenses
        : Array.isArray(opportunityProfile.strategic_licenses)
          ? opportunityProfile.strategic_licenses
          : [],
      relationships: Array.isArray(suppliedActorState.relationships)
        ? suppliedActorState.relationships
        : Array.isArray(opportunityProfile.strategic_relationships)
          ? opportunityProfile.strategic_relationships
          : [],
      infrastructure: Array.isArray(suppliedActorState.infrastructure)
        ? suppliedActorState.infrastructure
        : Array.isArray(opportunityProfile.strategic_infrastructure)
          ? opportunityProfile.strategic_infrastructure
          : [],
      constraints: Array.isArray(suppliedActorState.constraints)
        ? suppliedActorState.constraints
        : Array.isArray(opportunityProfile.strategic_constraints)
          ? opportunityProfile.strategic_constraints
          : [],
      capital_available: typeof suppliedActorState.capital_available === "number"
        ? suppliedActorState.capital_available
        : configuredCapital,
    };
    const strategicCandidates = [
      ...ranked.ranked,
      ...ranked.rejected.filter((item) => item?.candidate_id && item?.title && item?.transaction_type),
    ];
    const strategic = evaluateStrategicOptions({
      ranked_candidates: strategicCandidates,
      actor_state: actorState,
      terrain,
      timing,
      preferences,
    });

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
        portfolio_selected_count: portfolio.selected?.length ?? 0,
        portfolio_expected_value: portfolio.expected_value ?? null,
        strategic_engine_version: strategic.engine_version,
        strategic_option_count: strategic.option_count,
        primary_strategy_id: strategic.primary_strategy?.id ?? null,
      },
    });

    return json({
      ok: true,
      build: built,
      ranking: ranked,
      portfolio,
      strategic,
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
