// OECD Composite Leading Indicator puller, using SDMX-JSON.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { startProviderRun, finishProviderRun, failProviderRun } from "../_shared/provider-telemetry.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const OECD_ISO3 = [
  "AUS","AUT","BEL","CAN","CHL","COL","CRI","CZE","DNK","EST","FIN","FRA","DEU","GRC",
  "HUN","ISL","IRL","ISR","ITA","JPN","KOR","LVA","LTU","LUX","MEX","NLD","NZL","NOR",
  "POL","PRT","SVK","SVN","ESP","SWE","CHE","TUR","GBR","USA",
];

type DimensionValue = { id?: unknown };
type Dimension = { id?: unknown; values?: unknown };
type SeriesData = { observations?: unknown };
type OecdPayload = {
  data?: {
    dataSets?: Array<{ series?: unknown }>;
    structures?: Array<{ dimensions?: { series?: unknown; observation?: unknown } }>;
  };
};
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const numeric = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = await requireAdminOrCron(req, cors);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const run = await startProviderRun(supabase, {
    provider_name: "oecd-cli", endpoint: "pull-oecd",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });
  const started = Date.now();
  let inserted = 0;
  let errors = 0;

  try {
    const startPeriod = new Date().getUTCFullYear() - 2;
    for (let index = 0; index < OECD_ISO3.length; index += 6) {
      const countries = OECD_ISO3.slice(index, index + 6).join("+");
      const response = await fetch(
        `https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI,4.0/${countries}.M.LI...AA...H?startPeriod=${startPeriod}&format=jsondata`,
        { headers: { Accept: "application/vnd.sdmx.data+json" }, signal: AbortSignal.timeout(25_000) },
      );
      if (!response.ok) { errors += 1; continue; }
      const payload = await response.json().catch(() => null) as OecdPayload | null;
      if (!payload) { errors += 1; continue; }

      const dataSet = payload.data?.dataSets?.[0];
      const structures = payload.data?.structures?.[0]?.dimensions;
      const seriesDimensions = Array.isArray(structures?.series) ? structures.series as Dimension[] : [];
      const observationDimensions = Array.isArray(structures?.observation) ? structures.observation as Dimension[] : [];
      const refAreaIndex = seriesDimensions.findIndex((dimension) => dimension.id === "REF_AREA");
      if (refAreaIndex < 0) { errors += 1; continue; }
      const refAreaValues = Array.isArray(seriesDimensions[refAreaIndex]?.values)
        ? seriesDimensions[refAreaIndex].values as DimensionValue[] : [];
      const timeValues = Array.isArray(observationDimensions[0]?.values)
        ? observationDimensions[0].values as DimensionValue[] : [];
      const seriesObject = dataSet?.series && typeof dataSet.series === "object"
        ? dataSet.series as Record<string, SeriesData> : {};
      const observedAt = new Date().toISOString();
      const rows: Array<Record<string, unknown>> = [];

      for (const [seriesKey, seriesData] of Object.entries(seriesObject)) {
        const parts = seriesKey.split(":").map(Number);
        const areaIndex = parts[refAreaIndex];
        const areaCode = Number.isInteger(areaIndex) ? text(refAreaValues[areaIndex]?.id) : null;
        if (!areaCode) continue;
        const observations = seriesData.observations && typeof seriesData.observations === "object"
          ? seriesData.observations as Record<string, unknown> : {};
        for (const [observationKey, rawObservation] of Object.entries(observations)) {
          const timeIndex = Number(observationKey);
          const period = Number.isInteger(timeIndex) ? text(timeValues[timeIndex]?.id) : null;
          const observation = Array.isArray(rawObservation) ? rawObservation : [];
          const value = numeric(observation[0]);
          if (!period || value == null) continue;
          rows.push({
            provider_name: "oecd-cli", domain: "economic", metric_name: "composite_leading_indicator",
            iso3: areaCode, period, value, unit: "index",
            provenance_source: "OECD CLI", provenance_observed_at: observedAt,
            dedup_key: `oecd-cli:${areaCode}:${period}`,
            metadata: { observation_type: "OECD_published_index", analytical_confidence: "not_inferred" },
          });
        }
      }

      if (rows.length > 0) {
        const { error } = await supabase.from("normalized_metrics").upsert(rows, { onConflict: "dedup_key" });
        if (error) { errors += 1; console.error(error.message); } else inserted += rows.length;
      }
    }

    await supabase.from("system_logs").insert({
      action: "pull_oecd_cli", result: `inserted=${inserted} errors=${errors}`,
      log_level: errors ? "warning" : "info", division: "ingestion",
    });
    await finishProviderRun(supabase, run, {
      records_fetched: inserted, records_inserted: inserted, records_normalized: inserted, error_count: errors,
    });
    return json({ ok: true, inserted, errors, ms: Date.now() - started });
  } catch (error) {
    await failProviderRun(supabase, run, error, { records_inserted: inserted, error_count: errors });
    return json({ error: error instanceof Error ? error.message : String(error), inserted }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
