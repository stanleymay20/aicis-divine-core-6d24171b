// V-Dem governance indicators (free, public CSV via GitHub mirror).
// Pulls a curated subset of liberal-democracy indicators per country-year.
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

const FN = "pull-vdem";

const SOURCE = "https://ourworldindata.org/grapher/electoral-democracy-index.csv?v=1&csvType=full";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = svcClient();
  const run = await startProviderRun(supabase, {
    provider_name: "vdem",
    endpoint: FN,
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });
  const start = Date.now();

  try {
    const r = await fetch(SOURCE, { headers: { "User-Agent": "AICIS/1.0" } });
    if (!r.ok) throw new Error(`V-Dem source ${r.status}`);
    const csv = await r.text();
    const lines = csv.trim().split(/\r?\n/);
    const header = lines.shift()!.split(",");
    const idxCode = header.indexOf("Code");
    const idxYear = header.indexOf("Year");
    // Value column = first column whose header is not Entity/Code/Year/region
    const idxValue = header.findIndex(
      (h, i) => i !== idxCode && i !== idxYear && h !== "Entity" && !h.toLowerCase().includes("region")
    );

    const currentYear = new Date().getUTCFullYear();
    const minYear = currentYear - 6;
    const rows: NormalizedRow[] = [];

    for (const line of lines) {
      const cols = line.split(",");
      const code = cols[idxCode]?.trim();
      const year = parseInt(cols[idxYear] ?? "0", 10);
      const val = parseFloat(cols[idxValue] ?? "");
      if (!code || code.length !== 3 || !Number.isFinite(val) || year < minYear) continue;
      rows.push({
        provider_name: "vdem",
        domain: "governance",
        metric_name: "electoral_democracy_index",
        iso3: code,
        period: `${year}-12-31`,
        value: val,
        unit: "index_0_1",
        provenance_source: "V-Dem via OWID",
        confidence: 0.9,
      });
    }

    const { inserted, errors } = await writeNormalized(supabase, rows);
    const status = errors.length === 0 ? "success" : "partial";
    await logRun(
      supabase,
      FN,
      status,
      `Inserted ${inserted}/${rows.length} V-Dem rows in ${Date.now() - start}ms${errors.length ? " — " + errors[0] : ""}`
    );

    return new Response(JSON.stringify({ ok: true, inserted, total: rows.length, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logRun(supabase, FN, "error", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
