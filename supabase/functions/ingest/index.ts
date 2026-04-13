import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { structuredLog, handleCors, errorResponse, jsonResponse, resilientCall } from "../_shared/resilience.ts";

const FN = "ingest";
const ADAPTER_VERSION = "v2";

// ─── Provider URL Templates ─────────────────────────────────────────
const PROVIDER_URLS: Record<string, (params: Record<string, any>) => string> = {
  worldbank: (p) => {
    const countries = p.countries || "USA;CHN;GBR;DEU;JPN;FRA;IND;BRA";
    const indicator = p.indicator || "NY.GDP.MKTP.KD.ZG";
    const dateRange = p.date_range || "2018:2023";
    return `https://api.worldbank.org/v2/country/${countries}/indicator/${indicator}?format=json&date=${dateRange}&per_page=${p.per_page || 1000}`;
  },
  imf: (p) => {
    const dataset = p.dataset || "IFS";
    const freq = p.frequency || "A";
    const indicator = p.indicator || "PCPI_IX";
    const area = p.area || "US";
    return `https://dataservicesstg.imf.org/REST/SDMX_JSON.svc/CompactData/${dataset}/${freq}.${area}.${indicator}`;
  },
  openalex: (p) => {
    const entity = p.entity || "works";
    const filter = p.filter || "publication_year:2024";
    return `https://api.openalex.org/${entity}?filter=${filter}&per_page=${p.per_page || 50}`;
  },
};

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const body = await req.json();
    const { action, ...params } = body;
    switch (action) {
      case "run": return await runIngestion(supabase, params);
      case "replay": return await replayIngestion(supabase, params);
      case "metrics_by_entity": return await metricsByEntity(supabase, params);
      case "timeseries": return await timeseries(supabase, params);
      case "events_by_entity": return await eventsByEntity(supabase, params);
      case "run_health": return await runHealth(supabase, params);
      case "latest_by_country": return await latestByCountry(supabase, params);
      default:
        return errorResponse(new Error(`Unknown action: ${action}`), 400);
    }
  } catch (e) {
    structuredLog("error", FN, (e as Error).message);
    return errorResponse(e);
  }
});

// ─── SHA-256 ────────────────────────────────────────────────────────
async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ─── Dedup keys ─────────────────────────────────────────────────────
function metricDedupKey(provider: string, metric: string, iso3: string | undefined, period: string, entityId?: string): string {
  return `m:${provider}:${metric}:${iso3 || ""}:${period}:${entityId || ""}`;
}
function eventDedupKey(provider: string, eventType: string, title: string, startedAt: string): string {
  return `e:${provider}:${eventType}:${title.slice(0, 80)}:${startedAt}`;
}

// ─── Hardened Entity Resolution ─────────────────────────────────────
// Uses the same canonical resolution path as entity-resolve service
async function resolveEntity(supabase: any, name: string, entityType: string, iso3?: string): Promise<{ id: string | null; confidence: number }> {
  if (!name && !iso3) return { id: null, confidence: 0 };
  
  try {
    // 1. External ID exact match (strongest signal)
    if (iso3 && entityType === "country") {
      const { data: byIso } = await supabase
        .from("canonical_entities")
        .select("id")
        .eq("entity_type", "country")
        .eq("iso3", iso3.toUpperCase())
        .limit(1)
        .maybeSingle();
      if (byIso) return { id: byIso.id, confidence: 0.99 };
    }

    // 2. Normalized exact match
    if (name) {
      const normalizedName = name.toLowerCase().trim();
      const { data: exact } = await supabase
        .from("canonical_entities")
        .select("id")
        .eq("normalized_name", normalizedName)
        .limit(1)
        .maybeSingle();
      if (exact) return { id: exact.id, confidence: 0.95 };
    }

    // 3. Alias exact match
    if (name) {
      const { data: alias } = await supabase
        .from("entity_aliases")
        .select("entity_id")
        .ilike("alias", name)
        .limit(1)
        .maybeSingle();
      if (alias) return { id: alias.entity_id, confidence: 0.85 };
    }

    // 4. Fuzzy match via DB function (trigram similarity)
    if (name && name.length > 2) {
      const { data: fuzzy } = await supabase.rpc("similarity_search_entities", {
        search_name: name,
        search_type: entityType || null,
        min_similarity: 0.5,
        max_results: 1,
      });
      if (fuzzy && fuzzy.length > 0) {
        return { id: fuzzy[0].id, confidence: Math.min(fuzzy[0].similarity * 0.9, 0.8) };
      }
    }

    return { id: null, confidence: 0 };
  } catch {
    return { id: null, confidence: 0 };
  }
}

