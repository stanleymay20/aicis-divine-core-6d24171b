import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Expose-Headers": "x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, x-request-id",
};

const READ_SCOPE = "read";
const WRITE_SCOPE = "write";
const API_VERSION = "2.0";
const EPISTEMIC_CONTRACT = "null_preserving_semantically_typed_v2";
type SupabaseClientLike = ReturnType<typeof createClient>;
const UNUSABLE_SEMANTIC_TOKENS = [
  "legacy",
  "unknown",
  "unverified",
  "unspecified",
  "unlabeled",
  "withheld",
] as const;

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseLimit(url: URL, fallback: number, max: number): number {
  const parsed = Number.parseInt(url.searchParams.get("limit") ?? String(fallback), 10);
  return Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : fallback, max);
}

function semanticsUsable(value: unknown): boolean {
  if (typeof value !== "string" || value.trim() === "") return false;
  const normalized = value.toLowerCase();
  return !UNUSABLE_SEMANTIC_TOKENS.some((token) => normalized.includes(token));
}

function queryCall<T>(query: T, method: string, ...args: unknown[]): T {
  const callable = query as unknown as Record<string, (...methodArgs: unknown[]) => T>;
  const fn = callable[method];
  if (typeof fn !== "function") throw new TypeError(`Query builder does not support ${method}`);
  return fn(...args);
}

function requireUsableSemantics<T>(query: T, column: string): T {
  query = queryCall(query, "not", column, "is", null);
  for (const token of UNUSABLE_SEMANTIC_TOKENS) {
    query = queryCall(query, "not", column, "ilike", `%${token}%`);
  }
  return query;
}

