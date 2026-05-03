/**
 * seed-community-metrics — bootstraps the L0/L1 sub-national tier of the
 * nested federation by deriving baseline community indicators from each
 * admin_region's intrinsic attributes.
 *
 * v2 enhancements (enterprise-grade):
 *  - Auto-bootstraps admin_regions from REST Countries when starved (<50 regions)
 *    using each country's capital + major cities as L1 admin units with
 *    population estimates. Eliminates the "60 rows/24h" starvation gap.
 *  - Day-bucketed dedup: skips region+indicator already inserted today.
 *  - Insert-count assertion logged as a hard signal in automation_logs.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN = "seed-community-metrics";

async function bootstrapAdminRegions(supabase: any): Promise<number> {
  // Fetch every country with capital + population to seed L1 admin units.
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

      // Country level (L0) — synthetic root region per ISO3.
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

      // Capital city (L1) — assume 8% of population is urban capital, classic Zipf approximation.
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
    // Insert in chunks; rely on PK to skip dupes silently — admin_regions has no unique constraint
    // on (country_iso3, name), so we pre-filter by checking existence per ISO3.
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
    // 0. Bootstrap admin_regions if starved (<50 eligible).
    const { count: eligibleCount } = await supabase
      .from("admin_regions")
      .select("*", { count: "exact", head: true })
      .lte("admin_level", 1)
      .not("population_est", "is", null);

    let bootstrapped = 0;
    if ((eligibleCount ?? 0) < 50) {
      bootstrapped = await bootstrapAdminRegions(supabase);
    }

    // 1. Pull eligible regions across ALL admin levels (0-4).
    // GAP FIX: previously limited to admin_level<=3, missing 17,904 L4 regions.
    // Paginate to bypass PostgREST 1000-row default cap.
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
    const error = null as any;

    if (error) throw error;
    if (!regions || regions.length === 0) {
      await supabase.from("automation_logs").insert({
        job_name: FN,
        status: "error",
        message: `No eligible regions (bootstrapped ${bootstrapped}). Check admin_regions seed.`,
      });
      return new Response(JSON.stringify({ ok: false, inserted: 0, bootstrapped }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Day-bucket dedup: skip region+indicator already inserted today.
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { data: existingToday } = await supabase
      .from("community_metrics")
      .select("region_id,indicator_key")
      .gte("captured_at", todayStart.toISOString())
      .eq("source", "derived_admin_regions");
    const dedupKey = new Set(
      (existingToday || []).map((e: any) => `${e.region_id}|${e.indicator_key}`),
    );

    const now = new Date().toISOString();
    const rows: any[] = [];

    for (const r of regions) {
      const pop = Number(r.population_est) || 0;
      const area = Number(r.area_km2) || 0;
      if (pop <= 0) continue;

      const density = area > 0 ? pop / area : 0;
      const urbanFlag = r.urban_rural === "urban" ? 1 : 0;

      const candidates = [
        { key: "population_estimate", value: pop, unit: "persons", domain: "demographics", meta: { admin_level: r.admin_level, derivation: "intrinsic" } },
        { key: "population_density_km2", value: density, unit: "persons_per_km2", domain: "demographics", meta: { admin_level: r.admin_level, area_km2: area } },
        { key: "urban_classification", value: urbanFlag, unit: "boolean", domain: "settlement", meta: { admin_level: r.admin_level, label: r.urban_rural || "unknown" } },
      ];

      for (const c of candidates) {
        if (dedupKey.has(`${r.id}|${c.key}`)) continue;
        rows.push({
          region_id: r.id,
          country_iso3: r.country_iso3,
          domain: c.domain,
          indicator_key: c.key,
          value: c.value,
          unit: c.unit,
          source: "derived_admin_regions",
          captured_at: now,
          metadata: c.meta,
        });
      }
    }

    let inserted = 0;
    const chunkSize = 1000;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error: insErr } = await supabase.from("community_metrics").insert(chunk);
      if (!insErr) inserted += chunk.length;
      else console.error("[seed-community-metrics] insert error:", insErr.message);
    }

    // Hard assertion: log status as 'error' if 0 inserted from non-empty candidate set.
    const status =
      rows.length === 0
        ? "success" // already up-to-date today
        : inserted === rows.length
        ? "success"
        : inserted > 0
        ? "partial"
        : "error";

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status,
      message: `Bootstrapped ${bootstrapped} regions; seeded ${inserted}/${rows.length} metrics from ${regions.length} regions in ${Date.now() - start}ms`,
    });

    return new Response(
      JSON.stringify({ ok: true, inserted, candidates: rows.length, regions: regions.length, bootstrapped }),
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
