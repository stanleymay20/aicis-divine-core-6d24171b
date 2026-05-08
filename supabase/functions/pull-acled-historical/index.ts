// pull-acled-historical — ACLED conflict event backfill.
// Requires ACLED_API_KEY + ACLED_EMAIL (free academic / NGO key from acleddata.com).
// Pulls one year per invocation (state-tracked) into normalized_events.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const FN = "pull-acled-historical";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const apiKey = Deno.env.get("ACLED_API_KEY");
  const email = Deno.env.get("ACLED_EMAIL");
  if (!apiKey || !email) {
    await supabase.from("automation_logs").insert({
      job_name: FN, status: "warning",
      message: "ACLED_API_KEY or ACLED_EMAIL missing — soft-skip until configured.",
    });
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: "missing_credentials" }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const start = Date.now();
  try {
    const { data: state } = await supabase
      .from("automation_logs")
      .select("message")
      .eq("job_name", FN)
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextYear = 1997; // ACLED begins 1997
    if (state?.message) {
      const m = state.message.match(/year=(\d{4})/);
      if (m) nextYear = parseInt(m[1], 10) + 1;
    }
    const currentYear = new Date().getUTCFullYear();
    if (nextYear > currentYear) {
      await supabase.from("automation_logs").insert({
        job_name: FN, status: "success",
        message: `ACLED backfill complete through ${currentYear}. year=${currentYear}`,
      });
      return new Response(JSON.stringify({ ok: true, done: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let inserted = 0;
    let page = 1;
    const pageSize = 5000;
    const rows: any[] = [];

    while (true) {
      const url = `https://api.acleddata.com/acled/read?key=${apiKey}&email=${encodeURIComponent(email)}&year=${nextYear}&limit=${pageSize}&page=${page}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(45000) });
      if (!resp.ok) throw new Error(`ACLED HTTP ${resp.status}`);
      const data = await resp.json();
      if (data.success === false) throw new Error(data.error?.message || "ACLED returned success=false");
      const results: any[] = data?.data || [];
      if (results.length === 0) break;

      for (const e of results) {
        rows.push({
          dedup_key: `acled:${e.data_id || e.event_id_cnty}`,
          source: "acled",
          provider_name: "acled",
          event_type: (e.event_type || "conflict").toLowerCase().replace(/\s+/g, "_"),
          iso3: e.iso3 || null,
          country_name: e.country,
          period: e.event_date,
          severity: e.fatalities != null ? Math.min(100, Math.log10(Math.max(1, +e.fatalities)) * 25 + 20) : 30,
          fatalities: e.fatalities ? +e.fatalities : 0,
          latitude: e.latitude ? parseFloat(e.latitude) : null,
          longitude: e.longitude ? parseFloat(e.longitude) : null,
          summary: e.notes?.slice(0, 500) || `${e.event_type} in ${e.location}, ${e.country}`,
          confidence: 0.9,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          provenance_source: "ACLED",
          provenance_observed_at: new Date().toISOString(),
          metadata: {
            sub_event_type: e.sub_event_type, actor1: e.actor1, actor2: e.actor2,
            admin1: e.admin1, admin2: e.admin2, year: +e.year,
          },
        });
      }
      if (results.length < pageSize) break;
      page++;
      if (page > 100) break;
    }

    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase.from("normalized_events").upsert(chunk, {
        onConflict: "dedup_key", ignoreDuplicates: true,
      });
      if (!error) inserted += chunk.length;
    }

    await supabase.from("automation_logs").insert({
      job_name: FN, status: "success",
      message: `ACLED year=${nextYear}: ${inserted} events ingested in ${Date.now() - start}ms`,
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
