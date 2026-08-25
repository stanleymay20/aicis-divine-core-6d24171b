import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, corsHeaders, errorResponse, jsonResponse } from "../_shared/resilience.ts";
import { startProviderRun, finishProviderRun, failProviderRun } from "../_shared/provider-telemetry.ts";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "fetch-food-global";
const TIMEOUT_MS = 15_000;

type WfpPayload = {
  country?: {
    name?: unknown;
    metrics?: {
      fcs?: unknown;
      ipc_phase?: unknown;
      people_at_risk?: unknown;
      rcsi?: unknown;
    };
  };
};

type NasaPayload = {
  properties?: {
    parameter?: {
      T2M?: Record<string, unknown>;
      PRECTOTCORR?: Record<string, unknown>;
      PRECTOT?: Record<string, unknown>;
    };
  };
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const numeric = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== -999 ? parsed : null;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const validSeries = (series?: Record<string, unknown>): number[] =>
  Object.values(series ?? {}).flatMap((value) => {
    const parsed = numeric(value);
    return parsed == null ? [] : [parsed];
  });

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const run = await startProviderRun(supabase, {
    provider_name: FN,
    endpoint: FN,
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  try {
    structuredLog("info", FN, "Starting food data collection");
    const results: { food: number; errors: string[] } = { food: 0, errors: [] };

    await resilientCall(`${FN}:wfp`, async () => {
      for (const iso3 of ["GHA", "KEN", "ETH", "SOM", "YEM"]) {
        try {
          const response = await fetch(
            `https://hungermap.wfp.org/api/v1/foodsecurity?country=${iso3}`,
            { signal: AbortSignal.timeout(TIMEOUT_MS) },
          );
          if (!response.ok) {
            structuredLog("warn", FN, `WFP ${iso3}: HTTP ${response.status}`);
            continue;
          }

          const payload = await response.json() as WfpPayload;
          const metrics = payload.country?.metrics;
          const fcs = numeric(metrics?.fcs);
          if (fcs == null) {
            structuredLog("warn", FN, `WFP ${iso3}: food-consumption score missing; no observation written`);
            continue;
          }

          const { error } = await supabase.from("food_data").insert({
            country: text(payload.country?.name) ?? iso3,
            iso_code: iso3,
            source: "wfp",
            metric_name: "food_insecurity",
            value: fcs,
            unit: "fcs_score",
            ipc_phase: numeric(metrics?.ipc_phase),
            date: new Date().toISOString().slice(0, 10),
            metadata: {
              people_insecure: numeric(metrics?.people_at_risk),
              rcsi: numeric(metrics?.rcsi),
              missing_values_preserved: true,
            },
          });
          if (error) throw error;
          results.food += 1;
        } catch (error) {
          structuredLog("warn", FN, `WFP ${iso3} failed: ${messageOf(error)}`);
        }
      }
    }, { timeoutMs: TIMEOUT_MS }).catch((error: unknown) => {
      const message = `WFP: ${messageOf(error)}`;
      results.errors.push(message);
      structuredLog("warn", FN, message);
    });

    await resilientCall(`${FN}:nasa`, async () => {
      const locations = [
        { name: "Ghana", lat: 7.9465, lon: -1.0232, iso3: "GHA" },
        { name: "Kenya", lat: -0.0236, lon: 37.9062, iso3: "KEN" },
        { name: "India", lat: 20.5937, lon: 78.9629, iso3: "IND" },
      ];
      const endDate = new Date();
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const formatDate = (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, "");

      for (const location of locations) {
        try {
          const response = await fetch(
            `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,PRECTOTCORR&community=ag&longitude=${location.lon}&latitude=${location.lat}&start=${formatDate(startDate)}&end=${formatDate(endDate)}&format=JSON`,
            { signal: AbortSignal.timeout(TIMEOUT_MS) },
          );
          if (!response.ok) {
            structuredLog("warn", FN, `NASA ${location.iso3}: HTTP ${response.status}`);
            continue;
          }

          const payload = await response.json() as NasaPayload;
          const parameters = payload.properties?.parameter;
          const temperatures = validSeries(parameters?.T2M);
          const precipitation = validSeries(parameters?.PRECTOTCORR ?? parameters?.PRECTOT);
          if (temperatures.length === 0) continue;

          const averageTemperature = temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length;
          const totalPrecipitation = precipitation.length > 0
            ? precipitation.reduce((sum, value) => sum + value, 0)
            : null;

          const { error } = await supabase.from("food_data").insert({
            country: location.name,
            iso_code: location.iso3,
            source: "nasa_power",
            metric_name: "agricultural_conditions_temperature",
            value: averageTemperature,
            unit: "celsius",
            date: new Date().toISOString().slice(0, 10),
            latitude: location.lat,
            longitude: location.lon,
            metadata: {
              avg_temperature: averageTemperature,
              total_precipitation: totalPrecipitation,
              temperature_days_observed: temperatures.length,
              precipitation_days_observed: precipitation.length,
            },
          });
          if (error) throw error;
          results.food += 1;
        } catch (error) {
          structuredLog("warn", FN, `NASA ${location.iso3} failed: ${messageOf(error)}`);
        }
      }
    }, { timeoutMs: TIMEOUT_MS }).catch((error: unknown) => {
      const message = `NASA POWER: ${messageOf(error)}`;
      results.errors.push(message);
      structuredLog("warn", FN, message);
    });

    results.errors.push("FAOSTAT: no authorized API credential configured (provider unavailable)");
    structuredLog("warn", FN, "FAOSTAT skipped: no authorized API credential configured");

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: results.errors.length === 0 ? "success" : results.food > 0 ? "partial" : "error",
      message: `Fetched ${results.food} food records. Errors: ${results.errors.length}${results.errors.length ? ` [${results.errors.join("; ")}]` : ""}`,
    });

    structuredLog("info", FN, `Complete: ${results.food} records, ${results.errors.length} errors`, undefined, start);
    await finishProviderRun(supabase, run, {
      records_inserted: results.food,
      records_normalized: results.food,
      error_count: results.errors.length,
      error_summary: results.errors[0] ?? null,
    });
    return jsonResponse({ ok: true, message: `Fetched ${results.food} food records`, data: results });
  } catch (error) {
    const message = messageOf(error);
    structuredLog("error", FN, message, undefined, start);
    await supabase.from("automation_logs").insert({ job_name: FN, status: "error", message });
    await failProviderRun(supabase, run, error);
    return errorResponse(error);
  }
});
