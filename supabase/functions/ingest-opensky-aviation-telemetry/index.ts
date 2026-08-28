import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  startProviderRun,
  finishProviderRun,
  failProviderRun,
} from "../_shared/provider-telemetry.ts";
import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CONNECTOR_KEY = "opensky_aviation_telemetry";
const OPENSKY_STATES_URL = "https://opensky-network.org/api/states/all";

type WatchBox = {
  key: string;
  name: string;
  iso3: string;
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
};

type OpenSkyResponse = { time: number; states: unknown[][] | null };

type FlightState = {
  icao24: string;
  callsign: string | null;
  originCountry: string | null;
  timePosition: number | null;
  lastContact: number | null;
  longitude: number | null;
  latitude: number | null;
  baroAltitude: number | null;
  onGround: boolean;
  velocity: number | null;
  trueTrack: number | null;
  verticalRate: number | null;
  geoAltitude: number | null;
  squawk: string | null;
  spi: boolean;
  positionSource: number | null;
};

type TelemetryRow = {
  connector_key: string;
  observation_type: string;
  observed_entity: string;
  observed_region: string;
  observed_at: string | null;
  observation_value: number;
  observation_unit: string;
  confidence_score: number | null;
  anomaly_score: number;
  raw_payload: Record<string, unknown> & { dedup_hash?: string };
};

const WATCH_BOXES: WatchBox[] = [
  { key: "central_europe", name: "Central Europe", iso3: "EUR", lamin: 45, lomin: 5, lamax: 55, lomax: 20 },
  { key: "west_africa", name: "West Africa", iso3: "WAF", lamin: 3, lomin: -20, lamax: 18, lomax: 15 },
  { key: "east_africa", name: "East Africa", iso3: "EAF", lamin: -12, lomin: 25, lamax: 15, lomax: 52 },
  { key: "middle_east", name: "Middle East", iso3: "MEA", lamin: 12, lomin: 30, lamax: 38, lomax: 62 },
  { key: "south_asia", name: "South Asia", iso3: "SAS", lamin: 5, lomin: 60, lamax: 35, lomax: 95 },
  { key: "southeast_asia", name: "Southeast Asia", iso3: "SEA", lamin: -12, lomin: 95, lamax: 25, lomax: 130 },
  { key: "north_america_east", name: "North America East", iso3: "NAE", lamin: 25, lomin: -90, lamax: 50, lomax: -60 },
  { key: "south_america_east", name: "South America East", iso3: "SAE", lamin: -35, lomin: -65, lamax: 8, lomax: -30 },
];

function parseState(row: unknown[]): FlightState | null {
  if (!Array.isArray(row) || row.length < 17) return null;
  const icao24 = String(row[0] ?? "").trim();
  if (!icao24) return null;
  return {
    icao24,
    callsign: row[1] ? String(row[1]).trim() : null,
    originCountry: row[2] ? String(row[2]).trim() : null,
    timePosition: typeof row[3] === "number" ? row[3] : null,
    lastContact: typeof row[4] === "number" ? row[4] : null,
    longitude: typeof row[5] === "number" ? row[5] : null,
    latitude: typeof row[6] === "number" ? row[6] : null,
    baroAltitude: typeof row[7] === "number" ? row[7] : null,
    onGround: Boolean(row[8]),
    velocity: typeof row[9] === "number" ? row[9] : null,
    trueTrack: typeof row[10] === "number" ? row[10] : null,
    verticalRate: typeof row[11] === "number" ? row[11] : null,
    geoAltitude: typeof row[13] === "number" ? row[13] : null,
    squawk: row[14] ? String(row[14]).trim() : null,
    spi: Boolean(row[15]),
    positionSource: typeof row[16] === "number" ? row[16] : null,
  };
}

function emergencyRuleScore(state: FlightState): number {
  if (state.squawk === "7700" || state.squawk === "7500") return 100;
  if (state.squawk === "7600") return 85;
  if (state.spi) return 70;
  if (Math.abs(state.verticalRate ?? 0) > 30) return 55;
  return 5;
}

