// NASA POWER per admin1 — iterates public.admin_regions (admin_level=1) with cursor.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { startProviderRun, finishProviderRun, failProviderRun } from "../_shared/provider-telemetry.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PARAMS = "T2M,PRECTOTCORR,RH2M,WS10M";
const BATCH = 60;
const STATE_KEY = "nasa_power_admin1_cursor";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const run = await startProviderRun(supabase, {
    provider_name: "nasa_power_admin1",
    endpoint: "pull-nasa-power-admin1",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });
  const start = Date.now();
  let inserted = 0, errors = 0, fetched = 0;

  try {
    const { data: state } = await supabase
      .from("cron_job_state").select("state_value").eq("state_key", STATE_KEY).maybeSingle();
    const cursor = state?.state_value?.cursor ?? null;

    let q = supabase.from("admin_regions")
      .select("id, country_iso3, lat, lon, name")
      .eq("admin_level", 1)
      .not("lat", "is", null).not("lon", "is", null).not("country_iso3", "is", null)
      .order("id", { ascending: true }).limit(BATCH);
    if (cursor) q = q.gt("id", cursor);
    const { data: regions, error } = await q;
    if (error) throw error;
    if (!regions?.length) {
      await supabase.from("cron_job_state").upsert({ state_key: STATE_KEY, state_value: { cursor: null }, updated_at: new Date().toISOString() });
      await finishProviderRun(supabase, run, { records_fetched: 0, records_inserted: 0 });
      return json({ ok: true, msg: "cycle complete; cursor reset", inserted, fetched });
    }

    const end = new Date(); end.setUTCDate(end.getUTCDate() - 2);
    const startD = new Date(end); startD.setUTCDate(startD.getUTCDate() - 7);
    const fmt = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}`;

    for (const r of regions) {
      try {
        const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=${PARAMS}&community=AG&longitude=${r.lon}&latitude=${r.lat}&start=${fmt(startD)}&end=${fmt(end)}&format=JSON`;
        const res = await fetch(url);
        if (!res.ok) { errors++; continue; }
        const j = await res.json();
        const params = j?.properties?.parameter ?? {};
        const rows: any[] = [];
        for (const [pname, byDay] of Object.entries(params) as Array<[string, Record<string, number>]>) {
          for (const [day, val] of Object.entries(byDay)) {
            if (!isFinite(val) || val === -999) continue;
            rows.push({
              region_id: r.id,
              country_iso3: r.country_iso3,
              domain: "environment",
              indicator_key: pname.toLowerCase(),
              value: val,
              unit: pname === "T2M" ? "celsius" : pname === "PRECTOTCORR" ? "mm/day" : pname === "RH2M" ? "percent" : "m/s",
              source: "NASA POWER",
              captured_at: new Date(`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}T00:00:00Z`).toISOString(),
              metadata: { admin1: r.name, lat: r.lat, lon: r.lon },
            });
          }
        }
        fetched++;
        if (rows.length) {
          const { error: upErr } = await supabase.from("community_metrics").insert(rows);
          if (upErr) { errors++; console.error("insert", upErr.message); } else inserted += rows.length;
        }
      } catch (e) { errors++; console.error("region err", e); }
    }

    const lastId = regions[regions.length - 1].id;
    await supabase.from("cron_job_state").upsert({ state_key: STATE_KEY, state_value: { cursor: lastId }, updated_at: new Date().toISOString() });

    await supabase.from("system_logs").insert({
      action: "pull_nasa_power_admin1",
      result: `fetched=${fetched} inserted=${inserted} errors=${errors}`,
      log_level: errors ? "warning" : "info", division: "ingestion",
    });
    await finishProviderRun(supabase, run, {
      records_fetched: fetched,
      records_inserted: inserted,
      records_normalized: inserted,
      error_count: errors,
    });
    return json({ ok: true, fetched, inserted, errors, ms: Date.now() - start });
  } catch (e) {
    await failProviderRun(supabase, run, e, { records_inserted: inserted, records_fetched: fetched, error_count: errors });
    return json({ error: (e as Error).message, inserted }, 500);
  }
});

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}
