// UN Comtrade preview puller — annual trade totals by reporter.
// Uses public preview API (no key needed for limited rows). Writes monthly/annual to normalized_metrics.
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

// Comtrade reporter codes (M49) -> ISO3 (curated subset for top trade flows)
const REPORTERS: Array<{ m49: string; iso3: string }> = [
  { m49: "842", iso3: "USA" }, { m49: "156", iso3: "CHN" }, { m49: "276", iso3: "DEU" },
  { m49: "392", iso3: "JPN" }, { m49: "826", iso3: "GBR" }, { m49: "250", iso3: "FRA" },
  { m49: "356", iso3: "IND" }, { m49: "380", iso3: "ITA" }, { m49: "076", iso3: "BRA" },
  { m49: "124", iso3: "CAN" }, { m49: "410", iso3: "KOR" }, { m49: "484", iso3: "MEX" },
  { m49: "528", iso3: "NLD" }, { m49: "036", iso3: "AUS" }, { m49: "643", iso3: "RUS" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const run = await startProviderRun(supabase, {
    provider_name: "un-comtrade",
    endpoint: "pull-comtrade",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  const start = Date.now();
  const year = new Date().getUTCFullYear() - 1;
  let inserted = 0, errors = 0;

  try {
    for (const r of REPORTERS) {
      // Comtrade Preview API v1: total trade (cmdCode=TOTAL), all partners aggregate
      const url = `https://comtradeapi.un.org/public/v1/preview/C/A/HS?reporterCode=${r.m49}&period=${year}&partnerCode=0&cmdCode=TOTAL&flowCode=X,M`;
      const res = await fetch(url);
      if (!res.ok) { errors++; continue; }
      const j = await res.json().catch(() => null);
      const data = j?.data ?? [];
      const rows: any[] = [];
      for (const d of data) {
        const flow = d.flowCode === "X" ? "exports_total_usd" : d.flowCode === "M" ? "imports_total_usd" : null;
        if (!flow) continue;
        const v = parseFloat(d.primaryValue ?? d.fobvalue ?? d.cifvalue);
        if (!isFinite(v)) continue;
        rows.push({
          provider_name: "un-comtrade",
          domain: "trade",
          metric_name: flow,
          iso3: r.iso3,
          period: String(year),
          value: v,
          unit: "USD",
          confidence: 0.95,
          provenance_source: "UN Comtrade preview",
          provenance_observed_at: new Date().toISOString(),
          dedup_key: `comtrade:${r.iso3}:${flow}:${year}`,
        });
      }
      if (rows.length) {
        const { error } = await supabase
          .from("normalized_metrics")
          .upsert(rows as any, { onConflict: "dedup_key" });
        if (error) { errors++; console.error(error.message); } else inserted += rows.length;
      }
    }

    await supabase.from("system_logs").insert({
      action: "pull_comtrade", result: `inserted=${inserted} errors=${errors}`,
      log_level: errors ? "warning" : "info", division: "ingestion",
    });

    return json({ ok: true, inserted, errors, year, ms: Date.now() - start });
  } catch (e) {
    return json({ error: (e as Error).message, inserted }, 500);
  }
});

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}