function congestionRuleScore(flightCount: number): number {
  if (flightCount >= 2500) return 90;
  if (flightCount >= 1500) return 75;
  if (flightCount >= 800) return 55;
  if (flightCount >= 300) return 35;
  return 15;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function dedupHashFromPayload(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const hash = (value as Record<string, unknown>).dedup_hash;
  return typeof hash === "string" ? hash : null;
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
    connector_name: "OpenSky Aviation Telemetry",
    connector_type: "adsb",
    provider_name: "OpenSky Network",
    data_domain: "aviation-logistics",
    geographic_scope: "selected-global-watch-boxes",
    auth_mode: "none-or-basic-auth",
    polling_interval_seconds: 900,
    operational_status: args.success ? "active" : "degraded",
    last_success_at: args.success ? now : undefined,
    last_failure_at: args.success ? undefined : now,
    consecutive_failures: failures,
    last_error_message: args.success ? null : (args.error ?? "unknown").slice(0, 500),
    trust_tier: "tier_2",
    cost_tier: "free-public-limited",
    metadata: {
      provider_url: "https://opensky-network.org/",
      watch_boxes: WATCH_BOXES.map((b) => b.key),
      inserted: args.inserted ?? 0,
      duration_ms: args.durationMs ?? null,
      note: "OpenSky public API may be rate limited; add OPENSKY_USERNAME/OPENSKY_PASSWORD for authenticated access if needed.",
    },
    updated_at: now,
  }, { onConflict: "connector_key" });
}

