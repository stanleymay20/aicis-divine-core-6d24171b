// ACLED conflict event puller. Uses ACLED_EMAIL + ACLED_PASSWORD secrets.
// Writes event-grade observations to normalized_events.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type AcledEvent = Record<string, unknown> & {
  latitude?: unknown;
  longitude?: unknown;
  fatalities?: unknown;
  event_date?: unknown;
  event_type?: unknown;
  actor1?: unknown;
  actor2?: unknown;
  country?: unknown;
  notes?: unknown;
  source?: unknown;
  event_id_cnty?: unknown;
  data_id?: unknown;
  admin1?: unknown;
  admin2?: unknown;
  location?: unknown;
  sub_event_type?: unknown;
};

type CanonicalCountry = {
  iso3: string | null;
  canonical_name: string | null;
  display_name: string | null;
};

type NormalizedRow = {
  provider_name: string;
  event_type: string;
  title: string;
  description: string;
  iso3: string | null;
  country_iso3: string | null;
  category: string;
  source_name: string;
  source_url: string;
  severity: number;
  confidence: number;
  occurred_at: string;
  started_at: string;
  ended_at: string;
  dedup_key: string;
  metadata: Record<string, unknown>;
};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const asNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const auth = await requireAdminOrCron(req, cors);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const email = Deno.env.get("ACLED_EMAIL");
  const password = Deno.env.get("ACLED_PASSWORD");
  if (!email || !password) return json({ error: "ACLED credentials missing" }, 503);

  const start = Date.now();
  let inserted = 0;

  try {
    const since = new Date(Date.now() - 14 * 86400e3).toISOString().slice(0, 10);
    const url = `https://api.acleddata.com/acled/read?key=${encodeURIComponent(password)}&email=${encodeURIComponent(email)}&event_date=${since}&event_date_where=>=&limit=5000`;
    const res = await fetch(url, { signal: AbortSignal.timeout(40_000) });
    if (!res.ok) throw new Error(`ACLED HTTP ${res.status}`);

    const payload = await res.json() as { data?: unknown };
    const events = Array.isArray(payload.data) ? payload.data as AcledEvent[] : [];

    const rows: NormalizedRow[] = [];
    for (const event of events) {
      const eventId = asString(event.event_id_cnty) ?? asString(event.data_id);
      const eventDate = asString(event.event_date);
      const countryName = asString(event.country);
      if (!eventId || !eventDate || !countryName) continue;

      const occurredAt = new Date(eventDate).toISOString();
      const fatalities = Math.max(0, Math.round(asNumber(event.fatalities) ?? 0));
      const latitude = asNumber(event.latitude);
      const longitude = asNumber(event.longitude);
      const eventType = asString(event.event_type) ?? "conflict";
      const actor1 = asString(event.actor1) ?? "Unknown actor";
      const actor2 = asString(event.actor2) ?? "Unknown actor";
      const notes = asString(event.notes) ?? "";

      rows.push({
        provider_name: "acled",
        event_type: eventType,
        title: `${eventType}: ${actor1} vs ${actor2} in ${countryName}`,
        description: notes.slice(0, 1500),
        iso3: null,
        country_iso3: null,
        category: "conflict",
        source_name: "ACLED",
        source_url: asString(event.source) ?? "https://acleddata.com",
        severity: Math.min(1, fatalities / 50),
        confidence: 0.9,
        occurred_at: occurredAt,
        started_at: occurredAt,
        ended_at: occurredAt,
        dedup_key: `acled:${eventId}`,
        metadata: {
          fatalities,
          latitude,
          longitude,
          country_name: countryName,
          admin1: asString(event.admin1),
          admin2: asString(event.admin2),
          location: asString(event.location),
          actor1,
          actor2,
          sub_event_type: asString(event.sub_event_type),
        },
      });
    }

    const countryNames = [...new Set(rows.map((row) => String(row.metadata.country_name)).filter(Boolean))];
    const nameMap = new Map<string, string>();
    if (countryNames.length > 0) {
      const { data: entities, error: entityError } = await supabase
        .from("canonical_entities")
        .select("iso3,canonical_name,display_name")
        .eq("entity_type", "country")
        .in("canonical_name", countryNames);
      if (entityError) throw entityError;

      for (const entity of (entities ?? []) as CanonicalCountry[]) {
        if (!entity.iso3) continue;
        if (entity.canonical_name) nameMap.set(entity.canonical_name, entity.iso3);
        if (entity.display_name) nameMap.set(entity.display_name, entity.iso3);
      }
    }

    for (const row of rows) {
      const countryName = String(row.metadata.country_name);
      const iso3 = nameMap.get(countryName) ?? null;
      row.iso3 = iso3;
      row.country_iso3 = iso3;
    }

    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await supabase
        .from("normalized_events")
        .upsert(chunk, { onConflict: "dedup_key" });
      if (error) throw error;
      inserted += chunk.length;
    }

    await supabase.from("system_logs").insert({
      action: "pull_acled",
      result: `inserted=${inserted}`,
      log_level: "info",
      division: "ingestion",
    });

    return json({ ok: true, inserted, fetched: events.length, ms: Date.now() - start });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("pull-acled error:", message);
    return json({ error: message, inserted }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
