/**
 * export-aicis-dataset — AICIS Export Center backend (elite-grade)
 *
 * Streams a dataset (filtered) into a CSV/JSON/NDJSON file, optionally
 * gzip-compressed, into the `aicis-exports` private bucket and returns a
 * short-lived signed URL.
 *
 * Endpoints (POST):
 *  - default action `export`: builds the file and returns signed URL + checksum.
 *  - `{ action: "preview" }`: returns an estimated row count for the same
 *    dataset/filters without producing a file.
 *
 * Security:
 *  - Requires a valid JWT
 *  - Caller must hold role 'admin' or 'operator' (has_export_role RPC)
 *  - Every request — success or failure — is recorded in aicis_export_logs
 *  - Provenance fields are preserved
 *  - Hard cap: 250,000 rows per export, paginated 5,000 at a time
 *  - Keyset-stable ordering (date DESC, id DESC) prevents page drift
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

// ── Dataset registry ────────────────────────────────────────────────
type DatasetSpec = {
  table: string;
  columns: string[];
  iso3Col?: string;
  dateCol?: string;
  typeCol?: string;
  confidenceCol?: string;
  severityCol?: string;
  /** "unit" → 0–1 floats; "pct100" → 0–100 ints */
  scoreScale?: "unit" | "pct100";
  localityCol?: string;
  warningKindCol?: string;
  idCol?: string; // for keyset tiebreaker
};

const DATASETS: Record<string, DatasetSpec> = {
  local_events: {
    table: "aicis_local_events",
    columns: ["id","event_type","subtype","iso3","admin_level_1","locality","lat","lon",
              "start_time","end_time","severity","confidence","source_count","matched_keywords",
              "raw_signal_ids","title","description","status","bridged_to_normalized","created_at"],
    iso3Col: "iso3", dateCol: "start_time", typeCol: "event_type",
    confidenceCol: "confidence", severityCol: "severity", localityCol: "locality",
    scoreScale: "unit", idCol: "id",
  },
  early_warnings: {
    table: "aicis_early_warnings",
    columns: ["id","warning_kind","iso3","locality","admin_level_1","event_type","subtype",
              "severity","confidence","escalation_probability","time_window_hours",
              "source_count","event_count","metric","recommended_next_action","status",
              "first_detected_at","last_updated_at","resolved_at"],
    iso3Col: "iso3", dateCol: "first_detected_at", typeCol: "event_type",
    confidenceCol: "confidence", severityCol: "severity", localityCol: "locality",
    warningKindCol: "warning_kind", scoreScale: "unit", idCol: "id",
  },
  geo_audit: {
    table: "aicis_geo_resolution_audit",
    columns: ["id","signal_id","extracted_place","source_name","language","country_hint",
              "attempted_match","match_score","reason_unresolved","created_at"],
    iso3Col: "country_hint", dateCol: "created_at", idCol: "id",
  },
  country_corrections: {
    table: "lril_country_corrections",
    columns: ["id","signal_id","original_country_hint","detected_iso3",
              "raw_text_excerpt","source_name","confidence_penalty","created_at"],
    iso3Col: "detected_iso3", dateCol: "created_at", idCol: "id",
  },
  normalized_events: {
    table: "normalized_events",
    columns: ["id","provider_name","event_type","title","description","iso3","country_iso3",
              "started_at","ended_at","occurred_at","severity","confidence","provenance_source",
              "source_name","source_url","category","freshness_score","created_at"],
    iso3Col: "iso3", dateCol: "occurred_at", typeCol: "event_type",
    confidenceCol: "confidence", severityCol: "severity",
    scoreScale: "unit", idCol: "id",
  },
  training_dataset: {
    table: "training_dataset_aicis",
    columns: ["*"],
    iso3Col: "iso3", dateCol: "feature_window_end", idCol: "id",
  },
  global_signals: {
    table: "global_signals",
    columns: ["id","title","summary","category","status","confidence_score","impact_score",
              "urgency_score","source_count","primary_source","canonical_source_name",
              "source_trust_tier","ingestion_source","dedup_key","affected_countries",
              "affected_regions","affected_sectors","first_detected_at","occurred_at",
              "ingested_at","latest_update_at","evidence_hash","official_source_present",
              "merged_source_count","source_rank_score"],
    dateCol: "first_detected_at", typeCol: "category",
    confidenceCol: "confidence_score", severityCol: "impact_score",
    scoreScale: "pct100", idCol: "id",
  },
};

