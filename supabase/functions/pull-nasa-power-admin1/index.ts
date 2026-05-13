// NASA POWER per admin1 (territory entity) — writes to community_metrics.
// Cycles through canonical_entities entity_type='territory' that have lat/lon.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PARAMS = "T2M,PRECTOTCORR,RH2M,WS10M";
const BATCH = 50; // territories per invocation
const STATE_KEY = "nasa_power_admin1_cursor";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const start = Date.now();
  let inserted = 0, errors = 0, fetched = 0;

  try {
    // cursor stored in cron_job_state (uses created_at as last id processed)
    const { data: state } = await supabase
      .from("cron_job_state")
      .select("state_value")
      .eq("state_key", STATE_KEY)
      .maybeSingle();
    const cursor = state?.state_value?.cursor ?? null;

    let q = supabase
      .from("canonical_entities")
      .select("id, iso3, lat, lon, canonical_name")
      .eq("entity_type", "territory")
      .not("lat", "is", null)
      .not("lon", "is", null)
      .not("iso3", "is", null)
      .order("id", { ascending: true })
      .limit(BATCH);
    if (cursor) q = q.gt("id", cursor);
    const { data: territories, error } = await q;
    if (error) throw error;
    if (!territories?.length) {
      // reset cursor
      await supabase.from("cron_job_state").upsert({ state_key: STATE_KEY, state_value: { cursor: null } });
      return json({ ok: true, msg: "cycle complete; cursor reset", inserted, fetched });
    }

    const end = new Date(); end.setUTCDate(end.getUTCDate() - 2);
    const startD = new Date(end); startD.setUTCDate(startD.getUTCDate() - 7);
    const fmt = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}`;

    for (const t of territories) {
      try {
        const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=${PARAMS}&community=AG&longitude=${t.lon}&latitude=${t.lat}&start=${fmt(startD)}&end=${fmt(end)}&format=JSON`;
        const res = await fetch(url);
        if (!res.ok) { errors++; continue; }
        const j = await res.json();
        const params = j?.properties?.parameter ?? {};
        const rows: any[] = [];
        for (const [pname, byDay] of Object.entries(params) as Array<[string, Record<string, number>]>) {
          for (const [day, val] of Object.entries(byDay)) {
            if (!isFinite(val) || val === -999) continue;
            rows.push({
              region_id: t.id,
              country_iso3: t.iso3,
              domain: "environment",
              indicator_key: pname,
              value: val,
              unit: pname === "T2M" ? "celsius" : pname === "PRECTOTCORR" ? "mm/day" : pname === "RH2M" ? "percent" : "m/s",
              source: "NASA POWER",
              captured_at: new Date(`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}T00:00:00Z`).toISOString(),
              metadata: { admin1: t.canonical_name, lat: t.lat, lon: t.lon },
            });
          }
        }
        fetched++;
        if (rows.length) {
          const { error: upErr } = await supabase.from("community_metrics").insert(rows);
          if (upErr) { errors++; console.error(upErr.message); } else inserted += rows.length;
        }
      } catch (e) { errors++; console.error("territory err", e); }
    }

    const lastId = territories[territories.length - 1].id;
    await supabase.from("cron_job_state").upsert({ state_key: STATE_KEY, state_value: { cursor: lastId } });

    await supabase.from("system_logs").insert({
      action: "pull_nasa_power_admin1",
      result: `fetched=${fetched} inserted=${inserted} errors=${errors}`,
      log_level: errors ? "warning" : "info", division: "ingestion",
    });
    return json({ ok: true, fetched, inserted, errors, ms: Date.now() - start });
  } catch (e) {
    return json({ error: (e as Error).message, inserted }, 500);
  }
});

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}
