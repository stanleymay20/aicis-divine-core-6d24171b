import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN = "village-inference-engine";
const MAX_REGION_LIMIT = 100;

type Results = {
  regions_processed: number;
  indicators_created: number;
  satellite_tiles: number;
  errors: string[];
  skipped_synthetic: number;
};

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const runRow = await supabase
    .from("subnational_inference_runs")
    .insert({ function_name: FN, status: "started" })
    .select("run_id")
    .single();
  const runId: string | null = runRow.data?.run_id ?? null;

  try {
    const body = await req.json().catch(() => ({}));
    const countryIso3 = String(body.country_iso3 ?? "").trim().toUpperCase();
    const adminLevel = body.admin_level === undefined ? undefined : Number(body.admin_level);
    const limit = Math.min(Math.max(Number(body.limit ?? 50), 1), MAX_REGION_LIMIT);

    if (!/^[A-Z]{3}$/.test(countryIso3)) {
      await closeRun(supabase, runId, {
        status: "failed",
        duration_ms: Date.now() - start,
        error_message: "valid country_iso3 required",
      });
      return json({ error: "valid country_iso3 required" }, 400);
    }

    const results: Results = {
      regions_processed: 0,
      indicators_created: 0,
      satellite_tiles: 0,
      errors: [],
      skipped_synthetic: 0,
    };

    let regions = await fetchRegions(supabase, countryIso3, adminLevel, limit);
    if (regions.length === 0) {
      await seedRegionsFromOverpass(supabase, countryIso3);
      regions = await fetchRegions(supabase, countryIso3, adminLevel, limit);
    }

    for (const region of regions) {
      await collectObservedIndicatorsForRegion(supabase, region, results);
      results.regions_processed++;
    }

    const finalStatus = results.indicators_created === 0
      ? "zero_write"
      : results.errors.length > 0 ? "partial" : "succeeded";

    await closeRun(supabase, runId, {
      status: finalStatus,
      country_iso3: countryIso3,
      admin_level: adminLevel ?? null,
      rows_written: results.indicators_created,
      rows_attempted: results.regions_processed,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - start,
      metadata: {
        evidence_policy: "observed_or_deterministically_derived_only",
        synthetic_llm_indicators_disabled: true,
        synthetic_nightlight_proxy_disabled: true,
        satellite_tiles: results.satellite_tiles,
        errors: results.errors.slice(0, 5),
      },
    });

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: results.errors.length > 0 ? "partial" : "success",
      message: `processed=${results.regions_processed} indicators=${results.indicators_created} errors=${results.errors.length} truth_floor=observed_only`,
    });

    await supabase.rpc("schedule_village_seed_retry", {
      _iso3: countryIso3,
      _success: results.indicators_created > 0,
      _error: results.errors[0] ?? null,
    });

    return json({ success: true, run_id: runId, results, evidence_policy: "observed_or_deterministically_derived_only" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: "error",
      message: message.slice(0, 500),
    });
    await closeRun(supabase, runId, {
      status: "failed",
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - start,
      error_message: message.slice(0, 1000),
    });
    return json({ error: message, run_id: runId }, 500);
  }
});

