// Planetary Domain Expansion Orchestrator
// Goal: lift coverage from 9 → 209 countries across all 9 domains
// Strategy: stagger calls to existing pull-* workers, one domain per invocation,
// rotate countries via backfill_state cursor so we never overwhelm any single API.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Domain → list of edge functions that feed it.
// Only functions that ACTUALLY EXIST in supabase/functions/ are listed here.
// World Bank carries 1500+ indicators spanning finance, governance, health,
// population, education, food, water, energy, and gender — so it appears in
// multiple domains as a legitimate primary or secondary source.
const DOMAIN_PULLS: Record<string, string[]> = {
  // Economic & Financial
  finance: ["pull-worldbank", "pull-coingecko", "pull-alpha-vantage", "fetch-finance-global"],
  economic: ["pull-worldbank", "fetch-finance-global"],

  // Governance & Stability
  governance: ["pull-vdem", "pull-freedom-house", "pull-worldbank", "fetch-governance-global"],

  // Human Systems
  health: ["pull-owid-health", "pull-worldbank", "fetch-health-global"],
  population: ["pull-worldpop", "pull-worldbank"],
  migration: ["pull-worldbank"],
  education: ["pull-worldbank"],

  // Resources & Environment
  food: ["pull-faostat-food", "pull-worldbank", "fetch-food-global"],
  water: ["pull-worldbank"],
  energy: ["pull-owid-energy", "pull-eia-energy", "pull-entsoe", "pull-worldbank"],
  climate: ["pull-nasa-power", "fetch-satellite-global"],

  // Security & Technology
  security: ["pull-nvd-security", "fetch-security-global", "fetch-security-incidents"],
  cyber: ["pull-nvd-security", "fetch-security-incidents"],
  technology: ["pull-worldbank"],

  // Supply Chain & Geopolitical
  supply_chain: ["pull-worldbank", "fetch-finance-global"],
  geopolitical: ["gdelt-ingest", "ingest-gdelt", "fetch-governance-global"],
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const onlyDomain: string | undefined = body.domain;

    // Cursor: which domain to run next (round-robin over invocations)
    const { data: cursorRow } = await supabase
      .from("backfill_state")
      .select("value_int")
      .eq("key", "planetary_domain_expansion_cursor")
      .maybeSingle();

    const domains = Object.keys(DOMAIN_PULLS);
    const cursor = cursorRow?.value_int ?? 0;
    const targetDomain = onlyDomain && DOMAIN_PULLS[onlyDomain]
      ? onlyDomain
      : domains[cursor % domains.length];

    const pulls = DOMAIN_PULLS[targetDomain];
    const results: Array<{ pull: string; status: string; ms: number; error?: string }> = [];

    for (const pullName of pulls) {
      const t0 = Date.now();
      try {
        const { error } = await supabase.functions.invoke(pullName);
        if (error) throw error;
        results.push({ pull: pullName, status: "ok", ms: Date.now() - t0 });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ pull: pullName, status: "fail", ms: Date.now() - t0, error: msg });
      }
    }

    // Advance cursor
    await supabase
      .from("backfill_state")
      .upsert(
        { key: "planetary_domain_expansion_cursor", value_int: (cursor + 1) % domains.length, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );

    // Snapshot post-run coverage for this domain
    const { data: cov } = await supabase
      .from("metrics")
      .select("iso3", { count: "exact", head: false })
      .eq("domain", targetDomain)
      .not("iso3", "is", null);
    const uniqueCountries = new Set((cov ?? []).map((r: any) => r.iso3)).size;

    await supabase.from("automation_logs").insert({
      job_name: "planetary-domain-expansion",
      status: results.every((r) => r.status === "ok") ? "success" : "partial",
      message: `domain=${targetDomain} pulls=${pulls.length} countries_covered=${uniqueCountries}`,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        domain: targetDomain,
        cursor_next: (cursor + 1) % domains.length,
        countries_covered: uniqueCountries,
        results,
        duration_ms: Date.now() - start,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("planetary-domain-expansion error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
