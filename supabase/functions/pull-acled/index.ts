// ACLED conflict event puller. Uses ACLED_EMAIL + ACLED_PASSWORD secrets (auth=email/password).
// Writes to normalized_events with iso3, lat/lng, severity (fatalities), category=conflict.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const email = Deno.env.get("ACLED_EMAIL");
  const password = Deno.env.get("ACLED_PASSWORD");
  if (!email || !password) return json({ error: "ACLED creds missing" }, 500);

  const start = Date.now();
  let inserted = 0;

  try {
    // Pull last 14 days, max 5000 rows
    const since = new Date(Date.now() - 14 * 86400e3).toISOString().slice(0, 10);
    const url = `https://api.acleddata.com/acled/read?key=${encodeURIComponent(password)}&email=${encodeURIComponent(email)}&event_date=${since}&event_date_where=>=&limit=5000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ACLED ${res.status}`);
    const json0 = await res.json();
    const events = json0?.data ?? [];

    const rows = events.map((e: any) => {
      const lat = parseFloat(e.latitude), lng = parseFloat(e.longitude);
      const fat = parseInt(e.fatalities ?? "0", 10) || 0;
      const occurred = e.event_date ? new Date(e.event_date).toISOString() : new Date().toISOString();
      return {
        provider_name: "acled",
        event_type: e.event_type ?? "conflict",
        title: `${e.event_type ?? "Event"}: ${e.actor1 ?? "?"} vs ${e.actor2 ?? "?"} in ${e.country}`,
        description: (e.notes ?? "").slice(0, 1500),
        iso3: e.iso ? null : null, // ACLED uses iso numeric; resolve via country name lookup later
        country_iso3: null,
        category: "conflict",
        source_name: "ACLED",
        source_url: e.source ?? "https://acleddata.com",
        severity: Math.min(1, fat / 50),
        confidence: 0.9,
        occurred_at: occurred,
        started_at: occurred,
        ended_at: occurred,
        dedup_key: `acled:${e.event_id_cnty ?? e.data_id}`,
        metadata: {
          fatalities: fat,
          latitude: isFinite(lat) ? lat : null,
          longitude: isFinite(lng) ? lng : null,
          country_name: e.country,
          admin1: e.admin1,
          admin2: e.admin2,
          location: e.location,
          actor1: e.actor1,
          actor2: e.actor2,
          sub_event_type: e.sub_event_type,
        },
      };
    });

    // Resolve iso3 via canonical_entities country name
    const countryNames = [...new Set(rows.map((r: any) => r.metadata.country_name).filter(Boolean))];
    const { data: ents } = await supabase
      .from("canonical_entities")
      .select("iso3, canonical_name, display_name")
      .eq("entity_type", "country")
      .in("canonical_name", countryNames as string[]);
    const nameMap = new Map<string, string>();
    (ents ?? []).forEach((e: any) => { if (e.iso3) nameMap.set(e.canonical_name, e.iso3); });

    for (const r of rows) {
      const iso3 = nameMap.get(r.metadata.country_name) ?? null;
      r.iso3 = iso3;
      r.country_iso3 = iso3;
    }

    // Chunked upsert
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("normalized_events")
        .upsert(slice as any, { onConflict: "dedup_key" });
      if (error) console.error("upsert", error.message);
      else inserted += slice.length;
    }

    await supabase.from("system_logs").insert({
      action: "pull_acled",
      result: `inserted=${inserted}`,
      log_level: "info",
      division: "ingestion",
    });

    return json({ ok: true, inserted, fetched: events.length, ms: Date.now() - start });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message, inserted }, 500);
  }
});

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}
