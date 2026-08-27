// AICIS Exports API — evidence-preserving REST boundary for downstream platforms.
// Auth: Supabase admin JWT or governed export API key.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  buildEnvelope,
  encodeCursor,
  decodeCursor,
  normalizeSignal,
  compressSignals,
  validateExport,
  applyProfileFilters,
  sha256Hex,
  EXPORT_SCHEMA_VERSION_DEFAULT,
  ExportProfile,
} from "../_shared/export-schema.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const SIGNAL_EXPORT_COLUMNS = [
  "id",
  "title",
  "summary",
  "category",
  "status",
  "confidence_score",
  "confidence_score_semantics",
  "impact_score",
  "impact_score_semantics",
  "urgency_score",
  "urgency_score_semantics",
  "source_rank_score",
  "source_rank_score_semantics",
  "trend_direction",
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
  "why_it_matters",
  "source_urls",
  "source_references",
  "recommended_actions",
].join(",");

type AuthCtx =
  | { kind: "jwt"; user_id: string }
  | { kind: "api_key"; key_id: string; org_id: string | null; rate_limit: number; scopes: string[] };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function authenticate(req: Request): Promise<{ ctx: AuthCtx } | { error: Response }> {
  const apiKey = req.headers.get("x-aicis-api-key");
  if (apiKey) {
    const prefix = apiKey.slice(0, 16);
    const hash = await sha256Hex(apiKey);
    const { data: row } = await admin
      .from("export_api_keys")
      .select("id,organization_id,scopes,rate_limit_per_min,revoked_at,expires_at,key_hash")
      .eq("key_prefix", prefix)
      .maybeSingle();
    if (!row || row.key_hash !== hash) return { error: jsonResponse({ error: "invalid_api_key" }, 401) };
    if (row.revoked_at || (row.expires_at && new Date(row.expires_at) < new Date())) {
      return { error: jsonResponse({ error: "key_revoked" }, 401) };
    }
    await admin.from("export_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);
    return {
      ctx: {
        kind: "api_key",
        key_id: row.id,
        org_id: row.organization_id,
        rate_limit: Number(row.rate_limit_per_min) || 60,
        scopes: Array.isArray(row.scopes) ? row.scopes : [],
      },
    };
  }

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return { error: jsonResponse({ error: "missing_auth" }, 401) };
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data } = await userClient.auth.getUser();
  if (!data?.user) return { error: jsonResponse({ error: "invalid_jwt" }, 401) };
  const { data: isAdmin } = await admin.rpc("has_role", {
    _user_id: data.user.id,
    _role: "admin",
  });
  if (!isAdmin) return { error: jsonResponse({ error: "admin_required" }, 403) };
  return { ctx: { kind: "jwt", user_id: data.user.id } };
}

