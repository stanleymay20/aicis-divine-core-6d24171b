// Backfill country-level population/geography from REST Countries without
// inventing classifications or overwriting existing provenance metadata.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const FN = "backfill-l0-population";

interface RestCountry {
  cca3?: string;
  population?: number;
  area?: number;
  latlng?: number[];
}

interface AdminRegionRow {
  id: string;
  country_iso3: string | null;
  lat: number | null;
  lon: number | null;
  population_est: number | null;
  area_km2: number | null;
  metadata: Record<string, unknown> | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isRestCountry(value: unknown): value is RestCountry {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    const { data: canonicalAnchors, error: anchorError } = await supabase.rpc("ensure_l0_reporting_anchors");
    if (anchorError) throw anchorError;

    const response = await fetch(
      "https://restcountries.com/v3.1/all?fields=cca3,population,area,latlng",
      { signal: AbortSignal.timeout(20_000) },
    );
    if (!response.ok) throw new Error(`restcountries_http_${response.status}`);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error("restcountries_invalid_payload");

    const sourceMap = new Map<string, { population: number; area: number | null; lat: number | null; lon: number | null }>();
    for (const item of payload) {
      if (!isRestCountry(item)) continue;
      const iso3 = typeof item.cca3 === "string" ? item.cca3.toUpperCase() : "";
      const population = Number(item.population);
      if (!/^[A-Z]{3}$/.test(iso3) || !Number.isFinite(population) || population <= 0) continue;
      const area = Number(item.area);
      const lat = Array.isArray(item.latlng) ? Number(item.latlng[0]) : NaN;
      const lon = Array.isArray(item.latlng) ? Number(item.latlng[1]) : NaN;
      sourceMap.set(iso3, {
        population,
        area: Number.isFinite(area) && area > 0 ? area : null,
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lon) ? lon : null,
      });
    }

    const { data: rowData, error: rowError } = await supabase
      .from("admin_regions")
      .select("id,country_iso3,lat,lon,population_est,area_km2,metadata")
      .eq("admin_level", 0);
    if (rowError) throw rowError;

    const rows = (rowData ?? []) as AdminRegionRow[];
    let updated = 0;
    let noProviderMatch = 0;
    let alreadyComplete = 0;
    const now = new Date().toISOString();

    for (const row of rows) {
      const iso3 = row.country_iso3?.toUpperCase() ?? "";
      const observed = sourceMap.get(iso3);
      if (!observed) {
        noProviderMatch++;
        continue;
      }

      // The exact 1,000,000 value is a known historical placeholder in this
      // dataset, so replace it only when the provider supplies an observation.
      const needsPopulation = !row.population_est || row.population_est <= 0 || row.population_est === 1_000_000;
      const needsLat = row.lat === null && observed.lat !== null;
      const needsLon = row.lon === null && observed.lon !== null;
      const needsArea = (!row.area_km2 || row.area_km2 <= 0) && observed.area !== null;
      if (!needsPopulation && !needsLat && !needsLon && !needsArea) {
        alreadyComplete++;
        continue;
      }

      const patch: Record<string, unknown> = {
        metadata: {
          ...(row.metadata ?? {}),
          restcountries_backfill: {
            provider: "REST Countries v3.1",
            observed_at: now,
            fields_updated: [
              ...(needsPopulation ? ["population_est"] : []),
              ...(needsLat ? ["lat"] : []),
              ...(needsLon ? ["lon"] : []),
              ...(needsArea ? ["area_km2"] : []),
            ],
          },
        },
      };
      if (needsPopulation) patch.population_est = observed.population;
      if (needsLat) patch.lat = observed.lat;
      if (needsLon) patch.lon = observed.lon;
      if (needsArea) patch.area_km2 = observed.area;

      const { error: updateError } = await supabase.from("admin_regions").update(patch).eq("id", row.id);
      if (updateError) throw updateError;
      updated++;
    }

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: "success",
      message: `canonical_anchors=${canonicalAnchors ?? 0} updated=${updated} complete=${alreadyComplete} no_provider_match=${noProviderMatch}`,
    });

    return json({
      ok: true,
      canonical_anchors_created: canonicalAnchors ?? 0,
      updated,
      considered: rows.length,
      already_complete: alreadyComplete,
      no_provider_match: noProviderMatch,
      provider: "REST Countries v3.1",
      authenticated_via: auth.via,
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
