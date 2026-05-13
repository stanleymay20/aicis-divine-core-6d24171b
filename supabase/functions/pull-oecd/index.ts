// OECD CLI puller — chunks countries, parses SDMX-JSON.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OECD_ISO3 = [
  "AUS","AUT","BEL","CAN","CHL","COL","CRI","CZE","DNK","EST","FIN","FRA","DEU","GRC",
  "HUN","ISL","IRL","ISR","ITA","JPN","KOR","LVA","LTU","LUX","MEX","NLD","NZL","NOR",
  "POL","PRT","SVK","SVN","ESP","SWE","CHE","TUR","GBR","USA",
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
    const startPeriod = new Date().getUTCFullYear() - 2;
    const CHUNK = 6;
    for (let i = 0; i < OECD_ISO3.length; i += CHUNK) {
      const countries = OECD_ISO3.slice(i, i + CHUNK).join("+");
      const url = `https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI,4.0/${countries}.M.LI...AA...H?startPeriod=${startPeriod}&format=jsondata`;
      const res = await fetch(url, { headers: { Accept: "application/vnd.sdmx.data+json" } });
      if (!res.ok) { errors++; continue; }
      const j = await res.json().catch(() => null);
      if (!j) { errors++; continue; }

      const ds = j?.data?.dataSets?.[0];
      const structSeries = j?.data?.structures?.[0]?.dimensions?.series ?? [];
      const structObs = j?.data?.structures?.[0]?.dimensions?.observation ?? [];
      const refAreaIdx = structSeries.findIndex((d: any) => d.id === "REF_AREA");
      const refAreaValues = refAreaIdx >= 0 ? structSeries[refAreaIdx].values : [];
      const timeValues = structObs[0]?.values ?? [];

      const seriesObj = ds?.series ?? {};
      const rows: any[] = [];
      for (const [seriesKey, sData] of Object.entries(seriesObj) as Array<[string, any]>) {
        const seriesParts = seriesKey.split(":").map(Number);
        const areaCode = refAreaValues[seriesParts[refAreaIdx]]?.id;
        if (!areaCode) continue;
        const obsObj = sData?.observations ?? {};
        for (const [obsKey, obsArr] of Object.entries(obsObj) as Array<[string, any[]]>) {
          const period = timeValues[Number(obsKey)]?.id;
          const v = obsArr?.[0];
          if (!period || !isFinite(v)) continue;
          rows.push({
            provider_name: "oecd-cli",
            domain: "economic",
            metric_name: "composite_leading_indicator",
            iso3: areaCode,
            period,
            value: v,
            unit: "index",
            confidence: 0.95,
            provenance_source: "OECD CLI MEI",
            provenance_observed_at: new Date().toISOString(),
            dedup_key: `oecd-cli:${areaCode}:${period}`,
          });
        }
      }
      if (rows.length) {
        const { error } = await supabase.from("normalized_metrics").upsert(rows, { onConflict: "dedup_key" });
        if (error) { errors++; console.error(error.message); } else inserted += rows.length;
      }
    }

    await supabase.from("system_logs").insert({
      action: "pull_oecd_cli", result: `inserted=${inserted} errors=${errors}`,
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
