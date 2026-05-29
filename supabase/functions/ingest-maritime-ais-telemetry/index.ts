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

const CONNECTOR_KEY = "maritime_ais_telemetry";

type MaritimeObservation = {
  mmsi?: string | number | null;
  imo?: string | number | null;
  vessel_name?: string | null;
  callsign?: string | null;
  ship_type?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  speed_over_ground?: number | null;
  course_over_ground?: number | null;
  heading?: number | null;
  navigational_status?: string | null;
  destination?: string | null;
  eta?: string | null;
  timestamp?: string | number | null;
  region?: string | null;
  provider?: string | null;
  raw?: Record<string, unknown>;
};

type PortWatchZone = {
  key: string;
  name: string;
  region: string;
  iso3: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

const PORT_ZONES: PortWatchZone[] = [
  { key: "singapore", name: "Singapore Strait", region: "SGP", iso3: "SGP", minLat: 0.8, maxLat: 1.6, minLon: 103.4, maxLon: 104.3 },
  { key: "suez", name: "Suez Canal", region: "EGY", iso3: "EGY", minLat: 29.7, maxLat: 31.4, minLon: 32.2, maxLon: 33.0 },
  { key: "panama", name: "Panama Canal", region: "PAN", iso3: "PAN", minLat: 8.7, maxLat: 9.5, minLon: -80.2, maxLon: -79.3 },
  { key: "rotterdam", name: "Port of Rotterdam", region: "NLD", iso3: "NLD", minLat: 51.7, maxLat: 52.2, minLon: 3.6, maxLon: 4.7 },
  { key: "shanghai", name: "Shanghai Port", region: "CHN", iso3: "CHN", minLat: 30.6, maxLat: 31.8, minLon: 121.0, maxLon: 122.4 },
  { key: "la_long_beach", name: "Los Angeles / Long Beach", region: "USA", iso3: "USA", minLat: 33.4, maxLat: 34.2, minLon: -118.8, maxLon: -117.8 },
  { key: "tema", name: "Tema Port", region: "GHA", iso3: "GHA", minLat: 5.4, maxLat: 5.8, minLon: -0.2, maxLon: 0.2 },
  { key: "lagos", name: "Lagos Port", region: "NGA", iso3: "NGA", minLat: 6.2, maxLat: 6.7, minLon: 3.1, maxLon: 3.8 },
];

function normalizePostedPayload(payload: unknown): MaritimeObservation[] {
  if (Array.isArray(payload)) return payload.map(normalizeOne).filter(Boolean) as MaritimeObservation[];
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.observations)) return obj.observations.map(normalizeOne).filter(Boolean) as MaritimeObservation[];
    if (Array.isArray(obj.vessels)) return obj.vessels.map(normalizeOne).filter(Boolean) as MaritimeObservation[];
    if (Array.isArray(obj.messages)) return obj.messages.map(normalizeOne).filter(Boolean) as MaritimeObservation[];
    const one = normalizeOne(obj);
    return one ? [one] : [];
  }
  return [];
}

