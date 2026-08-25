// Planetary Domain Expansion Orchestrator
// Staggers provider pulls by domain so planetary coverage expands without
// overwhelming external APIs or bypassing privileged worker authorization.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { invokeInternalFunction } from "../_shared/internal-invoke.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const DOMAIN_PULLS: Record<string, string[]> = {
  finance: ["pull-worldbank", "pull-coingecko", "pull-alpha-vantage", "fetch-finance-global"],
  economic: ["pull-worldbank", "fetch-finance-global"],
  governance: ["pull-vdem", "pull-freedom-house", "pull-worldbank", "fetch-governance-global"],
  health: ["pull-owid-health", "pull-worldbank", "fetch-health-global"],
  population: ["pull-worldpop", "pull-worldbank"],
  migration: ["pull-worldbank"],
  education: ["pull-worldbank"],
  food: ["pull-faostat-food", "pull-worldbank", "fetch-food-global"],
  water: ["pull-worldbank"],
  energy: ["pull-owid-energy", "pull-eia-energy", "pull-entsoe", "pull-worldbank"],
  climate: ["pull-nasa-power", "fetch-satellite-global"],
  // Conflict/security observations are event-grade ACLED/UCDP-backed. Cyber
  // vulnerability intelligence remains a separate domain.
  security: ["pull-acled", "fetch-security-global", "fetch-security-incidents"],
  cyber: ["pull-nvd-security", "fetch-security-global"],
  technology: ["pull-worldbank"],
  supply_chain: ["pull-worldbank", "fetch-finance-global"],
  geopolitical: ["gdelt-ingest", "ingest-gdelt", "fetch-governance-global"],
};

type PullResult = {
  pull: string;
  status: "ok" | "fail";
  ms: number;
  error?: string;
};

type CoverageRow = { iso3: string | null };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = req.method === "POST"
      ? await req.json().catch(() => ({})) as Record<string, unknown>
      : {};
    const requestedDomain = typeof body.domain === "string" ? body.domain : null;

    const { data: cursorRow, error: cursorError } = await supabase
      .from("backfill_state")
      .select("value_int")
      .eq("key", "planetary_domain_expansion_cursor")
      .maybeSingle();
    if (cursorError) throw cursorError;

    const domains = Object.keys(DOMAIN_PULLS);
    const cursor = Number(cursorRow?.value_int) || 0;
    const targetDomain = requestedDomain && DOMAIN_PULLS[requestedDomain]
      ? requestedDomain
      : domains[cursor % domains.length];
    const pulls = DOMAIN_PULLS[targetDomain];
    const results: PullResult[] = [];

    for (const pullName of pulls) {
      const pullStart = Date.now();
      const result = await invokeInternalFunction(pullName, {}, 55_000);
      if (result.ok) {
        results.push({ pull: pullName, status: "ok", ms: Date.now() - pullStart });
      } else {
        results.push({
          pull: pullName,
          status: "fail",
          ms: Date.now() - pullStart,
          error: result.error ?? `HTTP ${result.status}`,
        });
      }
    }

    const nextCursor = (cursor + 1) % domains.length;
    const { error: cursorUpdateError } = await supabase
      .from("backfill_state")
      .upsert({
        key: "planetary_domain_expansion_cursor",
        value_int: nextCursor,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
    if (cursorUpdateError) throw cursorUpdateError;

    const { data: coverageData, error: coverageError } = await supabase
      .from("metrics")
      .select("iso3")
      .eq("domain", targetDomain)
      .not("iso3", "is", null);
    if (coverageError) throw coverageError;

    const uniqueCountries = new Set(
      ((coverageData ?? []) as CoverageRow[])
        .map((row) => row.iso3)
        .filter((iso3): iso3 is string => Boolean(iso3)),
    ).size;
    const failures = results.filter((result) => result.status === "fail");

    await supabase.from("automation_logs").insert({
      job_name: "planetary-domain-expansion",
      status: failures.length === 0 ? "success" : failures.length < results.length ? "partial" : "error",
      message: `domain=${targetDomain} pulls=${pulls.length} failures=${failures.length} countries_covered=${uniqueCountries}`,
    });

    return new Response(JSON.stringify({
      ok: failures.length === 0,
      domain: targetDomain,
      cursor_next: nextCursor,
      countries_covered: uniqueCountries,
      results,
      duration_ms: Date.now() - start,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("planetary-domain-expansion error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
