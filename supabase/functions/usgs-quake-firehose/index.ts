/**
 * USGS earthquake firehose.
 *
 * Ingestion stores observed USGS facts and provenance. The legacy global_signals
 * schema requires non-null confidence/impact/urgency values, so 50 is used only
 * as an explicit neutral compatibility sentinel and is never described as a
 * measured or modelled score.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { recordFirehoseHealth } from "../_shared/firehose-health.ts";
import {
  startProviderRun,
  finishProviderRun,
  failProviderRun,
} from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const FN = "usgs-quake-firehose";
const USGS_FEED = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson";
const NEUTRAL_UNASSESSED_SCORE = 50;

interface UsgsFeature {
  id?: string;
  properties?: {
    mag?: number | null;
    place?: string | null;
    time?: number | null;
    updated?: number | null;
    url?: string | null;
    status?: string | null;
    sig?: number | null;
    alert?: string | null;
    tsunami?: number | null;
    felt?: number | null;
    cdi?: number | null;
    mmi?: number | null;
    magType?: string | null;
  };
  geometry?: {
    coordinates?: [number, number, number?];
  } | null;
}

interface UsgsFeed {
  features?: UsgsFeature[];
}

interface Candidate {
  id: string;
  title: string;
  url: string;
  occurredAt: string;
  updatedAt: string | null;
  magnitude: number;
  magnitudeType: string | null;
  place: string;
  longitude: number | null;
  latitude: number | null;
  depthKm: number | null;
  status: string | null;
  significance: number | null;
  alert: string | null;
  tsunami: number | null;
  felt: number | null;
  cdi: number | null;
  mmi: number | null;
  dedupKey: string;
}

interface ExistingSignal {
  dedup_key: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeDedup(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 10)
    .join(" ");
}

function finiteOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const startedAt = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const run = await startProviderRun(supabase, {
    provider_name: "usgs_quake_firehose",
    endpoint: FN,
    scheduler_source: auth.via === "cron" ? "cron" : "admin",
  });

  try {
    const response = await fetch(USGS_FEED, {
      headers: { "Accept": "application/geo+json, application/json", "User-Agent": "AICIS/1.0" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`USGS HTTP ${response.status}`);

    const feed = await response.json() as UsgsFeed;
    const features = Array.isArray(feed.features) ? feed.features : [];
    const candidates: Candidate[] = [];
    const seen = new Set<string>();

    for (const feature of features) {
      const id = feature.id?.trim();
      const magnitude = finiteOrNull(feature.properties?.mag);
      const eventTimeMs = finiteOrNull(feature.properties?.time);
      if (!id || magnitude === null || eventTimeMs === null) continue;

      const occurredAt = new Date(eventTimeMs).toISOString();
      const place = feature.properties?.place?.trim() || "Unknown location";
      const title = `M${magnitude.toFixed(1)} earthquake — ${place}`;
      // Retain the legacy dedup form to avoid duplicating already-ingested rows.
      const dedupKey = `${normalizeDedup(title)}::usgs.gov`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      const coordinates = feature.geometry?.coordinates;
      candidates.push({
        id,
        title,
        url: feature.properties?.url || `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(id)}`,
        occurredAt,
        updatedAt: finiteOrNull(feature.properties?.updated) !== null
          ? new Date(Number(feature.properties?.updated)).toISOString()
          : null,
        magnitude,
        magnitudeType: feature.properties?.magType ?? null,
        place,
        longitude: finiteOrNull(coordinates?.[0]),
        latitude: finiteOrNull(coordinates?.[1]),
        depthKm: finiteOrNull(coordinates?.[2]),
        status: feature.properties?.status ?? null,
        significance: finiteOrNull(feature.properties?.sig),
        alert: feature.properties?.alert ?? null,
        tsunami: finiteOrNull(feature.properties?.tsunami),
        felt: finiteOrNull(feature.properties?.felt),
        cdi: finiteOrNull(feature.properties?.cdi),
        mmi: finiteOrNull(feature.properties?.mmi),
        dedupKey,
      });
    }

    let existingKeys = new Set<string>();
    if (candidates.length > 0) {
      const { data, error } = await supabase
        .from("global_signals")
        .select("dedup_key")
        .in("dedup_key", candidates.map((candidate) => candidate.dedupKey));
      if (error) throw error;
      existingKeys = new Set(
        ((data ?? []) as ExistingSignal[])
          .map((row) => row.dedup_key)
          .filter((key): key is string => Boolean(key)),
      );
    }

    const ingestionTime = new Date().toISOString();
    const rows: Array<Record<string, unknown>> = [];
    for (const candidate of candidates) {
      if (existingKeys.has(candidate.dedupKey)) continue;
      const detectionLatencySeconds = Math.max(
        0,
        Math.round((Date.now() - new Date(candidate.occurredAt).getTime()) / 1000),
      );
      const evidenceHash = await sha256Hex(
        `${candidate.id}|${candidate.title}|${candidate.url}|${candidate.occurredAt}`,
      );

      rows.push({
        detection_latency_seconds: detectionLatencySeconds,
        last_pipeline_stage: "ingested",
        title: candidate.title.slice(0, 500),
        summary: `USGS reported a magnitude ${candidate.magnitude} earthquake near ${candidate.place}.`.slice(0, 2000),
        category: "climate_disaster",
        subcategory: "earthquake",
        status: "new",
        confidence_score: NEUTRAL_UNASSESSED_SCORE,
        impact_score: NEUTRAL_UNASSESSED_SCORE,
        urgency_score: NEUTRAL_UNASSESSED_SCORE,
        uncertainty_notes: "Analytical confidence, impact, and urgency were not assessed at ingestion. Values of 50 are neutral compatibility sentinels required by the legacy global_signals schema; use observed USGS fields and downstream enrichment for interpretation.",
        impact_reasoning: "No impact score was inferred from earthquake magnitude at ingestion.",
        source_count: 1,
        primary_source: "USGS",
        source_references: [{
          url: candidate.url,
          name: "USGS",
          published: candidate.occurredAt,
          provider_event_id: candidate.id,
          magnitude: candidate.magnitude,
          magnitude_type: candidate.magnitudeType,
          depth_km: candidate.depthKm,
          latitude: candidate.latitude,
          longitude: candidate.longitude,
          provider_status: candidate.status,
          provider_significance: candidate.significance,
          provider_alert: candidate.alert,
          tsunami_flag: candidate.tsunami,
          felt_reports: candidate.felt,
          cdi: candidate.cdi,
          mmi: candidate.mmi,
          provider_updated_at: candidate.updatedAt,
        }],
        first_detected_at: candidate.occurredAt,
        latest_update_at: ingestionTime,
        occurred_at: candidate.occurredAt,
        affected_regions: [],
        affected_countries: [],
        affected_sectors: ["disaster-response"],
        affected_stakeholders: [],
        evidence_hash: evidenceHash,
        ingestion_source: "usgs_firehose",
        dedup_key: candidate.dedupKey,
        source_trust_tier: "tier_1",
        multi_source_confirmed: false,
        related_signal_ids: [],
        enrichment_status: "pending_enrichment",
        enrichment_attempts: 0,
        ingested_at: ingestionTime,
        official_source: true,
        official_source_present: true,
        canonical_source_name: "USGS",
        source_rank_score: 0,
        merged_source_count: 1,
      });
    }

    let inserted = 0;
    let insertError: string | null = null;
    if (rows.length > 0) {
      const { data, error } = await supabase.from("global_signals").insert(rows).select("id");
      if (error) insertError = error.message;
      else inserted = data?.length ?? 0;
    }

    const durationMs = Date.now() - startedAt;
    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: insertError ? "error" : "success",
      message: `features=${features.length} normalized=${candidates.length} new=${inserted} duration_ms=${durationMs}${insertError ? ` error=${insertError}` : ""}`,
    });
    await recordFirehoseHealth(supabase, {
      name: FN,
      trustTier: "tier_1",
      success: !insertError,
      insertedCount: inserted,
      durationMs,
      errorMessage: insertError ?? undefined,
    });

    if (insertError) {
      await failProviderRun(supabase, run, new Error(insertError), {
        records_inserted: inserted,
        error_count: 1,
      });
      return json({ ok: false, error: insertError, features: features.length, inserted }, 500);
    }

    await finishProviderRun(supabase, run, {
      records_fetched: features.length,
      records_inserted: inserted,
      records_normalized: candidates.length,
      error_count: 0,
    });
    return json({ ok: true, features: features.length, normalized: candidates.length, inserted, duration_ms: durationMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startedAt;
    await supabase.from("automation_logs").insert({ job_name: FN, status: "error", message: message.slice(0, 500) });
    await recordFirehoseHealth(supabase, {
      name: FN,
      trustTier: "tier_1",
      success: false,
      errorMessage: message,
      durationMs,
    });
    await failProviderRun(supabase, run, error);
    return json({ ok: false, error: message }, 502);
  }
});
