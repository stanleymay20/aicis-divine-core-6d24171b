// One-shot fix: backfill L0 population_est from REST Countries for any
// admin_regions row at admin_level=0 that has NULL/0 population.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const FN = "backfill-l0-population";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  try {
    const r = await fetch(
      "https://restcountries.com/v3.1/all?fields=cca3,population,area,latlng",
      { signal: AbortSignal.timeout(20000) },
    );
    if (!r.ok) throw new Error(`restcountries http ${r.status}`);
    const data = await r.json();
    const popMap = new Map<string, { pop: number; area: number; lat?: number; lon?: number }>();
    for (const c of data) {
      if (c.cca3 && c.population > 0) {
        popMap.set(c.cca3, {
          pop: Number(c.population),
          area: Number(c.area) || 0,
          lat: c.latlng?.[0],
          lon: c.latlng?.[1],
        });
      }
    }

    // Get all L0 regions missing population
    const { data: rows, error } = await supabase
      .from("admin_regions")
      .select("id,country_iso3")
      .eq("admin_level", 0)
      .or("population_est.is.null,population_est.eq.0");
    if (error) throw error;

    let updated = 0, skipped = 0;
    for (const row of rows ?? []) {
      const m = popMap.get(row.country_iso3);
      if (!m) { skipped++; continue; }
      const { error: uerr } = await supabase
        .from("admin_regions")
        .update({
          population_est: m.pop,
          area_km2: m.area || null,
          lat: m.lat ?? null,
          lon: m.lon ?? null,
          metadata: { backfilled_from: "restcountries_v3.1", backfilled_at: new Date().toISOString() },
        })
        .eq("id", row.id);
      if (!uerr) updated++;
    }

    await supabase.from("automation_logs").insert({
      job_name: FN, status: "success",
      message: `Backfilled L0 pop for ${updated}/${rows?.length ?? 0} rows (${skipped} no match)`,
    });

    return new Response(JSON.stringify({ ok: true, updated, considered: rows?.length ?? 0, skipped }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
