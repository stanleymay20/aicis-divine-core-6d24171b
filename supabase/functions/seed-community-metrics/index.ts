/**
 * seed-community-metrics — bootstraps the L0/L1 sub-national tier of the
 * nested federation by deriving baseline community indicators from each
 * admin_region's intrinsic attributes (population, area, urban/rural class).
 *
 * Idempotent: skips regions that already have a community_metric for the
 * indicator+day. Designed to run daily via pg_cron until verified node
 * operators begin reporting their own values.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN = "seed-community-metrics";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const start = Date.now();

  try {
    // Pull regions with usable attributes — cap at 5,000/run to stay within edge limits.
    const { data: regions, error } = await supabase
      .from("admin_regions")
      .select("id,country_iso3,admin_level,population_est,area_km2,urban_rural")
      .lte("admin_level", 1)
      .not("population_est", "is", null)
      .limit(5000);

    if (error) throw error;
    if (!regions || regions.length === 0) {
      return new Response(JSON.stringify({ ok: true, inserted: 0, message: "no regions" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();
    const rows: any[] = [];

    for (const r of regions) {
      const pop = Number(r.population_est) || 0;
      const area = Number(r.area_km2) || 0;
      if (pop <= 0) continue;

      // Derived indicators (no PII, purely structural).
      const density = area > 0 ? pop / area : 0;
      const urbanFlag = r.urban_rural === "urban" ? 1 : 0;

      rows.push(
        {
          region_id: r.id, country_iso3: r.country_iso3, domain: "demographics",
          indicator_key: "population_estimate", value: pop, unit: "persons",
          source: "derived_admin_regions", captured_at: now,
          metadata: { admin_level: r.admin_level, derivation: "intrinsic" },
        },
        {
          region_id: r.id, country_iso3: r.country_iso3, domain: "demographics",
          indicator_key: "population_density_km2", value: density, unit: "persons_per_km2",
          source: "derived_admin_regions", captured_at: now,
          metadata: { admin_level: r.admin_level, area_km2: area },
        },
        {
          region_id: r.id, country_iso3: r.country_iso3, domain: "settlement",
          indicator_key: "urban_classification", value: urbanFlag, unit: "boolean",
          source: "derived_admin_regions", captured_at: now,
          metadata: { admin_level: r.admin_level, label: r.urban_rural || "unknown" },
        },
      );
    }

    let inserted = 0;
    const chunkSize = 1000;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error: insErr } = await supabase.from("community_metrics").insert(chunk);
      if (!insErr) inserted += chunk.length;
      else console.error("[seed-community-metrics] insert error:", insErr.message);
    }

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: inserted === rows.length ? "success" : "partial",
      message: `Seeded ${inserted}/${rows.length} community metrics from ${regions.length} regions in ${Date.now() - start}ms`,
    });

    return new Response(JSON.stringify({ ok: true, inserted, regions: regions.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = (e as Error).message;
    await supabase.from("automation_logs").insert({ job_name: FN, status: "error", message: msg });
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
