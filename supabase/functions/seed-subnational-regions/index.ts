import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const FN = "seed-subnational-regions";
const MAX_VILLAGES = 500;

type SupabaseClient = ReturnType<typeof createClient>;

interface RegionInsert {
  name: string;
  admin_level: number;
  parent_id?: string | null;
  country_iso3: string;
  iso_code?: string | null;
  osm_id?: number | null;
  lat?: number | null;
  lon?: number | null;
  population_est?: number | null;
  urban_rural?: "urban" | "rural" | null;
  source: string;
  metadata?: Record<string, unknown>;
}

interface OsmElement {
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

interface NominatimResult {
  display_name?: string;
  lat?: string;
  lon?: string;
  osm_id?: number | string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function positiveInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function insertRegion(supabase: SupabaseClient, region: RegionInsert): Promise<string | null> {
  if (region.osm_id) {
    const { data: existing, error: existingError } = await supabase
      .from("admin_regions")
      .select("id")
      .eq("osm_id", region.osm_id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.id) return String(existing.id);
  }

  const { data: row, error } = await supabase.from("admin_regions").insert(region).select("id").single();
  if (error) {
    console.warn(`Insert failed for ${region.name}:`, error.message);
    return null;
  }
  return row?.id ? String(row.id) : null;
}

async function fetchOverpassWithTimeout(query: string, timeoutMs = 20_000): Promise<OsmElement[]> {
  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return [];
    const payload = await response.json() as { elements?: OsmElement[] };
    return Array.isArray(payload.elements) ? payload.elements : [];
  } catch {
    return [];
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const parsed = await req.json().catch(() => null);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "JSON body required" }, 400);
    const body = parsed as Record<string, unknown>;
    const iso3 = typeof body.country_iso3 === "string" ? body.country_iso3.trim().toUpperCase() : "";
    if (!/^[A-Z]{3}$/.test(iso3)) return json({ error: "valid country_iso3 required" }, 400);
    const includeVillages = body.include_villages === true;
    const requestedVillageLimit = Number(body.max_villages ?? 200);
    const maxVillages = Number.isFinite(requestedVillageLimit)
      ? Math.min(MAX_VILLAGES, Math.max(0, Math.floor(requestedVillageLimit)))
      : 200;

    const results = { countries: 0, provinces: 0, districts: 0, villages: 0, provider_gaps: [] as string[] };
    const { data: existingCountry, error: existingCountryError } = await supabase
      .from("admin_regions")
      .select("id")
      .eq("country_iso3", iso3)
      .eq("admin_level", 0)
      .maybeSingle();
    if (existingCountryError) throw existingCountryError;
    if (existingCountry) {
      return json({ success: true, message: `${iso3} already has a level-0 region`, skipped: true, authenticated_via: auth.via });
    }

