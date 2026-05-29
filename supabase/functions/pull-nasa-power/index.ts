// NASA POWER daily climate (temperature, precipitation, solar radiation) — free, no API key.
// Pulls a 7-day window for ~30 representative country centroids.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { svcClient, writeNormalized, logRun, NormalizedRow } from "../_shared/normalized-write.ts";
import {
  startProviderRun,
  finishProviderRun,
  failProviderRun,
} from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN = "pull-nasa-power";

// Country centroid lat/lon for ~30 priority countries spanning every continent.
const POINTS: { iso3: string; lat: number; lon: number }[] = [
  { iso3: "USA", lat: 39.8, lon: -98.6 }, { iso3: "CAN", lat: 56.1, lon: -106.3 },
  { iso3: "MEX", lat: 23.6, lon: -102.5 }, { iso3: "BRA", lat: -14.2, lon: -51.9 },
  { iso3: "ARG", lat: -38.4, lon: -63.6 }, { iso3: "GBR", lat: 55.4, lon: -3.4 },
  { iso3: "FRA", lat: 46.6, lon: 1.9 }, { iso3: "DEU", lat: 51.2, lon: 10.5 },
  { iso3: "ESP", lat: 40.5, lon: -3.7 }, { iso3: "ITA", lat: 41.9, lon: 12.6 },
  { iso3: "RUS", lat: 61.5, lon: 105.3 }, { iso3: "TUR", lat: 38.9, lon: 35.2 },
  { iso3: "EGY", lat: 26.8, lon: 30.8 }, { iso3: "ZAF", lat: -30.6, lon: 22.9 },
  { iso3: "NGA", lat: 9.1, lon: 8.7 }, { iso3: "KEN", lat: -0.0, lon: 37.9 },
  { iso3: "ETH", lat: 9.1, lon: 40.5 }, { iso3: "SAU", lat: 23.9, lon: 45.1 },
  { iso3: "IRN", lat: 32.4, lon: 53.7 }, { iso3: "PAK", lat: 30.4, lon: 69.3 },
  { iso3: "IND", lat: 20.6, lon: 78.9 }, { iso3: "BGD", lat: 23.7, lon: 90.4 },
  { iso3: "CHN", lat: 35.9, lon: 104.2 }, { iso3: "JPN", lat: 36.2, lon: 138.3 },
  { iso3: "KOR", lat: 35.9, lon: 127.8 }, { iso3: "VNM", lat: 14.1, lon: 108.3 },
  { iso3: "IDN", lat: -0.8, lon: 113.9 }, { iso3: "AUS", lat: -25.3, lon: 133.8 },
  { iso3: "NZL", lat: -41.0, lon: 174.0 }, { iso3: "CHL", lat: -35.7, lon: -71.5 },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = svcClient();
  const run = await startProviderRun(supabase, {
    provider_name: "nasa_power",
    endpoint: FN,
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });
  const start = Date.now();
  const rows: NormalizedRow[] = [];
  const errors: string[] = [];

  // Last 7 complete days
  const end = new Date(Date.now() - 2 * 86400000); // POWER data lags 2 days
  const startD = new Date(end.getTime() - 6 * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const startStr = fmt(startD);
  const endStr = fmt(end);

  try {
    // Fire in parallel batches of 6 to avoid hammering NASA POWER
    for (let i = 0; i < POINTS.length; i += 6) {
      const batch = POINTS.slice(i, i + 6);
      await Promise.all(
        batch.map(async (p) => {
          try {
            const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,PRECTOTCORR,ALLSKY_SFC_SW_DWN&community=AG&latitude=${p.lat}&longitude=${p.lon}&start=${startStr}&end=${endStr}&format=JSON`;
            const r = await fetch(url, {
              headers: { "User-Agent": "AICIS/1.0" },
              signal: AbortSignal.timeout(10000),
            });
            if (!r.ok) {
              errors.push(`${p.iso3}:${r.status}`);
              return;
            }
            const data = await r.json();
            const params = data?.properties?.parameter ?? {};
            const map: Record<string, { metric: string; unit: string; domain: string }> = {
              T2M: { metric: "temperature_2m_c", unit: "celsius", domain: "climate" },
              PRECTOTCORR: { metric: "precipitation_mm_day", unit: "mm/day", domain: "climate" },
              ALLSKY_SFC_SW_DWN: { metric: "solar_irradiance_kwh_m2", unit: "kWh/m^2/day", domain: "climate" },
            };
            for (const [key, meta] of Object.entries(map)) {
              const series = params[key] || {};
              for (const [yyyymmdd, raw] of Object.entries(series)) {
                const v = Number(raw);
                if (!Number.isFinite(v) || v <= -900) continue;
                const period = `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
                rows.push({
                  provider_name: "nasa_power",
                  domain: meta.domain,
                  metric_name: meta.metric,
                  iso3: p.iso3,
                  period,
                  value: v,
                  unit: meta.unit,
                  provenance_source: "NASA POWER",
                  confidence: 0.95,
                });
              }
            }
          } catch (e) {
            errors.push(`${p.iso3}:${(e as Error).message}`);
          }
        })
      );
    }

    const { inserted, errors: writeErrs } = await writeNormalized(supabase, rows);
    const allErrs = [...errors, ...writeErrs];
    const status = inserted > 0 ? (allErrs.length ? "partial" : "success") : "error";
    await logRun(
      supabase,
      FN,
      status,
      `Inserted ${inserted}/${rows.length} NASA POWER rows in ${Date.now() - start}ms${allErrs.length ? " — " + allErrs.slice(0, 3).join("; ") : ""}`
    );
    await finishProviderRun(supabase, run, {
      records_fetched: rows.length,
      records_inserted: inserted,
      records_normalized: inserted,
      error_count: allErrs.length,
      error_summary: allErrs[0] ?? null,
    });

    return new Response(JSON.stringify({ ok: true, inserted, total: rows.length, errors: allErrs }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logRun(supabase, FN, "error", msg);
    await failProviderRun(supabase, run, e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
