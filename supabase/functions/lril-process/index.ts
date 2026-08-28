/**
 * lril-process — Local Reality Ingestion Layer: detect → geo → classify → cluster.
 *
 * Truth-floor rules:
 * - missing provider time is not converted to now
 * - missing source/geo quality remains unknown
 * - LRIL confidence is a deterministic heuristic score, not a probability
 * - incomplete evidence yields NULL confidence and cannot bridge
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const FN = "lril-process";
const BATCH = 500;
const CLUSTER_RADIUS_KM = 25;
const CLUSTER_WINDOW_HOURS = 12;

type JsonRecord = Record<string, unknown>;

type Signal = {
  id: string;
  raw_text: string | null;
  language: string;
  country_hint: string | null;
  region_hint: string | null;
  source_reliability: number | null;
  published_at: string | null;
  url: string | null;
  source_name: string;
};

type GeoEntity = {
  id: string;
  iso3: string;
  admin_level_1: string | null;
  city: string | null;
  locality: string | null;
  lat: number | null;
  lon: number | null;
  geo_confidence: number | null;
};

type ExistingEvent = {
  id: string;
  lat: number | null;
  lon: number | null;
  source_count: number | null;
  raw_signal_ids: unknown;
  matched_keywords: unknown;
  severity: number | null;
  confidence: number | null;
  locality: string | null;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? value as JsonRecord : {};
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseProviderTime(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const start = Date.now();
  const workerId = req.headers.get("x-worker-id") || crypto.randomUUID().slice(0, 8);
  const stats = {
    fetched: 0,
    classified: 0,
    geo_resolved: 0,
    events_created: 0,
    events_updated: 0,
    bridged: 0,
    withheld_missing_time: 0,
    withheld_missing_confidence_inputs: 0,
    errors: 0,
  };

  try {
    await supabase.rpc("lril_release_stale_claims", { p_max_age_minutes: 5 });
  } catch {
    // Non-blocking cleanup.
  }

  const { data: signalRows, error: sErr } = await supabase.rpc("lril_claim_signals", { p_limit: BATCH });
  if (sErr) {
    await supabase.from("automation_logs").insert({ job_name: FN, status: "error", message: sErr.message });
    return new Response(JSON.stringify({ ok: false, error: sErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const signals = (signalRows ?? []) as Signal[];
  stats.fetched = signals.length;
  if (signals.length === 0) {
    return new Response(JSON.stringify({ ok: true, stats, message: "no unprocessed signals" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const isos = [...new Set(signals.map((signal) => signal.country_hint).filter((iso): iso is string => Boolean(iso)))];
  const geoCache = new Map<string, GeoEntity[]>();
  if (isos.length > 0) {
    const { data: geos } = await supabase
      .from("aicis_geo_entities")
      .select("id, iso3, admin_level_1, city, locality, lat, lon, geo_confidence")
      .in("iso3", isos);
    for (const geo of (geos ?? []) as GeoEntity[]) {
      const list = geoCache.get(geo.iso3) ?? [];
      list.push(geo);
      geoCache.set(geo.iso3, list);
    }
  }

  const processedIds: string[] = [];

  for (const signal of signals) {
    try {
      const { data: kwRows } = await supabase.rpc("lril_detect_keywords", {
        p_text: signal.raw_text || "",
        p_language: signal.language || "en",
        p_country: signal.country_hint,
      });
      const top = Array.isArray(kwRows) && kwRows.length > 0 ? asRecord(kwRows[0]) : null;
      if (!top) {
        processedIds.push(signal.id);
        continue;
      }

      const matched = stringArray(top.matched_terms);
      const domain = typeof top.domain === "string" ? top.domain : null;
      const subtype = typeof top.subtype === "string" ? top.subtype : null;
      const keywordStrength = finiteNumber(top.score);
      if (!domain || !subtype) {
        processedIds.push(signal.id);
        continue;
      }

      let effectiveIso3: string | null = signal.country_hint;
      const originalHint = signal.country_hint;
      let countryCorrected = false;

      try {
        const { data: normalized } = await supabase.rpc("lril_fips_to_iso3", { p_code: effectiveIso3 || "" });
        if (typeof normalized === "string" && normalized) effectiveIso3 = normalized;
      } catch {
        // Preserve upstream value when normalization is unavailable.
      }

      try {
        const { data: detected } = await supabase.rpc("lril_detect_country_from_text", {
          p_text: signal.raw_text || "",
        });
        if (typeof detected === "string" && detected && effectiveIso3 !== detected) {
          if (effectiveIso3) {
            countryCorrected = true;
            try {
              await supabase.from("lril_country_corrections").insert({
                signal_id: signal.id,
                original_country_hint: originalHint,
                detected_iso3: detected,
                raw_text_excerpt: (signal.raw_text || "").slice(0, 500),
                source_name: signal.source_name,
                confidence_penalty: null,
              });
            } catch {
              // Audit write is best-effort.
            }
          }
          effectiveIso3 = detected;
        }
      } catch {
        // Keep the upstream/normalized country when text detection is unavailable.
      }

      const iso3 = effectiveIso3;
      if (!iso3) {
        processedIds.push(signal.id);
        continue;
      }

      let geo: GeoEntity | null = null;
      if (geoCache.has(iso3) && signal.raw_text) {
        const lowerText = signal.raw_text.toLowerCase();
        for (const candidate of geoCache.get(iso3) ?? []) {
          const targets = [candidate.locality, candidate.city, candidate.admin_level_1]
            .filter((value): value is string => typeof value === "string");
          if (targets.some((target) => target.length >= 4 && lowerText.includes(target.toLowerCase()))) {
            geo = candidate;
            break;
          }
        }
      }

      if (!geo && signal.raw_text) {
        try {
          const { data: fuzzyRows } = await supabase.rpc("lril_resolve_geo_fuzzy_v3", {
            p_text: signal.raw_text.slice(0, 1500),
            p_iso3: iso3,
            p_signal_id: signal.id,
          });
          if (Array.isArray(fuzzyRows) && fuzzyRows.length > 0) {
            const fuzzy = asRecord(fuzzyRows[0]);
            const id = typeof fuzzy.geo_entity_id === "string" ? fuzzy.geo_entity_id : null;
            if (id) {
              geo = {
                id,
                iso3,
                admin_level_1: typeof fuzzy.admin_level_1 === "string" ? fuzzy.admin_level_1 : null,
                city: null,
                locality: typeof fuzzy.locality === "string" ? fuzzy.locality : null,
                lat: finiteNumber(fuzzy.lat),
                lon: finiteNumber(fuzzy.lon),
                geo_confidence: finiteNumber(fuzzy.geo_confidence),
              };
            }
          }
        } catch {
          // Unknown geo remains unknown.
        }
      }

      let geoConfidence = geo?.geo_confidence ?? null;
      if (countryCorrected && geoConfidence != null) {
        geoConfidence = Math.max(0, geoConfidence - 0.05);
      }
      if (geo) stats.geo_resolved++;
      stats.classified++;

      const startTime = parseProviderTime(signal.published_at);
      if (!startTime) {
        stats.withheld_missing_time++;
        processedIds.push(signal.id);
        continue;
      }

      const windowStart = new Date(Date.parse(startTime) - CLUSTER_WINDOW_HOURS * 3600 * 1000).toISOString();
      const windowEnd = new Date(Date.parse(startTime) + CLUSTER_WINDOW_HOURS * 3600 * 1000).toISOString();

      const { data: existingRows } = await supabase
        .from("aicis_local_events")
        .select("id, lat, lon, source_count, raw_signal_ids, matched_keywords, severity, confidence, locality")
        .eq("iso3", iso3)
        .eq("event_type", domain)
        .eq("subtype", subtype)
        .eq("status", "active")
        .gte("start_time", windowStart)
        .lte("start_time", windowEnd)
        .limit(20);
      const existing = (existingRows ?? []) as ExistingEvent[];

      let clusterId: string | null = null;
      if (existing.length > 0 && geo?.lat != null && geo?.lon != null) {
        for (const event of existing) {
          if (event.lat != null && event.lon != null) {
            if (haversineKm(geo.lat, geo.lon, Number(event.lat), Number(event.lon)) <= CLUSTER_RADIUS_KM) {
              clusterId = event.id;
              break;
            }
          }
        }
      }

      let sourceTier = finiteNumber(signal.source_reliability);
      try {
        const { data: tier } = await supabase.rpc("lril_source_tier", {
          p_source: signal.source_name,
          p_url: signal.url,
        });
        const measuredTier = finiteNumber(tier);
        if (measuredTier != null) sourceTier = measuredTier;
      } catch {
        // Missing tier evidence remains unknown.
      }

      const confidenceInputsComplete = sourceTier != null && keywordStrength != null && geoConfidence != null;
      if (!confidenceInputsComplete) stats.withheld_missing_confidence_inputs++;

      if (clusterId) {
        const target = existing.find((event) => event.id === clusterId);
        if (!target) continue;
        const newIds = [...new Set([...stringArray(target.raw_signal_ids), signal.id])];
        const newKeywords = [...new Set([...stringArray(target.matched_keywords), ...matched])];
        const newCount = newIds.length;
        const temporalDensity = Math.min(1, newCount / CLUSTER_WINDOW_HOURS);

        let newConfidence: number | null = target.confidence ?? null;
        let confidenceSemantics = "existing_score_preserved_missing_recompute_evidence";
        if (confidenceInputsComplete) {
          const { data: confRow } = await supabase.rpc("lril_compute_confidence", {
            p_source_count: newCount,
            p_avg_source_reliability: sourceTier,
            p_keyword_strength: Math.max(keywordStrength, 0.5 + 0.2 * newKeywords.length),
            p_geo_confidence: geoConfidence,
            p_temporal_density: temporalDensity,
            p_proxy_boost: 0,
          });
          newConfidence = finiteNumber(confRow);
          confidenceSemantics = "deterministic_heuristic_v1_not_calibrated_probability";
        }

        await supabase.from("aicis_local_events").update({
          source_count: newCount,
          raw_signal_ids: newIds,
          matched_keywords: newKeywords,
          confidence: newConfidence,
          confidence_semantics: confidenceSemantics,
          epistemic_status: newConfidence == null ? "insufficient_evidence" : "heuristic_score_available",
          event_time_status: "provider_supplied",
          bridged_to_normalized: false,
        }).eq("id", clusterId);
        stats.events_updated++;
      } else {
        let confidence: number | null = null;
        if (confidenceInputsComplete) {
          const { data: confRow } = await supabase.rpc("lril_compute_confidence", {
            p_source_count: 1,
            p_avg_source_reliability: sourceTier,
            p_keyword_strength: keywordStrength,
            p_geo_confidence: geoConfidence,
            p_temporal_density: 0.1,
            p_proxy_boost: 0,
          });
          confidence = finiteNumber(confRow);
        }

        let severity = Math.min(1, 0.3 + 0.1 * matched.length);
        let severitySemantics = "deterministic_keyword_count_heuristic_v1";
        if (sourceTier != null) {
          try {
            const { data: severityRow } = await supabase.rpc("lril_compute_severity", {
              p_domain: domain,
              p_subtype: subtype,
              p_text: (signal.raw_text || "").slice(0, 2000),
              p_matched_keywords: matched,
              p_source_reliability: sourceTier,
            });
            const computedSeverity = finiteNumber(severityRow);
            if (computedSeverity != null) {
              severity = computedSeverity;
              severitySemantics = "deterministic_lril_severity_model_v1";
            }
          } catch {
            // Keep explicitly labelled deterministic fallback.
          }
        }

        const title = `${subtype.replace(/_/g, " ")} — ${geo?.locality || geo?.city || iso3}`;
        const description = (signal.raw_text || "").slice(0, 500);
        const { error: insertError } = await supabase.from("aicis_local_events").insert({
          event_type: domain,
          subtype,
          iso3,
          iso3_normalized: iso3,
          admin_level_1: geo?.admin_level_1 || null,
          locality: geo?.locality || geo?.city || signal.region_hint || null,
          geo_entity_id: geo?.id || null,
          lat: geo?.lat ?? null,
          lon: geo?.lon ?? null,
          start_time: startTime,
          severity,
          confidence,
          source_count: 1,
          raw_signal_ids: [signal.id],
          matched_keywords: matched,
          title,
          description,
          status: "active",
          epistemic_status: confidence == null ? "insufficient_evidence" : "heuristic_score_available",
          confidence_semantics: confidence == null
            ? "withheld_missing_required_inputs"
            : "deterministic_heuristic_v1_not_calibrated_probability",
          severity_semantics: severitySemantics,
          event_time_status: "provider_supplied",
        });
        if (insertError) {
          stats.errors++;
          console.error("event insert", insertError.message);
        } else {
          stats.events_created++;
        }
      }

      processedIds.push(signal.id);
    } catch (error) {
      stats.errors++;
      console.error("signal", signal.id, error instanceof Error ? error.message : String(error));
    }
  }

  if (processedIds.length > 0) {
    for (let index = 0; index < processedIds.length; index += 500) {
      await supabase.from("aicis_raw_local_signals")
        .update({ processed_at: new Date().toISOString() })
        .in("id", processedIds.slice(index, index + 500));
    }
  }

  try {
    const { data: bridgeRows } = await supabase.rpc("lril_bridge_to_normalized");
    const first = Array.isArray(bridgeRows) && bridgeRows.length > 0 ? asRecord(bridgeRows[0]) : {};
    stats.bridged = finiteNumber(first.bridged_count) ?? 0;
  } catch (error) {
    console.error("bridge error", error instanceof Error ? error.message : String(error));
  }

  const duration = Date.now() - start;
  try {
    const { count: remaining } = await supabase
      .from("aicis_raw_local_signals")
      .select("id", { count: "exact", head: true })
      .is("processed_at", null);
    await supabase.from("lril_process_checkpoints").insert({
      worker_id: workerId,
      processed_count: processedIds.length,
      failed_count: stats.errors,
      last_batch_duration_ms: duration,
      remaining_unprocessed: remaining ?? null,
    });
  } catch {
    // Non-blocking observability.
  }

  await supabase.from("automation_logs").insert({
    job_name: FN,
    status: stats.errors > 0 ? "partial" : "success",
    message: `worker=${workerId} ${JSON.stringify(stats)} (${duration}ms)`,
  });

  return new Response(JSON.stringify({
    ok: true,
    worker_id: workerId,
    duration_ms: duration,
    truth_floor: {
      missing_event_time: "withheld",
      missing_confidence_inputs: "confidence_null",
      confidence_semantics: "deterministic_heuristic_not_calibrated_probability",
    },
    stats,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