// ─── Server-Side Adapter Normalization ──────────────────────────────
interface NormalizedItem {
  domain: string;
  metric?: string;
  metric_name?: string;
  iso3?: string;
  period?: string;
  value?: number;
  unit?: string;
  confidence?: number;
  source?: string;
  raw?: any;
  // Event fields
  event_type?: string;
  title?: string;
  description?: string;
  entity_name?: string;
  entity_type?: string;
  location_name?: string;
  started_at?: string;
  ended_at?: string;
  severity?: number;
  metadata?: any;
  // Multi-entity fields
  partner_iso3?: string;
  partner_name?: string;
  institution_name?: string;
  commodity_name?: string;
}

function normalizeWorldBank(rawData: any, endpoint: string): NormalizedItem[] {
  if (!Array.isArray(rawData) || rawData.length < 2) return [];
  const items = rawData[1];
  if (!Array.isArray(items)) return [];
  
  return items
    .filter((r: any) => r.value !== null && r.value !== undefined)
    .map((r: any) => ({
      domain: inferDomain(endpoint),
      metric: r.indicator?.id?.toLowerCase().replace(/\./g, '_') || endpoint,
      iso3: r.countryiso3code,
      period: String(r.date),
      value: parseFloat(r.value),
      unit: r.unit || '',
      confidence: 0.95,
      source: 'worldbank',
      raw: { indicator: r.indicator?.id, country: r.country?.value },
    }));
}

function normalizeIMF(rawData: any, endpoint: string): NormalizedItem[] {
  const items: NormalizedItem[] = [];
  const ds = rawData?.CompactData?.DataSet?.Series;
  if (!ds) return items;
  const series = Array.isArray(ds) ? ds : [ds];

  for (const s of series) {
    const indicator = s['@INDICATOR'] || s['@SUBJECT'] || endpoint;
    const country = s['@REF_AREA'] || '';
    const obs = Array.isArray(s.Obs) ? s.Obs : s.Obs ? [s.Obs] : [];
    for (const o of obs) {
      const val = parseFloat(o['@OBS_VALUE']);
      if (isNaN(val)) continue;
      items.push({
        domain: 'finance',
        metric: indicator.toLowerCase().replace(/\s+/g, '_'),
        iso3: country,
        period: o['@TIME_PERIOD'] || '',
        value: val,
        unit: s['@UNIT_MULT'] ? `10^${s['@UNIT_MULT']}` : '',
        confidence: 0.95,
        source: 'imf',
      });
    }
  }
  return items;
}

function normalizeOpenAlex(rawData: any): NormalizedItem[] {
  const results = rawData?.results;
  if (!Array.isArray(results)) return [];
  const items: NormalizedItem[] = [];

  for (const r of results) {
    if (r.cited_by_count !== undefined) {
      const iso3 = r.authorships?.[0]?.institutions?.[0]?.country_code;
      items.push({
        domain: 'research',
        metric: 'citation_count',
        iso3,
        period: String(r.publication_year || ''),
        value: r.cited_by_count || 0,
        unit: 'citations',
        confidence: 0.95,
        source: 'openalex',
        institution_name: r.authorships?.[0]?.institutions?.[0]?.display_name,
        raw: { id: r.id, title: (r.display_name || '').slice(0, 200), doi: r.doi },
      });
    }
  }
  return items;
}

function normalizeGeneric(rawData: any): NormalizedItem[] {
  if (Array.isArray(rawData)) return rawData;
  if (rawData.metrics) return rawData.metrics;
  if (rawData.events) return rawData.events;
  return [];
}

function serverNormalize(providerName: string, rawData: any, endpoint: string): NormalizedItem[] {
  switch (providerName) {
    case "worldbank": return normalizeWorldBank(rawData, endpoint);
    case "imf": return normalizeIMF(rawData, endpoint);
    case "openalex": return normalizeOpenAlex(rawData);
    default: return normalizeGeneric(rawData);
  }
}

