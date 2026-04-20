// ENTSO-E European electricity day-ahead total load forecast (free public XML, no key required for the
// open transparency dashboard's CSV export endpoint). We use the open ENTSO-E aggregate snapshot via
// energy-charts.info, which mirrors ENTSO-E with no API key and CORS-friendly JSON.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { svcClient, writeNormalized, logRun, NormalizedRow } from "../_shared/normalized-write.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN = "pull-entsoe";

// energy-charts.info supports per-bidding-zone queries via the `bzn` param.
const ZONES: { bzn: string; iso3: string }[] = [
  { bzn: "DE-LU", iso3: "DEU" }, { bzn: "FR", iso3: "FRA" },
  { bzn: "ES", iso3: "ESP" }, { bzn: "IT-North", iso3: "ITA" },
  { bzn: "NL", iso3: "NLD" }, { bzn: "BE", iso3: "BEL" },
  { bzn: "AT", iso3: "AUT" }, { bzn: "PL", iso3: "POL" },
  { bzn: "SE4", iso3: "SWE" }, { bzn: "NO2", iso3: "NOR" },
  { bzn: "DK1", iso3: "DNK" }, { bzn: "FI", iso3: "FIN" },
  { bzn: "PT", iso3: "PRT" }, { bzn: "IE-SEM", iso3: "IRL" },
  { bzn: "GR", iso3: "GRC" },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = svcClient();
  const start = Date.now();
  const rows: NormalizedRow[] = [];
  const errors: string[] = [];

  try {
    for (const { bzn, iso3 } of ZONES) {
      try {
        const url = `https://api.energy-charts.info/total_power?bzn=${encodeURIComponent(bzn)}`;
        const r = await fetch(url, {
          headers: { "User-Agent": "AICIS/1.0", Accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) {
          errors.push(`${code}:${r.status}`);
          continue;
        }
        const data = await r.json();
        const ts: number[] = data.unix_seconds || [];
        const series: { name: string; data: number[] }[] = data.production_types || [];
        if (!ts.length || !series.length) continue;
        const lastIdx = ts.length - 1;
        const period = new Date(ts[lastIdx] * 1000).toISOString().slice(0, 10);

        let total = 0;
        let renewable = 0;
        const RENEW = ["solar", "wind", "wind onshore", "wind offshore", "hydro run-of-river", "hydro water reservoir", "biomass", "geothermal"];
        for (const s of series) {
          const v = Number(s.data?.[lastIdx] ?? 0);
          if (!Number.isFinite(v)) continue;
          total += v;
          if (RENEW.some((k) => s.name.toLowerCase().includes(k))) renewable += v;
        }
        if (total <= 0) continue;
        rows.push(
          { provider_name: "entsoe", domain: "energy", metric_name: "total_generation_mw", iso3, period, value: total, unit: "MW", provenance_source: "ENTSO-E via energy-charts" },
          { provider_name: "entsoe", domain: "energy", metric_name: "renewable_share_pct", iso3, period, value: (renewable / total) * 100, unit: "pct", provenance_source: "ENTSO-E via energy-charts" }
        );
      } catch (e) {
        errors.push(`${code}:${(e as Error).message}`);
      }
    }

    const { inserted, errors: writeErrs } = await writeNormalized(supabase, rows);
    const allErrs = [...errors, ...writeErrs];
    const status = inserted > 0 ? (allErrs.length ? "partial" : "success") : "error";
    await logRun(
      supabase,
      FN,
      status,
      `Inserted ${inserted}/${rows.length} ENTSO-E rows in ${Date.now() - start}ms${allErrs.length ? " — " + allErrs.slice(0, 3).join("; ") : ""}`
    );

    return new Response(JSON.stringify({ ok: true, inserted, total: rows.length, errors: allErrs }), {
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
