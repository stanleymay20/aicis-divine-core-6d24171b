import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  startProviderRun,
  finishProviderRun,
  failProviderRun,
} from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CONNECTOR_KEY = "usgs_earthquake_telemetry";
const USGS_FEED = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson";

type UsgsFeature = {
  id: string;
  type: string;
  properties: {
    mag?: number | null;
    place?: string | null;
    time?: number | null;
    updated?: number | null;
    tz?: number | null;
    url?: string | null;
    detail?: string | null;
    felt?: number | null;
    cdi?: number | null;
    mmi?: number | null;
    alert?: string | null;
    status?: string | null;
    tsunami?: number | null;
    sig?: number | null;
    net?: string | null;
    code?: string | null;
    ids?: string | null;
    sources?: string | null;
    types?: string | null;
    nst?: number | null;
    dmin?: number | null;
    rms?: number | null;
    gap?: number | null;
    magType?: string | null;
    type?: string | null;
    title?: string | null;
  };
  geometry?: {
    type: string;
    coordinates: [number, number, number?];
  } | null;
};

type UsgsFeed = {
  type: string;
  metadata?: Record<string, unknown>;
  features: UsgsFeature[];
};

function severityFromMagnitude(mag: number): number {
  if (mag >= 8) return 100;
  if (mag >= 7) return 92;
  if (mag >= 6) return 78;
  if (mag >= 5) return 62;
  if (mag >= 4) return 42;
  if (mag >= 3) return 25;
  return 10;
}

function anomalyFromFeature(feature: UsgsFeature): number {
  const mag = feature.properties.mag ?? 0;
  const sig = feature.properties.sig ?? 0;
  const tsunamiBoost = feature.properties.tsunami === 1 ? 18 : 0;
  const alertBoost = feature.properties.alert ? 8 : 0;
  const sigBoost = Math.min(20, sig / 50);
  return Math.max(0, Math.min(100, Math.round(severityFromMagnitude(mag) + tsunamiBoost + alertBoost + sigBoost)));
}

