// AICIS Exports API — REST router for downstream platforms (Quantivis, SDKs).
// Auth: either Supabase JWT (admin) OR X-AICIS-API-Key header.
// All responses use SDK-stable envelope with cursor + schema_version.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders, buildEnvelope, encodeCursor, decodeCursor, normalizeSignal,
  compressSignals, validateExport, applyProfileFilters, sha256Hex,
  EXPORT_SCHEMA_VERSION_DEFAULT, ExportProfile,
} from "../_shared/export-schema.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

type AuthCtx = { kind: "jwt"; user_id: string } | { kind: "api_key"; key_id: string; org_id: string | null; rate_limit: number; scopes: string[] };

async function authenticate(req: Request): Promise<{ ctx: AuthCtx } | { error: Response }> {
  const apiKey = req.headers.get("x-aicis-api-key");
  if (apiKey) {
    const prefix = apiKey.slice(0, 16);
    const hash = await sha256Hex(apiKey);
    const { data: row } = await admin
      .from("export_api_keys")
      .select("id, organization_id, scopes, rate_limit_per_min, revoked_at, expires_at, key_hash")
      .eq("key_prefix", prefix)
      .maybeSingle();
    if (!row || row.key_hash !== hash) {
      return { error: new Response(JSON.stringify({ error: "invalid_api_key" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }) };
    }
    if (row.revoked_at || (row.expires_at && new Date(row.expires_at) < new Date())) {
      return { error: new Response(JSON.stringify({ error: "key_revoked" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }) };
    }
    await admin.from("export_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);
    return { ctx: { kind: "api_key", key_id: row.id, org_id: row.organization_id, rate_limit: row.rate_limit_per_min, scopes: row.scopes ?? [] } };
  }
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return { error: new Response(JSON.stringify({ error: "missing_auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }) };
  }
  const user = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data } = await user.auth.getUser();
  if (!data?.user) return { error: new Response(JSON.stringify({ error: "invalid_jwt" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }) };
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
  if (!isAdmin) return { error: new Response(JSON.stringify({ error: "admin_required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }) };
  return { ctx: { kind: "jwt", user_id: data.user.id } };
}

async function rateLimit(ctx: AuthCtx, route: string): Promise<Response | null> {
  if (ctx.kind !== "api_key") return null;
  const subject = `key:${ctx.key_id}`;
  const windowStartMs = Math.floor(Date.now() / 60000) * 60000;
  const windowStart = new Date(windowStartMs).toISOString();
  const { data: cur } = await admin
    .from("api_rate_limits").select("id, request_count")
    .eq("subject", subject).eq("route", route).eq("window_start", windowStart).maybeSingle();
  if (cur && cur.request_count >= ctx.rate_limit) {
    return new Response(JSON.stringify({ error: "rate_limit" }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" },
    });
  }
  if (cur) await admin.from("api_rate_limits").update({ request_count: cur.request_count + 1 }).eq("id", cur.id);
  else await admin.from("api_rate_limits").insert({ subject, route, window_start: windowStart, request_count: 1 });
  return null;
}

async function audit(ctx: AuthCtx, action: string, meta: Record<string, unknown> = {}) {
  await admin.from("export_audit_logs").insert({
    actor_user_id: ctx.kind === "jwt" ? ctx.user_id : null,
    actor_api_key_id: ctx.kind === "api_key" ? ctx.key_id : null,
    organization_id: ctx.kind === "api_key" ? ctx.org_id : null,
    action, metadata: meta,
  }).then(() => {}, () => {});
}

function envelopeHeaders(ctx: AuthCtx, batchId: string, schemaVersion: string, nextCursor: string | null, remaining: number | null) {
  const h: Record<string, string> = {
    ...corsHeaders,
    "Content-Type": "application/json",
    "X-Schema-Version": schemaVersion,
    "X-Export-Batch-Id": batchId,
  };
  if (ctx.kind === "api_key") {
    h["X-RateLimit-Limit"] = String(ctx.rate_limit);
    if (remaining !== null) h["X-RateLimit-Remaining"] = String(remaining);
  }
  if (nextCursor) h["X-Next-Cursor"] = nextCursor;
  return h;
}

// Resolve "active" profile: explicit ?profile_id=, else default Quantivis preset clone with empty defaults.
async function resolveProfile(profileId: string | null): Promise<ExportProfile> {
  if (profileId) {
    const { data } = await admin.from("export_profiles").select("*").eq("id", profileId).maybeSingle();
    if (data) return data as ExportProfile;
  }
  // synthetic default
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
  if (!countries.length) return map;
  const { data } = await admin
    .from("risk_action_recommendations")
    .select("country_iso3, domain, action_summary, intervention_type, urgency_window")
    .in("country_iso3", countries)
    .limit(2000);
  for (const r of data ?? []) {
    const key = `${(r.country_iso3 ?? "").toUpperCase()}::${r.domain ?? ""}`;
    const text = `[${r.urgency_window ?? "n/a"}] ${r.intervention_type ?? ""}: ${r.action_summary ?? ""}`.trim();
    if (!map.has(key)) map.set(key, []);
    if (map.get(key)!.length < 5) map.get(key)!.push(text);
  }
  return map;
}

async function handleSignals(req: Request, ctx: AuthCtx): Promise<Response> {
  const url = new URL(req.url);
  const profile = await resolveProfile(url.searchParams.get("profile_id"));
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, profile.max_records_per_run);
  const since = url.searchParams.get("since") ?? url.searchParams.get("updated_after");
  const until = url.searchParams.get("until");
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const batchId = crypto.randomUUID();

  let q = admin.from("global_signals").select(
    "id,title,summary,category,status,confidence_score,impact_score,urgency_score,trend_direction,affected_countries,affected_regions,affected_sectors,affected_entities,primary_source,canonical_source_name,source_trust_tier,ingestion_source,merged_source_count,source_rank_score,official_source_present,evidence_hash,first_detected_at,latest_update_at,why_it_matters,source_urls,recommended_actions",
    { count: "exact" },
  );
  q = applyProfileFilters(q, profile);
  if (since) q = q.gte("latest_update_at", since);
  if (until) q = q.lte("latest_update_at", until);
  if (cursor) {
    q = q.or(`latest_update_at.lt.${cursor.t},and(latest_update_at.eq.${cursor.t},id.lt.${cursor.i})`);
  }
  q = q.order("latest_update_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);

  const { data: rows, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ error: "query_failed", detail: error.message, batch_id: batchId }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const list = rows ?? [];
  const hasMore = list.length > limit;
  const page = hasMore ? list.slice(0, limit) : list;
  const countries = Array.from(new Set(page.flatMap((r: any) => r.affected_countries ?? []).filter(Boolean).map((c: string) => c.toUpperCase())));
  const recsMap = await buildRecsMap(countries);
  const signals = page.map((r: any) => normalizeSignal(r, profile, recsMap));
  const compressed = compressSignals(signals, { prefer_clusters: profile.prefer_clusters });
  const issues = validateExport(compressed.signals);
  const last = page[page.length - 1];
  const next = hasMore && last ? encodeCursor(last.latest_update_at, last.id) : null;
  const env = buildEnvelope(profile.prefer_clusters ? compressed.signals : signals, {
    schema_version: profile.schema_version,
    export_batch_id: batchId,
    cursor: { next, has_more: hasMore },
    meta: {
      profile_id: profile.id,
      profile_name: profile.name,
      clusters: compressed.clusters,
      validation_issues_count: issues.length,
      validation_issues_preview: issues.slice(0, 10),
    },
  });
  await audit(ctx, "exports.signals.read", { profile_id: profile.id, count: env.count, batch_id: batchId });
  return new Response(JSON.stringify(env), { headers: envelopeHeaders(ctx, batchId, profile.schema_version, next, ctx.kind === "api_key" ? Math.max(0, ctx.rate_limit - 1) : null) });
}

async function handleClusters(req: Request, ctx: AuthCtx): Promise<Response> {
  // Force-cluster mode.
  const url = new URL(req.url);
  const profile = await resolveProfile(url.searchParams.get("profile_id"));
  const forced: ExportProfile = { ...profile, prefer_clusters: true };
  const sigUrl = new URL(req.url);
  sigUrl.searchParams.set("profile_id", profile.id);
  // Reuse handleSignals body via temporary profile resolution: call directly with forced profile.
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, forced.max_records_per_run);
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const since = url.searchParams.get("since") ?? url.searchParams.get("updated_after");
  const batchId = crypto.randomUUID();
  let q = admin.from("global_signals").select(
    "id,title,summary,category,confidence_score,impact_score,urgency_score,trend_direction,affected_countries,affected_regions,affected_sectors,affected_entities,primary_source,canonical_source_name,source_trust_tier,ingestion_source,merged_source_count,source_rank_score,official_source_present,evidence_hash,first_detected_at,latest_update_at,why_it_matters,source_urls,recommended_actions",
  );
  q = applyProfileFilters(q, forced);
  if (since) q = q.gte("latest_update_at", since);
  if (cursor) q = q.or(`latest_update_at.lt.${cursor.t},and(latest_update_at.eq.${cursor.t},id.lt.${cursor.i})`);
  q = q.order("latest_update_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
  const { data: rows, error } = await q;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const list = rows ?? [];
  const hasMore = list.length > limit;
  const page = hasMore ? list.slice(0, limit) : list;
  const countries = Array.from(new Set(page.flatMap((r: any) => r.affected_countries ?? []).filter(Boolean).map((c: string) => c.toUpperCase())));
  const recsMap = await buildRecsMap(countries);
  const signals = page.map((r: any) => normalizeSignal(r, forced, recsMap));
  const { clusters } = compressSignals(signals, { prefer_clusters: true });
  const last = page[page.length - 1];
  const next = hasMore && last ? encodeCursor(last.latest_update_at, last.id) : null;
  const env = buildEnvelope(clusters, {
    schema_version: forced.schema_version, export_batch_id: batchId,
    cursor: { next, has_more: hasMore },
    meta: { profile_id: forced.id, total_input_signals: signals.length },
  });
  await audit(ctx, "exports.clusters.read", { count: clusters.length });
  return new Response(JSON.stringify(env), { headers: envelopeHeaders(ctx, batchId, forced.schema_version, next, null) });
}

async function handleRecommendations(req: Request, ctx: AuthCtx): Promise<Response> {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 500);
  const since = url.searchParams.get("since");
  const country = url.searchParams.get("country");
  const domain = url.searchParams.get("domain");
  const batchId = crypto.randomUUID();
  let q = admin.from("risk_action_recommendations").select("*").order("created_at", { ascending: false }).limit(limit);
  if (since) q = q.gte("created_at", since);
  if (country) q = q.eq("country_iso3", country.toUpperCase());
  if (domain) q = q.eq("domain", domain);
  const { data, error } = await q;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const env = buildEnvelope(data ?? [], { schema_version: "v1", export_batch_id: batchId });
  await audit(ctx, "exports.recommendations.read", { count: env.count });
  return new Response(JSON.stringify(env), { headers: envelopeHeaders(ctx, batchId, "v1", null, null) });
}

async function handleEntities(req: Request, ctx: AuthCtx): Promise<Response> {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 500);
  const country = url.searchParams.get("country");
  const batchId = crypto.randomUUID();
  let q = admin.from("countries").select("iso3, name, region, is_canonical_iso3").order("iso3").limit(limit);
  if (country) q = q.eq("iso3", country.toUpperCase());
  const { data, error } = await q;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const env = buildEnvelope(data ?? [], { schema_version: "v1", export_batch_id: batchId });
  await audit(ctx, "exports.entities.read", { count: env.count });
  return new Response(JSON.stringify(env), { headers: envelopeHeaders(ctx, batchId, "v1", null, null) });
}

async function handleRiskBriefs(req: Request, ctx: AuthCtx): Promise<Response> {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
  const country = url.searchParams.get("country");
  const batchId = crypto.randomUUID();
  let q = admin.from("risk_ranking_predictions")
    .select("country_iso3, domain, risk_probability, factors, confidence_lower, confidence_upper, evidence_count, generated_at")
    .order("risk_probability", { ascending: false })
    .order("generated_at", { ascending: false })
    .limit(limit);
  if (country) q = q.eq("country_iso3", country.toUpperCase());
  const { data, error } = await q;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const briefs = (data ?? []).map((r: any) => ({
    country: r.country_iso3,
    domain: r.domain,
    risk_probability: r.risk_probability,
    confidence_interval: [r.confidence_lower, r.confidence_upper],
    evidence_count: r.evidence_count,
    factors: r.factors,
    summary: `${r.country_iso3} ${r.domain} risk ${Math.round((r.risk_probability ?? 0) * 100)}% (CI ${Math.round((r.confidence_lower ?? 0) * 100)}–${Math.round((r.confidence_upper ?? 0) * 100)}%), based on ${r.evidence_count ?? 0} signals.`,
    generated_at: r.generated_at,
  }));
  const env = buildEnvelope(briefs, { schema_version: "v1", export_batch_id: batchId });
  await audit(ctx, "exports.risk_briefs.read", { count: env.count });
  return new Response(JSON.stringify(env), { headers: envelopeHeaders(ctx, batchId, "v1", null, null) });
}

async function handleCreateProfile(req: Request, ctx: AuthCtx): Promise<Response> {
  if (ctx.kind !== "jwt") return new Response(JSON.stringify({ error: "admin_jwt_required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const body = await req.json().catch(() => ({}));
  const insert = { ...body, created_by: ctx.user_id };
  const { data, error } = await admin.from("export_profiles").insert(insert).select().single();
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  await audit(ctx, "exports.profiles.create", { profile_id: data.id });
  return new Response(JSON.stringify({ ok: true, profile: data }), { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function handleRunCreate(req: Request, ctx: AuthCtx): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const profileId = body.profile_id;
  const format = body.format ?? "json";
  if (!profileId) return new Response(JSON.stringify({ error: "profile_id_required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const { data, error } = await admin.from("export_runs").insert({
    profile_id: profileId, status: "queued", trigger_source: ctx.kind === "jwt" ? "manual_ui" : "api", format,
  }).select().single();
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  // Fire runner async
  admin.functions.invoke("exports-runner", { body: { run_id: data.id } }).catch(() => {});
  await audit(ctx, "exports.run.enqueue", { run_id: data.id, profile_id: profileId });
  return new Response(JSON.stringify({ ok: true, run: data }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function handleRunGet(req: Request, ctx: AuthCtx, runId: string): Promise<Response> {
  const { data, error } = await admin.from("export_runs").select("*").eq("id", runId).maybeSingle();
  if (error || !data) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  return new Response(JSON.stringify({ ok: true, run: data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function handleRunDownload(_req: Request, ctx: AuthCtx, runId: string): Promise<Response> {
  const { data, error } = await admin.from("export_runs").select("storage_path, status").eq("id", runId).maybeSingle();
  if (error || !data?.storage_path) return new Response(JSON.stringify({ error: "no_file" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const { data: signed } = await admin.storage.from("aicis-exports").createSignedUrl(data.storage_path, 600);
  await audit(ctx, "exports.run.download", { run_id: runId });
  if (!signed?.signedUrl) return new Response(JSON.stringify({ error: "sign_failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  return new Response(JSON.stringify({ ok: true, signed_url: signed.signedUrl, expires_in_seconds: 600 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/exports-api/, "").replace(/\/+$/, "") || "/";
    const auth = await authenticate(req);
    if ("error" in auth) return auth.error;
    const ctx = auth.ctx;
    const rl = await rateLimit(ctx, path);
    if (rl) return rl;

    // Routes
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

    return new Response(JSON.stringify({ error: "not_found", path }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("exports-api error", e);
    return new Response(JSON.stringify({ error: "internal", detail: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