function inferDomain(indicator: string): string {
  const i = indicator.toUpperCase();
  if (i.includes("GDP") || i.includes("INF") || i.includes("CPI") || i.includes("DEBT") || i.includes("FDI")) return "finance";
  if (i.includes("POP") || i.includes("LIFE") || i.includes("MORT")) return "demographics";
  if (i.includes("UEM") || i.includes("LABOR") || i.includes("EMP")) return "labor";
  if (i.includes("EXP") || i.includes("IMP") || i.includes("TRADE")) return "trade";
  if (i.includes("CO2") || i.includes("ENERGY") || i.includes("ELEC")) return "environment";
  if (i.includes("INTERNET") || i.includes("TECH") || i.includes("MOBILE")) return "technology";
  if (i.includes("EDUC") || i.includes("LITERACY") || i.includes("SCHOOL")) return "education";
  if (i.includes("HEALTH") || i.includes("DISEASE")) return "health";
  if (i.includes("GINI") || i.includes("POV")) return "inequality";
  return "unknown";
}

// ═══════════════════════════════════════════════════════════════
// INGESTION ORCHESTRATOR v2
// ═══════════════════════════════════════════════════════════════
async function runIngestion(supabase: any, params: any) {
  const { provider_name, endpoint, fetch_url, fetch_params, data, run_mode = "live" } = params;
  if (!provider_name || !endpoint) {
    return errorResponse(new Error("provider_name and endpoint required"), 400);
  }

  const startTime = Date.now();
  const retrievedAt = new Date().toISOString();

  // 1. Create provider run
  const { data: run, error: runErr } = await supabase
    .from("provider_runs")
    .insert({
      provider_name, endpoint, params: fetch_params || {},
      status: "running", run_mode, adapter_version: ADAPTER_VERSION,
    })
    .select()
    .single();
  if (runErr) return errorResponse(runErr);

  const runId = run.id;
  const errors: Array<{ stage: string; error_message: string; error_detail?: any; source_record?: any }> = [];
  let recordsFetched = 0;
  let recordsNormalized = 0;
  let recordsInserted = 0;
  let recordsUpdated = 0;
  let recordsDeduplicated = 0;
  let entitiesResolved = 0;
  let linksCreated = 0;

  try {
    // 2. Get raw data — passed directly or fetched server-side
    let rawData = data;
    if (!rawData) {
      const url = fetch_url || buildProviderUrl(provider_name, endpoint, fetch_params || {});
      if (!url) {
        return errorResponse(new Error("No data provided and no fetch_url/provider_url available"), 400);
      }
      rawData = await resilientCall(`fetch:${provider_name}`, async () => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
        return r.json();
      }, { timeoutMs: 30000 });
    }

    if (!rawData) {
      return errorResponse(new Error("No data returned"), 400);
    }

    // 3. Store raw payload
    const rawJson = JSON.stringify(rawData);
    const payloadHash = await sha256(rawJson);
    const { data: rawPayload } = await supabase
      .from("provider_raw_payloads")
      .insert({ provider_run_id: runId, payload: rawData, payload_hash: payloadHash })
      .select("id")
      .single();
    const rawPayloadId = rawPayload?.id;

    // 4. Server-side normalization
    const normalizedItems: NormalizedItem[] = data
      ? normalizeGeneric(data)  // Client already normalized
      : serverNormalize(provider_name, rawData, endpoint);

    recordsFetched = normalizedItems.length;

    // 5. Process each item
    const metricRows: any[] = [];
    const eventRows: any[] = [];
    const entityLinkQueue: Array<{
      factType: "metric" | "event";
      dedupKey: string;
      links: Array<{ entityId: string; role: string; confidence: number }>;
    }> = [];

    for (const item of normalizedItems) {
      try {
        const isEvent = item.event_type || item.title;

        if (isEvent) {
          // ── Event processing ──
          const primary = await resolveEntity(supabase, item.entity_name || "", item.entity_type || "country", item.iso3);
          const location = await resolveEntity(supabase, item.location_name || item.iso3 || "", "country", item.iso3);
          
          const links: Array<{ entityId: string; role: string; confidence: number }> = [];
          if (primary.id) { links.push({ entityId: primary.id, role: "primary_entity", confidence: primary.confidence }); entitiesResolved++; }
          if (location.id && location.id !== primary.id) { links.push({ entityId: location.id, role: "location_entity", confidence: location.confidence }); entitiesResolved++; }

          const dk = eventDedupKey(provider_name, item.event_type || "unknown", item.title || "", item.started_at || "");

          eventRows.push({
            provider_name,
            event_type: item.event_type || "unknown",
            title: item.title || "Untitled",
            description: item.description,
            entity_id: primary.id,
            location_entity_id: location.id,
            iso3: item.iso3,
            started_at: item.started_at || new Date().toISOString(),
            ended_at: item.ended_at,
            severity: item.severity,
            confidence: item.confidence || 0.5,
            provenance_source: item.source || provider_name,
            raw_payload_id: rawPayloadId,
            provider_run_id: runId,
            dedup_key: dk,
            metadata: item.raw || item.metadata || {},
            freshness_score: 1.0,
            last_verified_at: retrievedAt,
          });

          if (links.length > 0) {
            entityLinkQueue.push({ factType: "event", dedupKey: dk, links });
          }
        } else {
          // ── Metric processing ──
          const primary = await resolveEntity(supabase, item.entity_name || item.iso3 || "", "country", item.iso3);
          const partnerRes = item.partner_iso3
            ? await resolveEntity(supabase, item.partner_name || "", "country", item.partner_iso3)
            : { id: null, confidence: 0 };
          const institutionRes = item.institution_name
            ? await resolveEntity(supabase, item.institution_name, "company")
            : { id: null, confidence: 0 };

          const links: Array<{ entityId: string; role: string; confidence: number }> = [];
          if (primary.id) { links.push({ entityId: primary.id, role: "primary_entity", confidence: primary.confidence }); entitiesResolved++; }
          if (partnerRes.id) { links.push({ entityId: partnerRes.id, role: "partner_entity", confidence: partnerRes.confidence }); entitiesResolved++; }
          if (institutionRes.id) { links.push({ entityId: institutionRes.id, role: "institution_entity", confidence: institutionRes.confidence }); entitiesResolved++; }

          const dk = metricDedupKey(provider_name, item.metric || item.metric_name || "", item.iso3, item.period || "", primary.id || "");

          metricRows.push({
            provider_name,
            domain: item.domain || "unknown",
            metric_name: item.metric || item.metric_name || "unknown",
            entity_id: primary.id,
            related_entity_id: partnerRes.id,
            location_entity_id: primary.id, // For country metrics, location = primary
            iso3: item.iso3,
            period: item.period || "",
            value: item.value,
            unit: item.unit,
            confidence: item.confidence || 0.5,
            provenance_source: item.source || provider_name,
            provenance_observed_at: retrievedAt,
            raw_payload_id: rawPayloadId,
            provider_run_id: runId,
            dedup_key: dk,
            freshness_score: 1.0,
            last_verified_at: retrievedAt,
          });

          if (links.length > 0) {
            entityLinkQueue.push({ factType: "metric", dedupKey: dk, links });
          }
        }
        recordsNormalized++;
      } catch (e) {
        errors.push({ stage: "normalize", error_message: (e as Error).message, source_record: item });
      }
    }

    // 6. Upsert metrics with insert/update tracking
    if (metricRows.length > 0) {
      for (let i = 0; i < metricRows.length; i += 100) {
        const batch = metricRows.slice(i, i + 100);
        // Check existing keys to distinguish insert vs update
        const batchKeys = batch.map((r: any) => r.dedup_key);
        const { data: existing } = await supabase
          .from("normalized_metrics")
          .select("dedup_key")
          .in("dedup_key", batchKeys);
        const existingKeys = new Set((existing || []).map((r: any) => r.dedup_key));

        const { data: upserted, error: upsertErr } = await supabase
          .from("normalized_metrics")
          .upsert(batch, { onConflict: "dedup_key", ignoreDuplicates: false })
          .select("id, dedup_key");

        if (upsertErr) {
          errors.push({ stage: "persist_metrics", error_message: upsertErr.message });
        } else {
          for (const row of upserted || []) {
            if (existingKeys.has(row.dedup_key)) recordsUpdated++;
            else recordsInserted++;
          }
        }
      }
    }

    // 7. Upsert events with insert/update tracking
    if (eventRows.length > 0) {
      for (let i = 0; i < eventRows.length; i += 100) {
        const batch = eventRows.slice(i, i + 100);
        const batchKeys = batch.map((r: any) => r.dedup_key);
        const { data: existing } = await supabase
          .from("normalized_events")
          .select("dedup_key")
          .in("dedup_key", batchKeys);
        const existingKeys = new Set((existing || []).map((r: any) => r.dedup_key));

        const { data: upserted, error: upsertErr } = await supabase
          .from("normalized_events")
          .upsert(batch, { onConflict: "dedup_key", ignoreDuplicates: false })
          .select("id, dedup_key");

        if (upsertErr) {
          errors.push({ stage: "persist_events", error_message: upsertErr.message });
        } else {
          for (const row of upserted || []) {
            if (existingKeys.has(row.dedup_key)) recordsUpdated++;
            else recordsInserted++;
          }
        }
      }
    }

    // 8. Populate entity_metric_links and entity_event_links (many-to-many)
    if (entityLinkQueue.length > 0) {
      const metricLinkRows: any[] = [];
      const eventLinkRows: any[] = [];

      // We need IDs from the upserted rows. Query by dedup_key.
      const metricDedupKeys = entityLinkQueue.filter(q => q.factType === "metric").map(q => q.dedupKey);
      const eventDedupKeys = entityLinkQueue.filter(q => q.factType === "event").map(q => q.dedupKey);

      const metricIdMap = new Map<string, string>();
      const eventIdMap = new Map<string, string>();

      if (metricDedupKeys.length > 0) {
        for (let i = 0; i < metricDedupKeys.length; i += 200) {
          const chunk = metricDedupKeys.slice(i, i + 200);
          const { data: rows } = await supabase.from("normalized_metrics").select("id, dedup_key").in("dedup_key", chunk);
          for (const r of rows || []) metricIdMap.set(r.dedup_key, r.id);
        }
      }
      if (eventDedupKeys.length > 0) {
        for (let i = 0; i < eventDedupKeys.length; i += 200) {
          const chunk = eventDedupKeys.slice(i, i + 200);
          const { data: rows } = await supabase.from("normalized_events").select("id, dedup_key").in("dedup_key", chunk);
          for (const r of rows || []) eventIdMap.set(r.dedup_key, r.id);
        }
      }

      for (const q of entityLinkQueue) {
        const factId = q.factType === "metric" ? metricIdMap.get(q.dedupKey) : eventIdMap.get(q.dedupKey);
        if (!factId) continue;

        for (const link of q.links) {
          if (q.factType === "metric") {
            metricLinkRows.push({ metric_id: factId, entity_id: link.entityId, link_role: link.role, confidence: link.confidence });
          } else {
            eventLinkRows.push({ event_id: factId, entity_id: link.entityId, link_role: link.role, confidence: link.confidence });
          }
        }
      }

      // Upsert links (skip duplicates)
      if (metricLinkRows.length > 0) {
        for (let i = 0; i < metricLinkRows.length; i += 200) {
          const { error } = await supabase.from("entity_metric_links").upsert(
            metricLinkRows.slice(i, i + 200),
            { onConflict: "metric_id,entity_id,link_role", ignoreDuplicates: true }
          );
          if (!error) linksCreated += Math.min(200, metricLinkRows.length - i);
        }
      }
      if (eventLinkRows.length > 0) {
        for (let i = 0; i < eventLinkRows.length; i += 200) {
          const { error } = await supabase.from("entity_event_links").upsert(
            eventLinkRows.slice(i, i + 200),
            { onConflict: "event_id,entity_id,link_role", ignoreDuplicates: true }
          );
          if (!error) linksCreated += Math.min(200, eventLinkRows.length - i);
        }
      }
    }

    // 9. Write provenance with full fields
    const provenanceRows = [
      ...metricRows.map(m => ({
        fact_type: "metric", fact_id: m.dedup_key,
        source_provider: provider_name, source_endpoint: endpoint,
        confidence: m.confidence, observed_at: m.provenance_observed_at,
        retrieved_at: retrievedAt,
        freshness_score: 1.0,
        quality_score: m.confidence,
        entity_match_confidence: entityLinkQueue.find(q => q.dedupKey === m.dedup_key)?.links[0]?.confidence || null,
        adapter_version: ADAPTER_VERSION,
        source_url: buildProviderUrl(provider_name, endpoint, {}) || null,
      })),
      ...eventRows.map(e => ({
        fact_type: "event", fact_id: e.dedup_key,
        source_provider: provider_name, source_endpoint: endpoint,
        confidence: e.confidence,
        retrieved_at: retrievedAt,
        freshness_score: 1.0,
        quality_score: e.confidence,
        entity_match_confidence: entityLinkQueue.find(q => q.dedupKey === e.dedup_key)?.links[0]?.confidence || null,
        adapter_version: ADAPTER_VERSION,
      })),
    ];
    if (provenanceRows.length > 0) {
      for (let i = 0; i < provenanceRows.length; i += 500) {
        await supabase.from("data_provenance").insert(provenanceRows.slice(i, i + 500));
      }
    }

    // 10. Log errors
    if (errors.length > 0) {
      await supabase.from("ingestion_errors").insert(
        errors.map(e => ({ provider_run_id: runId, ...e }))
      );
    }

    // 11. Finalize run with accurate analytics
    const durationMs = Date.now() - startTime;
    const totalWritten = recordsInserted + recordsUpdated;
    await supabase.from("provider_runs").update({
      status: errors.length > 0 ? "completed_with_errors" : "completed",
      completed_at: new Date().toISOString(),
      records_fetched: recordsFetched,
      records_normalized: recordsNormalized,
      records_written: totalWritten,
      records_inserted: recordsInserted,
      records_updated: recordsUpdated,
      records_deduplicated: recordsDeduplicated,
      entities_resolved: entitiesResolved,
      error_count: errors.length,
      error_summary: errors.length > 0 ? errors.slice(0, 3).map(e => e.error_message).join("; ") : null,
      duration_ms: durationMs,
    }).eq("id", runId);

    structuredLog("info", FN, `Ingestion complete: ${provider_name}/${endpoint}`, {
      recordsFetched, recordsNormalized, recordsInserted, recordsUpdated,
      entitiesResolved, linksCreated, errors: errors.length, durationMs,
    });

    return jsonResponse({
      ok: true,
      run_id: runId,
      provider: provider_name,
      endpoint,
      run_mode,
      records_fetched: recordsFetched,
      records_normalized: recordsNormalized,
      records_inserted: recordsInserted,
      records_updated: recordsUpdated,
      records_written: totalWritten,
      entities_resolved: entitiesResolved,
      links_created: linksCreated,
      error_count: errors.length,
      duration_ms: durationMs,
    });

  } catch (e) {
    const durationMs = Date.now() - startTime;
    await supabase.from("provider_runs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_summary: (e as Error).message,
      error_count: errors.length + 1,
      duration_ms: durationMs,
    }).eq("id", runId);

    structuredLog("error", FN, `Ingestion failed: ${(e as Error).message}`);
    return errorResponse(e);
  }
}