function normalizeOne(input: unknown): MaritimeObservation | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, any>;
  const msg = obj.Message ?? obj.message ?? obj;
  const position = msg.PositionReport ?? msg.positionReport ?? msg.Position ?? msg.position ?? msg;
  const metadata = msg.MetaData ?? msg.metadata ?? obj.MetaData ?? obj.metadata ?? {};

  const lat = num(position.Latitude ?? position.latitude ?? obj.latitude ?? obj.lat);
  const lon = num(position.Longitude ?? position.longitude ?? obj.longitude ?? obj.lon ?? obj.lng);
  const mmsi = obj.MMSI ?? obj.mmsi ?? position.UserID ?? position.mmsi ?? metadata.MMSI ?? metadata.mmsi;

  if (lat == null || lon == null || mmsi == null) return null;

  return {
    mmsi,
    imo: obj.IMO ?? obj.imo ?? metadata.IMO ?? metadata.imo,
    vessel_name: obj.ShipName ?? obj.vessel_name ?? obj.name ?? metadata.ShipName ?? metadata.ship_name,
    callsign: obj.CallSign ?? obj.callsign ?? metadata.CallSign ?? metadata.callsign,
    ship_type: obj.ShipType ?? obj.ship_type ?? metadata.ShipType ?? metadata.ship_type,
    latitude: lat,
    longitude: lon,
    speed_over_ground: num(position.Sog ?? position.SOG ?? position.speed_over_ground ?? obj.speed_over_ground ?? obj.sog),
    course_over_ground: num(position.Cog ?? position.COG ?? position.course_over_ground ?? obj.course_over_ground ?? obj.cog),
    heading: num(position.TrueHeading ?? position.heading ?? obj.heading),
    navigational_status: String(position.NavigationalStatus ?? position.nav_status ?? obj.navigational_status ?? obj.status ?? "unknown"),
    destination: obj.Destination ?? obj.destination ?? metadata.Destination ?? metadata.destination,
    eta: obj.ETA ?? obj.eta ?? metadata.ETA ?? metadata.eta,
    timestamp: obj.Timestamp ?? obj.timestamp ?? metadata.time_utc ?? metadata.timestamp ?? Date.now(),
    region: obj.region ?? metadata.region,
    provider: obj.provider ?? "posted-ais-provider",
    raw: obj,
  };
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function zoneFor(obs: MaritimeObservation): PortWatchZone | null {
  const lat = obs.latitude;
  const lon = obs.longitude;
  if (lat == null || lon == null) return null;
  return PORT_ZONES.find((z) => lat >= z.minLat && lat <= z.maxLat && lon >= z.minLon && lon <= z.maxLon) ?? null;
}