function apiData(data: unknown[], extra: Record<string, unknown> = {}) {
  return json({
    api_version: API_VERSION,
    epistemic_contract: EPISTEMIC_CONTRACT,
    data,
    count: data.length,
    ...extra,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const resource = pathParts[1] ?? "";
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const writeAudit = async (params: {
    keyId: string | null;
    orgId: string | null;
    status: number;
    requestBody: string;
    responseBody: string;
  }) => {
    try {
      const { data: previous, error: previousError } = await supabaseAdmin
        .from("api_request_audit")
        .select("chain_hash")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (previousError) throw previousError;
      const previousHash = previous?.chain_hash ?? "";
      const requestHash = await sha256(`${req.method}|${url.pathname}|${url.search}|${params.requestBody}`);
      const responseHash = await sha256(params.responseBody);
      const chainHash = await sha256(
        `${previousHash}|${requestHash}|${responseHash}|${params.status}|${requestId}`,
      );
      await supabaseAdmin.from("api_request_audit").insert({
        api_key_id: params.keyId,
        org_id: params.orgId,
        endpoint: url.pathname.replace(/^\/public-api/, "") || "/",
        method: req.method,
        request_hash: requestHash,
        response_hash: responseHash,
        previous_chain_hash: previousHash || null,
        chain_hash: chainHash,
        response_status: params.status,
        latency_ms: Date.now() - startedAt,
      });
    } catch (error) {
      console.error("audit write failed", error);
    }
  };

  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) {
    const body = JSON.stringify({ error: "Missing x-api-key header", request_id: requestId });
    await writeAudit({ keyId: null, orgId: null, status: 401, requestBody: "", responseBody: body });
    return new Response(body, {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId },
    });
  }

  const keyHash = await sha256(apiKey);
  const { data: keyRow, error: keyError } = await supabaseAdmin
    .from("api_keys")
    .select("id,org_id,rate_limit_per_minute,revoked,expires_at,scopes")
    .eq("key_hash", keyHash)
    .eq("revoked", false)
    .maybeSingle();

  if (keyError) {
    const body = JSON.stringify({ error: "API key verification unavailable", request_id: requestId });
    await writeAudit({ keyId: null, orgId: null, status: 503, requestBody: "", responseBody: body });
    return new Response(body, {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId },
    });
  }
  if (!keyRow) {
    const body = JSON.stringify({ error: "Invalid or revoked API key", request_id: requestId });
    await writeAudit({ keyId: null, orgId: null, status: 403, requestBody: "", responseBody: body });
    return new Response(body, {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId },
    });
  }
  if (keyRow.expires_at && new Date(keyRow.expires_at).getTime() < Date.now()) {
    const body = JSON.stringify({ error: "API key expired", expired_at: keyRow.expires_at, request_id: requestId });
    await writeAudit({ keyId: keyRow.id, orgId: keyRow.org_id, status: 403, requestBody: "", responseBody: body });
    return new Response(body, {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId },
    });
  }

  const configuredLimit = Number(keyRow.rate_limit_per_minute);
  const rateLimit = Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : 60;
  const { data: countResult, error: countError } = await supabaseAdmin.rpc("count_api_requests_window", {
    _key_id: keyRow.id,
    _window_seconds: 60,
  });
  if (countError || typeof countResult !== "number" || !Number.isFinite(countResult)) {
    const body = JSON.stringify({
      error: "Rate-limit verification unavailable",
      request_id: requestId,
    });
    await writeAudit({ keyId: keyRow.id, orgId: keyRow.org_id, status: 503, requestBody: "", responseBody: body });
    return new Response(body, {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId },
    });
  }

  const used = countResult;
  const remaining = Math.max(0, rateLimit - used);
  const rateHeaders = {
    "x-ratelimit-limit": String(rateLimit),
    "x-ratelimit-remaining": String(remaining),
    "x-ratelimit-reset": "60",
    "x-request-id": requestId,
  };
  if (used >= rateLimit) {
    const body = JSON.stringify({
      error: "Rate limit exceeded",
      limit: rateLimit,
      window_seconds: 60,
      request_id: requestId,
    });
    await writeAudit({ keyId: keyRow.id, orgId: keyRow.org_id, status: 429, requestBody: "", responseBody: body });
    return new Response(body, {
      status: 429,
      headers: { ...corsHeaders, ...rateHeaders, "Content-Type": "application/json", "Retry-After": "60" },
    });
  }

  const scopes = Array.isArray(keyRow.scopes) ? keyRow.scopes as string[] : [READ_SCOPE];
  const isWrite = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  const allowed = isWrite
    ? scopes.includes(WRITE_SCOPE)
    : scopes.includes(READ_SCOPE) || scopes.includes(WRITE_SCOPE);
  if (!allowed) {
    const required = isWrite ? WRITE_SCOPE : READ_SCOPE;
    const body = JSON.stringify({
      error: `Insufficient scope: ${required} required`,
      scopes,
      request_id: requestId,
    });
    await writeAudit({ keyId: keyRow.id, orgId: keyRow.org_id, status: 403, requestBody: "", responseBody: body });
    return new Response(body, {
      status: 403,
      headers: { ...corsHeaders, ...rateHeaders, "Content-Type": "application/json" },
    });
  }

  supabaseAdmin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRow.id).then(() => {});
  const orgId = keyRow.org_id;
  let rawBody = "";
  if (isWrite) {
    try {
      rawBody = await req.clone().text();
    } catch {
      rawBody = "";
    }
  }

  try {
    let response: Response;
    switch (resource) {
      case "signals": response = await handleSignals(supabaseAdmin, url); break;
      case "decisions": response = await handleDecisions(supabaseAdmin, url, req); break;
      case "outcomes": response = await handleOutcomes(supabaseAdmin, url); break;
      case "priority-decisions": response = await handlePriorityDecisions(supabaseAdmin); break;
      case "ml-predictions": response = await handleMLPredictions(supabaseAdmin, url); break;
      case "propagation": response = await handlePropagation(supabaseAdmin, url); break;
      case "simulations": response = await handleSimulations(supabaseAdmin, url); break;
      case "risk-ranking": response = await handleRiskRanking(supabaseAdmin, url); break;
      case "health": response = await handleHealth(supabaseAdmin); break;
      case "domains": response = await handleDomains(supabaseAdmin); break;
      default:
        response = json({
          api: "AICIS Public API",
          version: API_VERSION,
          epistemic_contract: EPISTEMIC_CONTRACT,
          documentation_path: "/developers",
          endpoints: [
            "GET /signals",
            "GET /decisions",
            "POST /decisions",
            "GET /outcomes",
            "GET /priority-decisions",
            "GET /ml-predictions",
            "GET /propagation",
            "GET /simulations",
            "GET /risk-ranking",
            "GET /domains",
            "GET /health",
          ],
        });
    }

    const responseBody = await response.clone().text();
    await writeAudit({
      keyId: keyRow.id,
      orgId,
      status: response.status,
      requestBody: rawBody,
      responseBody,
    });
    const merged = new Headers(response.headers);
    for (const [key, value] of Object.entries(rateHeaders)) merged.set(key, value);
    return new Response(responseBody, { status: response.status, headers: merged });
  } catch (error) {
    console.error("Public API error:", error);
    const message = error instanceof Error ? error.message : String(error);
    const body = JSON.stringify({ error: message, resource, request_id: requestId });
    await writeAudit({ keyId: keyRow.id, orgId, status: 500, requestBody: rawBody, responseBody: body });
    return new Response(body, {
      status: 500,
      headers: { ...corsHeaders, ...rateHeaders, "Content-Type": "application/json" },
    });
  }
});