async function fetchRegions(supabase: any, iso3: string, adminLevel: number | undefined, limit: number) {
  let query = supabase
    .from("admin_regions")
    .select("id,name,admin_level,lat,lon,country_iso3,population_est,urban_rural")
    .eq("country_iso3", iso3)
    .not("lat", "is", null)
    .not("lon", "is", null)
    .limit(limit);
  if (adminLevel !== undefined && Number.isFinite(adminLevel)) query = query.eq("admin_level", adminLevel);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function closeRun(supabase: any, runId: string | null, values: Record<string, unknown>) {
  if (!runId) return;
  await supabase.from("subnational_inference_runs").update(values).eq("run_id", runId);
}

async function seedRegionsFromOverpass(supabase: any, iso3: string): Promise<number> {
  try {
    const countryResp = await fetch(
      `https://nominatim.openstreetmap.org/search?country=${encodeURIComponent(iso3)}&format=json&limit=1&addressdetails=1`,
      { headers: { "User-Agent": "AICIS/2.0 (subnational evidence collection)" } },
    );
    if (!countryResp.ok) return 0;
    const countryData = await countryResp.json();
    if (!Array.isArray(countryData) || countryData.length === 0) return 0;

    const country = countryData[0];
    const lat = Number(country.lat);
    const lon = Number(country.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 0;

    const { data: countryRegion } = await supabase
      .from("admin_regions")
      .upsert({
        name: country.display_name?.split(",")[0] || iso3,
        admin_level: 0,
        country_iso3: iso3,
        lat,
        lon,
        osm_id: Number(country.osm_id) || null,
        source: "nominatim",
      }, { onConflict: "osm_id" })
      .select("id")
      .single();

    const parentId = countryRegion?.id ?? null;
    let count = parentId ? 1 : 0;

    const overpassQuery = `[out:json][timeout:30];area["ISO3166-1:alpha3"="${iso3}"]->.searchArea;(relation["admin_level"="4"]["boundary"="administrative"](area.searchArea););out center 100;`;
    const overpassResp = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(overpassQuery)}`,
    });

    if (overpassResp.ok) {
      const payload = await overpassResp.json();
      for (const el of (payload.elements ?? []).slice(0, 200)) {
        const rLat = Number(el.center?.lat ?? el.lat);
        const rLon = Number(el.center?.lon ?? el.lon);
        if (!Number.isFinite(rLat) || !Number.isFinite(rLon)) continue;
        const osmAdmin = Number(el.tags?.admin_level ?? 4);
        const mappedLevel = osmAdmin <= 4 ? 1 : osmAdmin <= 6 ? 2 : osmAdmin <= 8 ? 3 : 4;
        const { error } = await supabase.from("admin_regions").upsert({
          name: el.tags?.name || el.tags?.["name:en"] || `Region ${el.id}`,
          admin_level: mappedLevel,
          parent_id: parentId,
          country_iso3: iso3,
          osm_id: el.id,
          lat: rLat,
          lon: rLon,
          population_est: Number(el.tags?.population) || null,
          source: "overpass",
        }, { onConflict: "osm_id" });
        if (!error) count++;
      }
    }

    const villageQuery = `[out:json][timeout:30];area["ISO3166-1:alpha3"="${iso3}"]->.searchArea;(node["place"~"village|hamlet|town"](area.searchArea););out 500;`;
    const villageResp = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(villageQuery)}`,
    });
    if (villageResp.ok) {
      const payload = await villageResp.json();
      for (const v of (payload.elements ?? []).slice(0, 500)) {
        const vLat = Number(v.lat);
        const vLon = Number(v.lon);
        if (!Number.isFinite(vLat) || !Number.isFinite(vLon)) continue;
        const { error } = await supabase.from("admin_regions").upsert({
          name: v.tags?.name || v.tags?.["name:en"] || `Settlement ${v.id}`,
          admin_level: 4,
          parent_id: parentId,
          country_iso3: iso3,
          osm_id: v.id,
          lat: vLat,
          lon: vLon,
          population_est: Number(v.tags?.population) || null,
          urban_rural: v.tags?.place === "town" ? "urban" : "rural",
          source: "overpass",
        }, { onConflict: "osm_id" });
        if (!error) count++;
      }
    }

    return count;
  } catch (error) {
    console.error("seedRegionsFromOverpass error", error);
    return 0;
  }
}

