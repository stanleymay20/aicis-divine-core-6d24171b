/**
 * graph-recovery-tick — Restores compounding across stalled graph layers.
 * All operations are idempotent.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type SupabaseClient = ReturnType<typeof createClient>;
type EventLinkResult = { scanned: number; created: number; inferred_iso3: number };
type SignalDrainResult = { offset: number; migrated: number; has_more: boolean };
type EntitySeedResult = { skipped: boolean; created: number };
type MetricLinkResult = { inserted?: number };
type CanonicalExpansionResult = { inserted?: number; updated?: number; remaining?: number | null; phase?: string | null };
type TickResult = {
  started_at: string;
  event_links?: EventLinkResult;
  metric_links?: MetricLinkResult | null;
  canonical_entities?: { promoted: number; updated: number; remaining: number | null; phase: string | null };
  signal_drain?: SignalDrainResult;
  entity_seed?: EntitySeedResult;
  duration_ms?: number;
};
type NormalizedEvent = {
  id: string;
  iso3: string | null;
  entity_id: string | null;
  location_entity_id: string | null;
  title: string | null;
  description: string | null;
  event_type: string | null;
};
type CanonicalCountry = { id: string; iso3: string | null };
type ExistingEventLink = { event_id: string; entity_id: string; link_role: string };
type EventLinkInsert = { event_id: string; entity_id: string; link_role: string; confidence: number };
type LegacySignal = Record<string, unknown> & {
  id: string;
  confidence_score?: number | null;
  confidence?: number | null;
  freshness_score?: number | null;
  last_verified_at?: string | null;
  category?: string | null;
  event_type?: string | null;
  title?: string | null;
  headline?: string | null;
  summary?: string | null;
  description?: string | null;
  affected_regions?: string[] | null;
  iso3?: string | null;
  country_iso3?: string | null;
  detected_at?: string | null;
  created_at?: string | null;
  impact_score?: number | null;
  severity?: number | null;
  urgency_score?: number | null;
  source_tier?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const startedAt = Date.now();
  const result: TickResult = { started_at: new Date().toISOString() };

  const { data: logRow } = await supabase
    .from("automation_logs")
    .insert({ job_name: "graph-recovery-tick", status: "running", message: "tick start" })
    .select("id")
    .single();

  try {
    result.event_links = await linkRecentEvents(supabase);

    const { data: rawLinkRes } = await supabase.rpc("batch_generate_links", { _batch_size: 5000 });
    const linkRecord = asRecord(rawLinkRes);
    const metricLinks: MetricLinkResult = { inserted: optionalNumber(linkRecord.inserted) };
    result.metric_links = metricLinks;

    const { data: rawExpandRes, error: expandErr } = await supabase.rpc("batch_expand_entities", { _batch_size: 1000 });
    if (expandErr) throw expandErr;
    const expandRecord = asRecord(rawExpandRes);
    const expandRes: CanonicalExpansionResult = {
      inserted: optionalNumber(expandRecord.inserted),
      updated: optionalNumber(expandRecord.updated),
      remaining: expandRecord.remaining === null ? null : optionalNumber(expandRecord.remaining),
      phase: expandRecord.phase === null ? null : optionalString(expandRecord.phase),
    };
    result.canonical_entities = {
      promoted: expandRes.inserted ?? 0,
      updated: expandRes.updated ?? 0,
      remaining: expandRes.remaining ?? null,
      phase: expandRes.phase ?? null,
    };

    result.signal_drain = await drainGlobalSignals(supabase);
    result.entity_seed = await seedNonGeoEntitiesIfMissing(supabase);

    const ms = Date.now() - startedAt;
    if (logRow?.id) {
      await supabase.from("automation_logs").update({
        status: "success",
        message: `tick ok in ${ms}ms — ev_links:${result.event_links?.created ?? 0} (inferred:${result.event_links?.inferred_iso3 ?? 0}), m_links:${metricLinks.inserted ?? 0}, regions:${result.canonical_entities?.promoted ?? 0}, signals:${result.signal_drain?.migrated ?? 0}`,
      }).eq("id", logRow.id);
    }
    result.duration_ms = ms;
    await supabase.rpc("register_pipeline_heartbeat", {
      _pipeline_name: "graph-recovery-tick",
      _success: true,
      _metadata: {
        event_links: result.event_links?.created ?? 0,
        metric_links: metricLinks.inserted ?? 0,
        regions: result.canonical_entities?.promoted ?? 0,
        signals: result.signal_drain?.migrated ?? 0,
        duration_ms: ms,
      },
    });
    return jsonRes({ ok: true, ...result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (logRow?.id) {
      await supabase.from("automation_logs").update({ status: "error", message: msg }).eq("id", logRow.id);
    }
    await supabase.rpc("register_pipeline_heartbeat", {
      _pipeline_name: "graph-recovery-tick",
      _success: false,
      _error: msg,
    });
    console.error("graph-recovery-tick error:", error);
    return jsonRes({ ok: false, error: msg, partial: result }, 500);
  }
});

async function linkRecentEvents(supabase: SupabaseClient): Promise<EventLinkResult> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: eventRows } = await supabase
    .from("normalized_events")
    .select("id, iso3, entity_id, location_entity_id, title, description, event_type")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);

  const events = (eventRows ?? []) as NormalizedEvent[];
  if (events.length === 0) return { scanned: 0, created: 0, inferred_iso3: 0 };

  let inferredCount = 0;
  for (const event of events) {
    if (!event.iso3) {
      const inferred = inferIso3FromText(`${event.title || ""} ${event.description || ""}`);
      if (inferred) {
        event.iso3 = inferred;
        inferredCount++;
      }
    }
  }

  const isoSet = new Set(events.map((event) => event.iso3).filter((iso): iso is string => typeof iso === "string"));
  const { data: countryRows } = await supabase
    .from("canonical_entities")
    .select("id, iso3")
    .in("entity_type", ["country", "territory"])
    .in("iso3", Array.from(isoSet));
  const countries = (countryRows ?? []) as CanonicalCountry[];
  const isoMap = new Map(countries.filter((country) => country.iso3).map((country) => [country.iso3 as string, country.id]));

  const eventIds = events.map((event) => event.id);
  const { data: existingRows } = await supabase
    .from("entity_event_links")
    .select("event_id, entity_id, link_role")
    .in("event_id", eventIds);
  const existing = (existingRows ?? []) as ExistingEventLink[];
  const existingKey = new Set(existing.map((row) => `${row.event_id}|${row.entity_id}|${row.link_role}`));

  const rows: EventLinkInsert[] = [];
  for (const event of events) {
    const countryId = event.iso3 ? isoMap.get(event.iso3) : null;
    if (countryId) {
      const key = `${event.id}|${countryId}|location`;
      if (!existingKey.has(key)) {
        rows.push({ event_id: event.id, entity_id: countryId, link_role: "location", confidence: 0.9 });
        existingKey.add(key);
      }
    }
    if (event.entity_id) {
      const key = `${event.id}|${event.entity_id}|subject`;
      if (!existingKey.has(key)) {
        rows.push({ event_id: event.id, entity_id: event.entity_id, link_role: "subject", confidence: 1.0 });
        existingKey.add(key);
      }
    }
    if (event.location_entity_id && event.location_entity_id !== event.entity_id) {
      const key = `${event.id}|${event.location_entity_id}|location`;
      if (!existingKey.has(key)) {
        rows.push({ event_id: event.id, entity_id: event.location_entity_id, link_role: "location", confidence: 0.95 });
        existingKey.add(key);
      }
    }
  }

  const sliceSeen = new Set<string>();
  const dedupedRows = rows.filter((row) => {
    const key = `${row.event_id}|${row.entity_id}|${row.link_role}`;
    if (sliceSeen.has(key)) return false;
    sliceSeen.add(key);
    return true;
  });

  let created = 0;
  for (let i = 0; i < dedupedRows.length; i += 500) {
    const slice = dedupedRows.slice(i, i + 500);
    const { data: insertedRows, error } = await supabase
      .from("entity_event_links")
      .upsert(slice, { onConflict: "event_id,entity_id,link_role", ignoreDuplicates: true })
      .select("id");
    if (error) {
      console.error("entity_event_links upsert error:", error.message);
      continue;
    }
    created += insertedRows?.length ?? 0;
  }
  return { scanned: events.length, created, inferred_iso3: inferredCount };
}

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
  for (const [pattern, iso] of COUNTRY_HINTS) if (pattern.test(text)) return iso;
  return null;
}

async function drainGlobalSignals(supabase: SupabaseClient): Promise<SignalDrainResult> {
  const { data: state } = await supabase.from("backfill_state").select("value_int").eq("key", "legacy_signals_offset").maybeSingle();
  const offset = state?.value_int ?? 0;
  const limit = 1000;

  const { data: signalRows, error: sigErr } = await supabase
    .from("global_signals")
    .select("*")
    .order("id")
    .range(offset, offset + limit - 1);

  if (sigErr) return { offset, migrated: 0, has_more: false };
  const signals = (signalRows ?? []) as LegacySignal[];
  if (signals.length === 0) return { offset, migrated: 0, has_more: false };

  const seen = new Set<string>();
  const rows = signals
    .map((signal) => {
      const confidence = signal.confidence_score ?? signal.confidence ?? null;
      const freshness = signal.freshness_score ?? null;
      const lastVerifiedAt = signal.last_verified_at ?? null;
      const firstAffectedRegion = Array.isArray(signal.affected_regions) ? signal.affected_regions[0] : null;
      return {
        provider_name: "aicis_signals",
        event_type: signal.category || signal.event_type || "signal",
        title: signal.title || signal.headline || "Signal",
        description: signal.summary || signal.description || "",
        iso3: firstAffectedRegion || signal.iso3 || signal.country_iso3 || null,
        started_at: signal.detected_at || signal.created_at || null,
        severity: signal.impact_score ?? signal.severity ?? null,
        confidence,
        provenance_source: "global_signals",
        dedup_key: `e:signals:${signal.id}`,
        freshness_score: freshness,
        last_verified_at: lastVerifiedAt,
        metadata: {
          category: signal.category,
          urgency: signal.urgency_score,
          source_tier: signal.source_tier,
          confidence_status: confidence == null ? "unknown" : "upstream_supplied",
          freshness_status: freshness == null ? "unknown" : "upstream_supplied",
          verification_status: lastVerifiedAt == null ? "not_verified" : "upstream_timestamp_supplied",
        },
      };
    })
    .filter((row) => {
      if (seen.has(row.dedup_key)) return false;
      seen.add(row.dedup_key);
      return true;
    });

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

async function seedNonGeoEntitiesIfMissing(supabase: SupabaseClient): Promise<EntitySeedResult> {
  const { count: orgCount } = await supabase
    .from("canonical_entities")
    .select("*", { count: "exact", head: true })
    .eq("entity_type", "company");

  if ((orgCount ?? 0) >= 50) return { skipped: true, created: 0 };

  // Executable service-role caller retained until source scheduler/caller contract is proven.
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/planetary-backfill`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ action: "seed_entities", entity_class: "all" }),
  });
  const out = asRecord(await resp.json().catch(() => ({})));
  return { skipped: false, created: optionalNumber(out.entities_created) ?? 0 };
}