async function handleSignals(sb: SupabaseClientLike, url: URL) {
  const limit = parseLimit(url, 20, 100);
  const category = url.searchParams.get("category");
  const minImpactRaw = url.searchParams.get("min_impact");
  const minImpact = minImpactRaw === null ? null : Number(minImpactRaw);

  let query = sb.from("global_signals")
    .select("id,title,category,impact_score,impact_score_semantics,urgency_score,urgency_score_semantics,confidence_score,confidence_score_semantics,affected_sectors,source_trust_tier,affected_regions,latest_update_at,recommended_actions,source_identifier_count,source_identifier_count_semantics,source_independence_status,independent_origin_count,source_independence_semantics")
    .order("latest_update_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (category) query = query.eq("category", category);
  if (minImpact !== null && Number.isFinite(minImpact) && minImpact > 0) {
    query = query.gte("impact_score", minImpact);
    query = requireUsableSemantics(query, "impact_score_semantics");
  }

  const { data, error } = await query;
  if (error) throw error;
  const normalized = (data ?? []).map((signal) => ({
    id: signal.id,
    title: signal.title,
    category: signal.category,
    impact_score: semanticsUsable(signal.impact_score_semantics) ? signal.impact_score : null,
    impact_score_semantics: signal.impact_score_semantics ?? null,
    urgency_score: semanticsUsable(signal.urgency_score_semantics) ? signal.urgency_score : null,
    urgency_score_semantics: signal.urgency_score_semantics ?? null,
    confidence_score: semanticsUsable(signal.confidence_score_semantics) ? signal.confidence_score : null,
    confidence_score_semantics: signal.confidence_score_semantics ?? null,
    affected_sectors: signal.affected_sectors ?? [],
    source_type: signal.source_trust_tier ?? null,
    source_identifier_count: signal.source_identifier_count ?? null,
    source_identifier_count_semantics: signal.source_identifier_count_semantics ?? null,
    source_independence_status: signal.source_independence_status ?? "not_assessed",
    independent_origin_count: signal.independent_origin_count ?? null,
    source_independence_semantics: signal.source_independence_semantics ?? null,
    region: Array.isArray(signal.affected_regions) ? signal.affected_regions[0] ?? null : signal.affected_regions ?? null,
    updated_at: signal.latest_update_at ?? null,
    recommendation: Array.isArray(signal.recommended_actions)
      ? signal.recommended_actions[0] ?? null
      : signal.recommended_actions ?? null,
  }));
  return apiData(normalized, {
    note: "source identifier count is descriptive and is not independent corroboration",
  });
}

async function handleDecisions(sb: SupabaseClientLike, url: URL, req: Request) {
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const signalSummary = typeof body.signal_summary === "string" ? body.signal_summary.trim() : "";
    const domain = typeof body.domain === "string" ? body.domain.trim() : "";
    const reportedSeverity = typeof body.severity_score === "number" && Number.isFinite(body.severity_score)
      && body.severity_score >= 0 && body.severity_score <= 100
      ? body.severity_score
      : null;
    if (!signalSummary || !domain) return json({ error: "signal_summary and domain are required" }, 400);

    const { data, error } = await sb.from("adi_decisions").insert({
      signal_summary: signalSummary,
      domain,
      severity_score: null,
      severity_score_semantics: "external_api_input_not_canonical_assessment",
      reported_severity_score: reportedSeverity,
      confidence: null,
      confidence_semantics: "not_assessed_at_submission",
      evidence_status: "external_input_unassessed",
      evidence_semantics: "caller_reported_decision_request_pending_governed_review",
      signal_source: "public_api",
      status: "pending_review",
    }).select().single();
    if (error) throw error;
    return json({
      api_version: API_VERSION,
      epistemic_contract: EPISTEMIC_CONTRACT,
      data,
      note: "caller-reported severity is preserved separately and is not promoted to canonical AICIS severity",
    }, 201);
  }

  const limit = parseLimit(url, 20, 100);
  const status = url.searchParams.get("status");
  let query = sb.from("adi_decisions")
    .select("id,domain,signal_summary,severity_score,severity_score_semantics,reported_severity_score,confidence,confidence_semantics,evidence_status,evidence_semantics,status,recommended_option_rank,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return apiData(data ?? []);
}

async function handleOutcomes(sb: SupabaseClientLike, url: URL) {
  const limit = parseLimit(url, 20, 100);
  const { data, error } = await sb.from("decision_outcome_log")
    .select("id,signal_title,action_taken,outcome_success,impact_score,roi_estimate,net_value,evidence_type,evidence_quality_score,criticality_tier,created_at")
    .not("outcome_success", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const normalized = (data ?? []).map((outcome) => ({
    ...outcome,
    evidence_tier: outcome.criticality_tier ?? outcome.evidence_type ?? null,
    evidence_quality_semantics: "legacy_field_semantics_not_reclassified_by_public_api",
  }));
  return apiData(normalized);
}

async function handlePriorityDecisions(sb: SupabaseClientLike) {
  let query = sb.from("global_signals")
    .select("id,title,category,impact_score,impact_score_semantics,urgency_score,urgency_score_semantics,confidence_score,confidence_score_semantics,affected_sectors,recommended_actions,affected_regions,latest_update_at,status")
    .in("status", ["confirmed", "pending_enrichment", "enriched"])
    .not("impact_score", "is", null)
    .order("impact_score", { ascending: false, nullsFirst: false })
    .limit(5);
  query = requireUsableSemantics(query, "impact_score_semantics");
  const { data: signals, error } = await query;
  if (error) throw error;

  const priorities = (signals ?? []).map((signal) => {
    const urgency = semanticsUsable(signal.urgency_score_semantics) ? signal.urgency_score : null;
    const impact = semanticsUsable(signal.impact_score_semantics) ? signal.impact_score : null;
    const urgencyLevel = typeof urgency === "number" && urgency >= 80
      ? "critical"
      : typeof impact === "number" && impact >= 70
      ? "high"
      : null;
    return {
      signal_id: signal.id,
      title: signal.title,
      category: signal.category,
      priority_score: impact,
      priority_score_semantics: "governed_impact_score_used_as_sort_key_not_probability",
      urgency_level: urgencyLevel,
      urgency_level_semantics: urgencyLevel ? "threshold_label_from_governed_scores" : "withheld_insufficient_governed_score",
      affected_domains: Array.isArray(signal.affected_sectors) ? signal.affected_sectors : [],
      recommended_action: Array.isArray(signal.recommended_actions)
        ? signal.recommended_actions[0] ?? null
        : signal.recommended_actions ?? null,
      estimated_impact: typeof impact === "number"
        ? impact >= 80 ? "high" : impact >= 50 ? "medium" : "low"
        : null,
      region: Array.isArray(signal.affected_regions) ? signal.affected_regions[0] ?? null : signal.affected_regions ?? null,
      updated_at: signal.latest_update_at ?? null,
    };
  });
  return apiData(priorities);
}

async function handleHealth(sb: SupabaseClientLike) {
  const { data: logs, error } = await sb.from("automation_logs")
    .select("status,executed_at")
    .order("executed_at", { ascending: false })
    .limit(10);
  if (error) {
    return json({
      api_version: API_VERSION,
      status: "unknown",
      health_semantics: "automation_log_query_failed_no_health_claim_issued",
      error: error.message,
      timestamp: new Date().toISOString(),
    }, 503);
  }
  if (!logs || logs.length === 0) {
    return json({
      api_version: API_VERSION,
      status: "unknown",
      health_semantics: "no_recent_automation_observations",
      last_automation_run: null,
      recent_errors: null,
      timestamp: new Date().toISOString(),
    });
  }
  const errors = logs.filter((log) => log.status === "error").length;
  return json({
    api_version: API_VERSION,
    status: errors > 3 ? "degraded_recent_window" : "operational_recent_window",
    health_semantics: "status_derived_only_from_last_10_automation_log_rows_not_full_system_health",
    last_automation_run: logs[0]?.executed_at ?? null,
    observations_examined: logs.length,
    recent_errors: errors,
    timestamp: new Date().toISOString(),
  });
}

async function handleDomains(sb: SupabaseClientLike) {
  const { data, error } = await sb.from("country_performance_snapshots").select("domain").limit(1000);
  if (error) throw error;
  const domains = [...new Set((data ?? []).map((row) => row.domain).filter(Boolean))];
  return apiData(domains);
}

async function handleMLPredictions(sb: SupabaseClientLike, url: URL) {
  const limit = parseLimit(url, 50, 200);
  const domain = url.searchParams.get("domain");
  const { data: latest, error: latestError } = await sb.from("risk_ml_predictions")
    .select("generation_batch_id")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;
  if (!latest) return apiData([], { note: "no inference batch available; this does not imply zero risk" });

  let query = sb.from("risk_ml_predictions")
    .select("country_iso3,domain,risk_probability,calibrated_score,prediction_interval_lower,prediction_interval_upper,horizon_days,model_version,model_semantics,evidence_status,probability_semantics,calibration_status,calibration_sample_size,calibration_computed_at,interval_semantics,source_kind,source_snapshot_date,feature_completeness,generated_at")
    .eq("generation_batch_id", latest.generation_batch_id)
    .order("risk_probability", { ascending: false })
    .limit(limit);
  if (domain) query = query.eq("domain", domain);
  const { data, error } = await query;
  if (error) throw error;
  return apiData(data ?? [], {
    note: "interpret risk_probability only through probability_semantics; no output is not zero risk",
  });
}

async function handlePropagation(sb: SupabaseClientLike, url: URL) {
  const limit = parseLimit(url, 50, 200);
  const domain = url.searchParams.get("domain");
  const { data: latest, error: latestError } = await sb.from("risk_propagation_score")
    .select("generation_batch_id,computed_at")
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;
  if (!latest) return apiData([], { note: "no propagation screen batch available; this does not imply no propagation risk" });

  let query = sb.from("risk_propagation_score")
    .select("origin_iso3,target_iso3,domain,propagation_score,propagation_semantics,evidence_status,origin_input_semantics,edge_intensity_semantics,source_prediction_id,source_cross_border_signal_id,source_snapshot_date,hop_count,contagion_path,computed_at")
    .eq("generation_batch_id", latest.generation_batch_id)
    .order("propagation_score", { ascending: false })
    .limit(limit);
  if (domain) query = query.eq("domain", domain);
  const [{ data, error }, { count: withheldCount, error: withheldError }] = await Promise.all([
    query,
    sb.from("risk_propagation_abstentions")
      .select("id", { count: "exact", head: true })
      .eq("generation_batch_id", latest.generation_batch_id),
  ]);
  if (error) throw error;
  if (withheldError) throw withheldError;
  return apiData(data ?? [], {
    propagation_semantics: "deterministic_exposure_screen_not_probability_or_causal_confidence",
    withheld_count: withheldCount ?? null,
    note: "withheld propagation cases are recorded separately; absent rows do not imply no risk",
  });
}

async function handleSimulations(sb: SupabaseClientLike, url: URL) {
  const limit = parseLimit(url, 20, 100);
  const { data, error } = await sb.from("simulation_runs")
    .select("id,scenario_name,shock_domain,shock_iso3,shock_magnitude,shock_direction,estimated_global_impact,affected_countries,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const normalized = (data ?? []).map((row) => ({
    id: row.id,
    scenario_name: row.scenario_name,
    shock_domain: row.shock_domain,
    shock_iso3: row.shock_iso3,
    shock_magnitude: row.shock_magnitude,
    shock_direction: row.shock_direction,
    shock_semantics: "scenario_input_not_observation",
    estimated_global_impact: null,
    reported_legacy_estimated_global_impact: row.estimated_global_impact ?? null,
    impact_semantics: "legacy_simulation_output_semantics_unverified_withheld_from_canonical_field",
    affected_countries: row.affected_countries ?? null,
    created_at: row.created_at ?? null,
  }));
  return apiData(normalized, {
    note: "legacy simulation impact values remain available for audit but are withheld from the canonical output until the simulation model contract is hardened",
  });
}

