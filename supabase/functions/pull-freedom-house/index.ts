// Freedom House civil + political liberties (free, public via OWID stable CSV).
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

const FN = "pull-freedom-house";

const SOURCES: { url: string; metric: string }[] = [
  {
    url: "https://ourworldindata.org/grapher/civil-liberties-fh.csv?v=1&csvType=full",
    metric: "civil_liberties_score",
  },
  {
    url: "https://ourworldindata.org/grapher/political-rights-fh.csv?v=1&csvType=full",
    metric: "political_rights_score",
  },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = svcClient();
  const run = await startProviderRun(supabase, {
    provider_name: "freedom_house",
    endpoint: FN,
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });
  const start = Date.now();
  const rows: NormalizedRow[] = [];
  const errors: string[] = [];

  try {
    for (const src of SOURCES) {
      try {
        const r = await fetch(src.url, { headers: { "User-Agent": "AICIS/1.0" } });
        if (!r.ok) {
          errors.push(`${src.metric} ${r.status}`);
          continue;
        }
        const csv = await r.text();
        const lines = csv.trim().split(/\r?\n/);
        const header = lines.shift()!.split(",");
        const idxCode = header.indexOf("Code");
        const idxYear = header.indexOf("Year");
        // Value column is the last numeric column
        const idxValue = header.length - 1;

        const currentYear = new Date().getUTCFullYear();
        const minYear = currentYear - 6;
        for (const line of lines) {
          const cols = line.split(",");
          const code = cols[idxCode]?.trim();
          const year = parseInt(cols[idxYear] ?? "0", 10);
          const val = parseFloat(cols[idxValue] ?? "");
          if (!code || code.length !== 3 || !Number.isFinite(val) || year < minYear) continue;
          rows.push({
            provider_name: "freedom_house",
            domain: "governance",
            metric_name: src.metric,
            iso3: code,
            period: `${year}-12-31`,
            value: val,
            unit: "score_1_7",
            provenance_source: "Freedom House via OWID",
            confidence: 0.85,
          });
        }
      } catch (e) {
        errors.push(`${src.metric} ${(e as Error).message}`);
      }
    }

    const { inserted, errors: writeErrs } = await writeNormalized(supabase, rows);
    const allErrs = [...errors, ...writeErrs];
    const status = allErrs.length === 0 ? "success" : "partial";
    await logRun(
      supabase,
      FN,
      status,
      `Inserted ${inserted}/${rows.length} Freedom House rows in ${Date.now() - start}ms${allErrs.length ? " — " + allErrs[0] : ""}`
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