// ─── Build provider URL from templates ──────────────────────────────
function buildProviderUrl(providerName: string, endpoint: string, params: Record<string, any>): string | null {
  const builder = PROVIDER_URLS[providerName];
  if (!builder) return null;
  return builder({ ...params, indicator: endpoint, endpoint });
}

// ═══════════════════════════════════════════════════════════════
// REPLAY / BACKFILL
// ═══════════════════════════════════════════════════════════════
async function replayIngestion(supabase: any, params: any) {
  const { provider_run_id } = params;
  if (!provider_run_id) return errorResponse(new Error("provider_run_id required"), 400);

  // Get original run
  const { data: origRun, error: runErr } = await supabase
    .from("provider_runs")
    .select("provider_name, endpoint, params")
    .eq("id", provider_run_id)
    .single();
  if (runErr || !origRun) return errorResponse(new Error("Original run not found"), 404);

  // Get raw payload from that run
  const { data: rawPayload } = await supabase
    .from("provider_raw_payloads")
    .select("payload")
    .eq("provider_run_id", provider_run_id)
    .limit(1)
    .single();
  if (!rawPayload) return errorResponse(new Error("No raw payload found for run"), 404);

  // Re-run with the stored payload
  return runIngestion(supabase, {
    provider_name: origRun.provider_name,
    endpoint: origRun.endpoint,
    data: rawPayload.payload,
    run_mode: "replay",
    fetch_params: { ...origRun.params, replay_source_run_id: provider_run_id },
  });
}

