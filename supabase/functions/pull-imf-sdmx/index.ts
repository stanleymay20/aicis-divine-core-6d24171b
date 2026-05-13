// IMF SDMX pull — IFS dataset. No key required. Pulls a curated set of high-value monthly indicators.
// Writes to normalized_metrics with iso3 + period (YYYY-MM).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// IMF IFS indicator codes -> our canonical metric names
const INDICATORS: Array<{ code: string; metric: string; domain: string; unit: string }> = [
  { code: "PCPI_IX", metric: "cpi_index", domain: "economic", unit: "index" },
  { code: "FPOLM_PA", metric: "policy_rate", domain: "economic", unit: "percent" },
  { code: "ENDA_XDC_USD_RATE", metric: "fx_per_usd", domain: "economic", unit: "ratio" },
];

// Curated set of important countries; IMF uses ISO2 in IFS
const COUNTRIES: Array<{ iso2: string; iso3: string }> = [
  { iso2: "US", iso3: "USA" }, { iso2: "GB", iso3: "GBR" }, { iso2: "DE", iso3: "DEU" },
  { iso2: "FR", iso3: "FRA" }, { iso2: "JP", iso3: "JPN" }, { iso2: "CN", iso3: "CHN" },
  { iso2: "IN", iso3: "IND" }, { iso2: "BR", iso3: "BRA" }, { iso2: "ZA", iso3: "ZAF" },
  { iso2: "TR", iso3: "TUR" }, { iso2: "CA", iso3: "CAN" }, { iso2: "AU", iso3: "AUS" },
  { iso2: "MX", iso3: "MEX" }, { iso2: "ID", iso3: "IDN" }, { iso2: "KR", iso3: "KOR" },
  { iso2: "IT", iso3: "ITA" }, { iso2: "ES", iso3: "ESP" }, { iso2: "RU", iso3: "RUS" },
  { iso2: "SA", iso3: "SAU" }, { iso2: "AR", iso3: "ARG" }, { iso2: "EG", iso3: "EGY" },
  { iso2: "NG", iso3: "NGA" }, { iso2: "PK", iso3: "PAK" }, { iso2: "BD", iso3: "BGD" },
  { iso2: "VN", iso3: "VNM" }, { iso2: "TH", iso3: "THA" }, { iso2: "PH", iso3: "PHL" },
  { iso2: "NL", iso3: "NLD" }, { iso2: "PL", iso3: "POL" }, { iso2: "CH", iso3: "CHE" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const start = Date.now();
  let inserted = 0, errors = 0;

  try {
    for (const ind of INDICATORS) {
      // CompactData/IFS/M.{country+}.{indicator}
      const codes = COUNTRIES.map((c) => c.iso2).join("+");
      const url = `https://www.imf.org/external/datamapper/api/v1/${ind.code}`;
      // Datamapper API returns annual; for monthly we use SDMX 2.1 IFS endpoint:
      const sdmxUrl = `https://dataservices.imf.org/REST/SDMX_JSON.svc/CompactData/IFS/M.${codes}.${ind.code}?startPeriod=2023`;

      const res = await fetch(sdmxUrl, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        console.error("IMF fetch failed", ind.code, res.status);
        errors++;
        continue;
      }
      const json = await res.json().catch(() => null);
      const series = json?.CompactData?.DataSet?.Series;
      if (!series) continue;
      const seriesArr = Array.isArray(series) ? series : [series];

      for (const s of seriesArr) {
        const iso2 = s["@REF_AREA"];
        const country = COUNTRIES.find((c) => c.iso2 === iso2);
        if (!country) continue;
        const obs = s.Obs;
        if (!obs) continue;
        const obsArr = Array.isArray(obs) ? obs : [obs];

        const rows = obsArr
          .map((o: any) => {
            const period = o["@TIME_PERIOD"];
            const v = parseFloat(o["@OBS_VALUE"]);
            if (!period || !isFinite(v)) return null;
            return {
              provider_name: "imf-ifs",
              domain: ind.domain,
              metric_name: ind.metric,
              iso3: country.iso3,
              period,
              value: v,
              unit: ind.unit,
              confidence: 0.95,
              provenance_source: `IMF IFS ${ind.code}`,
              provenance_observed_at: new Date().toISOString(),
              dedup_key: `imf:${ind.code}:${country.iso3}:${period}`,
            };
          })
          .filter(Boolean);

        if (rows.length) {
          const { error } = await supabase
            .from("normalized_metrics")
            .upsert(rows as any, { onConflict: "dedup_key" });
          if (error) { console.error("upsert", error.message); errors++; }
          else inserted += rows.length;
        }
      }
    }

    await supabase.from("system_logs").insert({
      action: "pull_imf_sdmx",
      result: `inserted=${inserted} errors=${errors}`,
      log_level: errors ? "warning" : "info",
      division: "ingestion",
    });

    return json({ ok: true, inserted, errors, ms: Date.now() - start });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message, inserted, errors }, 500);
  }
});

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}