function anomalyScore(obs: MaritimeObservation, zone: PortWatchZone | null): number {
  const speed = obs.speed_over_ground ?? 0;
  const status = (obs.navigational_status ?? "").toLowerCase();
  const stoppedRisk = speed < 0.5 && zone ? 55 : 0;
  const restrictedRisk = status.includes("restricted") || status.includes("not under command") ? 75 : 0;
  const agroundRisk = status.includes("aground") ? 95 : 0;
  const chokepointBoost = zone && ["suez", "panama", "singapore"].includes(zone.key) ? 15 : 0;
  return Math.max(5, Math.min(100, Math.round(Math.max(stoppedRisk, restrictedRisk, agroundRisk) + chokepointBoost)));
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
    connector_name: "Maritime AIS Telemetry",
    connector_type: "ais",
    provider_name: "provider-flexible-ais",
    data_domain: "shipping-logistics",
    geographic_scope: "global-chokepoints-and-ports",
    auth_mode: "provider_webhook_or_posted_payload",
    polling_interval_seconds: 900,
    operational_status: args.success ? "active" : "degraded",
    last_success_at: args.success ? now : undefined,
    last_failure_at: args.success ? undefined : now,
    consecutive_failures: failures,
    last_error_message: args.success ? null : (args.error ?? "unknown").slice(0, 500),
    trust_tier: "tier_2",
    cost_tier: "provider-dependent",
    metadata: {
      supported_payloads: ["AISStream-style", "generic vessels[]", "generic observations[]", "single vessel object"],
      watched_zones: PORT_ZONES.map((z) => z.key),
      inserted: args.inserted ?? 0,
      duration_ms: args.durationMs ?? null,
      note: "Most real AIS feeds require a provider API key or webhook. This endpoint normalizes any approved provider payload into AICIS telemetry_observations.",
    },
    updated_at: now,
  }, { onConflict: "connector_key" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const started = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const __telemetryRun = await startProviderRun(supabase, {
    provider_name: "maritime_ais",
    endpoint: "ingest-maritime-ais-telemetry",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({
        status: "ready",
        connector_key: CONNECTOR_KEY,
        message: "POST AIS observations to ingest. Supports observations[], vessels[], messages[], AISStream-style messages, or a single vessel object.",
        watched_zones: PORT_ZONES,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const payload = await req.json();
    const observations = normalizePostedPayload(payload);
    const rows = [];

    for (const obs of observations) {
      const zone = zoneFor(obs);
      const observedAt = typeof obs.timestamp === "number"
        ? new Date(obs.timestamp > 10_000_000_000 ? obs.timestamp : obs.timestamp * 1000).toISOString()
        : obs.timestamp ? new Date(obs.timestamp).toISOString() : new Date().toISOString();
      const region = obs.region || zone?.iso3 || "GLOBAL_MARITIME";
      const anomaly = anomalyScore(obs, zone);
      const dedup = await sha256Hex(`${CONNECTOR_KEY}|${obs.mmsi}|${observedAt}|${obs.latitude}|${obs.longitude}`);

      rows.push({
        connector_key: CONNECTOR_KEY,
        observation_type: "maritime_vessel_position",
        observed_entity: obs.vessel_name || String(obs.mmsi),
        observed_region: region,
        observed_at: observedAt,
        observation_value: obs.speed_over_ground ?? 0,
        observation_unit: "knots",
        confidence_score: 82,
        anomaly_score: anomaly,
        raw_payload: {
          dedup_hash: dedup,
          mmsi: obs.mmsi,
          imo: obs.imo,
          vessel_name: obs.vessel_name,
          callsign: obs.callsign,
          ship_type: obs.ship_type,
          latitude: obs.latitude,
          longitude: obs.longitude,
          speed_over_ground: obs.speed_over_ground,
          course_over_ground: obs.course_over_ground,
          heading: obs.heading,
          navigational_status: obs.navigational_status,
          destination: obs.destination,
          eta: obs.eta,
          port_zone: zone,
          provider: obs.provider,
          raw: obs.raw,
        },
      });
    }

    const zoneCounts = new Map<string, number>();
    for (const obs of observations) {
      const zone = zoneFor(obs);
      if (zone) zoneCounts.set(zone.key, (zoneCounts.get(zone.key) ?? 0) + 1);
    }

    const now = new Date().toISOString();
    for (const [zoneKey, count] of zoneCounts.entries()) {
      const zone = PORT_ZONES.find((z) => z.key === zoneKey)!;
      const congestion = count >= 250 ? 90 : count >= 100 ? 70 : count >= 40 ? 50 : 25;
      const dedup = await sha256Hex(`${CONNECTOR_KEY}|zone|${zone.key}|${now.slice(0, 13)}`);
      rows.push({
        connector_key: CONNECTOR_KEY,
        observation_type: "maritime_port_zone_density",
        observed_entity: zone.name,
        observed_region: zone.iso3,
        observed_at: now,
        observation_value: count,
        observation_unit: "vessel_count",
        confidence_score: 78,
        anomaly_score: congestion,
        raw_payload: {
          dedup_hash: dedup,
          zone,
          vessel_count: count,
          provider: "derived-from-ais-payload",
        },
      });
    }

    let inserted = 0;
    if (rows.length > 0) {
      const since = new Date(Date.now() - 6 * 3600_000).toISOString();
      const { data: existing, error: existingErr } = await supabase
        .from("telemetry_observations")
        .select("raw_payload")
        .eq("connector_key", CONNECTOR_KEY)
        .gte("created_at", since);
      if (existingErr) throw existingErr;

      const existingHashes = new Set((existing ?? []).map((r: any) => r?.raw_payload?.dedup_hash).filter(Boolean));
      const fresh = rows.filter((r: any) => !existingHashes.has(r.raw_payload.dedup_hash));

      if (fresh.length > 0) {
        const { error: insertErr } = await supabase.from("telemetry_observations").insert(fresh);
        if (insertErr) throw insertErr;
        inserted = fresh.length;
      }
    }

    await recordConnectorHealth(supabase, { success: true, inserted, durationMs: Date.now() - started });

    await supabase.from("automation_logs").insert({
      job_name: "ingest-maritime-ais-telemetry",
      status: "success",
      message: `observations=${observations.length} rows=${rows.length} inserted=${inserted} duration_ms=${Date.now() - started}`,
    });

    try {
      await supabase.rpc("generate_telemetry_health_summary");
      await supabase.rpc("generate_strategic_digital_twins");
      await supabase.rpc("generate_operational_risk_assessments");
    } catch (e) {
      console.warn("post maritime telemetry refresh skipped", e);
    }
    await finishProviderRun(supabase, __telemetryRun);


    return new Response(JSON.stringify({
      status: "success",
      connector_key: CONNECTOR_KEY,
      observations: observations.length,
      derived_rows: rows.length,
      inserted,
      duration_ms: Date.now() - started,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordConnectorHealth(supabase, { success: false, durationMs: Date.now() - started, error: msg });
    await supabase.from("automation_logs").insert({
      job_name: "ingest-maritime-ais-telemetry",
      status: "error",
      message: msg.slice(0, 500),
    });
    await failProviderRun(supabase, __telemetryRun, e);

    return new Response(JSON.stringify({ status: "error", error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
