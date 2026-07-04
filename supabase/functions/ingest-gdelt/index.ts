import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  startProviderRun,
  finishProviderRun,
  failProviderRun,
} from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Use simple search terms — GDELT DOC API free tier has limited OR support
const INSTABILITY_TERMS = ["protest", "conflict", "unrest"];

const ALL_COUNTRIES: [string, string][] = [
  ["AFG","Afghanistan"],["AGO","Angola"],["BDI","Burundi"],["BFA","Burkina Faso"],
  ["CAF","Central African Republic"],["COD","Congo"],["ETH","Ethiopia"],
  ["HTI","Haiti"],["IRQ","Iraq"],["LBY","Libya"],["MLI","Mali"],["MMR","Myanmar"],
  ["MOZ","Mozambique"],["NGA","Nigeria"],["PAK","Pakistan"],["SDN","Sudan"],
  ["SOM","Somalia"],["SSD","South Sudan"],["SYR","Syria"],["TCD","Chad"],
  ["UKR","Ukraine"],["VEN","Venezuela"],["YEM","Yemen"],["ZWE","Zimbabwe"],
  ["USA","United States"],["GBR","United Kingdom"],["FRA","France"],
  ["DEU","Germany"],["JPN","Japan"],["CHN","China"],["IND","India"],
  ["BRA","Brazil"],["RUS","Russia"],["ZAF","South Africa"],["MEX","Mexico"],
  ["IDN","Indonesia"],["TUR","Turkey"],["SAU","Saudi Arabia"],["ARG","Argentina"],
  ["KOR","South Korea"],["EGY","Egypt"],["IRN","Iran"],["THA","Thailand"],
  ["COL","Colombia"],["PHL","Philippines"],["KEN","Kenya"],["TZA","Tanzania"],
];

const BATCH_SIZE = 1;
const TOTAL_BATCHES = ALL_COUNTRIES.length;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let batch = 0;
  let processAll = true;
  try {
    const body = await req.json().catch(() => ({}));
    if (body && typeof body.batch === "number") {
      batch = Math.min(Math.max(0, Number(body.batch) || 0), TOTAL_BATCHES - 1);
      processAll = false;
    }
    if (body && body.all === true) processAll = true;
  } catch { /* default */ }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const today = new Date().toISOString().split("T")[0];
  const countries = processAll
    ? ALL_COUNTRIES
    : ALL_COUNTRIES.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE);
  let inserted = 0;
  const errors: string[] = [];

  const run = await startProviderRun(sb, {
    provider_name: "gdelt",
    endpoint: "ingest-gdelt",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
    params: { batch, batch_size: BATCH_SIZE },
  });

  try {
    for (let i = 0; i < countries.length; i++) {
      const [iso3, name] = countries[i];
      try {
        // Query each instability term separately, aggregate
        let totalArticles = 0;
        let toneSum = 0, toneN = 0, gsSum = 0, gsN = 0;
        const sampleTitles: string[] = [];

        for (const term of INSTABILITY_TERMS) {
          const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(term)}%20${encodeURIComponent(`"${name}"`)}&mode=artlist&format=json&maxrecords=20`;
          const res = await fetch(url);

          if (!res.ok) continue;

          const text = await res.text();
          // GDELT returns plain text errors, not JSON
          if (!text.startsWith("{") && !text.startsWith("[")) continue;

          try {
            const data = JSON.parse(text);
            const articles = data?.articles || [];
            totalArticles += articles.length;

            for (const a of articles) {
              if (a?.tone !== undefined) { toneSum += parseFloat(a.tone) || 0; toneN++; }
              if (a?.goldstein !== undefined) { gsSum += parseFloat(a.goldstein) || 0; gsN++; }
            }
            if (sampleTitles.length < 3 && articles.length > 0) {
              sampleTitles.push(articles[0]?.title || "");
            }
          } catch { continue; }

          // Throttle between terms
          await new Promise(r => setTimeout(r, 300));
        }

        if (totalArticles === 0) continue;

        const { error } = await sb.from("political_events").upsert({
          iso3, event_date: today, source: "gdelt", event_type: "instability",
          event_count: totalArticles,
          avg_tone: toneN > 0 ? toneSum / toneN : null,
          goldstein_scale: gsN > 0 ? gsSum / gsN : null,
          raw_payload: { n: totalArticles, titles: sampleTitles },
        }, { onConflict: "iso3,event_date,source,event_type" });

        if (error) errors.push(`${iso3}: ${error.message}`);
        else inserted++;

        // 500ms throttle
        if (i < countries.length - 1) await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        const msg = `${iso3}: ${e instanceof Error ? e.message : "?"}`;
        console.error(msg);
        errors.push(msg);
      }
    }

    await sb.from("automation_logs").insert({
      job_name: "ingest-gdelt",
      status: errors.length === 0 ? "success" : "partial",
      message: `Batch ${batch}/${TOTAL_BATCHES - 1}: ${inserted}/${countries.length} inserted`,
    });

    await finishProviderRun(sb, run, {
      records_fetched: countries.length,
      records_inserted: inserted,
      records_normalized: inserted,
      error_count: errors.length,
      error_summary: errors[0] ?? null,
    });

    return new Response(JSON.stringify({ ok: true, batch, inserted, errors: errors.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ingest-gdelt fatal:", e);
    await failProviderRun(sb, run, e, { records_inserted: inserted, error_count: errors.length });
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
