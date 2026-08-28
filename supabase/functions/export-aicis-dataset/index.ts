/**
 * export-aicis-dataset — governed raw evidence exporter.
 *
 * This path intentionally preserves raw table values. Numeric fields are never
 * silently reclassified as probabilities, confidence, severity, or corroboration.
 * Where canonical semantic columns exist they travel with the raw values. Every
 * exported row also carries an AICIS export-semantics marker.
 *
 * Security:
 *  - valid JWT required
 *  - admin/operator export role required
 *  - private storage + short-lived signed URLs
 *  - hard row cap
 *
 * Pagination uses deterministic ordering plus range offsets. It is not a
 * snapshot-isolated/keyset export, so consumers should use the checksum and
 * exported_at metadata when reproducibility matters.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";
import { gzip } from "https://deno.land/x/compress@v0.4.5/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN = "export-aicis-dataset";
const PAGE = 5000;
const HARD_CAP = 250_000;
const SIGNED_URL_TTL_S = 600;
const EPISTEMIC_CONTRACT = "raw_evidence_export_v2_semantics_preserved";
const UNUSABLE_SEMANTIC_TOKENS = [
  "legacy",
  "unknown",
  "unverified",
  "unspecified",
  "unlabeled",
  "withheld",
] as const;

type DatasetSpec = {
  table: string;
  columns: string[];
  datasetSemantics: string;
  iso3Col?: string;
  dateCol?: string;
  typeCol?: string;
  confidenceCol?: string;
  confidenceSemanticsCol?: string;
  severityCol?: string;
  severitySemanticsCol?: string;
  scoreScale?: "unit" | "pct100";
  localityCol?: string;
  warningKindCol?: string;
  idCol?: string;
};

const DATASETS: Record<string, DatasetSpec> = {
  local_events: {
    table: "aicis_local_events",
    columns: [
      "id", "event_type", "subtype", "iso3", "admin_level_1", "locality", "lat", "lon",
      "start_time", "end_time", "severity", "confidence", "source_count", "matched_keywords",
      "raw_signal_ids", "title", "description", "status", "bridged_to_normalized", "created_at",
    ],
    datasetSemantics: "legacy_local_event_rows_raw_fields_score_semantics_not_yet_governed",
    iso3Col: "iso3",
    dateCol: "start_time",
    typeCol: "event_type",
    confidenceCol: "confidence",
    severityCol: "severity",
    localityCol: "locality",
    scoreScale: "unit",
    idCol: "id",
  },
  early_warnings: {
    table: "aicis_early_warnings",
    columns: [
      "id", "warning_kind", "iso3", "locality", "admin_level_1", "event_type", "subtype",
      "severity", "confidence", "escalation_probability", "time_window_hours",
      "source_count", "event_count", "metric", "recommended_next_action", "status",
      "first_detected_at", "last_updated_at", "resolved_at",
    ],
    datasetSemantics: "legacy_early_warning_rows_raw_fields_probability_and_score_semantics_not_yet_governed",
    iso3Col: "iso3",
    dateCol: "first_detected_at",
    typeCol: "event_type",
    confidenceCol: "confidence",
    severityCol: "severity",
    localityCol: "locality",
    warningKindCol: "warning_kind",
    scoreScale: "unit",
    idCol: "id",
  },
  geo_audit: {
    table: "aicis_geo_resolution_audit",
    columns: [
      "id", "signal_id", "extracted_place", "source_name", "language", "country_hint",
      "attempted_match", "match_score", "reason_unresolved", "created_at",
    ],
    datasetSemantics: "georesolution_audit_raw_match_outputs_not_entity_identity_proof",
    iso3Col: "country_hint",
    dateCol: "created_at",
    idCol: "id",
  },
  country_corrections: {
    table: "lril_country_corrections",
    columns: [
      "id", "signal_id", "original_country_hint", "detected_iso3",
      "raw_text_excerpt", "source_name", "confidence_penalty", "created_at",
    ],
    datasetSemantics: "country_correction_audit_raw_fields",
    iso3Col: "detected_iso3",
    dateCol: "created_at",
    idCol: "id",
  },
  normalized_events: {
    table: "normalized_events",
    columns: [
      "id", "provider_name", "event_type", "title", "description", "iso3", "country_iso3",
      "started_at", "started_at_semantics", "reported_started_at", "ended_at", "occurred_at",
      "severity", "confidence", "confidence_semantics", "reported_confidence", "provenance_source",
      "source_name", "source_url", "category", "freshness_score", "freshness_semantics",
      "reported_freshness_score", "created_at",
    ],
    datasetSemantics: "normalized_event_raw_evidence_confidence_freshness_and_start_time_require_companion_semantics",
    iso3Col: "iso3",
    dateCol: "occurred_at",
    typeCol: "event_type",
    confidenceCol: "confidence",
    confidenceSemanticsCol: "confidence_semantics",
    severityCol: "severity",
    scoreScale: "unit",
    idCol: "id",
  },
  training_dataset: {
    table: "training_dataset_aicis",
    columns: ["*"],
    datasetSemantics: "raw_training_feature_rows_interpret_through_dataset_manifest_and_feature_lineage",
    iso3Col: "iso3",
    dateCol: "feature_window_end",
    idCol: "id",
  },
  global_signals: {
    table: "global_signals",
    columns: [
      "id", "title", "summary", "category", "status",
      "confidence_score", "confidence_score_semantics", "reported_confidence_score",
      "impact_score", "impact_score_semantics", "reported_impact_score",
      "urgency_score", "urgency_score_semantics", "reported_urgency_score",
      "source_count", "source_count_semantics", "reported_source_count",
      "source_identifier_count", "source_identifier_count_semantics",
      "independent_origin_count", "source_independence_status", "source_independence_semantics",
      "primary_source", "canonical_source_name", "source_trust_tier", "ingestion_source", "dedup_key",
      "affected_countries", "affected_regions", "affected_sectors",
      "first_detected_at", "first_detected_at_semantics", "reported_first_detected_at",
      "source_published_at", "source_published_at_semantics",
      "occurred_at", "occurred_at_semantics", "reported_occurred_at",
      "ingested_at", "latest_update_at", "evidence_hash", "official_source_present",
      "merged_source_count", "merged_source_count_semantics", "reported_merged_source_count",
      "source_rank_score", "source_rank_score_semantics", "source_grouping_semantics",
    ],
    datasetSemantics: "global_signal_raw_rows_scores_require_explicit_semantics_source_counts_do_not_imply_independence",
    dateCol: "first_detected_at",
    typeCol: "category",
    confidenceCol: "confidence_score",
    confidenceSemanticsCol: "confidence_score_semantics",
    severityCol: "impact_score",
    severitySemanticsCol: "impact_score_semantics",
    scoreScale: "pct100",
    idCol: "id",
  },
};

const FilterSchema = z.object({
  date_from: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "invalid date_from").optional(),
  date_to: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "invalid date_to").optional(),
  iso3: z.string().regex(/^[A-Z]{3}$/i).optional(),
  event_type: z.string().max(64).optional(),
  warning_kind: z.string().max(64).optional(),
  min_confidence: z.number().min(0).max(1).optional(),
  min_severity: z.number().min(0).max(1).optional(),
  locality_only: z.boolean().optional(),
  search: z.string().max(256).optional(),
}).strict();

const BodySchema = z.object({
  action: z.enum(["export", "preview"]).optional().default("export"),
  dataset_name: z.string().refine((key) => key in DATASETS, "unknown dataset"),
  format: z.enum(["csv", "json", "ndjson"]).optional().default("csv"),
  filters: FilterSchema.optional().default({}),
  limit: z.number().int().min(1).max(HARD_CAP).optional().default(50_000),
  gzip: z.boolean().optional().default(true),
});

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const exportValue = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(exportValue) ? `"${exportValue.replace(/"/g, '""')}"` : exportValue;
}

function rowsToCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const header = columns.map(csvEscape).join(",");
  const body = rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")).join("\n");
  return body ? `${header}\n${body}\n` : `${header}\n`;
}

async function sha256Hex(buffer: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function queryCall<T>(query: T, method: string, ...args: unknown[]): T {
  const callable = query as unknown as Record<string, (...methodArgs: unknown[]) => T>;
  const fn = callable[method];
  if (typeof fn !== "function") throw new TypeError(`Query builder does not support ${method}`);
  return fn(...args);
}

function requireUsableSemantics<T>(query: T, column: string): T {
  query = queryCall(query, "not", column, "is", null);
  for (const token of UNUSABLE_SEMANTIC_TOKENS) query = queryCall(query, "not", column, "ilike", `%${token}%`);
  return query;
}

function validateSemanticFilters(spec: DatasetSpec, filters: z.infer<typeof FilterSchema>): string | null {
  if (typeof filters.min_confidence === "number") {
    if (!spec.confidenceCol) return "dataset_does_not_expose_a_confidence_field";
    if (!spec.confidenceSemanticsCol) return "min_confidence_requires_governed_confidence_semantics_for_this_dataset";
  }
  if (typeof filters.min_severity === "number") {
    if (!spec.severityCol) return "dataset_does_not_expose_a_severity_field";
    if (!spec.severitySemanticsCol) return "min_severity_requires_governed_severity_semantics_for_this_dataset";
  }
  return null;
}

function applyFilters<T>(query: T, spec: DatasetSpec, filters: z.infer<typeof FilterSchema>): T {
  if (filters.date_from && spec.dateCol) query = queryCall(query, "gte", spec.dateCol, filters.date_from);
  if (filters.date_to && spec.dateCol) query = queryCall(query, "lte", spec.dateCol, filters.date_to);
  if (filters.iso3 && spec.iso3Col) query = queryCall(query, "eq", spec.iso3Col, filters.iso3.toUpperCase());
  if (filters.event_type && spec.typeCol) query = queryCall(query, "eq", spec.typeCol, filters.event_type);
  if (filters.warning_kind && spec.warningKindCol) query = queryCall(query, "eq", spec.warningKindCol, filters.warning_kind);

  if (typeof filters.min_confidence === "number" && spec.confidenceCol && spec.confidenceSemanticsCol) {
    const value = spec.scoreScale === "pct100"
      ? Math.round(filters.min_confidence * 100)
      : filters.min_confidence;
    query = queryCall(query, "gte", spec.confidenceCol, value);
    query = requireUsableSemantics(query, spec.confidenceSemanticsCol);
  }

  if (typeof filters.min_severity === "number" && spec.severityCol && spec.severitySemanticsCol) {
    const value = spec.scoreScale === "pct100"
      ? Math.round(filters.min_severity * 100)
      : filters.min_severity;
    query = queryCall(query, "gte", spec.severityCol, value);
    query = requireUsableSemantics(query, spec.severitySemanticsCol);
  }

  if (filters.locality_only && spec.localityCol) query = query.not(spec.localityCol, "is", null);
  if (filters.search && filters.search.trim().length >= 2) {
    const term = filters.search.replace(/[%_,()]/g, " ").trim();
    const searchableColumns = ["title", "description", "summary", "raw_text_excerpt", "extracted_place"];
    const orParts: string[] = [];
    for (const column of searchableColumns) {
      if (spec.columns[0] === "*" || spec.columns.includes(column)) orParts.push(`${column}.ilike.%${term}%`);
    }
    if (orParts.length) query = query.or(orParts.join(","));
  }
  return query;
}

function annotateRows(rows: Record<string, unknown>[], datasetName: string, spec: DatasetSpec) {
  return rows.map((row) => ({
    ...row,
    _aicis_export_semantics: {
      epistemic_contract: EPISTEMIC_CONTRACT,
      dataset: datasetName,
      dataset_semantics: spec.datasetSemantics,
      raw_fields_preserved: true,
      note: "A numeric raw field is not self-interpreting; inspect companion semantics/reporting fields where present.",
    },
  }));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const start = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: "missing auth" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ ok: false, error: "invalid auth" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = userData.user.id;
  const userEmail = userData.user.email ?? null;

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: hasRole, error: roleError } = await admin.rpc("has_export_role", { _user_id: userId });
  if (roleError) {
    return new Response(JSON.stringify({ ok: false, error: "export_role_verification_unavailable" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!hasRole) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden — admin/operator role required" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: "invalid body",
      detail: error instanceof Error ? error.message : String(error),
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const spec = DATASETS[body.dataset_name];
  const filters = body.filters || {};
  const semanticFilterError = validateSemanticFilters(spec, filters);
  if (semanticFilterError) {
    return new Response(JSON.stringify({
      ok: false,
      error: semanticFilterError,
      epistemic_contract: EPISTEMIC_CONTRACT,
      dataset_semantics: spec.datasetSemantics,
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (body.action === "preview") {
    let query = admin.from(spec.table).select("*", { count: "exact", head: true });
    query = applyFilters(query, spec, filters);
    const { count, error } = await query;
    if (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      ok: true,
      epistemic_contract: EPISTEMIC_CONTRACT,
      dataset_name: body.dataset_name,
      dataset_semantics: spec.datasetSemantics,
      estimated_row_count: count ?? null,
      count_semantics: "database_count_of_rows_matching_governed_filters",
      hard_cap: HARD_CAP,
      filters,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const limit = Math.min(body.limit ?? 50_000, HARD_CAP);
  const { data: logRow, error: logError } = await admin.from("aicis_export_logs").insert({
    exported_by: userId,
    exported_by_email: userEmail,
    dataset_name: body.dataset_name,
    format: body.format,
    filters,
    status: "pending",
  }).select("id").single();
  if (logError || !logRow?.id) {
    return new Response(JSON.stringify({ ok: false, error: "export_audit_log_unavailable" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const logId = logRow.id;

  try {
    const columns = spec.columns[0] === "*" ? "*" : spec.columns.join(",");
    const rawRows: Record<string, unknown>[] = [];
    let from = 0;

    while (rawRows.length < limit) {
      const pageSize = Math.min(PAGE, limit - rawRows.length);
      let query = admin.from(spec.table).select(columns).range(from, from + pageSize - 1);
      query = applyFilters(query, spec, filters);
      if (spec.dateCol) query = query.order(spec.dateCol, { ascending: false, nullsFirst: false });
      if (spec.idCol) query = query.order(spec.idCol, { ascending: false });
      const { data: page, error: pageError } = await query;
      if (pageError) throw new Error(`query: ${pageError.message}`);
      if (!page || page.length === 0) break;
      rawRows.push(...page as Record<string, unknown>[]);
      if (page.length < pageSize) break;
      from += pageSize;
    }

    const rows = annotateRows(rawRows, body.dataset_name, spec);
    const columnList = spec.columns[0] === "*"
      ? (rows[0] ? Object.keys(rows[0]) : ["_aicis_export_semantics"])
      : [...spec.columns, "_aicis_export_semantics"];

    let payload: string;
    let mime: string;
    let extension: string;
    const exportedAt = new Date().toISOString();

    if (body.format === "csv") {
      payload = rowsToCsv(columnList, rows);
      mime = "text/csv";
      extension = "csv";
    } else if (body.format === "ndjson") {
      payload = rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
      mime = "application/x-ndjson";
      extension = "ndjson";
    } else {
      payload = JSON.stringify({
        epistemic_contract: EPISTEMIC_CONTRACT,
        dataset: body.dataset_name,
        dataset_semantics: spec.datasetSemantics,
        exported_at: exportedAt,
        row_count: rows.length,
        filters,
        rows,
      }, null, 2);
      mime = "application/json";
      extension = "json";
    }

    let bytes = new TextEncoder().encode(payload);
    const rawSize = bytes.byteLength;
    let storedExtension = extension;
    let storedMime = mime;
    if (body.gzip) {
      bytes = gzip(bytes);
      storedExtension = `${extension}.gz`;
      storedMime = "application/gzip";
    }
    const checksum = await sha256Hex(bytes);
    const timestamp = exportedAt.replace(/[:.]/g, "-");
    const path = `${userId}/${body.dataset_name}-${timestamp}.${storedExtension}`;

    const { error: uploadError } = await admin.storage.from("aicis-exports")
      .upload(path, bytes, { contentType: storedMime, upsert: false });
    if (uploadError) throw new Error(`upload: ${uploadError.message}`);

    const { data: signed, error: signError } = await admin.storage.from("aicis-exports")
      .createSignedUrl(path, SIGNED_URL_TTL_S);
    if (signError) throw new Error(`sign: ${signError.message}`);

    const duration = Date.now() - start;
    const { error: logUpdateError } = await admin.from("aicis_export_logs").update({
      row_count: rows.length,
      file_size_bytes: bytes.byteLength,
      sha256_checksum: checksum,
      storage_path: path,
      status: "success",
      duration_ms: duration,
    }).eq("id", logId);
    if (logUpdateError) throw new Error(`audit_update: ${logUpdateError.message}`);

    return new Response(JSON.stringify({
      ok: true,
      epistemic_contract: EPISTEMIC_CONTRACT,
      dataset_semantics: spec.datasetSemantics,
      log_id: logId,
      dataset_name: body.dataset_name,
      format: body.format,
      compressed: body.gzip,
      row_count: rows.length,
      raw_size_bytes: rawSize,
      file_size_bytes: bytes.byteLength,
      compression_ratio: body.gzip && rawSize > 0
        ? Number((rawSize / bytes.byteLength).toFixed(2))
        : 1,
      sha256_checksum: checksum,
      storage_path: path,
      signed_url: signed?.signedUrl ?? null,
      expires_in_seconds: SIGNED_URL_TTL_S,
      duration_ms: duration,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(FN, message);
    await admin.from("aicis_export_logs").update({
      status: "error",
      error_message: message,
      duration_ms: Date.now() - start,
    }).eq("id", logId);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
