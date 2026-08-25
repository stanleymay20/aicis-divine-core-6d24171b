// IMF DataMapper annual macroeconomic observations.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { startProviderRun, finishProviderRun, failProviderRun } from "../_shared/provider-telemetry.ts";
import { requireAdminOrCron } from "../_shared/auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const INDICATORS = [
  { code: "NGDP_RPCH", metric: "real_gdp_growth_pct", domain: "economic", unit: "percent" },
  { code: "PCPIPCH", metric: "inflation_avg_pct", domain: "economic", unit: "percent" },
  { code: "GGXWDG_NGDP", metric: "govt_debt_pct_gdp", domain: "economic", unit: "percent" },
  { code: "BCA_NGDPD", metric: "current_account_pct_gdp", domain: "economic", unit: "percent" },
  { code: "LUR", metric: "unemployment_rate", domain: "economic", unit: "percent" },
];

type IndicatorValues = Record<string, Record<string, unknown>>;
type ImfPayload = { values?: Record<string, unknown> };
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
    provider_name: "imf-datamapper", endpoint: "pull-imf-sdmx",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });
  const started = Date.now();
  let inserted = 0;
  let errors = 0;

  try {
    for (const indicator of INDICATORS) {
      const response = await fetch(
        `https://www.imf.org/external/datamapper/api/v1/${indicator.code}`,
        { signal: AbortSignal.timeout(25_000) },
      );
      if (!response.ok) { errors += 1; continue; }
      const payload = await response.json() as ImfPayload;
      const values = payload.values?.[indicator.code];
      const byCountry = values && typeof values === "object" ? values as IndicatorValues : {};
      const observedAt = new Date().toISOString();
      const rows = Object.entries(byCountry).flatMap(([iso3, byYear]) => {
        if (!/^[A-Z]{3}$/.test(iso3) || !byYear || typeof byYear !== "object") return [];
        return Object.entries(byYear).flatMap(([year, raw]) => {
          const value = numeric(raw);
          if (value == null || !/^\d{4}$/.test(year)) return [];
          return [{
            provider_name: "imf-datamapper", domain: indicator.domain, metric_name: indicator.metric,
            iso3, period: year, value, unit: indicator.unit,
            provenance_source: `IMF DataMapper ${indicator.code}`, provenance_observed_at: observedAt,
            dedup_key: `imf-dm:${indicator.code}:${iso3}:${year}`,
            metadata: { observation_type: "IMF_published_series", analytical_confidence: "not_inferred" },
          }];
        });
      });

      for (let index = 0; index < rows.length; index += 1000) {
        const chunk = rows.slice(index, index + 1000);
        const { error } = await supabase.from("normalized_metrics").upsert(chunk, { onConflict: "dedup_key" });
        if (error) { errors += 1; console.error(error.message); } else inserted += chunk.length;
      }
    }

    await supabase.from("system_logs").insert({
      action: "pull_imf_datamapper", result: `inserted=${inserted} errors=${errors}`,
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
