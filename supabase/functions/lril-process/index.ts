/**
 * lril-process — Local Reality Ingestion Layer: detect → geo → classify → cluster
 *
 * Reads unprocessed rows from `aicis_raw_local_signals`, runs:
 *   1. Keyword detection (via lril_detect_keywords RPC)
 *   2. Geo resolution (locality match against aicis_geo_entities,
 *      with country_hint/region_hint fallback)
 *   3. Event classification (domain + subtype from keyword pack)
 *   4. Spatial-temporal clustering (10–50km, 6–24h window)
 *   5. Confidence scoring (lril_compute_confidence)
 *   6. Upsert into aicis_local_events
 *   7. Bridge medium+ confidence events to normalized_events
 *
 * Idempotent: marks signals as processed_at = now() to avoid reprocessing.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN = "lril-process";
const BATCH = 500;
const CLUSTER_RADIUS_KM = 25;
const CLUSTER_WINDOW_HOURS = 12;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

interface Signal {
  id: string;
  raw_text: string | null;
  language: string;
  country_hint: string | null;
  region_hint: string | null;
  source_reliability: number;
  published_at: string | null;
  url: string | null;
  source_name: string;
}

interface GeoEntity {
  id: string;
  iso3: string;
  admin_level_1: string | null;
  city: string | null;
  locality: string | null;
  lat: number | null;
  lon: number | null;
  geo_confidence: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const start = Date.now();
  const stats = { fetched: 0, classified: 0, geo_resolved: 0, events_created: 0, events_updated: 0, bridged: 0, errors: 0 };

  // 1. Fetch unprocessed signals
  const { data: signals, error: sErr } = await supabase
    .from("aicis_raw_local_signals")
    .select("id, raw_text, language, country_hint, region_hint, source_reliability, published_at, url, source_name")
    .is("processed_at", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(BATCH);
  if (sErr) {
    await supabase.from("automation_logs").insert({ job_name: FN, status: "error", message: sErr.message });
    return new Response(JSON.stringify({ ok: false, error: sErr.message }), { status: 500, headers: corsHeaders });
  }
  stats.fetched = signals?.length || 0;

  if (!signals || signals.length === 0) {
    return new Response(JSON.stringify({ ok: true, stats, message: "no unprocessed signals" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Pre-load geo cache by country hints present in this batch
  const isos = [...new Set(signals.map(s => s.country_hint).filter(Boolean) as string[])];
  const geoCache = new Map<string, GeoEntity[]>();
  if (isos.length > 0) {
    const { data: geos } = await supabase
      .from("aicis_geo_entities")
      .select("id, iso3, admin_level_1, city, locality, lat, lon, geo_confidence")
      .in("iso3", isos);
    for (const g of (geos || []) as GeoEntity[]) {
      const list = geoCache.get(g.iso3) || [];
      list.push(g);
      geoCache.set(g.iso3, list);
    }
  }

  // Holding pen for new local events to cluster against (per iso3+subtype)
  const processedIds: string[] = [];

  for (const s of signals as Signal[]) {
    try {
      // 2a. Keyword detection
      const { data: kwRows } = await supabase.rpc("lril_detect_keywords", {
        p_text: s.raw_text || "",
        p_language: s.language || "en",
        p_country: s.country_hint,
      });
      const top = Array.isArray(kwRows) && kwRows.length > 0 ? kwRows[0] : null;
      if (!top) { processedIds.push(s.id); continue; }

      const matched: any[] = top.matched_terms || [];
      const domain: string = top.domain;
      const subtype: string = top.subtype;
      const keyword_strength = Number(top.score || 0);

      // Country fallback: if hint is missing OR is a publisher country (GDELT),
      // try to detect from the actual text. Override when text strongly indicates
      // a different country (e.g. xenophobia article from a Nigerian publisher about ZAF).
      let effectiveIso3 = s.country_hint;
      try {
        const { data: detected } = await supabase.rpc("lril_detect_country_from_text", { p_text: s.raw_text || "" });
        if (detected && (typeof detected === "string")) {
          if (!effectiveIso3 || effectiveIso3 !== detected) effectiveIso3 = detected;
        }
      } catch (_) { /* keep original */ }
      (s as any).country_hint = effectiveIso3;

      // 2b. Geo resolution (locality string-match in cached geo entities)
      const iso3 = s.country_hint;
      let geo: GeoEntity | null = null;
      if (iso3 && geoCache.has(iso3) && s.raw_text) {
        const lc = s.raw_text.toLowerCase();
        const candidates = geoCache.get(iso3)!;
        for (const g of candidates) {
          const targets = [g.locality, g.city, g.admin_level_1].filter(Boolean) as string[];
          for (const t of targets) {
            if (t.length >= 4 && lc.includes(t.toLowerCase())) { geo = g; break; }
          }
          if (geo) break;
        }
      }
      const geo_confidence = geo ? geo.geo_confidence : (iso3 ? 0.4 : 0.15);
      if (geo) stats.geo_resolved++;
      stats.classified++;

      const startTime = s.published_at || new Date().toISOString();

      if (!iso3) { processedIds.push(s.id); continue; }

      // 2c. Cluster: find existing active event in same iso3 + domain + subtype
      // within time window and (if both have coords) spatial radius
      const windowStart = new Date(new Date(startTime).getTime() - CLUSTER_WINDOW_HOURS * 3600 * 1000).toISOString();
      const windowEnd   = new Date(new Date(startTime).getTime() + CLUSTER_WINDOW_HOURS * 3600 * 1000).toISOString();

      const { data: existing } = await supabase
        .from("aicis_local_events")
        .select("id, lat, lon, source_count, raw_signal_ids, matched_keywords, severity, confidence, locality")
        .eq("iso3", iso3)
        .eq("event_type", domain)
        .eq("subtype", subtype)
        .eq("status", "active")
        .gte("start_time", windowStart)
        .lte("start_time", windowEnd)
        .limit(20);

      let clusterId: string | null = null;
      if (existing && existing.length > 0 && geo?.lat != null && geo?.lon != null) {
        for (const e of existing) {
          if (e.lat != null && e.lon != null) {
            const d = haversineKm(geo.lat, geo.lon, Number(e.lat), Number(e.lon));
            if (d <= CLUSTER_RADIUS_KM) { clusterId = e.id; break; }
          } else {
            // existing has no coords → cluster anyway if same iso3+subtype within window
            clusterId = e.id; break;
          }
        }
      } else if (existing && existing.length > 0) {
        clusterId = existing[0].id;
      }

      if (clusterId) {
        // Update existing event: append signal, recompute confidence
        const target = existing!.find(e => e.id === clusterId)!;
        const newIds = [...new Set([...(target.raw_signal_ids || []), s.id])];
        const newKws = [...new Set([...(target.matched_keywords || []), ...matched])];
        const newCount = newIds.length;
        const temporal_density = Math.min(1, newCount / CLUSTER_WINDOW_HOURS);
        const { data: confRow } = await supabase.rpc("lril_compute_confidence", {
          p_source_count: newCount,
          p_avg_source_reliability: s.source_reliability,
          p_keyword_strength: keyword_strength,
          p_geo_confidence: geo_confidence,
          p_temporal_density: temporal_density,
          p_proxy_boost: 0,
        });
        const newConfidence = Number(confRow ?? target.confidence ?? 0.3);

        await supabase.from("aicis_local_events").update({
          source_count: newCount,
          raw_signal_ids: newIds,
          matched_keywords: newKws,
          confidence: newConfidence,
          bridged_to_normalized: false, // re-evaluate downstream
        }).eq("id", clusterId);
        stats.events_updated++;
      } else {
        // Create new event (low-confidence early signal allowed)
        const { data: confRow } = await supabase.rpc("lril_compute_confidence", {
          p_source_count: 1,
          p_avg_source_reliability: s.source_reliability,
          p_keyword_strength: keyword_strength,
          p_geo_confidence: geo_confidence,
          p_temporal_density: 0.1,
          p_proxy_boost: 0,
        });
        const confidence = Number(confRow ?? 0.3);
        const severity = Math.min(1, 0.3 + 0.1 * matched.length);

        const title = `${subtype.replace(/_/g, ' ')} — ${geo?.locality || geo?.city || iso3}`;
        const description = (s.raw_text || "").slice(0, 500);

        const { error: insErr } = await supabase.from("aicis_local_events").insert({
          event_type: domain,
          subtype,
          iso3,
          admin_level_1: geo?.admin_level_1 || null,
          locality: geo?.locality || geo?.city || s.region_hint || null,
          geo_entity_id: geo?.id || null,
          lat: geo?.lat || null,
          lon: geo?.lon || null,
          start_time: startTime,
          severity,
          confidence,
          source_count: 1,
          raw_signal_ids: [s.id],
          matched_keywords: matched,
          title,
          description,
          status: "active",
        });
        if (insErr) { stats.errors++; console.error("event insert", insErr.message); }
        else stats.events_created++;
      }

      processedIds.push(s.id);
    } catch (e) {
      stats.errors++;
      console.error("signal", s.id, (e as Error).message);
    }
  }

  // Mark signals processed
  if (processedIds.length > 0) {
    for (let i = 0; i < processedIds.length; i += 500) {
      await supabase.from("aicis_raw_local_signals")
        .update({ processed_at: new Date().toISOString() })
        .in("id", processedIds.slice(i, i + 500));
    }
  }

  // Bridge medium+ confidence events to normalized_events
  try {
    const { data: bridgeRows } = await supabase.rpc("lril_bridge_to_normalized");
    stats.bridged = Number(bridgeRows?.[0]?.bridged_count || 0);
  } catch (e) {
    console.error("bridge error", (e as Error).message);
  }

  await supabase.from("automation_logs").insert({
    job_name: FN,
    status: stats.errors > 0 ? "partial" : "success",
    message: `${JSON.stringify(stats)} (${Date.now() - start}ms)`,
  });

  return new Response(JSON.stringify({ ok: true, stats }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
