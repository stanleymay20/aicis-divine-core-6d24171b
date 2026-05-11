// pull-ucdp-historical — UCDP Georeferenced Event Dataset (GED) backfill.
// Free, no API key required. https://ucdp.uu.se/apidocs/
// Pulls one year per invocation (state-tracked) into normalized_events.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const FN = "pull-ucdp-historical";
const UCDP_VERSION = "25.1"; // latest GED release (Feb 2026)

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const start = Date.now();
  const UCDP_TOKEN = Deno.env.get("UCDP_ACCESS_TOKEN");

  try {
    if (!UCDP_TOKEN) {
      await supabase.from("automation_logs").insert({
        job_name: FN, status: "skipped",
        message: "UCDP_ACCESS_TOKEN not set — awaiting token from api maintainer (Mert Can Yilmaz)",
      });
      return new Response(JSON.stringify({ ok: true, skipped: "no_token" }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    // Determine which year to pull next. State stored in automation_logs.
    const { data: state } = await supabase
      .from("automation_logs")
      .select("message")
      .eq("job_name", FN)
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextYear = 1989; // UCDP GED begins 1989
    if (state?.message) {
      const m = state.message.match(/year=(\d{4})/);
      if (m) nextYear = parseInt(m[1], 10) + 1;
    }
    const currentYear = new Date().getUTCFullYear();
    if (nextYear > currentYear - 1) {
      await supabase.from("automation_logs").insert({
        job_name: FN, status: "success",
        message: `UCDP backfill complete through ${currentYear - 1}. year=${currentYear - 1}`,
      });
      return new Response(JSON.stringify({ ok: true, done: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let inserted = 0;
    let page = 1;
    const pageSize = 1000;
    const rows: any[] = [];

    while (true) {
      const url = `https://ucdpapi.pcr.uu.se/api/gedevents/${UCDP_VERSION}?pagesize=${pageSize}&page=${page}&StartDate=${nextYear}-01-01&EndDate=${nextYear}-12-31`;
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(40000),
        headers: { "x-ucdp-access-token": UCDP_TOKEN },
      });
      if (!resp.ok) {
        if (resp.status === 404) break;
        throw new Error(`UCDP HTTP ${resp.status}`);
      }
      const data = await resp.json();
      const results: any[] = data?.Result || [];
      if (results.length === 0) break;

      for (const e of results) {
        if (!e.country_id || !e.date_start) continue;
        const occurredAt = new Date(e.date_start).toISOString();
        const endedAt = e.date_end ? new Date(e.date_end).toISOString() : occurredAt;
        const fatalities = e.best ?? null;
        const eventType = e.type_of_violence === 1 ? "state_based_conflict"
          : e.type_of_violence === 2 ? "non_state_conflict"
          : "one_sided_violence";
        rows.push({
          dedup_key: `ucdp:ged:${UCDP_VERSION}:${e.id}`,
          provider_name: "ucdp",
          event_type: eventType,
          category: "conflict",
          title: `${e.side_a || "Unknown"} vs ${e.side_b || "Unknown"} — ${e.country}`,
          description: `${fatalities ?? 0} fatalities in ${e.adm_1 || e.country} (${e.where_coordinates || ""}). Source: ${e.source_article || e.source_original || "UCDP"}`,
          iso3: null,
          country_iso3: null,
          source_name: "UCDP GED",
          source_url: `https://ucdp.uu.se/encyclopedia`,
          occurred_at: occurredAt,
          started_at: occurredAt,
          ended_at: endedAt,
          severity: fatalities != null ? Math.min(100, Math.log10(Math.max(1, fatalities)) * 25) : null,
          confidence: 0.95,
          provenance_source: "UCDP GED v" + UCDP_VERSION,
          last_verified_at: new Date().toISOString(),
          metadata: {
            conflict_id: e.conflict_new_id,
            dyad_id: e.dyad_new_id,
            country_name: e.country,
            country_id: e.country_id,
            region: e.region,
            adm_1: e.adm_1,
            adm_2: e.adm_2,
            latitude: e.latitude,
            longitude: e.longitude,
            fatalities,
            deaths_civilians: e.deaths_civilians,
            year: nextYear,
          },
        });
      }
      if (results.length < pageSize) break;
      page++;
      if (page > 50) break; // safety
    }

    // Chunk insert
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase.from("normalized_events").upsert(chunk, {
        onConflict: "dedup_key", ignoreDuplicates: true,
      });
      if (!error) inserted += chunk.length;
    }

    await supabase.from("automation_logs").insert({
      job_name: FN, status: "success",
      message: `UCDP year=${nextYear}: ${inserted} events ingested in ${Date.now() - start}ms`,
    });

    return new Response(JSON.stringify({ ok: true, year: nextYear, inserted }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    await supabase.from("automation_logs").insert({
      job_name: FN, status: "error", message: (e as Error).message.slice(0, 500),
    });
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