async function fetchBox(box: WatchBox): Promise<OpenSkyResponse> {
  const url = new URL(OPENSKY_STATES_URL);
  url.searchParams.set("lamin", String(box.lamin));
  url.searchParams.set("lomin", String(box.lomin));
  url.searchParams.set("lamax", String(box.lamax));
  url.searchParams.set("lomax", String(box.lomax));

  const username = Deno.env.get("OPENSKY_USERNAME");
  const password = Deno.env.get("OPENSKY_PASSWORD");
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "AICIS-Divine-Core/1.0 aviation telemetry",
  };
  if (username && password) headers.Authorization = "Basic " + btoa(`${username}:${password}`);

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenSky failed for ${box.key}: ${res.status} ${body.slice(0, 300)}`);
  }
  return await res.json() as OpenSkyResponse;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (auth.response) return auth.response;

  const started = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const telemetryRun = await startProviderRun(supabase, {
    provider_name: "opensky",
    endpoint: "ingest-opensky-aviation-telemetry",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  try {
    const url = new URL(req.url);
    const boxParam = url.searchParams.get("box");
    const boxes = boxParam ? WATCH_BOXES.filter((b) => b.key === boxParam) : WATCH_BOXES.slice(0, 4);

    const rows: TelemetryRow[] = [];
    let totalFlights = 0;

    for (const box of boxes) {
      const feed = await fetchBox(box);
      const observedAt = feed.time ? new Date(feed.time * 1000).toISOString() : null;
      const states = (feed.states ?? []).map(parseState).filter((state): state is FlightState => state !== null);
      totalFlights += states.length;

      const ruleFlaggedEmergencyStates = states.filter((s) => emergencyRuleScore(s) >= 70);
      const altitudeSamples = states
        .map((s) => s.geoAltitude ?? s.baroAltitude)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      const velocitySamples = states
        .map((s) => s.velocity)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      const avgAltitude = altitudeSamples.length ? altitudeSamples.reduce((a, v) => a + v, 0) / altitudeSamples.length : null;
      const avgVelocity = velocitySamples.length ? velocitySamples.reduce((a, v) => a + v, 0) / velocitySamples.length : null;
      const congestion = congestionRuleScore(states.length);

      rows.push({
        connector_key: CONNECTOR_KEY,
        observation_type: "aviation_flight_density",
        observed_entity: box.name,
        observed_region: box.iso3,
        observed_at: observedAt,
        observation_value: states.length,
        observation_unit: "aircraft_count",
        confidence_score: null,
        anomaly_score: congestion,
        raw_payload: {
          box_key: box.key,
          box_name: box.name,
          bounds: box,
          rule_flagged_emergency_count: ruleFlaggedEmergencyStates.length,
          avg_altitude_m: avgAltitude == null ? null : Math.round(avgAltitude),
          avg_velocity_ms: avgVelocity == null ? null : Math.round(avgVelocity),
          provider: "OpenSky Network",
          feed: "states/all",
          observation_provenance: "provider_observed_aircraft_count",
          provider_timestamp_status: observedAt ? "provider_supplied" : "unknown",
          analytical_confidence: null,
          anomaly_score_semantics: "deterministic_rule_heuristic_not_probability",
          congestion_rule: "aircraft_count_thresholds_v1",
        },
      });

      rows.push({
        connector_key: CONNECTOR_KEY,
        observation_type: "aviation_emergency_signals",
        observed_entity: box.name,
        observed_region: box.iso3,
        observed_at: observedAt,
        observation_value: ruleFlaggedEmergencyStates.length,
        observation_unit: "rule_flagged_aircraft_count",
        confidence_score: null,
        anomaly_score: ruleFlaggedEmergencyStates.length > 0 ? 95 : 5,
        raw_payload: {
          box_key: box.key,
          rule_flagged_aircraft: ruleFlaggedEmergencyStates.slice(0, 20).map((s) => ({
            icao24: s.icao24,
            callsign: s.callsign,
            squawk: s.squawk,
            spi: s.spi,
            latitude: s.latitude,
            longitude: s.longitude,
            origin_country: s.originCountry,
            emergency_rule_score: emergencyRuleScore(s),
          })),
          provider: "OpenSky Network",
          feed: "states/all",
          observation_provenance: "rule_derived_from_provider_state_vectors",
          provider_timestamp_status: observedAt ? "provider_supplied" : "unknown",
          analytical_confidence: null,
          verification_status: "not_verified_as_emergency",
          anomaly_score_semantics: "deterministic_rule_heuristic_not_probability",
          emergency_rule: "squawk_spi_vertical_rate_thresholds_v1",
        },
      });
    }

    for (const row of rows) {
      row.raw_payload.dedup_hash = await sha256Hex(
        `${row.connector_key}|${row.observation_type}|${row.observed_region}|${row.observed_at ?? "unknown-provider-time"}`,
      );
    }

    let inserted = 0;
    if (rows.length > 0) {
      const since = new Date(Date.now() - 3 * 3600_000).toISOString();
      const { data: existing, error: existingErr } = await supabase
        .from("telemetry_observations")
        .select("raw_payload")
        .eq("connector_key", CONNECTOR_KEY)
        .gte("created_at", since);
      if (existingErr) throw existingErr;

      const existingHashes = new Set(
        (existing ?? [])
          .map((row) => dedupHashFromPayload(row.raw_payload))
          .filter((hash): hash is string => hash !== null),
      );
      const fresh = rows.filter((row) => {
        const hash = row.raw_payload.dedup_hash;
        return typeof hash === "string" && !existingHashes.has(hash);
      });

      if (fresh.length > 0) {
        const { error: insertErr } = await supabase.from("telemetry_observations").insert(fresh);
        if (insertErr) throw insertErr;
        inserted = fresh.length;
      }
    }

    await recordConnectorHealth(supabase, { success: true, inserted, durationMs: Date.now() - started });
    await supabase.from("automation_logs").insert({
      job_name: "ingest-opensky-aviation-telemetry",
      status: "success",
      message: `boxes=${boxes.length} flights=${totalFlights} observations=${rows.length} inserted=${inserted} duration_ms=${Date.now() - started}`,
    });

    try {
      await supabase.rpc("generate_telemetry_health_summary");
      await supabase.rpc("generate_strategic_digital_twins");
    } catch (error) {
      console.warn("post aviation telemetry refresh skipped", error);
    }
    await finishProviderRun(supabase, telemetryRun);

    return new Response(JSON.stringify({
      status: "success",
      connector_key: CONNECTOR_KEY,
      boxes: boxes.length,
      flights: totalFlights,
      observations: rows.length,
      inserted,
      duration_ms: Date.now() - started,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await recordConnectorHealth(supabase, { success: false, durationMs: Date.now() - started, error: msg });
    await supabase.from("automation_logs").insert({
      job_name: "ingest-opensky-aviation-telemetry",
      status: "error",
      message: msg.slice(0, 500),
    });
    await failProviderRun(supabase, telemetryRun, error);

    return new Response(JSON.stringify({ status: "error", error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
