import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FN = "batch-seed-regions";
const BATCH_SIZE = 1;

const ALL_COUNTRIES = [
  "AFG","ALB","DZA","AND","AGO","ATG","ARG","ARM","AUS","AUT","AZE","BHS","BHR","BGD","BRB",
  "BLR","BEL","BLZ","BEN","BTN","BOL","BIH","BWA","BRA","BRN","BGR","BFA","BDI","CPV","KHM",
  "CMR","CAN","CAF","TCD","CHL","CHN","COL","COM","COG","COD","CRI","CIV","HRV","CUB","CYP",
  "CZE","DNK","DJI","DMA","DOM","ECU","EGY","SLV","GNQ","ERI","EST","SWZ","ETH","FJI","FIN",
  "FRA","GAB","GMB","GEO","DEU","GHA","GRC","GRD","GTM","GIN","GNB","GUY","HTI","HND","HUN",
  "ISL","IND","IDN","IRN","IRQ","IRL","ISR","ITA","JAM","JPN","JOR","KAZ","KEN","KIR","PRK",
  "KOR","KWT","KGZ","LAO","LVA","LBN","LSO","LBR","LBY","LIE","LTU","LUX","MDG","MWI","MYS",
  "MDV","MLI","MLT","MHL","MRT","MUS","MEX","FSM","MDA","MCO","MNG","MNE","MAR","MOZ","MMR",
  "NAM","NRU","NPL","NLD","NZL","NIC","NER","NGA","MKD","NOR","OMN","PAK","PLW","PAN","PNG",
  "PRY","PER","PHL","POL","PRT","QAT","ROU","RUS","RWA","KNA","LCA","VCT","WSM","SMR","STP",
  "SAU","SEN","SRB","SYC","SLE","SGP","SVK","SVN","SLB","SOM","ZAF","SSD","ESP","LKA","SDN",
  "SUR","SWE","CHE","SYR","TWN","TJK","TZA","THA","TLS","TGO","TON","TTO","TUN","TUR","TKM",
  "TUV","UGA","UKR","ARE","GBR","USA","URY","UZB","VUT","VEN","VNM","YEM","ZMB","ZWE"
];

async function insertRegion(supabase: any, data: any): Promise<string | null> {
  if (data.osm_id) {
    const { data: existing } = await supabase
      .from("admin_regions").select("id").eq("osm_id", data.osm_id).maybeSingle();
    if (existing) return existing.id;
  }
  const { data: row, error } = await supabase
    .from("admin_regions").insert(data).select("id").single();
  if (error) return null;
  return row?.id || null;
}

async function overpass(query: string): Promise<any[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return [];
    return (await resp.json()).elements || [];
  } catch { clearTimeout(timer); return []; }
}

