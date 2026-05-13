// OECD SDMX-JSON puller — Composite Leading Indicator (CLI) monthly per country.
// No key required. Writes normalized_metrics for OECD members.
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
  let inserted = 0;

  try {
    // OECD CLI dataset (MEI_CLI). SDMX-JSON.
    const startPeriod = new Date().getUTCFullYear() - 2;
    const url = `https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI,4.0/${OECD_ISO3.join("+")}.M.LI...AA...H?startPeriod=${startPeriod}&format=jsondata`;
    const res = await fetch(url, { headers: { Accept: "application/vnd.sdmx.data+json" } });
    if (!res.ok) throw new Error(`OECD ${res.status}`);
    const j = await res.json();

    const obs = j?.data?.dataSets?.[0]?.observations ?? {};
    const dims = j?.data?.structures?.[0]?.dimensions?.observation ?? [];
    const series = j?.data?.structures?.[0]?.dimensions?.series ?? [];
    const refAreaIdx = series.findIndex((d: any) => d.id === "REF_AREA");
    const refAreaValues = refAreaIdx >= 0 ? series[refAreaIdx].values : [];
    const timeIdx = dims.findIndex((d: any) => d.id === "TIME_PERIOD");
    const timeValues = timeIdx >= 0 ? dims[timeIdx].values : [];

    const rows: any[] = [];
    for (const [key, val] of Object.entries(obs)) {
      const parts = key.split(":").map(Number);
      const seriesKey = parts.slice(0, series.length).join(":");
      const obsKey = parts.slice(series.length);
      const areaCode = refAreaValues[parts[refAreaIdx]]?.id;
      const period = timeValues[obsKey[timeIdx]]?.id ?? timeValues[obsKey[0]]?.id;
      const v = (val as any[])[0];
      if (!areaCode || !period || !isFinite(v)) continue;
      if (!OECD_ISO3.includes(areaCode)) continue;
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

    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("normalized_metrics")
        .upsert(slice as any, { onConflict: "dedup_key" });
      if (!error) inserted += slice.length;
      else console.error(error.message);
    }

    await supabase.from("system_logs").insert({
      action: "pull_oecd_cli", result: `inserted=${inserted}`,
      log_level: "info", division: "ingestion",
    });
    return json({ ok: true, inserted, ms: Date.now() - start });
  } catch (e) {
    return json({ error: (e as Error).message, inserted }, 500);
  }
});

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}