function regionFromPlace(place: string | null | undefined): string {
  if (!place) return "UNKNOWN";
  const parts = place.split(",");
  const tail = parts[parts.length - 1]?.trim();
  return tail || place.trim() || "UNKNOWN";
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function recordConnectorHealth(
  supabase: ReturnType<typeof createClient>,
  args: { success: boolean; inserted?: number; durationMs?: number; error?: string },
) {
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from("telemetry_connectors")
    .select("consecutive_failures")
    .eq("connector_key", CONNECTOR_KEY)
    .maybeSingle();

  const failures = args.success ? 0 : (existing?.consecutive_failures ?? 0) + 1;

  await supabase.from("telemetry_connectors").upsert({
    connector_key: CONNECTOR_KEY,
    connector_name: "USGS Earthquake Telemetry",
    connector_type: "earthquake",
    provider_name: "USGS",
    data_domain: "geophysical-disaster",
    geographic_scope: "global",
    auth_mode: "none",
    polling_interval_seconds: 300,
    operational_status: args.success ? "active" : "degraded",
    last_success_at: args.success ? now : undefined,
    last_failure_at: args.success ? undefined : now,
    consecutive_failures: failures,
    last_error_message: args.success ? null : (args.error ?? "unknown").slice(0, 500),
    trust_tier: "tier_1",
    cost_tier: "free-public",
    metadata: {
      source_url: USGS_FEED,
      inserted: args.inserted ?? 0,
      duration_ms: args.durationMs ?? null,
      feed_window: "1h",
    },
    updated_at: now,
  }, { onConflict: "connector_key" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const started = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const res = await fetch(USGS_FEED, {
      headers: {
        "Accept": "application/geo+json, application/json",
        "User-Agent": "AICIS-Divine-Core/1.0 telemetry ingestion",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`USGS feed failed: ${res.status} ${body.slice(0, 300)}`);
    }

    const feed = (await res.json()) as UsgsFeed;
    const features = Array.isArray(feed.features) ? feed.features : [];

    const rows = [];
    for (const f of features) {
      const props = f.properties ?? {};
      const mag = Number(props.mag ?? 0);
      const observedAt = props.time ? new Date(props.time).toISOString() : new Date().toISOString();
      const lon = f.geometry?.coordinates?.[0] ?? null;
      const lat = f.geometry?.coordinates?.[1] ?? null;
      const depthKm = f.geometry?.coordinates?.[2] ?? null;
      const observedRegion = regionFromPlace(props.place);
      const dedup = await sha256Hex(`${CONNECTOR_KEY}|${f.id}|${observedAt}|${mag}`);

      rows.push({
        connector_key: CONNECTOR_KEY,
        observation_type: "earthquake_magnitude",
        observed_entity: props.title ?? props.place ?? f.id,
        observed_region: observedRegion,
        observed_at: observedAt,
        observation_value: mag,
        observation_unit: "magnitude",
        confidence_score: props.status === "reviewed" ? 95 : 85,
        anomaly_score: anomalyFromFeature(f),
        raw_payload: {
          usgs_id: f.id,
          dedup_hash: dedup,
          place: props.place,
          title: props.title,
          url: props.url,
          detail: props.detail,
          magnitude: mag,
          magnitude_type: props.magType,
          significance: props.sig,
          alert: props.alert,
          tsunami: props.tsunami,
          felt: props.felt,
          cdi: props.cdi,
          mmi: props.mmi,
          status: props.status,
          net: props.net,
          code: props.code,
          latitude: lat,
          longitude: lon,
          depth_km: depthKm,
          provider: "USGS",
          feed: "all_hour.geojson",
        },
      });
    }

    let inserted = 0;
    if (rows.length > 0) {
      // telemetry_observations currently has no hard unique constraint. To keep this idempotent,
      // avoid inserting observations whose raw_payload.dedup_hash already exists.
      const hashes = rows.map((r) => r.raw_payload.dedup_hash);
      const { data: existing, error: existingErr } = await supabase
        .from("telemetry_observations")
        .select("raw_payload")
        .eq("connector_key", CONNECTOR_KEY)
        .gte("created_at", new Date(Date.now() - 6 * 3600_000).toISOString());
      if (existingErr) throw existingErr;

      const existingHashes = new Set(
        (existing ?? [])
          .map((r: any) => r?.raw_payload?.dedup_hash)
          .filter(Boolean),
      );
      const freshRows = rows.filter((r) => !existingHashes.has(r.raw_payload.dedup_hash));

      if (freshRows.length > 0) {
        const { error: insertErr } = await supabase.from("telemetry_observations").insert(freshRows);
        if (insertErr) throw insertErr;
        inserted = freshRows.length;
      }
    }

    await recordConnectorHealth(supabase, { success: true, inserted, durationMs: Date.now() - started });

    await supabase.from("automation_logs").insert({
      job_name: "ingest-usgs-earthquake-telemetry",
      status: "success",
      message: `features=${features.length} inserted=${inserted} duration_ms=${Date.now() - started}`,
    });

    // Opportunistically refresh high-level operational summaries. Failures here should not poison ingestion.
    try {
      await supabase.rpc("generate_telemetry_health_summary");
    } catch (e) {
      console.warn("telemetry health refresh skipped", e);
    }

    return new Response(JSON.stringify({
      status: "success",
      connector_key: CONNECTOR_KEY,
      features: features.length,
      inserted,
      duration_ms: Date.now() - started,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordConnectorHealth(supabase, { success: false, durationMs: Date.now() - started, error: msg });
    await supabase.from("automation_logs").insert({
      job_name: "ingest-usgs-earthquake-telemetry",
      status: "error",
      message: msg.slice(0, 500),
    });

    return new Response(JSON.stringify({ status: "error", error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