async function seedOneCountry(supabase: any, iso3: string, seedVillages: boolean) {
  const res = { provinces: 0, districts: 0, villages: 0 };

  const { data: existCheck } = await supabase
    .from("admin_regions").select("id").eq("country_iso3", iso3).eq("admin_level", 0).maybeSingle();

  let countryId: string | null = existCheck?.id || null;

  if (!countryId) {
    const cResp = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${iso3}&format=json&limit=1&featuretype=country`,
      { headers: { "User-Agent": "AICIS/2.0" } }
    );
    const cData = await cResp.json().catch(() => []);
    if (cData?.length) {
      const c = cData[0];
      countryId = await insertRegion(supabase, {
        name: c.display_name?.split(",")[0] || iso3, admin_level: 0, country_iso3: iso3,
        lat: parseFloat(c.lat), lon: parseFloat(c.lon),
        osm_id: parseInt(c.osm_id) || null, source: "nominatim",
      });
    } else {
      const { data: row } = await supabase.from("admin_regions")
        .insert({ name: iso3, admin_level: 0, country_iso3: iso3, source: "fallback" })
        .select("id").single();
      countryId = row?.id || null;
    }
  }

  // Seed villages
  if (seedVillages) {
    const { count: vilCount } = await supabase
      .from("admin_regions").select("id", { count: "exact", head: true })
      .eq("country_iso3", iso3).gte("admin_level", 3);

    if (!vilCount || vilCount === 0) {
      const MAX_VILLAGES = 150;
      const vilElements = await overpass(
        `[out:json][timeout:15];area["ISO3166-1:alpha3"="${iso3}"]->.a;(node["place"~"village|hamlet|town|city"](area.a););out ${MAX_VILLAGES};`
      );
      for (const v of vilElements.slice(0, MAX_VILLAGES)) {
        const name = v.tags?.name || v.tags?.["name:en"] || `Settlement-${v.id}`;
        if (!v.lat || !v.lon) continue;
        const placeType = v.tags?.place || "village";
        const adminLvl = (placeType === "city" || placeType === "town") ? 3 : 4;
        await insertRegion(supabase, {
          name, admin_level: adminLvl, parent_id: countryId, country_iso3: iso3,
          osm_id: v.id, lat: v.lat, lon: v.lon,
          population_est: parseInt(v.tags?.population) || null,
          urban_rural: (placeType === "city" || placeType === "town") ? "urban" : "rural",
          source: "overpass", metadata: { place_type: placeType },
        });
        res.villages++;
      }
    }
  }

  return res;
}

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  try {
    // Use RPC to efficiently find countries needing villages
    const { data: needsVillagesList, error: rpcErr } = await supabase
      .rpc("get_countries_needing_villages");

    if (rpcErr) throw rpcErr;

    const needsVillages = (needsVillagesList || []).map((r: any) => r.country_iso3);

    // Also check for completely unseeded countries
    const { data: seededRows } = await supabase
      .from("admin_regions").select("country_iso3").eq("admin_level", 0);
    const seededSet = new Set((seededRows || []).map((r: any) => r.country_iso3));
    const unseeded = ALL_COUNTRIES.filter(iso3 => !seededSet.has(iso3));

    let batch: string[];
    let phase: string;

    console.log(`[${FN}] Unseeded: ${unseeded.length}, Needs villages: ${needsVillages.length}`);

    if (unseeded.length > 0) {
      batch = unseeded.slice(0, BATCH_SIZE);
      phase = "seeding";
    } else if (needsVillages.length > 0) {
      batch = needsVillages.slice(0, BATCH_SIZE);
      phase = "villages";
    } else {
      fetch(`${supabaseUrl}/functions/v1/batch-village-inference`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {});

      return new Response(JSON.stringify({
        success: true,
        message: "All 211 countries fully seeded with villages! Starting inference.",
        total_countries: seededSet.size,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const batchResults: Record<string, any> = {};

    for (const iso3 of batch) {
      console.log(`[${FN}] [${phase}] ${iso3}`);
      try {
        const result = await seedOneCountry(supabase, iso3, true);
        batchResults[iso3] = result;
        // Record the attempt so we don't retry countries where Overpass has no data
        await supabase.from("village_seed_attempts").upsert({
          country_iso3: iso3,
          villages_found: result.villages,
          status: "completed",
          attempted_at: new Date().toISOString(),
        });
      } catch (e) {
        batchResults[iso3] = { error: (e as Error).message };
        await supabase.from("village_seed_attempts").upsert({
          country_iso3: iso3,
          villages_found: 0,
          status: "error",
          attempted_at: new Date().toISOString(),
        });
      }
      await new Promise(r => setTimeout(r, 1500));
    }

    const totalRemaining = (phase === "seeding")
      ? (unseeded.length - batch.length) + needsVillages.length
      : needsVillages.length - batch.length;

    await supabase.from("automation_logs").insert({
      job_name: FN, status: "success",
      message: `[${phase}] ${batch.join(",")}. Remaining: ${totalRemaining}. ${JSON.stringify(batchResults)}`,
    });

    if (totalRemaining > 0) {
      // Delay before self-chaining to prevent invocation storms
      await new Promise(r => setTimeout(r, 5000));
      fetch(`${supabaseUrl}/functions/v1/batch-seed-regions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {});
    }

    return new Response(JSON.stringify({
      success: true, phase, batch: batchResults,
      remaining: totalRemaining,
      auto_continuing: totalRemaining > 0,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(`[${FN}] Error:`, e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
