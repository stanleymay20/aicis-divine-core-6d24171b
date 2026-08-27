// Executes governed export runs. Unknown evidence remains null all the way to
// JSON/NDJSON/CSV; scheduled exports use the same epistemic contract as REST.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { gzip } from "https://deno.land/x/compress@v0.4.5/mod.ts";
import {
  corsHeaders as baseCorsHeaders,
  normalizeSignal,
  compressSignals,
  validateExport,
  applyProfileFilters,
  rowsToCsv,
  buildEnvelope,
  ExportProfile,
  EXPORT_SCHEMA_VERSION_DEFAULT,
} from "../_shared/export-schema.ts";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { invokeInternalFunction } from "../_shared/internal-invoke.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const SIGNAL_EXPORT_COLUMNS = [
  "id",
  "title",
  "summary",
  "category",
  "subcategory",
  "confidence_score",
  "confidence_score_semantics",
  "impact_score",
  "impact_score_semantics",
  "urgency_score",
  "urgency_score_semantics",
  "source_rank_score",
  "source_rank_score_semantics",
  "affected_countries",
  "affected_regions",
  "affected_sectors",
  "affected_entities",
  "primary_source",
  "canonical_source_name",
  "source_trust_tier",
  "ingestion_source",
  "source_count",
  "source_count_semantics",
  "source_identifier_count",
  "source_identifier_count_semantics",
  "merged_source_count",
  "merged_source_count_semantics",
  "source_independence_status",
  "independent_origin_count",
  "source_independence_semantics",
  "official_source_present",
  "official_source_present_semantics",
  "evidence_hash",
  "source_published_at",
  "source_published_at_semantics",
  "occurred_at",
  "occurred_at_semantics",
  "first_detected_at",
  "first_detected_at_semantics",
  "latest_update_at",
  "impact_reasoning",
  "source_urls",
  "source_references",
  "recommended_actions",
].join(",");

type RecommendationRow = {
  country_iso3: string | null;
  domain: string | null;
  action_summary: string | null;
  intervention_type: string | null;
  urgency_window: string | null;
};

type SignalRow = Record<string, unknown> & {
  id: string;
  affected_countries?: unknown;
  latest_update_at?: unknown;
};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

async function buildRecsMap(countries: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (countries.length === 0) return map;

  const { data, error } = await admin
    .from("risk_action_recommendations")
    .select("country_iso3,domain,action_summary,intervention_type,urgency_window")
    .in("country_iso3", countries)
    .limit(2000);
  if (error) throw error;

  for (const row of (data ?? []) as RecommendationRow[]) {
    const key = `${(row.country_iso3 ?? "").toUpperCase()}::${row.domain ?? ""}`;
    const text = `[${row.urgency_window ?? "n/a"}] ${row.intervention_type ?? ""}: ${row.action_summary ?? ""}`.trim();
    const existing = map.get(key) ?? [];
    if (existing.length < 5) map.set(key, [...existing, text]);
  }
  return map;
}

