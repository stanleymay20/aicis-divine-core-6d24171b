// IMF Datamapper API — annual indicators per country. Reliable, no key needed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  startProviderRun,
  finishProviderRun,
  failProviderRun,
} from "../_shared/provider-telemetry.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const INDICATORS: Array<{ code: string; metric: string; domain: string; unit: string }> = [
  { code: "NGDP_RPCH", metric: "real_gdp_growth_pct", domain: "economic", unit: "percent" },
  { code: "PCPIPCH", metric: "inflation_avg_pct", domain: "economic", unit: "percent" },
  { code: "GGXWDG_NGDP", metric: "govt_debt_pct_gdp", domain: "economic", unit: "percent" },
  { code: "BCA_NGDPD", metric: "current_account_pct_gdp", domain: "economic", unit: "percent" },
  { code: "LUR", metric: "unemployment_rate", domain: "economic", unit: "percent" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const run = await startProviderRun(supabase, {
    provider_name: "imf-datamapper",
    endpoint: "pull-imf-sdmx",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });
  const start = Date.now();
  let inserted = 0, errors = 0;

  try {
    for (const ind of INDICATORS) {
      const url = `https://www.imf.org/external/datamapper/api/v1/${ind.code}`;
      const res = await fetch(url);
      if (!res.ok) { errors++; continue; }
      const j = await res.json();
      const values = j?.values?.[ind.code] ?? {};
      const rows: any[] = [];
      for (const [iso3, byYear] of Object.entries(values) as Array<[string, Record<string, number>]>) {
        if (!/^[A-Z]{3}$/.test(iso3)) continue;
        for (const [year, v] of Object.entries(byYear)) {
          if (!isFinite(v as number)) continue;
          rows.push({
            provider_name: "imf-datamapper",
            domain: ind.domain,
            metric_name: ind.metric,
            iso3,
            period: year,
            value: v,
            unit: ind.unit,
            confidence: 0.95,
            provenance_source: `IMF WEO ${ind.code}`,
            provenance_observed_at: new Date().toISOString(),
            dedup_key: `imf-dm:${ind.code}:${iso3}:${year}`,
          });
        }
      }
      const CHUNK = 1000;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("normalized_metrics")
          .upsert(slice, { onConflict: "dedup_key" });
        if (error) { errors++; console.error(error.message); } else inserted += slice.length;
      }
    }
    await supabase.from("system_logs").insert({
      action: "pull_imf_datamapper", result: `inserted=${inserted} errors=${errors}`,
      log_level: errors ? "warning" : "info", division: "ingestion",
    });
    return json({ ok: true, inserted, errors, ms: Date.now() - start });
  } catch (e) {
    return json({ error: (e as Error).message, inserted }, 500);
  }
});

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}
