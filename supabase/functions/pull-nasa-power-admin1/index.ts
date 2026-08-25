// NASA POWER admin-1 observation puller. Preserves daily history while
// suppressing exact re-insertion of observations already stored for the same
// region, indicator, source, and observation date.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { startProviderRun, finishProviderRun, failProviderRun } from "../_shared/provider-telemetry.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const PARAMS = "T2M,PRECTOTCORR,RH2M,WS10M";
const BATCH = 60;
const STATE_KEY = "nasa_power_admin1_cursor";
const SOURCE = "NASA POWER";

interface RegionRow {
  id: string;
  country_iso3: string;
  lat: number;
  lon: number;
  name: string;
}

interface ExistingObservation {
  region_id: string;
  indicator_key: string;
  captured_at: string;
}

interface CommunityMetricRow {
  region_id: string;
  country_iso3: string;
  domain: "environment";
  indicator_key: string;
  value: number;
  unit: string;
  source: string;
  captured_at: string;
  metadata: Record<string, unknown>;
}

interface NasaPayload {
  properties?: { parameter?: Record<string, Record<string, number>> };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function observationKey(regionId: string, indicator: string, capturedAt: string): string {
  return `${regionId}|${indicator}|${capturedAt.slice(0, 10)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const auth = await requireAdminOrCron(req, cors);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const run = await startProviderRun(supabase, {
    provider_name: "nasa_power_admin1",
    endpoint: "pull-nasa-power-admin1",
    scheduler_source: req.headers.get("x-scheduler-source") ?? auth.via ?? "manual",
  });

  const startedAt = Date.now();
  let inserted = 0;
  let errors = 0;
  let fetchedRegions = 0;
  let duplicatesSkipped = 0;

  try {
    const { data: state, error: stateError } = await supabase
      .from("cron_job_state")
      .select("state_value")
      .eq("state_key", STATE_KEY)
      .maybeSingle();
    if (stateError) throw stateError;
    const stateValue = state?.state_value && typeof state.state_value === "object" && !Array.isArray(state.state_value)
      ? state.state_value as Record<string, unknown>
      : {};
    const cursor = typeof stateValue.cursor === "string" ? stateValue.cursor : null;

    let query = supabase.from("admin_regions")
      .select("id,country_iso3,lat,lon,name")
      .eq("admin_level", 1)
      .not("lat", "is", null)
      .not("lon", "is", null)
      .not("country_iso3", "is", null)
      .order("id", { ascending: true })
      .limit(BATCH);
    if (cursor) query = query.gt("id", cursor);
    const { data: regionData, error: regionError } = await query;
    if (regionError) throw regionError;
    const regions = (regionData ?? []) as RegionRow[];

    if (regions.length === 0) {
      const { error: resetError } = await supabase.from("cron_job_state").upsert({
        state_key: STATE_KEY,
        state_value: { cursor: null },
        updated_at: new Date().toISOString(),
      });
      if (resetError) throw resetError;
      await finishProviderRun(supabase, run, { records_fetched: 0, records_inserted: 0 });
      return json({ ok: true, message: "cycle complete; cursor reset", inserted, fetched_regions: 0, authenticated_via: auth.via });
    }

    const endDate = new Date();
    endDate.setUTCDate(endDate.getUTCDate() - 2);
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - 7);
    const formatDate = (date: Date) => `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
    const rangeStart = `${startDate.toISOString().slice(0, 10)}T00:00:00.000Z`;
    const rangeEnd = `${endDate.toISOString().slice(0, 10)}T23:59:59.999Z`;

    const { data: existingData, error: existingError } = await supabase
      .from("community_metrics")
      .select("region_id,indicator_key,captured_at")
      .in("region_id", regions.map((region) => region.id))
      .eq("source", SOURCE)
      .gte("captured_at", rangeStart)
      .lte("captured_at", rangeEnd)
      .limit(10_000);
    if (existingError) throw existingError;
    const existingKeys = new Set(
      ((existingData ?? []) as ExistingObservation[]).map((row) => observationKey(row.region_id, row.indicator_key, row.captured_at)),
    );

    for (const region of regions) {
      try {
        const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=${PARAMS}&community=AG&longitude=${region.lon}&latitude=${region.lat}&start=${formatDate(startDate)}&end=${formatDate(endDate)}&format=JSON`;
        const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok) {
          errors++;
          continue;
        }
        const payload = await response.json() as NasaPayload;
        const parameters = payload.properties?.parameter ?? {};
        const rows: CommunityMetricRow[] = [];

        for (const [parameterName, byDay] of Object.entries(parameters)) {
          for (const [day, value] of Object.entries(byDay)) {
            if (!Number.isFinite(value) || value === -999 || !/^\d{8}$/.test(day)) continue;
            const capturedAt = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T00:00:00.000Z`;
            const indicatorKey = parameterName.toLowerCase();
            const key = observationKey(region.id, indicatorKey, capturedAt);
            if (existingKeys.has(key)) {
              duplicatesSkipped++;
              continue;
            }
            existingKeys.add(key);
            rows.push({
              region_id: region.id,
              country_iso3: region.country_iso3,
              domain: "environment",
              indicator_key: indicatorKey,
              value,
              unit: parameterName === "T2M" ? "celsius" : parameterName === "PRECTOTCORR" ? "mm/day" : parameterName === "RH2M" ? "percent" : "m/s",
              source: SOURCE,
              captured_at: capturedAt,
              metadata: { admin1: region.name, lat: region.lat, lon: region.lon, provider_parameter: parameterName },
            });
          }
        }

        fetchedRegions++;
        if (rows.length > 0) {
          const { error: insertError } = await supabase.from("community_metrics").insert(rows);
          if (insertError) {
            errors++;
            console.error("NASA POWER insert", insertError.message);
          } else {
            inserted += rows.length;
          }
        }
      } catch (error) {
        errors++;
        console.error("NASA POWER region error", error);
      }
    }

    const lastId = regions[regions.length - 1].id;
    const { error: cursorError } = await supabase.from("cron_job_state").upsert({
      state_key: STATE_KEY,
      state_value: { cursor: lastId },
      updated_at: new Date().toISOString(),
    });
    if (cursorError) throw cursorError;

    await supabase.from("system_logs").insert({
      action: "pull_nasa_power_admin1",
      result: `fetched_regions=${fetchedRegions} inserted=${inserted} duplicates_skipped=${duplicatesSkipped} errors=${errors}`,
      log_level: errors ? "warning" : "info",
      division: "ingestion",
    });
    await finishProviderRun(supabase, run, {
      records_fetched: fetchedRegions,
      records_inserted: inserted,
      records_normalized: inserted,
      error_count: errors,
    });

    return json({
      ok: errors === 0,
      fetched_regions: fetchedRegions,
      inserted,
      duplicates_skipped: duplicatesSkipped,
      errors,
      duration_ms: Date.now() - startedAt,
      authenticated_via: auth.via,
    });
  } catch (error) {
    await failProviderRun(supabase, run, error, {
      records_inserted: inserted,
      records_fetched: fetchedRegions,
      error_count: errors,
    });
    return json({ error: error instanceof Error ? error.message : String(error), inserted }, 500);
  }
});