async function execRun(runId: string) {
  const start = Date.now();
  await admin.from("export_runs").update({
    status: "running",
    started_at: new Date().toISOString(),
  }).eq("id", runId);

  const { data: run, error: runError } = await admin
    .from("export_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (runError) throw runError;
  if (!run) throw new Error("run_not_found");

  const { data: profile, error: profileError } = await admin
    .from("export_profiles")
    .select("*")
    .eq("id", run.profile_id)
    .single();
  if (profileError) throw profileError;
  if (!profile) throw new Error("profile_not_found");
  const prof = profile as ExportProfile;
  const schemaVersion = prof.schema_version === "v2"
    ? prof.schema_version
    : EXPORT_SCHEMA_VERSION_DEFAULT;

  const { data: cursor, error: cursorError } = await admin
    .from("export_cursor_state")
    .select("*")
    .eq("profile_id", prof.id)
    .maybeSingle();
  if (cursorError) throw cursorError;

  let query = admin.from("global_signals").select(SIGNAL_EXPORT_COLUMNS);
  query = applyProfileFilters(query, prof);
  if (cursor?.last_signal_updated_at) {
    query = query.gte("latest_update_at", cursor.last_signal_updated_at);
  }
  query = query
    .order("latest_update_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(prof.max_records_per_run);

  const { data: rowData, error } = await query;
  if (error) throw new Error(`query: ${error.message}`);
  const raw = (rowData ?? []) as SignalRow[];

  const countries = [...new Set(
    raw.flatMap((row) => asStringArray(row.affected_countries)).map((country) => country.toUpperCase()),
  )];
  const recsMap = await buildRecsMap(countries);
  const signals = raw.map((row) => normalizeSignal(row, prof, recsMap));
  const { signals: postSignals, clusters } = compressSignals(signals, {
    prefer_clusters: prof.prefer_clusters,
  });
  const issues = validateExport(postSignals);
  const finalData = prof.prefer_clusters ? postSignals : signals;

  const envelope = buildEnvelope(finalData, {
    schema_version: schemaVersion,
    export_batch_id: run.export_batch_id,
    meta: {
      profile_id: prof.id,
      profile_name: prof.name,
      requested_schema_version: prof.schema_version,
      effective_schema_version: schemaVersion,
      cluster_semantics: "country_domain_day_aggregation_bucket_not_event_identity",
      clusters,
      validation_issues: issues.slice(0, 50),
      null_semantics: "missing_or_withheld_evidence_is_exported_as_null_not_zero",
    },
  });

  const format = run.format as "json" | "csv" | "ndjson";
  let payload: string;
  let mime: string;
  let extension: string;

  if (format === "csv") {
    const columns = [
      "signal_id",
      "title",
      "summary",
      "domain",
      "country",
      "region",
      "severity",
      "confidence_score",
      "relevance_score",
      "urgency_score",
      "impact_score",
      "score_semantics",
      "trend_direction",
      "created_at",
      "updated_at",
      "provenance",
    ];
    payload = rowsToCsv(columns, finalData);
    mime = "text/csv";
    extension = "csv";
  } else if (format === "ndjson") {
    payload = finalData.map((row) => JSON.stringify(row)).join("\n") + (finalData.length ? "\n" : "");
    mime = "application/x-ndjson";
    extension = "ndjson";
  } else {
    payload = JSON.stringify(envelope, null, 2);
    mime = "application/json";
    extension = "json";
  }

  let bytes = new TextEncoder().encode(payload);
  const rawSize = bytes.byteLength;
  let storedExtension = extension;
  let storedMime = mime;
  if (bytes.byteLength > 1_000_000) {
    bytes = gzip(bytes);
    storedExtension = `${extension}.gz`;
    storedMime = "application/gzip";
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `runs/${run.id}-${timestamp}.${storedExtension}`;
  const { error: uploadError } = await admin.storage
    .from("aicis-exports")
    .upload(path, bytes, { contentType: storedMime, upsert: true });
  if (uploadError) throw new Error(`upload: ${uploadError.message}`);

  const newestRow = raw[0];
  const newestUpdatedAt = typeof newestRow?.latest_update_at === "string"
    ? newestRow.latest_update_at
    : null;
  const duration = Date.now() - start;

  const { error: updateError } = await admin.from("export_runs").update({
    status: "success",
    records_selected: raw.length,
    records_exported: finalData.length,
    clusters_exported: clusters.length,
    recommendations_exported: [...recsMap.values()].reduce((total, items) => total + items.length, 0),
    duration_ms: duration,
    payload_size_bytes: bytes.byteLength,
    storage_path: path,
    finished_at: new Date().toISOString(),
    cursor_end: {
      last_updated_at: newestUpdatedAt,
      raw_size_bytes: rawSize,
      schema_version: schemaVersion,
      validation_issues: issues.length,
    },
  }).eq("id", run.id);
  if (updateError) throw updateError;

  if (newestRow && newestUpdatedAt) {
    const { error: cursorUpdateError } = await admin.from("export_cursor_state").upsert({
      profile_id: prof.id,
      last_signal_updated_at: newestUpdatedAt,
      last_signal_id: newestRow.id,
      updated_at: new Date().toISOString(),
    });
    if (cursorUpdateError) throw cursorUpdateError;
  }

  const { error: profileUpdateError } = await admin
    .from("export_profiles")
    .update({ last_run_at: new Date().toISOString() })
    .eq("id", prof.id);
  if (profileUpdateError) throw profileUpdateError;

  const webhookResult = await invokeInternalFunction(
    "exports-webhook-dispatcher",
    { run_id: run.id },
    45_000,
  );
  if (!webhookResult.ok) {
    console.warn(
      `exports-webhook-dispatcher failed for ${run.id}: ${webhookResult.error ?? webhookResult.status}`,
    );
  }

  return {
    ok: true,
    run_id: run.id,
    records: finalData.length,
    clusters: clusters.length,
    bytes: bytes.byteLength,
    schema_version: schemaVersion,
    validation_issues: issues.length,
    webhook_dispatch_ok: webhookResult.ok,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  let runId: string | null = null;
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    runId = typeof body.run_id === "string" && body.run_id ? body.run_id : null;
    if (!runId) {
      return new Response(JSON.stringify({ error: "run_id_required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await execRun(runId);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("exports-runner", message);
    if (runId) {
      try {
        await admin.from("export_runs").update({
          status: "error",
          error: message,
          finished_at: new Date().toISOString(),
        }).eq("id", runId);
      } catch {
        // Best-effort failure recording.
      }
    }
    return new Response(JSON.stringify({ error: "internal", detail: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});