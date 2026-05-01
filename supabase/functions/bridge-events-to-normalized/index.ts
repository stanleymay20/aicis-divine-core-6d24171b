import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN = "bridge-events-to-normalized";

/**
 * Bridges fresh internal event sources into normalized_events when external
 * feeds (GDELT) are rate-limited. Sources:
 *   - crisis_events (active crisis detections)
 *   - global_signals (categorized world signals)
 *   - security_incidents (security feed)
 *
 * Idempotent via dedup_key.
 */

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const result = { crisis: 0, signals: 0, security: 0, errors: [] as string[] };

  try {
    // 1) crisis_events → normalized_events
    const { data: crises } = await supabase
      .from("crisis_events")
      .select("id, kind, region, severity, status, opened_at, details_md, created_at")
      .gte("created_at", since)
      .limit(500);

    for (const c of crises || []) {
      const dedup = `crisis:${c.id}`;
      let iso3: string | null = (c.region && c.region.length === 3) ? c.region : null;
      if (!iso3 && c.region) {
        try {
          const { data: norm } = await supabase.rpc("lril_fips_to_iso3", { p_code: c.region });
          if (typeof norm === "string" && norm) iso3 = norm;
        } catch (_) {}
      }
      const { error } = await supabase.from("normalized_events").upsert({
        provider_name: "internal:crisis_events",
        event_type: c.kind || "crisis",
        category: c.kind || "crisis",
        title: `${c.kind || "crisis"} in ${c.region}`,
        description: c.details_md || null,
        iso3, country_iso3: iso3,
        started_at: c.opened_at || c.created_at,
        occurred_at: c.opened_at || c.created_at,
        severity: c.severity ?? null,
        confidence: 0.8,
        provenance_source: "crisis_events",
        source_name: "AICIS Crisis Scanner",
        dedup_key: dedup,
        metadata: { crisis_id: c.id, status: c.status },
      }, { onConflict: "dedup_key" });
      if (!error) result.crisis++;
    }

    // 2) global_signals → normalized_events
    const { data: signals } = await supabase
      .from("global_signals")
      .select("id, title, summary, category, subcategory, occurred_at, first_detected_at, affected_countries, primary_source, confidence_score, urgency_score")
      .gte("first_detected_at", since)
      .limit(500);

    for (const s of signals || []) {
      const country = Array.isArray(s.affected_countries) && s.affected_countries.length
        ? s.affected_countries[0] : null;
      let iso3: string | null = (country && country.length === 3) ? country : null;
      if (!iso3 && country) {
        try {
          const { data: norm } = await supabase.rpc("lril_fips_to_iso3", { p_code: country });
          if (typeof norm === "string" && norm) iso3 = norm;
        } catch (_) {}
      }
      const dedup = `signal:${s.id}`;

      const { error } = await supabase.from("normalized_events").upsert({
        provider_name: "internal:global_signals",
        event_type: String(s.category || "signal"),
        category: String(s.category || "signal"),
        title: s.title,
        description: s.summary,
        iso3,
        country_iso3: iso3,
        started_at: s.occurred_at || s.first_detected_at,
        occurred_at: s.occurred_at || s.first_detected_at,
        severity: s.urgency_score ? s.urgency_score / 10 : null,
        confidence: s.confidence_score ? s.confidence_score / 100 : 0.5,
        provenance_source: s.primary_source || "global_signals",
        source_name: s.primary_source || "Global Signals",
        dedup_key: dedup,
        metadata: { signal_id: s.id, subcategory: s.subcategory },
      }, { onConflict: "dedup_key" });
      if (!error) result.signals++;
    }

    // 3) security_incidents → normalized_events
    const { data: secs } = await supabase
      .from("security_incidents")
      .select("id, title, description, severity, country, created_at")
      .gte("created_at", since)
      .limit(500);

    for (const s of secs || []) {
      const dedup = `security:${s.id}`;
      const iso3 = (s.country && s.country.length === 3) ? s.country : null;
      const { error } = await supabase.from("normalized_events").upsert({
        provider_name: "internal:security_incidents",
        event_type: "security",
        category: "security",
        title: s.title,
        description: s.description,
        iso3,
        country_iso3: iso3,
        started_at: s.created_at,
        occurred_at: s.created_at,
        severity: typeof s.severity === "number" ? s.severity : null,
        confidence: 0.75,
        provenance_source: "security_incidents",
        source_name: "AICIS Security Feed",
        dedup_key: dedup,
        metadata: { incident_id: s.id },
      }, { onConflict: "dedup_key" });
      if (!error) result.security++;
    }

    const total = result.crisis + result.signals + result.security;

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: "success",
      message: `Bridged ${total} events (crisis=${result.crisis}, signals=${result.signals}, security=${result.security})`,
    });

    return new Response(JSON.stringify({ success: true, ...result, total }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    await supabase.from("automation_logs").insert({
      job_name: FN, status: "error", message: (e as Error).message,
    });
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