async function collectObservedIndicatorsForRegion(supabase: any, region: any, results: Results) {
  try {
    const lat = Number(region.lat);
    const lon = Number(region.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const indicators = await fetchNASAPower(lat, lon);
    if (!indicators) return;

    for (const indicator of indicators) {
      const observedAt = indicator.observed_at;
      const { error } = await supabase.from("village_indicators").insert({
        region_id: region.id,
        domain: indicator.domain,
        indicator: indicator.indicator,
        value: indicator.value,
        unit: indicator.unit,
        confidence: indicator.derived ? 0.8 : 0.95,
        data_source: indicator.derived ? "deterministic_derivation" : "nasa_power",
        inference_model: indicator.derived ? indicator.method : "NASA_POWER_API",
        raw: {
          ...indicator.raw,
          observed_at: observedAt,
          evidence_class: indicator.derived ? "derived_from_observed_measurements" : "observed_remote_sensing",
        },
      });
      if (!error) results.indicators_created++;
      else results.errors.push(`Region ${region.name}: ${error.message}`);
    }
  } catch (error) {
    results.errors.push(`Region ${region.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function fetchNASAPower(lat: number, lon: number) {
  try {
    const today = new Date();
    const endDate = new Date(today.getTime() - 7 * 86400000);
    const startDate = new Date(endDate.getTime() - 30 * 86400000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
    const parameters = "T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,ALLSKY_SFC_SW_DWN,WS2M,RH2M";
    const url = `https://power.larc.nasa.gov/api/temporal/daily/point?start=${fmt(startDate)}&end=${fmt(endDate)}&latitude=${lat}&longitude=${lon}&community=AG&parameters=${parameters}&format=JSON`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    const p = data.properties?.parameter ?? {};
    const observedAt = endDate.toISOString().slice(0, 10);

    const average = (obj: Record<string, number>) => {
      const values = Object.values(obj ?? {}).filter((value) => Number.isFinite(value) && value !== -999);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    };

    const t2m = average(p.T2M);
    const precipitation = average(p.PRECTOTCORR);
    const solar = average(p.ALLSKY_SFC_SW_DWN);
    const humidity = average(p.RH2M);
    const wind = average(p.WS2M);
    const out: any[] = [];

    const addObserved = (domain: string, indicator: string, value: number | null, unit: string, param: string) => {
      if (value === null) return;
      out.push({ domain, indicator, value: Math.round(value * 10) / 10, unit, observed_at: observedAt, derived: false, raw: { nasa_parameter: param } });
    };

    addObserved("environment", "avg_temperature_c", t2m, "°C", "T2M");
    addObserved("environment", "daily_precipitation_mm", precipitation, "mm/day", "PRECTOTCORR");
    addObserved("environment", "solar_irradiance", solar, "kWh/m²/day", "ALLSKY_SFC_SW_DWN");
    addObserved("health", "relative_humidity_pct", humidity, "%", "RH2M");
    addObserved("environment", "wind_speed_2m", wind, "m/s", "WS2M");

    if (t2m !== null && humidity !== null) {
      const heatStress = t2m > 35 && humidity > 60 ? 9 : t2m > 30 && humidity > 50 ? 7 : t2m > 25 ? 4 : 2;
      out.push({
        domain: "health",
        indicator: "heat_stress_index",
        value: heatStress,
        unit: "1-10",
        observed_at: observedAt,
        derived: true,
        method: "AICIS_HEAT_STRESS_RULE_V1",
        raw: { inputs: { avg_temperature_c: t2m, relative_humidity_pct: humidity } },
      });
    }

    if (solar !== null) {
      const score = solar > 6 ? 9 : solar > 4.5 ? 7 : solar > 3 ? 5 : 3;
      out.push({
        domain: "infrastructure",
        indicator: "solar_energy_potential_score",
        value: score,
        unit: "1-10",
        observed_at: observedAt,
        derived: true,
        method: "AICIS_SOLAR_POTENTIAL_RULE_V1",
        raw: { inputs: { solar_irradiance: solar } },
      });
    }

    return out;
  } catch (error) {
    console.error("NASA POWER error", error);
    return null;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