async function rateLimit(ctx: AuthCtx, route: string): Promise<Response | null> {
  if (ctx.kind !== "api_key") return null;
  const subject = `key:${ctx.key_id}`;
  const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const { data: current } = await admin
    .from("api_rate_limits")
    .select("id,request_count")
    .eq("subject", subject)
    .eq("route", route)
    .eq("window_start", windowStart)
    .maybeSingle();
  if (current && current.request_count >= ctx.rate_limit) {
    return new Response(JSON.stringify({ error: "rate_limit" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" },
    });
  }
  if (current) {
    await admin.from("api_rate_limits").update({ request_count: current.request_count + 1 }).eq("id", current.id);
  } else {
    await admin.from("api_rate_limits").insert({ subject, route, window_start: windowStart, request_count: 1 });
  }
  return null;
}

async function audit(ctx: AuthCtx, action: string, metadata: Record<string, unknown> = {}) {
  await admin.from("export_audit_logs").insert({
    actor_user_id: ctx.kind === "jwt" ? ctx.user_id : null,
    actor_api_key_id: ctx.kind === "api_key" ? ctx.key_id : null,
    organization_id: ctx.kind === "api_key" ? ctx.org_id : null,
    action,
    metadata,
  }).then(() => {}, () => {});
}

function envelopeHeaders(
  ctx: AuthCtx,
  batchId: string,
  schemaVersion: string,
  nextCursor: string | null,
  remaining: number | null,
) {
  const headers: Record<string, string> = {
    ...corsHeaders,
    "Content-Type": "application/json",
    "X-Schema-Version": schemaVersion,
    "X-Export-Batch-Id": batchId,
  };
  if (ctx.kind === "api_key") {
    headers["X-RateLimit-Limit"] = String(ctx.rate_limit);
    if (remaining !== null) headers["X-RateLimit-Remaining"] = String(remaining);
  }
  if (nextCursor) headers["X-Next-Cursor"] = nextCursor;
  return headers;
}

async function resolveProfile(profileId: string | null): Promise<ExportProfile> {
  if (profileId) {
    const { data } = await admin.from("export_profiles").select("*").eq("id", profileId).maybeSingle();
    if (data) return data as ExportProfile;
  }
  return {
    id: "default",
    name: "default",
    destination_type: "api",
    domains: [],
    countries: [],
    regions: [],
    severity_tiers: ["medium", "high", "critical"],
    min_relevance_score: 0,
    min_confidence_score: 0,
    min_urgency_score: 0,
    max_records_per_run: 500,
    include_raw_source: false,
    include_recommendations: true,
    include_explanations: true,
    prefer_clusters: false,
    schema_version: EXPORT_SCHEMA_VERSION_DEFAULT,
  };
}

async function buildRecsMap(countries: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (countries.length === 0) return map;
  const { data } = await admin
    .from("risk_action_recommendations")
    .select("country_iso3,domain,action_summary,intervention_type,urgency_window")
    .in("country_iso3", countries)
    .limit(2000);
  for (const row of data ?? []) {
    const key = `${(row.country_iso3 ?? "").toUpperCase()}::${row.domain ?? ""}`;
    const text = `[${row.urgency_window ?? "n/a"}] ${row.intervention_type ?? ""}: ${row.action_summary ?? ""}`.trim();
    const current = map.get(key) ?? [];
    if (current.length < 5) map.set(key, [...current, text]);
  }
  return map;
}

function countryList(rows: Array<Record<string, unknown>>): string[] {
  return Array.from(new Set(rows.flatMap((row) =>
    Array.isArray(row.affected_countries)
      ? row.affected_countries.filter((item): item is string => typeof item === "string")
      : []
  ).map((country) => country.toUpperCase())));
}

async function signalPage(
  req: Request,
  profile: ExportProfile,
): Promise<{
  page: Array<Record<string, unknown>>;
  hasMore: boolean;
  next: string | null;
  error?: Response;
}> {
  const url = new URL(req.url);
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
  const limit = Math.min(Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 100, profile.max_records_per_run);
  const since = url.searchParams.get("since") ?? url.searchParams.get("updated_after");
  const until = url.searchParams.get("until");
  const cursor = decodeCursor(url.searchParams.get("cursor"));

  let query = admin.from("global_signals").select(SIGNAL_EXPORT_COLUMNS, { count: "exact" });
  query = applyProfileFilters(query, profile);
  if (since) query = query.gte("latest_update_at", since);
  if (until) query = query.lte("latest_update_at", until);
  if (cursor) {
    query = query.or(`latest_update_at.lt.${cursor.t},and(latest_update_at.eq.${cursor.t},id.lt.${cursor.i})`);
  }
  query = query.order("latest_update_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);

  const { data, error } = await query;
  if (error) {
    return {
      page: [],
      hasMore: false,
      next: null,
      error: jsonResponse({ error: "query_failed", detail: error.message }, 500),
    };
  }
  const list = (data ?? []) as Array<Record<string, unknown>>;
  const hasMore = list.length > limit;
  const page = hasMore ? list.slice(0, limit) : list;
  const last = page[page.length - 1];
  const latest = typeof last?.latest_update_at === "string" ? last.latest_update_at : null;
  const id = typeof last?.id === "string" ? last.id : null;
  const next = hasMore && latest && id ? encodeCursor(latest, id) : null;
  return { page, hasMore, next };
}

async function handleSignals(req: Request, ctx: AuthCtx): Promise<Response> {
  const profile = await resolveProfile(new URL(req.url).searchParams.get("profile_id"));
  const batchId = crypto.randomUUID();
  const result = await signalPage(req, profile);
  if (result.error) return result.error;
  const recsMap = await buildRecsMap(countryList(result.page));
  const signals = result.page.map((row) => normalizeSignal(row, profile, recsMap));
  const compressed = compressSignals(signals, { prefer_clusters: profile.prefer_clusters });
  const exported = profile.prefer_clusters ? compressed.signals : signals;
  const issues = validateExport(compressed.signals);
  const envelope = buildEnvelope(exported, {
    schema_version: profile.schema_version,
    export_batch_id: batchId,
    cursor: { next: result.next, has_more: result.hasMore },
    meta: {
      profile_id: profile.id,
      profile_name: profile.name,
      cluster_semantics: "country_domain_day_aggregation_bucket_not_event_identity",
      clusters: compressed.clusters,
      validation_issues_count: issues.length,
      validation_issues_preview: issues.slice(0, 10),
    },
  });
  await audit(ctx, "exports.signals.read", { profile_id: profile.id, count: envelope.count, batch_id: batchId });
  return new Response(JSON.stringify(envelope), {
    headers: envelopeHeaders(
      ctx,
      batchId,
      profile.schema_version,
      result.next,
      ctx.kind === "api_key" ? Math.max(0, ctx.rate_limit - 1) : null,
    ),
  });
}

async function handleClusters(req: Request, ctx: AuthCtx): Promise<Response> {
  const profile = await resolveProfile(new URL(req.url).searchParams.get("profile_id"));
  const forced = { ...profile, prefer_clusters: true };
  const batchId = crypto.randomUUID();
  const result = await signalPage(req, forced);
  if (result.error) return result.error;
  const recsMap = await buildRecsMap(countryList(result.page));
  const signals = result.page.map((row) => normalizeSignal(row, forced, recsMap));
  const { clusters } = compressSignals(signals, { prefer_clusters: true });
  const envelope = buildEnvelope(clusters, {
    schema_version: forced.schema_version,
    export_batch_id: batchId,
    cursor: { next: result.next, has_more: result.hasMore },
    meta: {
      profile_id: forced.id,
      total_input_signals: signals.length,
      cluster_semantics: "country_domain_day_aggregation_bucket_not_event_identity",
    },
  });
  await audit(ctx, "exports.clusters.read", { count: clusters.length });
  return new Response(JSON.stringify(envelope), {
    headers: envelopeHeaders(ctx, batchId, forced.schema_version, result.next, null),
  });
}

async function handleRecommendations(req: Request, ctx: AuthCtx): Promise<Response> {
  const url = new URL(req.url);
  const requested = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
  const limit = Math.min(Number.isFinite(requested) && requested > 0 ? requested : 100, 500);
  const batchId = crypto.randomUUID();
  let query = admin.from("risk_action_recommendations").select("*").order("created_at", { ascending: false }).limit(limit);
  const since = url.searchParams.get("since");
  const country = url.searchParams.get("country");
  const domain = url.searchParams.get("domain");
  if (since) query = query.gte("created_at", since);
  if (country) query = query.eq("country_iso3", country.toUpperCase());
  if (domain) query = query.eq("domain", domain);
  const { data, error } = await query;
  if (error) return jsonResponse({ error: error.message }, 500);
  const envelope = buildEnvelope(data ?? [], { schema_version: "v1", export_batch_id: batchId });
  await audit(ctx, "exports.recommendations.read", { count: envelope.count });
  return new Response(JSON.stringify(envelope), {
    headers: envelopeHeaders(ctx, batchId, "v1", null, null),
  });
}

async function handleEntities(req: Request, ctx: AuthCtx): Promise<Response> {
  const url = new URL(req.url);
  const requested = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
  const limit = Math.min(Number.isFinite(requested) && requested > 0 ? requested : 100, 500);
  const country = url.searchParams.get("country");
  const batchId = crypto.randomUUID();
  let query = admin.from("countries").select("iso3,name,region,is_canonical_iso3").order("iso3").limit(limit);
  if (country) query = query.eq("iso3", country.toUpperCase());
  const { data, error } = await query;
  if (error) return jsonResponse({ error: error.message }, 500);
  const envelope = buildEnvelope(data ?? [], { schema_version: "v1", export_batch_id: batchId });
  await audit(ctx, "exports.entities.read", { count: envelope.count });
  return new Response(JSON.stringify(envelope), {
    headers: envelopeHeaders(ctx, batchId, "v1", null, null),
  });
}

function percent(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}%`;
}

async function handleRiskBriefs(req: Request, ctx: AuthCtx): Promise<Response> {
  const url = new URL(req.url);
  const requested = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Math.min(Number.isFinite(requested) && requested > 0 ? requested : 50, 200);
  const country = url.searchParams.get("country");
  const batchId = crypto.randomUUID();
  let query = admin.from("risk_ranking_predictions")
    .select("country_iso3,domain,risk_probability,factors,confidence_lower,confidence_upper,evidence_count,evidence_status,probability_semantics,base_rate_probability,calibration_trust,calibration_sample_size,source_snapshot_date,model_version,generated_at")
    .order("risk_probability", { ascending: false })
    .order("generated_at", { ascending: false })
    .limit(limit);
  if (country) query = query.eq("country_iso3", country.toUpperCase());
  const { data, error } = await query;
  if (error) return jsonResponse({ error: error.message }, 500);

  const briefs = (data ?? []).map((row) => {
    const issued = row.evidence_status === "sufficient" && typeof row.risk_probability === "number";
    const scoreText = issued ? percent(row.risk_probability) : null;
    const evidenceText = typeof row.evidence_count === "number"
      ? `${row.evidence_count} source/evidence records`
      : "evidence count unavailable";
    return {
      country: row.country_iso3,
      domain: row.domain,
      evidence_status: row.evidence_status ?? "unknown",
      risk_probability: issued ? row.risk_probability : null,
      probability_semantics: row.probability_semantics ?? "unknown",
      model_version: row.model_version ?? null,
      source_snapshot_date: row.source_snapshot_date ?? null,
      evidence_count: row.evidence_count ?? null,
      factors: row.factors ?? null,
      base_rate_probability: row.base_rate_probability ?? null,
      calibration_trust: row.calibration_trust ?? null,
      calibration_sample_size: row.calibration_sample_size ?? null,
      confidence_interval: null,
      reported_legacy_interval: row.confidence_lower !== null || row.confidence_upper !== null
        ? [row.confidence_lower ?? null, row.confidence_upper ?? null]
        : null,
      interval_semantics: "legacy_interval_semantics_unverified_not_exported_as_confidence_interval",
      summary: issued
        ? `${row.country_iso3} ${row.domain}: ${scoreText} uncalibrated heuristic risk-screen value; ${evidenceText}. This is not a calibrated probability.`
        : `${row.country_iso3} ${row.domain}: no risk value issued because evidence is insufficient or unavailable.`,
      generated_at: row.generated_at ?? null,
    };
  });

  const envelope = buildEnvelope(briefs, { schema_version: "v2", export_batch_id: batchId });
  await audit(ctx, "exports.risk_briefs.read", { count: envelope.count });
  return new Response(JSON.stringify(envelope), {
    headers: envelopeHeaders(ctx, batchId, "v2", null, null),
  });
}

async function handleCreateProfile(req: Request, ctx: AuthCtx): Promise<Response> {
  if (ctx.kind !== "jwt") return jsonResponse({ error: "admin_jwt_required" }, 403);
  const body = await req.json().catch(() => ({}));
  const { data, error } = await admin
    .from("export_profiles")
    .insert({ ...body, created_by: ctx.user_id })
    .select()
    .single();
  if (error) return jsonResponse({ error: error.message }, 400);
  await audit(ctx, "exports.profiles.create", { profile_id: data.id });
  return jsonResponse({ ok: true, profile: data }, 201);
}

async function handleRunCreate(req: Request, ctx: AuthCtx): Promise<Response> {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const profileId = typeof body.profile_id === "string" ? body.profile_id : null;
  const format = typeof body.format === "string" ? body.format : "json";
  if (!profileId) return jsonResponse({ error: "profile_id_required" }, 400);
  const { data, error } = await admin.from("export_runs").insert({
    profile_id: profileId,
    status: "queued",
    trigger_source: ctx.kind === "jwt" ? "manual_ui" : "api",
    format,
  }).select().single();
  if (error) return jsonResponse({ error: error.message }, 400);
  admin.functions.invoke("exports-runner", { body: { run_id: data.id } }).catch(() => {});
  await audit(ctx, "exports.run.enqueue", { run_id: data.id, profile_id: profileId });
  return jsonResponse({ ok: true, run: data }, 202);
}

async function handleRunGet(_req: Request, _ctx: AuthCtx, runId: string): Promise<Response> {
  const { data, error } = await admin.from("export_runs").select("*").eq("id", runId).maybeSingle();
  if (error || !data) return jsonResponse({ error: "not_found" }, 404);
  return jsonResponse({ ok: true, run: data });
}

async function handleRunDownload(_req: Request, ctx: AuthCtx, runId: string): Promise<Response> {
  const { data, error } = await admin
    .from("export_runs")
    .select("storage_path,status")
    .eq("id", runId)
    .maybeSingle();
  if (error || !data?.storage_path) return jsonResponse({ error: "no_file" }, 404);
  const { data: signed } = await admin.storage.from("aicis-exports").createSignedUrl(data.storage_path, 600);
  await audit(ctx, "exports.run.download", { run_id: runId });
  if (!signed?.signedUrl) return jsonResponse({ error: "sign_failed" }, 500);
  return jsonResponse({ ok: true, signed_url: signed.signedUrl, expires_in_seconds: 600 });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/exports-api/, "").replace(/\/+$/, "") || "/";
    const auth = await authenticate(req);
    if ("error" in auth) return auth.error;
    const ctx = auth.ctx;
    const limited = await rateLimit(ctx, path);
    if (limited) return limited;

    if (req.method === "GET" && path === "/exports/signals") return await handleSignals(req, ctx);
    if (req.method === "GET" && path === "/exports/clusters") return await handleClusters(req, ctx);
    if (req.method === "GET" && path === "/exports/recommendations") return await handleRecommendations(req, ctx);
    if (req.method === "GET" && path === "/exports/entities") return await handleEntities(req, ctx);
    if (req.method === "GET" && path === "/exports/risk-briefs") return await handleRiskBriefs(req, ctx);
    if (req.method === "POST" && path === "/exports/profiles") return await handleCreateProfile(req, ctx);
    if (req.method === "POST" && path === "/exports/run") return await handleRunCreate(req, ctx);

    const runMatch = path.match(/^\/exports\/runs\/([0-9a-f-]{36})(\/download\.(csv|json|ndjson))?$/);
    if (runMatch && req.method === "GET") {
      const runId = runMatch[1];
      if (runMatch[2]) return await handleRunDownload(req, ctx, runId);
      return await handleRunGet(req, ctx, runId);
    }

    return jsonResponse({ error: "not_found", path }, 404);
  } catch (error) {
    console.error("exports-api error", error);
    return jsonResponse({
      error: "internal",
      detail: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});