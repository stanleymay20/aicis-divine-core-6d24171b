// signal-geocoder
// Phase 3 — Geo resolution layer.
//
// For each signal where geocoded_at IS NULL:
//  - If affected_countries[] resolves to one ISO3, take that as admin0.
//  - Try to extract a city/region from translated_title+title+summary against
//    aicis_geo_entities for that country (admin1/admin2/city) when present.
//  - Fall back to country centroid (lookup admin_regions admin_level=0
//    or aicis_geo_entities country row).
//  - If nothing, mark as failed but do not block ingestion.
//
// Never mutates business fields. Idempotent. Logs to automation_logs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BATCH = 500;

type GeoEntity = {
  iso3: string;
  admin_level_1: string | null;
  admin_level_2: string | null;
  city: string | null;
  locality: string | null;
  lat: number | null;
  lon: number | null;
};

function tokenize(s: string): string[] {
  return (s || "")
    .replace(/[^A-Za-z\u00C0-\u017F\s'-]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 3);
}

// Build a quick country token map from aicis_geo_entities for the iso3.
function findPlaceMatch(text: string, entities: GeoEntity[]): GeoEntity | null {
  if (!text) return null;
  const lower = ` ${text.toLowerCase()} `;
  // Prefer city > admin_level_2 > admin_level_1
  let best: { e: GeoEntity; rank: number } | null = null;
  for (const e of entities) {
    const candidates: { v: string | null; rank: number }[] = [
      { v: e.city, rank: 3 },
      { v: e.admin_level_2, rank: 2 },
      { v: e.admin_level_1, rank: 1 },
      { v: e.locality, rank: 2 },
    ];
    for (const { v, rank } of candidates) {
      if (!v || v.length < 3) continue;
      if (lower.includes(` ${v.toLowerCase()} `)) {
        if (!best || rank > best.rank) best = { e, rank };
      }
    }
  }
  return best ? best.e : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  let processed = 0, byCountry = 0, byPlace = 0, byCentroid = 0, failed = 0;

  try {
    // Pass 1: never-geocoded rows (partial index idx_gs_pending_geocode).
    const { data: pending, error } = await supa
      .from("global_signals")
      .select("id,title,summary,translated_title,translated_summary,affected_countries,geo_method,ingested_at")
      .is("geocoded_at", null)
      .order("first_detected_at", { ascending: false })
      .limit(BATCH);
    if (error) throw error;
    const signals = pending || [];

    // Pass 2: retry ONLY previously-failed rows that have since gained a country.
    // Rows with no country at all are never retried — they would loop forever.
    // Only when the fresh backlog is fully drained — this scan is expensive.
    if (signals.length === 0) {
      const { data: retry, error: rErr } = await supa
        .from("global_signals")
        .select("id,title,summary,translated_title,translated_summary,affected_countries,geo_method,ingested_at")
        .eq("geo_method", "failed")
        .not("affected_countries", "is", null)
        .neq("affected_countries", "{}")
        .order("first_detected_at", { ascending: false })
        .limit(BATCH);

      if (rErr) throw rErr;
      signals.push(...(retry || []));
    }


    // Pre-cache geo entities per ISO3 we encounter
    const iso3Set = new Set<string>();
    for (const s of signals) {
      const ac = (s.affected_countries || []) as string[];
      if (ac.length >= 1) iso3Set.add(ac[0]);
    }

    const entitiesByIso = new Map<string, GeoEntity[]>();
    if (iso3Set.size > 0) {
      const { data: ents, error: eErr } = await supa
        .from("aicis_geo_entities")
        .select("iso3,admin_level_1,admin_level_2,city,locality,lat,lon")
        .in("iso3", Array.from(iso3Set))
        .limit(20000);
      if (eErr) throw eErr;
      for (const e of (ents || []) as GeoEntity[]) {
        if (!entitiesByIso.has(e.iso3)) entitiesByIso.set(e.iso3, []);
        entitiesByIso.get(e.iso3)!.push(e);
      }
    }

    // Country centroids from admin_regions admin_level=0
    const { data: admin0, error: a0Err } = await supa
      .from("admin_regions")
      .select("country_iso3,lat,lon")
      .eq("admin_level", 0)
      .limit(500);
    if (a0Err) throw a0Err;
    const centroidByIso = new Map<string, { lat: number; lon: number }>();
    for (const r of admin0 || []) {
      if (r.country_iso3 && r.lat != null && r.lon != null) {
        centroidByIso.set(r.country_iso3 as string, { lat: r.lat as number, lon: r.lon as number });
      }
    }

    for (const sig of signals) {
      processed++;
      const ac = (sig.affected_countries || []) as string[];
      // Multi-country signals resolve to their primary (first) country rather than
      // being dropped as "failed" — this was silently losing most geo coverage.
      const iso3 = ac.length >= 1 ? ac[0] : null;
      const isMultiCountry = ac.length > 1;


      const nowIso = new Date().toISOString();
      const ingestRef = (sig as any).ingested_at;
      const processingLatencySec = ingestRef
        ? Math.max(0, Math.round((Date.now() - new Date(ingestRef).getTime()) / 1000))
        : null;
      const update: any = {
        geocoded_at: nowIso,
        last_pipeline_stage: "geocoded",
        pipeline_completed_at: nowIso,
        processing_latency_seconds: processingLatencySec,
      };

      if (!iso3) {
        update.geo_method = "failed";
        update.geo_confidence = 0;
        failed++;
      } else {
        update.geo_admin0_iso3 = iso3;

        const text = [sig.translated_title, sig.translated_summary, sig.title, sig.summary]
          .filter(Boolean).join("  ");
        const ents = entitiesByIso.get(iso3) || [];
        const placeMatch = findPlaceMatch(text, ents);

        if (placeMatch && placeMatch.lat != null && placeMatch.lon != null) {
          update.geo_admin1 = placeMatch.admin_level_1;
          update.geo_admin2 = placeMatch.admin_level_2;
          update.geo_lat = placeMatch.lat;
          update.geo_lng = placeMatch.lon;
          update.geo_method = placeMatch.city ? "place_extraction" : "admin_match";
          update.geo_confidence = 75;
          byPlace++;
        } else {
          const centroid = centroidByIso.get(iso3);
          if (centroid) {
            update.geo_lat = centroid.lat;
            update.geo_lng = centroid.lon;
            update.geo_method = "centroid";
            update.geo_confidence = 35;
            byCentroid++;
          } else {
            update.geo_method = "affected_country";
            update.geo_confidence = 20;
            byCountry++;
          }
        }
        if (isMultiCountry) {
          update.geo_confidence = Math.min(Number(update.geo_confidence ?? 0), 40);
        }
      }



      const { error: uErr } = await supa.from("global_signals").update(update).eq("id", sig.id);
      if (uErr) throw uErr;
    }

    await supa.from("automation_logs").insert({
      job_name: "signal-geocoder",
      status: "success",
      message: `processed=${processed} place=${byPlace} centroid=${byCentroid} country=${byCountry} failed=${failed} in ${Date.now() - startedAt}ms`,
    });
    return new Response(JSON.stringify({ processed, place: byPlace, centroid: byCentroid, country: byCountry, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error("signal-geocoder error:", msg);
    await supa.from("automation_logs").insert({
      job_name: "signal-geocoder", status: "error", message: msg.slice(0, 500),
    });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