    const countryResponse = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(iso3)}&format=json&limit=1&featuretype=country`,
      {
        headers: { "User-Agent": "AICIS/2.0 (subnational geography ingestion)" },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!countryResponse.ok) {
      results.provider_gaps.push(`Nominatim HTTP ${countryResponse.status}`);
      await supabase.from("automation_logs").insert({
        job_name: FN,
        status: "warning",
        message: `${iso3}: no geography written because Nominatim returned HTTP ${countryResponse.status}`,
      });
      return json({ success: false, reason: "country_geocoding_unavailable", results, authenticated_via: auth.via }, 502);
    }

    const countryPayload = await countryResponse.json() as NominatimResult[];
    const country = Array.isArray(countryPayload) ? countryPayload[0] : undefined;
    const countryLat = Number(country?.lat);
    const countryLon = Number(country?.lon);
    if (!country || !Number.isFinite(countryLat) || !Number.isFinite(countryLon)) {
      results.provider_gaps.push("Nominatim returned no usable country coordinate");
      await supabase.from("automation_logs").insert({
        job_name: FN,
        status: "warning",
        message: `${iso3}: no fallback geography created because provider returned no usable country match`,
      });
      return json({ success: false, reason: "country_geocoding_unavailable", results, authenticated_via: auth.via }, 502);
    }

    const osmId = Number(country.osm_id);
    const countryId = await insertRegion(supabase, {
      name: country.display_name?.split(",")[0]?.trim() || iso3,
      admin_level: 0,
      country_iso3: iso3,
      lat: countryLat,
      lon: countryLon,
      osm_id: Number.isFinite(osmId) ? osmId : null,
      source: "nominatim",
      metadata: { provider: "OpenStreetMap Nominatim", lookup: iso3 },
    });
    if (!countryId) throw new Error("country_region_insert_failed");
    results.countries = 1;

    const provinceElements = await fetchOverpassWithTimeout(
      `[out:json][timeout:15];area["ISO3166-1:alpha3"="${iso3}"]->.a;rel["admin_level"="4"]["boundary"="administrative"](area.a);out center 200;`,
      18_000,
    );
    for (const element of provinceElements) {
      const name = element.tags?.name || element.tags?.["name:en"];
      const lat = Number(element.center?.lat ?? element.lat);
      const lon = Number(element.center?.lon ?? element.lon);
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const id = await insertRegion(supabase, {
        name,
        admin_level: 1,
        parent_id: countryId,
        country_iso3: iso3,
        iso_code: element.tags?.["ISO3166-2"] ?? null,
        osm_id: Number.isFinite(Number(element.id)) ? Number(element.id) : null,
        lat,
        lon,
        population_est: positiveInteger(element.tags?.population),
        source: "overpass",
      });
      if (id) results.provinces++;
    }

    const districtElements = await fetchOverpassWithTimeout(
      `[out:json][timeout:15];area["ISO3166-1:alpha3"="${iso3}"]->.a;rel["admin_level"="6"]["boundary"="administrative"](area.a);out center 200;`,
      18_000,
    );
    for (const element of districtElements) {
      const name = element.tags?.name || element.tags?.["name:en"];
      const lat = Number(element.center?.lat ?? element.lat);
      const lon = Number(element.center?.lon ?? element.lon);
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const id = await insertRegion(supabase, {
        name,
        admin_level: 2,
        parent_id: countryId,
        country_iso3: iso3,
        osm_id: Number.isFinite(Number(element.id)) ? Number(element.id) : null,
        lat,
        lon,
        population_est: positiveInteger(element.tags?.population),
        source: "overpass",
      });
      if (id) results.districts++;
    }

    if (includeVillages && maxVillages > 0) {
      const villageElements = await fetchOverpassWithTimeout(
        `[out:json][timeout:15];area["ISO3166-1:alpha3"="${iso3}"]->.a;(node["place"~"village|hamlet|town"](area.a););out ${maxVillages};`,
        18_000,
      );
      for (const village of villageElements.slice(0, maxVillages)) {
        const name = village.tags?.name || village.tags?.["name:en"];
        const lat = Number(village.lat);
        const lon = Number(village.lon);
        if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const id = await insertRegion(supabase, {
          name,
          admin_level: 4,
          parent_id: countryId,
          country_iso3: iso3,
          osm_id: Number.isFinite(Number(village.id)) ? Number(village.id) : null,
          lat,
          lon,
          population_est: positiveInteger(village.tags?.population),
          urban_rural: village.tags?.place === "town" ? "urban" : "rural",
          source: "overpass",
          metadata: { place_type: village.tags?.place ?? null },
        });
        if (id) results.villages++;
      }
    }

    const total = results.countries + results.provinces + results.districts + results.villages;
    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: "success",
      message: `${iso3}: stored ${total} provider-backed regions (${results.provinces} admin1/${results.districts} admin2/${results.villages} settlements)`,
    });

    return json({ success: true, results, authenticated_via: auth.via });
  } catch (error) {
    console.error(`[${FN}] Error:`, error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