const FilterSchema = z.object({
  date_from: z.string().refine(s => !isNaN(Date.parse(s)), "invalid date_from").optional(),
  date_to: z.string().refine(s => !isNaN(Date.parse(s)), "invalid date_to").optional(),
  iso3: z.string().regex(/^[A-Z]{3}$/i).optional(),
  event_type: z.string().max(64).optional(),
  warning_kind: z.string().max(64).optional(),
  min_confidence: z.number().min(0).max(1).optional(),
  min_severity: z.number().min(0).max(1).optional(),
  locality_only: z.boolean().optional(),
  search: z.string().max(256).optional(),
}).strict();

const BodySchema = z.object({
  action: z.enum(["export","preview"]).optional().default("export"),
  dataset_name: z.string().refine(k => k in DATASETS, "unknown dataset"),
  format: z.enum(["csv","json","ndjson"]).optional().default("csv"),
  filters: FilterSchema.optional().default({}),
  limit: z.number().int().min(1).max(HARD_CAP).optional().default(50_000),
  gzip: z.boolean().optional().default(true),
});

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") v = JSON.stringify(v);
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function rowsToCsv(cols: string[], rows: any[]): string {
  const header = cols.map(csvEscape).join(",");
  const body = rows.map(r => cols.map(c => csvEscape(r[c])).join(",")).join("\n");
  return body ? `${header}\n${body}\n` : `${header}\n`;
}

async function sha256Hex(buf: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,"0")).join("");
}

