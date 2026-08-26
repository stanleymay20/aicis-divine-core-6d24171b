import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
/**
 * populate-global-profiles — Global Country Profile Seeder
 * 
 * Fetches all sovereign countries from World Bank API,
 * builds minimal KPI skeletons for each using public APIs,
 * and upserts into country_profiles for engine consumption.
 * 
 * Designed to scale from 8 → 195 countries.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 10; // concurrent country fetches
const WB_BASE = "https://api.worldbank.org/v2";

interface WBCountry {
  id: string; // ISO3
  name: string;
  latitude: string;
  longitude: string;
  region: { value: string };
  incomeLevel: { value: string };
}

// World Bank indicator codes for minimal KPI skeleton
const WB_INDICATORS: Record<string, { code: string; metric: string; unit: string }[]> = {
  governance: [{ code: "GE.EST", metric: "government_effectiveness", unit: "index" }],
  health: [{ code: "SP.DYN.LE00.IN", metric: "life_expectancy", unit: "years" }],
  education: [{ code: "SE.SEC.ENRR", metric: "secondary_enrolment", unit: "%" }],
  energy: [{ code: "EG.ELC.ACCS.ZS", metric: "electricity_access", unit: "%" }],
  finance: [{ code: "NY.GDP.MKTP.CD", metric: "gdp_current_usd", unit: "USD" }],
  population: [{ code: "SP.POP.TOTL", metric: "population_total", unit: "people" }],
  food: [{ code: "AG.PRD.FOOD.XD", metric: "food_production_index", unit: "index" }],
  security: [{ code: "PV.EST", metric: "political_stability", unit: "index" }],
  climate: [
    { code: "EN.ATM.CO2E.PC", metric: "co2_emissions_per_capita", unit: "metric_tons" },
    { code: "EG.FEC.RNEW.ZS", metric: "renewable_energy_share", unit: "%" },
    { code: "AG.LND.FRST.ZS", metric: "forest_area_pct", unit: "%" },
  ],
};

async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAllCountries(): Promise<WBCountry[]> {
  const resp = await fetchWithTimeout(`${WB_BASE}/country?format=json&per_page=300`);
  const data = await resp.json();
  if (!Array.isArray(data) || !data[1]) return [];
  
  // Filter to sovereign countries only (exclude aggregates)
  return data[1].filter((c: any) => 
    c.region?.id !== "NA" && // exclude aggregates
    c.capitalCity && c.capitalCity !== "" && // must have capital
    c.id.length === 3 // ISO3 only
  );
}

async function fetchIndicatorForCountry(iso3: string, indicatorCode: string): Promise<any[]> {
  try {
    const resp = await fetchWithTimeout(
      `${WB_BASE}/country/${iso3}/indicator/${indicatorCode}?format=json&per_page=20&date=2010:2024`,
      10000
    );
    const data = await resp.json();
    if (Array.isArray(data) && data[1]) {
      return data[1]
        .filter((item: any) => item.value !== null && item.value !== undefined)
        .slice(0, 10)
        .map((item: any) => ({
          value: parseFloat(item.value),
          period: item.date,
        }));
    }
  } catch (e) {
    // Silent fail — partial data is expected
  }
  return [];
}

async function buildKPIsForCountry(iso3: string): Promise<Record<string, any>> {
  const kpis: Record<string, any> = {};
  
  // Fetch all indicators in parallel (now supports multiple indicators per domain)
  const tasks: { domain: string; code: string; metric: string; unit: string }[] = [];
  for (const [domain, indicators] of Object.entries(WB_INDICATORS)) {
    for (const ind of indicators) {
      tasks.push({ domain, code: ind.code, metric: ind.metric, unit: ind.unit });
    }
  }
  
  const results = await Promise.all(
    tasks.map(t => 
      fetchIndicatorForCountry(iso3, t.code).then(data => ({ ...t, data }))
    )
  );
  
  // Group results by domain
  const domainMetrics: Record<string, any[]> = {};
  for (const { domain, data, metric, unit } of results) {
    if (!domainMetrics[domain]) domainMetrics[domain] = [];
    for (const d of data) {
      domainMetrics[domain].push({
        metric,
        period: d.period,
        value: d.value,
        unit,
        source: "worldbank",
        raw: {},
      });
    }
  }
  
  for (const [domain] of Object.entries(WB_INDICATORS)) {
    const metrics = domainMetrics[domain] || [];
    kpis[domain] = {
      metrics,
      completeness: Math.min(1, metrics.length / 5),
    };
  }
  
  return kpis;
}

Deno.serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startMs = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Parse optional params
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const maxCountries = body.max_countries || 999;
    const skipExisting = body.skip_existing !== false; // default true

    // 1. Fetch all countries from World Bank
    console.log("Fetching global country list from World Bank...");
    const allCountries = await fetchAllCountries();
    console.log(`Found ${allCountries.length} sovereign countries`);

    // 2. Check which profiles already exist
    let existingIso3s = new Set<string>();
    if (skipExisting) {
      const { data: existing } = await supabase
        .from("country_profiles")
        .select("iso3");
      existingIso3s = new Set((existing || []).map((e: any) => e.iso3));
      console.log(`${existingIso3s.size} profiles already exist, skipping those`);
    }

    // 3. Filter to countries needing profiles
    const toProcess = allCountries
      .filter(c => !existingIso3s.has(c.id))
      .slice(0, maxCountries);
    
    console.log(`Processing ${toProcess.length} new countries`);

    if (dryRun) {
      return new Response(JSON.stringify({
        success: true,
        dry_run: true,
        total_countries: allCountries.length,
        existing: existingIso3s.size,
        to_process: toProcess.length,
        countries: toProcess.map(c => ({ iso3: c.id, name: c.name })),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 4. Process in batches
    let processed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
      const batch = toProcess.slice(i, i + BATCH_SIZE);
      
      const results = await Promise.allSettled(
        batch.map(async (country) => {
          const kpis = await buildKPIsForCountry(country.id);
          
          // Count total metrics
          const totalMetrics = Object.values(kpis).reduce(
            (sum: number, d: any) => sum + (d.metrics?.length || 0), 0
          );

          const { error } = await supabase.from("country_profiles").upsert({
            iso3: country.id,
            country_name: country.name,
            compiled_at: new Date().toISOString(),
            kpis,
            confidence: Math.min(1, totalMetrics / 40),
          }, { onConflict: "iso3" });

          if (error) throw new Error(`${country.id}: ${error.message}`);

          // Also cache in geo_catalog
          await supabase.from("geo_catalog").upsert({
            name: country.name,
            iso3: country.id,
            lat: parseFloat(country.latitude) || 0,
            lon: parseFloat(country.longitude) || 0,
            resolved_at: new Date().toISOString(),
          }, { onConflict: "iso3" });

          return { iso3: country.id, totalMetrics };
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled") {
          processed++;
        } else {
          failed++;
          errors.push(String(r.reason).substring(0, 100));
        }
      }

      // Brief pause between batches to avoid rate limiting
      if (i + BATCH_SIZE < toProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log(`Progress: ${processed + failed}/${toProcess.length} (${processed} ok, ${failed} failed)`);
    }

    const elapsed = Date.now() - startMs;

    // Log telemetry
    await supabase.from("automation_logs").insert({
      job_name: "populate-global-profiles",
      status: failed > toProcess.length * 0.5 ? "partial" : "success",
      message: JSON.stringify({
        totalCountries: allCountries.length,
        existingSkipped: existingIso3s.size,
        processed,
        failed,
        elapsedMs: elapsed,
        errors: errors.slice(0, 10),
      }),
    });

    return new Response(JSON.stringify({
      success: true,
      totalCountries: allCountries.length,
      existingSkipped: existingIso3s.size,
      processed,
      failed,
      elapsedMs: elapsed,
      errors: errors.slice(0, 5),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("populate-global-profiles error:", err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
