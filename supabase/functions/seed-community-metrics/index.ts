/**
 * seed-community-metrics — bootstraps the L0/L1 sub-national tier of the
 * nested federation by deriving baseline community indicators from each
 * admin_region's intrinsic attributes.
 *
 * v3 storage/history behavior:
 *  - Auto-bootstraps admin_regions from REST Countries when starved (<50 regions).
 *  - Uses community_metric_state + record_derived_community_metrics() for
 *    change-aware persistence: unchanged values are skipped forever, while
 *    genuinely new/changed observations are appended to community_metrics.
 *  - Historical observations are never deleted by this seeder.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN = "seed-community-metrics";

async function bootstrapAdminRegions(supabase: any): Promise<number> {
  try {
    const r = await fetch(
      "https://restcountries.com/v3.1/all?fields=cca3,capital,population,area,latlng,subregion",
      { signal: AbortSignal.timeout(15000) },
    );
    if (!r.ok) return 0;
    const data = await r.json();
    const rows: any[] = [];
    for (const c of data) {
      const iso3 = c.cca3;
      const pop = Number(c.population) || 0;
      const area = Number(c.area) || 0;
      if (!iso3 || pop <= 0) continue;

      rows.push({
        country_iso3: iso3,
        admin_level: 0,
        name: iso3,
        population_est: pop,
        area_km2: area,
        urban_rural: "mixed",
        lat: c.latlng?.[0] ?? null,
        lon: c.latlng?.[1] ?? null,
        source: "restcountries_bootstrap",
        metadata: { subregion: c.subregion ?? null },
      });

      const capital = Array.isArray(c.capital) ? c.capital[0] : null;
      if (capital) {
        rows.push({
          country_iso3: iso3,
          admin_level: 1,
          name: capital,
          population_est: Math.round(pop * 0.08),
          area_km2: Math.max(50, area * 0.001),
          urban_rural: "urban",
          lat: c.latlng?.[0] ?? null,
          lon: c.latlng?.[1] ?? null,
          source: "restcountries_bootstrap",
          metadata: { role: "capital", parent_iso3: iso3 },
        });
      }
    }
    if (rows.length === 0) return 0;

    const { data: existing } = await supabase
      .from("admin_regions")
      .select("country_iso3,name")
      .eq("source", "restcountries_bootstrap");
    const seen = new Set((existing || []).map((e: any) => `${e.country_iso3}|${e.name}`));
    const fresh = rows.filter((r) => !seen.has(`${r.country_iso3}|${r.name}`));
    if (fresh.length === 0) return 0;

    let inserted = 0;
    for (let i = 0; i < fresh.length; i += 500) {
      const chunk = fresh.slice(i, i + 500);
      const { error } = await supabase.from("admin_regions").insert(chunk);
      if (!error) inserted += chunk.length;
    }
    return inserted;
  } catch {
    return 0;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const start = Date.now();

  try {
    const { error: anchorErr } = await supabase.rpc("ensure_l0_reporting_anchors");
    if (anchorErr) throw anchorErr;
    const { error: demoErr } = await supabase.rpc("ensure_admin_region_demographics");
    if (demoErr) throw demoErr;

    const { count: eligibleCount } = await supabase
      .from("admin_regions")
      .select("*", { count: "exact", head: true })
      .lte("admin_level", 1)
      .not("population_est", "is", null);

    let bootstrapped = 0;
    if ((eligibleCount ?? 0) < 50) {
      bootstrapped = await bootstrapAdminRegions(supabase);
    }

    const regions: any[] = [];
    const PAGE = 1000;
    for (let from = 0; from < 30000; from += PAGE) {
      const { data: page, error } = await supabase
        .from("admin_regions")
        .select("id,country_iso3,admin_level,population_est,area_km2,urban_rural")
        .lte("admin_level", 4)
        .not("population_est", "is", null)
        .gt("population_est", 0)
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!page || page.length === 0) break;
      regions.push(...page);
      if (page.length < PAGE) break;
    }

    if (regions.length === 0) {
      await supabase.from("automation_logs").insert({
        job_name: FN,
        status: "error",
        message: `No eligible regions (bootstrapped ${bootstrapped}). Check admin_regions seed.`,
      });
      return new Response(JSON.stringify({ ok: false, inserted: 0, bootstrapped }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows: any[] = [];

    for (const r of regions) {
      const pop = Number(r.population_est) || 0;
      const area = Number(r.area_km2) || 0;
      if (pop <= 0) continue;

      const density = area > 0 ? pop / area : 0;
      const urbanFlag = r.urban_rural === "urban" ? 1 : 0;

      const candidates = [
        {
          key: "population_estimate",
          value: pop,
          unit: "persons",
          domain: "demographics",
          meta: { admin_level: r.admin_level, derivation: "intrinsic" },
        },
        {
          key: "population_density_km2",
          value: density,
          unit: "persons_per_km2",
          domain: "demographics",
          meta: { admin_level: r.admin_level, area_km2: area },
        },
        {
          key: "urban_classification",
          value: urbanFlag,
          unit: "boolean",
          domain: "settlement",
          meta: { admin_level: r.admin_level, label: r.urban_rural || "unknown" },
        },
      ];

      for (const c of candidates) {
        rows.push({
          region_id: r.id,
          country_iso3: r.country_iso3,
          domain: c.domain,
          indicator_key: c.key,
          value: c.value,
          unit: c.unit,
          metadata: c.meta,
        });
      }
    }

    // Persist through the database-side state machine so comparison + history
    // insertion is atomic. This avoids both repeated full-history scans and
    // race conditions between overlapping seeder invocations.
    let inserted = 0;
    const chunkSize = 1000;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { data, error: rpcErr } = await supabase.rpc("record_derived_community_metrics", {
        _rows: chunk,
      });
      if (rpcErr) throw rpcErr;
      inserted += Number(data) || 0;
    }

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: "success",
      message: `Bootstrapped ${bootstrapped} regions; appended ${inserted} changed metrics from ${rows.length} candidates across ${regions.length} regions in ${Date.now() - start}ms`,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        inserted,
        candidates: rows.length,
        unchanged: rows.length - inserted,
        regions: regions.length,
        bootstrapped,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = (e as Error).message;
    await supabase.from("automation_logs").insert({ job_name: FN, status: "error", message: msg });
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
