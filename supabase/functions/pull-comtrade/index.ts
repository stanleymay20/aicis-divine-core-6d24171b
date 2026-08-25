// UN Comtrade preview puller — annual trade totals by reporter.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { startProviderRun, finishProviderRun, failProviderRun } from "../_shared/provider-telemetry.ts";
import { requireAdminOrCron } from "../_shared/auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const REPORTERS = [
  { m49: "842", iso3: "USA" }, { m49: "156", iso3: "CHN" }, { m49: "276", iso3: "DEU" },
  { m49: "392", iso3: "JPN" }, { m49: "826", iso3: "GBR" }, { m49: "250", iso3: "FRA" },
  { m49: "356", iso3: "IND" }, { m49: "380", iso3: "ITA" }, { m49: "076", iso3: "BRA" },
  { m49: "124", iso3: "CAN" }, { m49: "410", iso3: "KOR" }, { m49: "484", iso3: "MEX" },
  { m49: "528", iso3: "NLD" }, { m49: "036", iso3: "AUS" }, { m49: "643", iso3: "RUS" },
];

type ComtradeRow = { flowCode?: unknown; primaryValue?: unknown; fobvalue?: unknown; cifvalue?: unknown };
type ComtradePayload = { data?: unknown };
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
    provider_name: "un-comtrade", endpoint: "pull-comtrade",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });
  const started = Date.now();
  const year = new Date().getUTCFullYear() - 1;
  let inserted = 0;
  let errors = 0;

  try {
    for (const reporter of REPORTERS) {
      const response = await fetch(
        `https://comtradeapi.un.org/public/v1/preview/C/A/HS?reporterCode=${reporter.m49}&period=${year}&partnerCode=0&cmdCode=TOTAL&flowCode=X,M`,
        { signal: AbortSignal.timeout(20_000) },
      );
      if (!response.ok) { errors += 1; continue; }
      const payload = await response.json().catch(() => null) as ComtradePayload | null;
      const data = Array.isArray(payload?.data) ? payload.data as ComtradeRow[] : [];
      const observedAt = new Date().toISOString();
      const rows = data.flatMap((row) => {
        const flow = row.flowCode === "X" ? "exports_total_usd" : row.flowCode === "M" ? "imports_total_usd" : null;
        const value = numeric(row.primaryValue) ?? numeric(row.fobvalue) ?? numeric(row.cifvalue);
        if (!flow || value == null) return [];
        return [{
          provider_name: "un-comtrade", domain: "trade", metric_name: flow,
          iso3: reporter.iso3, period: String(year), value, unit: "USD",
          provenance_source: "UN Comtrade preview", provenance_observed_at: observedAt,
          dedup_key: `comtrade:${reporter.iso3}:${flow}:${year}`,
          metadata: { observation_type: "official_reported_trade_value", analytical_confidence: "not_inferred" },
        }];
      });
      if (rows.length === 0) continue;
      const { error } = await supabase.from("normalized_metrics").upsert(rows, { onConflict: "dedup_key" });
      if (error) { errors += 1; console.error(error.message); } else inserted += rows.length;
    }

    await supabase.from("system_logs").insert({
      action: "pull_comtrade", result: `inserted=${inserted} errors=${errors}`,
      log_level: errors ? "warning" : "info", division: "ingestion",
    });
    await finishProviderRun(supabase, run, {
      records_fetched: inserted, records_inserted: inserted, records_normalized: inserted, error_count: errors,
    });
    return json({ ok: true, inserted, errors, year, ms: Date.now() - started });
  } catch (error) {
    await failProviderRun(supabase, run, error, { records_inserted: inserted, error_count: errors });
    return json({ error: error instanceof Error ? error.message : String(error), inserted }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
