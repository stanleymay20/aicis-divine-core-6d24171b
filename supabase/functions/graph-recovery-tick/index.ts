/**
 * graph-recovery-tick — Restores compounding across all stalled graph layers.
 *
 * Runs every 10 min. Each tick advances multiple offsets idempotently:
 *  1. entity_event_links: link recent normalized_events to canonical entities by iso3
 *  2. metric link expansion: continue link_gen_offset via batch_generate_links()
 *  3. canonical_entities: promote next batch of admin_regions
 *  4. legacy_signals: drain global_signals into normalized_events
 *  5. seed non-geo entities (orgs/commodities/sectors) once if missing
 *
 * All operations are idempotent (ON CONFLICT DO NOTHING / unique constraints).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const startedAt = Date.now();
  const result: Record<string, any> = { started_at: new Date().toISOString() };

  // Log start
  const { data: logRow } = await supabase
    .from("automation_logs")
    .insert({ job_name: "graph-recovery-tick", status: "running", message: "tick start" })
    .select("id")
    .single();

  try {
    // ─── Step 1: entity_event_links from recent events ───────────────────
    result.event_links = await linkRecentEvents(supabase);

    // ─── Step 2: continue metric link expansion ──────────────────────────
    const { data: linkRes } = await supabase.rpc("batch_generate_links", { _batch_size: 5000 });
    result.metric_links = linkRes;

    // ─── Step 3: promote next batch of admin_regions to canonical_entities
    result.canonical_entities = await promoteRegionsBatch(supabase);

    // ─── Step 4: drain global_signals into normalized_events ─────────────
    result.signal_drain = await drainGlobalSignals(supabase);

    // ─── Step 5: seed non-geo entities once (idempotent) ─────────────────
    result.entity_seed = await seedNonGeoEntitiesIfMissing(supabase);

    const ms = Date.now() - startedAt;
    if (logRow?.id) {
      await supabase.from("automation_logs").update({
        status: "success",
        message: `tick ok in ${ms}ms — ev_links:${result.event_links?.created || 0}, m_links:${(linkRes as any)?.inserted || 0}, regions:${result.canonical_entities?.promoted || 0}, signals:${result.signal_drain?.migrated || 0}`,
      }).eq("id", logRow.id);
    }
    result.duration_ms = ms;
    return jsonRes({ ok: true, ...result });
  } catch (e) {
    const msg = (e as Error).message;
    if (logRow?.id) {
      await supabase.from("automation_logs").update({ status: "error", message: msg }).eq("id", logRow.id);
    }
    console.error("graph-recovery-tick error:", e);
    return jsonRes({ ok: false, error: msg, partial: result }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Step 1: Link recent normalized_events → canonical_entities by iso3
// ═══════════════════════════════════════════════════════════════════════
async function linkRecentEvents(supabase: any): Promise<{ scanned: number; created: number; inferred_iso3: number }> {
  // Fetch recent events that lack any entity_event_links
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // last 30 days

  const { data: events } = await supabase
    .from("normalized_events")
    .select("id, iso3, entity_id, location_entity_id, title, description, event_type")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (!events || events.length === 0) return { scanned: 0, created: 0, inferred_iso3: 0 };

  // Infer iso3 from title/description for events lacking it
  let inferredCount = 0;
  for (const ev of events) {
    if (!ev.iso3) {
      const inferred = inferIso3FromText(`${ev.title || ""} ${ev.description || ""}`);
      if (inferred) {
        ev.iso3 = inferred;
        inferredCount++;
      }
    }
  }

  // Build country entity map
  const isoSet = new Set<string>(events.map((e: any) => e.iso3).filter(Boolean));
  const { data: countries } = await supabase
    .from("canonical_entities")
    .select("id, iso3")
    .in("entity_type", ["country", "territory"])
    .in("iso3", Array.from(isoSet));

  const isoMap = new Map((countries || []).map((c: any) => [c.iso3, c.id]));

  // Filter out already-linked events to reduce noise
  const eventIds = events.map((e: any) => e.id);
  const { data: existing } = await supabase
    .from("entity_event_links")
    .select("event_id, entity_id, link_role")
    .in("event_id", eventIds);
  const existingKey = new Set((existing || []).map((r: any) => `${r.event_id}|${r.entity_id}|${r.link_role}`));

  const rows: any[] = [];
  for (const ev of events) {
    // Country link by iso3
    const countryId = ev.iso3 ? isoMap.get(ev.iso3) : null;
    if (countryId) {
      const k = `${ev.id}|${countryId}|location`;
      if (!existingKey.has(k)) {
        rows.push({ event_id: ev.id, entity_id: countryId, link_role: "location", confidence: 0.9 });
        existingKey.add(k);
      }
    }
    // Subject entity link
    if (ev.entity_id) {
      const k = `${ev.id}|${ev.entity_id}|subject`;
      if (!existingKey.has(k)) {
        rows.push({ event_id: ev.id, entity_id: ev.entity_id, link_role: "subject", confidence: 1.0 });
        existingKey.add(k);
      }
    }
    // Location entity link
    if (ev.location_entity_id && ev.location_entity_id !== ev.entity_id) {
      const k = `${ev.id}|${ev.location_entity_id}|location`;
      if (!existingKey.has(k)) {
        rows.push({ event_id: ev.id, entity_id: ev.location_entity_id, link_role: "location", confidence: 0.95 });
        existingKey.add(k);
      }
    }
  }

  let created = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    const { data: ins, error } = await supabase
      .from("entity_event_links")
      .upsert(slice, { onConflict: "event_id,entity_id,link_role", ignoreDuplicates: true })
      .select("id");
    if (!error) created += ins?.length ?? 0;
  }
  return { scanned: events.length, created, inferred_iso3: inferredCount };
}

// Lightweight iso3 inference from event text (covers ~80% of news headlines)
const COUNTRY_HINTS: Array<[RegExp, string]> = [
  [/\b(united states|u\.s\.a?|america|usa)\b/i, "USA"],
  [/\b(united kingdom|u\.k\.|britain|england)\b/i, "GBR"],
  [/\b(china|chinese)\b/i, "CHN"], [/\b(india|indian)\b/i, "IND"],
  [/\b(russia|russian)\b/i, "RUS"], [/\b(germany|german)\b/i, "DEU"],
  [/\b(france|french)\b/i, "FRA"], [/\b(japan|japanese)\b/i, "JPN"],
  [/\b(brazil|brazilian)\b/i, "BRA"], [/\b(mexico|mexican)\b/i, "MEX"],
  [/\b(canada|canadian)\b/i, "CAN"], [/\b(australia|australian)\b/i, "AUS"],
  [/\b(italy|italian)\b/i, "ITA"], [/\b(spain|spanish)\b/i, "ESP"],
  [/\b(turkey|turkish)\b/i, "TUR"], [/\b(iran|iranian)\b/i, "IRN"],
  [/\b(israel|israeli)\b/i, "ISR"], [/\b(ukraine|ukrainian)\b/i, "UKR"],
  [/\b(saudi arabia|saudi)\b/i, "SAU"], [/\b(south korea|korean)\b/i, "KOR"],
  [/\b(north korea|dprk)\b/i, "PRK"], [/\b(pakistan|pakistani)\b/i, "PAK"],
  [/\b(indonesia|indonesian)\b/i, "IDN"], [/\b(egypt|egyptian)\b/i, "EGY"],
  [/\b(nigeria|nigerian)\b/i, "NGA"], [/\b(south africa)\b/i, "ZAF"],
  [/\b(argentina|argentine)\b/i, "ARG"], [/\b(thailand|thai)\b/i, "THA"],
  [/\b(vietnam|vietnamese)\b/i, "VNM"], [/\b(philippines|filipino)\b/i, "PHL"],
  [/\b(poland|polish)\b/i, "POL"], [/\b(netherlands|dutch)\b/i, "NLD"],
  [/\b(sweden|swedish)\b/i, "SWE"], [/\b(switzerland|swiss)\b/i, "CHE"],
  [/\b(belgium|belgian)\b/i, "BEL"], [/\b(greece|greek)\b/i, "GRC"],
  [/\b(portugal|portuguese)\b/i, "PRT"], [/\b(chile|chilean)\b/i, "CHL"],
  [/\b(colombia|colombian)\b/i, "COL"], [/\b(venezuela)\b/i, "VEN"],
  [/\b(syria|syrian)\b/i, "SYR"], [/\b(iraq|iraqi)\b/i, "IRQ"],
  [/\b(afghanistan|afghan)\b/i, "AFG"], [/\b(yemen|yemeni)\b/i, "YEM"],
  [/\b(sudan|sudanese)\b/i, "SDN"], [/\b(ethiopia|ethiopian)\b/i, "ETH"],
  [/\b(kenya|kenyan)\b/i, "KEN"], [/\bchicago|new york|los angeles|texas|california|florida\b/i, "USA"],
  [/\b(myanmar|burma)\b/i, "MMR"], [/\b(taiwan|taiwanese)\b/i, "TWN"],
];
function inferIso3FromText(text: string): string | null {
  if (!text) return null;
  for (const [re, iso] of COUNTRY_HINTS) if (re.test(text)) return iso;
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// Step 3: Promote next batch of admin_regions to canonical_entities.
// Targets unpromoted regions (skip those already linked via metadata.admin_region_id).
// ═══════════════════════════════════════════════════════════════════════
async function promoteRegionsBatch(supabase: any): Promise<{ scanned: number; promoted: number; admin_levels: number[] }> {
  // Get list of admin_region_ids already promoted (cap at 30k for memory)
  const { data: promotedIds } = await supabase
    .from("canonical_entities")
    .select("metadata")
    .eq("entity_type", "city")
    .not("metadata->>admin_region_id", "is", null)
    .limit(30000);
  const alreadyPromoted = new Set<string>((promotedIds || []).map((r: any) => r.metadata?.admin_region_id).filter(Boolean));

  // Pull a batch of regions, prioritising deep admin levels (L4 = villages)
  const { data: regions } = await supabase
    .from("admin_regions")
    .select("id, name, admin_level, lat, lon, country_iso3, population_est, urban_rural")
    .not("lat", "is", null)
    .not("lon", "is", null)
    .order("admin_level", { ascending: false })
    .order("id")
    .limit(2000);

  if (!regions || regions.length === 0) return { scanned: 0, promoted: 0, admin_levels: [] };

  const newRegions = regions.filter((r: any) => !alreadyPromoted.has(r.id)).slice(0, 500);
  if (newRegions.length === 0) return { scanned: regions.length, promoted: 0, admin_levels: [] };

  const adminLevels = Array.from(new Set(newRegions.map((r: any) => r.admin_level)));

  const rows = newRegions.map((r: any) => ({
    canonical_name: `${r.name}, ${r.country_iso3} L${r.admin_level}`,
    entity_type: "city" as const,
    display_name: r.name,
    iso3: r.country_iso3,
    lat: r.lat,
    lon: r.lon,
    trust_score: 0.8,
    source_count: 1,
    metadata: {
      admin_level: r.admin_level,
      country_iso3: r.country_iso3,
      population_est: r.population_est,
      urban_rural: r.urban_rural,
      admin_region_id: r.id,
    },
    last_resolved_at: new Date().toISOString(),
  }));

  let promoted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const slice = rows.slice(i, i + 200);
    const { data: ins } = await supabase
      .from("canonical_entities")
      .upsert(slice, { onConflict: "entity_type,normalized_name", ignoreDuplicates: true })
      .select("id");
    promoted += ins?.length ?? 0;
  }

  return { scanned: regions.length, promoted, admin_levels: adminLevels };
}

// ═══════════════════════════════════════════════════════════════════════
// Step 4: Drain global_signals into normalized_events (idempotent)
// ═══════════════════════════════════════════════════════════════════════
async function drainGlobalSignals(supabase: any): Promise<{ offset: number; migrated: number; has_more: boolean }> {
  const { data: state } = await supabase
    .from("backfill_state").select("value_int").eq("key", "legacy_signals_offset").maybeSingle();
  const offset = state?.value_int ?? 0;
  const limit = 1000;

  const { data: signals, error: sigErr } = await supabase
    .from("global_signals")
    .select("*")
    .order("id")
    .range(offset, offset + limit - 1);

  if (sigErr) {
    // Table may have a different shape; tolerate gracefully.
    return { offset, migrated: 0, has_more: false };
  }
  if (!signals || signals.length === 0) {
    return { offset, migrated: 0, has_more: false };
  }

  const rows = signals.map((s: any) => ({
    provider_name: "aicis_signals",
    event_type: s.category || s.event_type || "signal",
    title: s.title || s.headline || "Signal",
    description: s.summary || s.description || "",
    iso3: Array.isArray(s.affected_regions) ? s.affected_regions[0] : (s.iso3 || s.country_iso3 || null),
    started_at: s.detected_at || s.created_at,
    severity: s.impact_score ?? s.severity ?? null,
    confidence: s.confidence_score ?? s.confidence ?? 0.5,
    provenance_source: "global_signals",
    dedup_key: `e:signals:${s.id}`,
    freshness_score: 0.8,
    last_verified_at: s.created_at,
    metadata: { category: s.category, urgency: s.urgency_score, source_tier: s.source_tier },
  }));

  let migrated = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    const { error, count } = await supabase
      .from("normalized_events")
      .upsert(slice, { onConflict: "dedup_key", ignoreDuplicates: true, count: "exact" });
    if (!error) migrated += count ?? slice.length;
  }

  await supabase.from("backfill_state").upsert(
    { key: "legacy_signals_offset", value_int: offset + signals.length, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );

  return { offset, migrated, has_more: signals.length === limit };
}

// ═══════════════════════════════════════════════════════════════════════
// Step 5: Seed orgs/commodities/sectors once if missing
// ═══════════════════════════════════════════════════════════════════════
async function seedNonGeoEntitiesIfMissing(supabase: any): Promise<{ skipped: boolean; created: number }> {
  const { count: orgCount } = await supabase
    .from("canonical_entities")
    .select("*", { count: "exact", head: true })
    .eq("entity_type", "company");

  // Already seeded — skip
  if ((orgCount ?? 0) >= 50) return { skipped: true, created: 0 };

  // Delegate to planetary-backfill which already has the curated list
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/planetary-backfill`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ action: "seed_entities", entity_class: "all" }),
  });
  const out = await resp.json().catch(() => ({}));
  return { skipped: false, created: out?.entities_created ?? 0 };
}