// ═══════════════════════════════════════════════════════════════
// READ APIs
// ═══════════════════════════════════════════════════════════════
async function metricsByEntity(supabase: any, params: any) {
  const { entity_id, domain, metric_name, limit = 50 } = params;
  if (!entity_id) return errorResponse(new Error("entity_id required"), 400);

  let q = supabase
    .from("normalized_metrics")
    .select("*")
    .eq("entity_id", entity_id)
    .order("period", { ascending: false })
    .limit(limit);

  if (domain) q = q.eq("domain", domain);
  if (metric_name) q = q.eq("metric_name", metric_name);

  const { data, error } = await q;
  if (error) return errorResponse(error);
  return jsonResponse({ metrics: data, count: data?.length || 0 });
}

async function timeseries(supabase: any, params: any) {
  const { entity_id, iso3, metric_name, domain, start_period, end_period, limit = 500 } = params;
  if (!metric_name) return errorResponse(new Error("metric_name required"), 400);

  let q = supabase
    .from("normalized_metrics")
    .select("period, value, unit, confidence, provider_name, provenance_source, freshness_score")
    .eq("metric_name", metric_name)
    .order("period", { ascending: true })
    .limit(limit);

  if (entity_id) q = q.eq("entity_id", entity_id);
  if (iso3) q = q.eq("iso3", iso3);
  if (domain) q = q.eq("domain", domain);
  if (start_period) q = q.gte("period", start_period);
  if (end_period) q = q.lte("period", end_period);

  const { data, error } = await q;
  if (error) return errorResponse(error);
  return jsonResponse({ metric: metric_name, series: data, count: data?.length || 0 });
}

