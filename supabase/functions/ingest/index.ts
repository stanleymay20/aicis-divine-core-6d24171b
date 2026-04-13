import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { structuredLog, handleCors, errorResponse, jsonResponse, resilientCall } from "../_shared/resilience.ts";

const FN = "ingest";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const { action, ...params } = await req.json();
    switch (action) {
      case "run": return await runIngestion(supabase, params);
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

// ─── SHA-256 hash helper ────────────────────────────────────────────
async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ─── Dedup key generator ────────────────────────────────────────────
function metricDedupKey(provider: string, metric: string, iso3: string | undefined, period: string, entityId?: string): string {
  return `m:${provider}:${metric}:${iso3 || ""}:${period}:${entityId || ""}`;
}

function eventDedupKey(provider: string, eventType: string, title: string, startedAt: string): string {
  return `e:${provider}:${eventType}:${title.slice(0, 80)}:${startedAt}`;
}

// ─── Entity resolution helper ───────────────────────────────────────
async function tryResolveEntity(supabase: any, name: string, entityType: string, iso3?: string): Promise<string | null> {
  if (!name) return null;
  try {
    // Try normalized exact match first (fast)
    const normalizedName = name.toLowerCase().trim();
    const { data: exact } = await supabase
      .from("canonical_entities")
      .select("id")
      .eq("entity_type", entityType)
      .eq("normalized_name", normalizedName)
      .limit(1)
      .maybeSingle();
    if (exact) return exact.id;

    // Try ISO3 match for countries
    if (iso3 && entityType === "country") {
      const { data: byIso } = await supabase
        .from("canonical_entities")
        .select("id")
        .eq("entity_type", "country")
        .eq("iso3", iso3.toUpperCase())
        .limit(1)
        .maybeSingle();
      if (byIso) return byIso.id;
    }

    // Try alias
    const { data: alias } = await supabase
      .from("entity_aliases")
      .select("entity_id")
      .ilike("alias", name)
      .limit(1)
      .maybeSingle();
    if (alias) return alias.entity_id;

    return null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// INGESTION ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════
async function runIngestion(supabase: any, params: any) {
  const { provider_name, endpoint, fetch_url, fetch_params, data } = params;
  if (!provider_name || !endpoint) {
    return errorResponse(new Error("provider_name and endpoint required"), 400);
  }

  const startTime = Date.now();

  // 1. Create provider run record
  const { data: run, error: runErr } = await supabase
    .from("provider_runs")
    .insert({ provider_name, endpoint, params: fetch_params || {}, status: "running" })
    .select()
    .single();
  if (runErr) return errorResponse(runErr);

  const runId = run.id;
  const errors: Array<{ stage: string; error_message: string; error_detail?: any; source_record?: any }> = [];
  let recordsFetched = 0;
  let recordsNormalized = 0;
  let recordsWritten = 0;
  let recordsDeduplicated = 0;
  let entitiesResolved = 0;

  try {
    // 2. Get raw data — either passed directly or fetched
    let rawData = data;
    if (!rawData && fetch_url) {
      const response = await resilientCall(`fetch:${provider_name}`, async () => {
        const r = await fetch(fetch_url);
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
        return r.json();
      }, { timeoutMs: 30000 });
      rawData = response;
    }

    if (!rawData) {
      return errorResponse(new Error("No data provided and no fetch_url specified"), 400);
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

    // 4. Normalize — expect data as array of normalized metrics
    // If raw data is already normalized (from client-side adapter), use directly
    const normalizedItems: any[] = Array.isArray(rawData) ? rawData : 
      rawData.metrics ? rawData.metrics : 
      rawData.events ? rawData.events : [];

    recordsFetched = normalizedItems.length;

    // 5. Process each normalized item
    const metricRows: any[] = [];
    const eventRows: any[] = [];

    for (const item of normalizedItems) {
      try {
        const isEvent = item.event_type || item.title;

        if (isEvent) {
          // Event processing
          const entityId = await tryResolveEntity(supabase, item.entity_name || "", item.entity_type || "country", item.iso3);
          const locationId = await tryResolveEntity(supabase, item.location_name || item.iso3 || "", "country", item.iso3);
          if (entityId || locationId) entitiesResolved++;

          const dk = eventDedupKey(provider_name, item.event_type || "unknown", item.title || "", item.started_at || "");

          eventRows.push({
            provider_name,
            event_type: item.event_type || "unknown",
            title: item.title || "Untitled",
            description: item.description,
            entity_id: entityId,
            location_entity_id: locationId,
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
          });
        } else {
          // Metric processing
          const entityId = await tryResolveEntity(supabase, item.entity_name || item.iso3 || "", "country", item.iso3);
          if (entityId) entitiesResolved++;

          const dk = metricDedupKey(provider_name, item.metric || item.metric_name || "", item.iso3, item.period || "", entityId || "");

          metricRows.push({
            provider_name,
            domain: item.domain || "unknown",
            metric_name: item.metric || item.metric_name || "unknown",
            entity_id: entityId,
            iso3: item.iso3,
            period: item.period || "",
            value: item.value,
            unit: item.unit,
            confidence: item.confidence || 0.5,
            provenance_source: item.source || provider_name,
            provenance_observed_at: new Date().toISOString(),
            raw_payload_id: rawPayloadId,
            provider_run_id: runId,
            dedup_key: dk,
          });
        }
        recordsNormalized++;
      } catch (e) {
        errors.push({
          stage: "normalize",
          error_message: (e as Error).message,
          source_record: item,
        });
      }
    }

    // 6. Upsert metrics (idempotent via dedup_key)
    if (metricRows.length > 0) {
      // Batch in chunks of 100
      for (let i = 0; i < metricRows.length; i += 100) {
        const batch = metricRows.slice(i, i + 100);
        const { data: upserted, error: upsertErr } = await supabase
          .from("normalized_metrics")
          .upsert(batch, { onConflict: "dedup_key", ignoreDuplicates: false })
          .select("id");

        if (upsertErr) {
          errors.push({ stage: "persist_metrics", error_message: upsertErr.message });
        } else {
          const written = upserted?.length || 0;
          recordsWritten += written;
          recordsDeduplicated += batch.length - written;
        }
      }
    }

    // 7. Upsert events (idempotent via dedup_key)
    if (eventRows.length > 0) {
      for (let i = 0; i < eventRows.length; i += 100) {
        const batch = eventRows.slice(i, i + 100);
        const { data: upserted, error: upsertErr } = await supabase
          .from("normalized_events")
          .upsert(batch, { onConflict: "dedup_key", ignoreDuplicates: false })
          .select("id");

        if (upsertErr) {
          errors.push({ stage: "persist_events", error_message: upsertErr.message });
        } else {
          const written = upserted?.length || 0;
          recordsWritten += written;
          recordsDeduplicated += batch.length - written;
        }
      }
    }

    // 8. Write provenance records
    const provenanceRows = [
      ...metricRows.map(m => ({
        fact_type: "metric", fact_id: m.dedup_key,
        source_provider: provider_name, source_endpoint: endpoint,
        confidence: m.confidence, observed_at: m.provenance_observed_at,
      })),
      ...eventRows.map(e => ({
        fact_type: "event", fact_id: e.dedup_key,
        source_provider: provider_name, source_endpoint: endpoint,
        confidence: e.confidence,
      })),
    ];
    if (provenanceRows.length > 0) {
      // Only store first 200 provenance records per run to avoid bloat
      await supabase.from("data_provenance").insert(provenanceRows.slice(0, 200));
    }

    // 9. Log errors
    if (errors.length > 0) {
      await supabase.from("ingestion_errors").insert(
        errors.map(e => ({ provider_run_id: runId, ...e }))
      );
    }

    // 10. Finalize run
    const durationMs = Date.now() - startTime;
    await supabase.from("provider_runs").update({
      status: errors.length > 0 ? "completed_with_errors" : "completed",
      completed_at: new Date().toISOString(),
      records_fetched: recordsFetched,
      records_normalized: recordsNormalized,
      records_written: recordsWritten,
      records_deduplicated: recordsDeduplicated,
      entities_resolved: entitiesResolved,
      error_count: errors.length,
      error_summary: errors.length > 0 ? errors.slice(0, 3).map(e => e.error_message).join("; ") : null,
      duration_ms: durationMs,
    }).eq("id", runId);

    structuredLog("info", FN, `Ingestion complete: ${provider_name}/${endpoint}`, {
      recordsFetched, recordsNormalized, recordsWritten, recordsDeduplicated, entitiesResolved, errors: errors.length, durationMs,
    });

    return jsonResponse({
      ok: true,
      run_id: runId,
      provider: provider_name,
      endpoint,
      records_fetched: recordsFetched,
      records_normalized: recordsNormalized,
      records_written: recordsWritten,
      records_deduplicated: recordsDeduplicated,
      entities_resolved: entitiesResolved,
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

// ═══════════════════════════════════════════════════════════════
// READ APIs
// ═══════════════════════════════════════════════════════════════

// Latest metrics for a given entity
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

// Time-series: entity + metric over time
async function timeseries(supabase: any, params: any) {
  const { entity_id, iso3, metric_name, domain, start_period, end_period, limit = 500 } = params;
  if (!metric_name) return errorResponse(new Error("metric_name required"), 400);

  let q = supabase
    .from("normalized_metrics")
    .select("period, value, unit, confidence, provider_name, provenance_source")
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

// Recent events by entity or location
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

// Provider run health
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
    total_records_written: runs.reduce((s: number, r: any) => s + (r.records_written || 0), 0),
  };

  return jsonResponse({ runs, summary });
}

// Latest metrics by country ISO3
async function latestByCountry(supabase: any, params: any) {
  const { iso3, domain, limit = 100 } = params;
  if (!iso3) return errorResponse(new Error("iso3 required"), 400);

  let q = supabase
    .from("normalized_metrics")
    .select("metric_name, value, unit, period, confidence, provider_name, domain")
    .eq("iso3", iso3.toUpperCase())
    .order("period", { ascending: false })
    .limit(limit);

  if (domain) q = q.eq("domain", domain);

  const { data, error } = await q;
  if (error) return errorResponse(error);

  // Deduplicate: keep latest period per metric
  const latest = new Map<string, any>();
  for (const row of data || []) {
    if (!latest.has(row.metric_name) || row.period > latest.get(row.metric_name).period) {
      latest.set(row.metric_name, row);
    }
  }

  return jsonResponse({ iso3, metrics: Array.from(latest.values()), count: latest.size });
}