async function handleRiskRanking(sb: SupabaseClientLike, url: URL) {
  const limit = parseLimit(url, 50, 200);
  const domain = url.searchParams.get("domain");
  const { data: latest, error: latestError } = await sb.from("risk_ranking_predictions")
    .select("generation_batch_id")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;
  if (!latest) return apiData([], { note: "no ranking batch available; this does not imply zero risk" });

  let query = sb.from("risk_ranking_predictions")
    .select("country_iso3,domain,risk_probability,rank_position,factors,confidence_lower,confidence_upper,evidence_count,evidence_status,probability_semantics,base_rate_probability,calibration_trust,calibration_sample_size,source_snapshot_date,model_version,generated_at")
    .eq("generation_batch_id", latest.generation_batch_id)
    .order("rank_position", { ascending: true, nullsFirst: false })
    .limit(limit);
  if (domain) query = query.eq("domain", domain);
  const { data, error } = await query;
  if (error) throw error;

  const normalized = (data ?? []).map((row) => ({
    country_iso3: row.country_iso3,
    domain: row.domain,
    risk_score: row.evidence_status === "sufficient" ? row.risk_probability : null,
    probability_semantics: row.probability_semantics ?? "unknown",
    evidence_status: row.evidence_status ?? "unknown",
    rank_position: row.rank_position ?? null,
    momentum_score: row.factors?.momentum_score ?? null,
    volatility: row.factors?.volatility_index ?? null,
    confidence_interval: null,
    reported_legacy_interval: row.confidence_lower !== null || row.confidence_upper !== null
      ? [row.confidence_lower ?? null, row.confidence_upper ?? null]
      : null,
    interval_semantics: "legacy_interval_semantics_unverified_not_exported_as_confidence_interval",
    evidence_count: row.evidence_count ?? null,
    base_rate_probability: row.base_rate_probability ?? null,
    calibration_trust: row.calibration_trust ?? null,
    calibration_sample_size: row.calibration_sample_size ?? null,
    source_snapshot_date: row.source_snapshot_date ?? null,
    model_version: row.model_version ?? null,
    generated_at: row.generated_at ?? null,
  }));
  return apiData(normalized, {
    note: "risk_score may be an uncalibrated heuristic screen; inspect probability_semantics",
  });
}