async function eventsByEntity(supabase: any, params: any) {
  const { entity_id, iso3, event_type, limit = 50 } = params;

  let q = supabase
    .from("normalized_events")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (entity_id) q = q.or(`entity_id.eq.${entity_id},location_entity_id.eq.${entity_id}`);
  if (iso3) q = q.eq("iso3", iso3);
  if (event_type) q = q.eq("event_type", event_type);

  const { data, error } = await q;
  if (error) return errorResponse(error);
  return jsonResponse({ events: data, count: data?.length || 0 });
}

async function runHealth(supabase: any, params: any) {
  const { provider_name, limit = 20 } = params;

  let q = supabase
    .from("provider_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (provider_name) q = q.eq("provider_name", provider_name);

  const { data, error } = await q;
  if (error) return errorResponse(error);

  const runs = data || [];
  const summary = {
    total_runs: runs.length,
    successful: runs.filter((r: any) => r.status === "completed").length,
    with_errors: runs.filter((r: any) => r.status === "completed_with_errors").length,
    failed: runs.filter((r: any) => r.status === "failed").length,
    running: runs.filter((r: any) => r.status === "running").length,
    avg_duration_ms: runs.length > 0 ? Math.round(runs.reduce((s: number, r: any) => s + (r.duration_ms || 0), 0) / runs.length) : 0,
    total_records_inserted: runs.reduce((s: number, r: any) => s + (r.records_inserted || 0), 0),
    total_records_updated: runs.reduce((s: number, r: any) => s + (r.records_updated || 0), 0),
    total_records_written: runs.reduce((s: number, r: any) => s + (r.records_written || 0), 0),
    total_entities_resolved: runs.reduce((s: number, r: any) => s + (r.entities_resolved || 0), 0),
  };

  return jsonResponse({ runs, summary });
}

async function latestByCountry(supabase: any, params: any) {
  const { iso3, domain, limit = 100 } = params;
  if (!iso3) return errorResponse(new Error("iso3 required"), 400);

  let q = supabase
    .from("normalized_metrics")
    .select("metric_name, value, unit, period, confidence, provider_name, domain, freshness_score")
    .eq("iso3", iso3.toUpperCase())
    .order("period", { ascending: false })
    .limit(limit);

  if (domain) q = q.eq("domain", domain);

  const { data, error } = await q;
  if (error) return errorResponse(error);

  const latest = new Map<string, any>();
  for (const row of data || []) {
    if (!latest.has(row.metric_name) || row.period > latest.get(row.metric_name).period) {
      latest.set(row.metric_name, row);
    }
  }

  return jsonResponse({ iso3, metrics: Array.from(latest.values()), count: latest.size });
}