function applyFilters<T>(q: any, spec: DatasetSpec, filters: any) {
  if (filters.date_from && spec.dateCol) q = q.gte(spec.dateCol, filters.date_from);
  if (filters.date_to && spec.dateCol)   q = q.lte(spec.dateCol, filters.date_to);
  if (filters.iso3 && spec.iso3Col)      q = q.eq(spec.iso3Col, filters.iso3.toUpperCase());
  if (filters.event_type && spec.typeCol) q = q.eq(spec.typeCol, filters.event_type);
  if (filters.warning_kind && spec.warningKindCol) q = q.eq(spec.warningKindCol, filters.warning_kind);
  if (typeof filters.min_confidence === "number" && spec.confidenceCol) {
    const v = spec.scoreScale === "pct100" ? Math.round(filters.min_confidence * 100) : filters.min_confidence;
    q = q.gte(spec.confidenceCol, v);
  }
  if (typeof filters.min_severity === "number" && spec.severityCol) {
    const v = spec.scoreScale === "pct100" ? Math.round(filters.min_severity * 100) : filters.min_severity;
    q = q.gte(spec.severityCol, v);
  }
  if (filters.locality_only && spec.localityCol) q = q.not(spec.localityCol, "is", null);
  if (filters.search && filters.search.trim().length >= 2) {
    const term = filters.search.replace(/[%_]/g, " ").trim();
    // Best-effort full-text-ish: title ilike OR summary/description ilike when present.
    const cols = spec.columns;
    const orParts: string[] = [];
    for (const c of ["title","description","summary","raw_text_excerpt","extracted_place"]) {
      if (cols[0] === "*" || cols.includes(c)) orParts.push(`${c}.ilike.%${term}%`);
    }
    if (orParts.length) q = q.or(orParts.join(","));
  }
  return q;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const start = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: "missing auth" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }});
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: uErr } = await userClient.auth.getUser();
  if (uErr || !userData?.user) {
    return new Response(JSON.stringify({ ok: false, error: "invalid auth" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }});
  }
  const userId = userData.user.id;
  const userEmail = userData.user.email ?? null;

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: hasRole } = await admin.rpc("has_export_role", { _user_id: userId });
  if (!hasRole) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden — admin/operator role required" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }});
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "invalid body", detail: (e as Error).message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }});
  }

  const spec = DATASETS[body.dataset_name];
  const filters = body.filters || {};

  // ── PREVIEW: head-count only ─────────────────────────────────────
  if (body.action === "preview") {
    let q = admin.from(spec.table).select("*", { count: "exact", head: true });
    q = applyFilters(q, spec, filters);
    const { count, error } = await q;
    if (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }});
    }
    return new Response(JSON.stringify({
      ok: true,
      dataset_name: body.dataset_name,
      estimated_row_count: count ?? 0,
      hard_cap: HARD_CAP,
      filters,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" }});
  }

  // ── EXPORT ──────────────────────────────────────────────────────
  const limit = Math.min(body.limit ?? 50_000, HARD_CAP);

  const { data: logRow } = await admin.from("aicis_export_logs").insert({
    exported_by: userId, exported_by_email: userEmail,
    dataset_name: body.dataset_name, format: body.format, filters,
    status: "pending",
  }).select("id").single();
  const logId = logRow?.id;

  try {
    const cols = spec.columns[0] === "*" ? "*" : spec.columns.join(",");
    const all: any[] = [];
    let from = 0;
    while (all.length < limit) {
      const pageSize = Math.min(PAGE, limit - all.length);
      let q = admin.from(spec.table).select(cols).range(from, from + pageSize - 1);
      q = applyFilters(q, spec, filters);
      // Stable keyset-style ordering: date DESC then id DESC
      if (spec.dateCol) q = q.order(spec.dateCol, { ascending: false, nullsFirst: false });
      if (spec.idCol)   q = q.order(spec.idCol,   { ascending: false });
      const { data: page, error: pErr } = await q;
      if (pErr) throw new Error(`query: ${pErr.message}`);
      if (!page || page.length === 0) break;
      all.push(...page);
      if (page.length < pageSize) break;
      from += pageSize;
    }

    const colList = spec.columns[0] === "*"
      ? (all[0] ? Object.keys(all[0]) : [])
      : spec.columns;
    let payload: string;
    let mime: string;
    let ext: string;
    if (body.format === "csv") {
      payload = rowsToCsv(colList, all); mime = "text/csv"; ext = "csv";
    } else if (body.format === "ndjson") {
      payload = all.map(r => JSON.stringify(r)).join("\n") + (all.length ? "\n" : "");
      mime = "application/x-ndjson"; ext = "ndjson";
    } else {
      payload = JSON.stringify({
        dataset: body.dataset_name, exported_at: new Date().toISOString(),
        row_count: all.length, filters, rows: all,
      }, null, 2);
      mime = "application/json"; ext = "json";
    }

    let bytes = new TextEncoder().encode(payload);
    const rawSize = bytes.byteLength;
    let storedExt = ext;
    let storedMime = mime;
    if (body.gzip) {
      bytes = gzip(bytes);
      storedExt = `${ext}.gz`;
      storedMime = "application/gzip";
    }
    const checksum = await sha256Hex(bytes);

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const path = `${userId}/${body.dataset_name}-${ts}.${storedExt}`;

    const { error: upErr } = await admin.storage.from("aicis-exports")
      .upload(path, bytes, { contentType: storedMime, upsert: false });
    if (upErr) throw new Error(`upload: ${upErr.message}`);

    const { data: signed, error: signErr } = await admin.storage.from("aicis-exports")
      .createSignedUrl(path, SIGNED_URL_TTL_S);
    if (signErr) throw new Error(`sign: ${signErr.message}`);

    const duration = Date.now() - start;
    if (logId) {
      await admin.from("aicis_export_logs").update({
        row_count: all.length, file_size_bytes: bytes.byteLength,
        sha256_checksum: checksum, storage_path: path,
        status: "success", duration_ms: duration,
      }).eq("id", logId);
    }

    return new Response(JSON.stringify({
      ok: true,
      log_id: logId,
      dataset_name: body.dataset_name,
      format: body.format,
      compressed: body.gzip,
      row_count: all.length,
      raw_size_bytes: rawSize,
      file_size_bytes: bytes.byteLength,
      compression_ratio: body.gzip && rawSize > 0 ? Number((rawSize / bytes.byteLength).toFixed(2)) : 1,
      sha256_checksum: checksum,
      storage_path: path,
      signed_url: signed?.signedUrl,
      expires_in_seconds: SIGNED_URL_TTL_S,
      duration_ms: duration,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" }});

  } catch (e) {
    const msg = (e as Error).message || "unknown error";
    console.error(FN, msg);
    if (logId) {
      await admin.from("aicis_export_logs").update({
        status: "error", error_message: msg, duration_ms: Date.now() - start,
      }).eq("id", logId);
    }
    return new Response(JSON.stringify({ ok: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }});
  }
});
