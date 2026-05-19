import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Expose-Headers": "x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, x-request-id",
};

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

const READ_SCOPE = "read";
const WRITE_SCOPE = "write";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const resource = pathParts[1] || "";

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Helper: write tamper-evident audit row, regardless of outcome
  const writeAudit = async (params: {
    keyId: string | null;
    orgId: string | null;
    status: number;
    requestBody: string;
    responseBody: string;
  }) => {
    try {
      const { data: prev } = await supabaseAdmin
        .from("api_request_audit")
        .select("chain_hash")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const prevHash = prev?.chain_hash ?? "";
      const requestHash = await sha256(`${req.method}|${url.pathname}|${url.search}|${params.requestBody}`);
      const responseHash = await sha256(params.responseBody);
      const chainHash = await sha256(`${prevHash}|${requestHash}|${responseHash}|${params.status}|${requestId}`);
      await supabaseAdmin.from("api_request_audit").insert({
        api_key_id: params.keyId,
        org_id: params.orgId,
        endpoint: url.pathname.replace(/^\/public-api/, "") || "/",
        method: req.method,
        request_hash: requestHash,
        response_hash: responseHash,
        previous_chain_hash: prevHash || null,
        chain_hash: chainHash,
        response_status: params.status,
        latency_ms: Date.now() - startedAt,
      });
    } catch (e) {
      console.error("audit write failed", e);
    }
  };

  // ── Authenticate via API key ──────────────────────────────
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) {
    const body = JSON.stringify({ error: "Missing x-api-key header", request_id: requestId });
    await writeAudit({ keyId: null, orgId: null, status: 401, requestBody: "", responseBody: body });
    return new Response(body, { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId } });
  }

  const keyHash = await sha256(apiKey);
  const { data: keyRow } = await supabaseAdmin
    .from("api_keys")
    .select("id, org_id, rate_limit_per_minute, revoked, expires_at, scopes")
    .eq("key_hash", keyHash)
    .eq("revoked", false)
    .maybeSingle();

  if (!keyRow) {
    const body = JSON.stringify({ error: "Invalid or revoked API key", request_id: requestId });
    await writeAudit({ keyId: null, orgId: null, status: 403, requestBody: "", responseBody: body });
    return new Response(body, { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId } });
  }

  // Expiry enforcement
  if (keyRow.expires_at && new Date(keyRow.expires_at).getTime() < Date.now()) {
    const body = JSON.stringify({ error: "API key expired", expired_at: keyRow.expires_at, request_id: requestId });
    await writeAudit({ keyId: keyRow.id, orgId: keyRow.org_id, status: 403, requestBody: "", responseBody: body });
    return new Response(body, { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId } });
  }

  // Rate-limit enforcement (sliding 60-second window)
  const limit = keyRow.rate_limit_per_minute || 60;
  const { data: countRes } = await supabaseAdmin.rpc("count_api_requests_window", {
    _key_id: keyRow.id,
    _window_seconds: 60,
  });
  const used = (countRes as unknown as number) ?? 0;
  const remaining = Math.max(0, limit - used);
  const rateHeaders = {
    "x-ratelimit-limit": String(limit),
    "x-ratelimit-remaining": String(remaining),
    "x-ratelimit-reset": String(60),
    "x-request-id": requestId,
  };
  if (used >= limit) {
    const body = JSON.stringify({ error: "Rate limit exceeded", limit, window_seconds: 60, request_id: requestId });
    await writeAudit({ keyId: keyRow.id, orgId: keyRow.org_id, status: 429, requestBody: "", responseBody: body });
    return new Response(body, {
      status: 429,
      headers: { ...corsHeaders, ...rateHeaders, "Content-Type": "application/json", "Retry-After": "60" },
    });
  }

  // Scope enforcement: writes require explicit `write` scope
  const scopes = (keyRow.scopes as string[] | null) ?? [READ_SCOPE];
  const isWrite = req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS";
  if (isWrite && !scopes.includes(WRITE_SCOPE)) {
    const body = JSON.stringify({ error: "Insufficient scope: write required", scopes, request_id: requestId });
    await writeAudit({ keyId: keyRow.id, orgId: keyRow.org_id, status: 403, requestBody: "", responseBody: body });
    return new Response(body, { status: 403, headers: { ...corsHeaders, ...rateHeaders, "Content-Type": "application/json" } });
  }

  // Touch last_used_at (best-effort)
  supabaseAdmin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRow.id).then(() => {});

  const orgId = keyRow.org_id;

  // Capture body once for audit (clone, since handlers may also need it)
  let rawBody = "";
  if (isWrite) {
    try { rawBody = await req.clone().text(); } catch { /* ignore */ }
  }

  try {
    let res: Response;
    switch (resource) {
      case "signals":             res = await handleSignals(supabaseAdmin, url, orgId); break;
      case "decisions":           res = await handleDecisions(supabaseAdmin, url, req, orgId); break;
      case "outcomes":            res = await handleOutcomes(supabaseAdmin, url, orgId); break;
      case "priority-decisions":  res = await handlePriorityDecisions(supabaseAdmin, orgId); break;
      case "ml-predictions":      res = await handleMLPredictions(supabaseAdmin, url); break;
      case "propagation":         res = await handlePropagation(supabaseAdmin, url); break;
      case "simulations":         res = await handleSimulations(supabaseAdmin, url); break;
      case "risk-ranking":        res = await handleRiskRanking(supabaseAdmin, url); break;
      case "health":              res = await handleHealth(supabaseAdmin); break;
      case "domains":             res = await handleDomains(supabaseAdmin, url); break;
      default:
        res = json({
          api: "AICIS Public API",
          version: "1.2",
          docs: "https://aicis-divine-core.lovable.app/developers",
          endpoints: [
            "GET /signals", "GET /decisions", "POST /decisions",
            "GET /outcomes", "GET /priority-decisions",
            "GET /ml-predictions", "GET /propagation", "GET /simulations",
            "GET /risk-ranking", "GET /domains", "GET /health",
          ],
        });
    }

    const responseBody = await res.clone().text();
    await writeAudit({ keyId: keyRow.id, orgId, status: res.status, requestBody: rawBody, responseBody });

    // Merge rate-limit headers into successful response
    const merged = new Headers(res.headers);
    Object.entries(rateHeaders).forEach(([k, v]) => merged.set(k, v));
    return new Response(responseBody, { status: res.status, headers: merged });
  } catch (e) {
    console.error("Public API error:", e);
    const body = JSON.stringify({ error: (e as Error).message, request_id: requestId });
    await writeAudit({ keyId: keyRow.id, orgId, status: 500, requestBody: rawBody, responseBody: body });
    return new Response(body, { status: 500, headers: { ...corsHeaders, ...rateHeaders, "Content-Type": "application/json" } });
  }
});

// ── Handlers ─────────────────────────────────────────────

async function handleSignals(sb: any, url: URL, _orgId: string) {
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
  const category = url.searchParams.get("category");
  const minImpact = parseInt(url.searchParams.get("min_impact") || "0");

  let query = sb
    .from("global_signals")
    .select("id, title, category, impact_score, urgency_score, confidence_score, affected_sectors, source_trust_tier, affected_regions, latest_update_at, recommended_actions")
    .order("latest_update_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (category) query = query.eq("category", category);
  if (minImpact > 0) query = query.gte("impact_score", minImpact);

  const { data, error } = await query;
  if (error) throw error;

  const normalized = (data || []).map((s: any) => ({
    id: s.id,
    title: s.title,
    category: s.category,
    impact_score: s.impact_score,
    urgency: s.urgency_score,
    confidence_score: s.confidence_score,
    affected_sectors: s.affected_sectors,
    source_type: s.source_trust_tier,
    region: Array.isArray(s.affected_regions) ? s.affected_regions[0] : s.affected_regions,
    published_at: s.latest_update_at,
    recommendation: Array.isArray(s.recommended_actions) ? s.recommended_actions[0] : s.recommended_actions,
  }));

  return json({ data: normalized, count: normalized.length });
}

async function handleDecisions(sb: any, url: URL, req: Request, orgId: string) {
  if (req.method === "POST") {
    const body = await req.json();
    const { signal_summary, domain, severity_score } = body;
    if (!signal_summary || !domain) {
      return json({ error: "signal_summary and domain are required" }, 400);
    }

    const { data, error } = await sb
      .from("adi_decisions")
      .insert({
        signal_summary,
        domain,
        severity_score: severity_score || 50,
        signal_source: "api",
        status: "pending_review",
      })
      .select()
      .single();

    if (error) throw error;
    return json({ data }, 201);
  }

  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
  const status = url.searchParams.get("status");

  let query = sb
    .from("adi_decisions")
    .select("id, domain, signal_summary, severity_score, confidence, status, recommended_option_rank, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw error;

  return json({ data, count: data?.length || 0 });
}

async function handleOutcomes(sb: any, url: URL, _orgId: string) {
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);

  const { data, error } = await sb
    .from("decision_outcome_log")
    .select("id, signal_title, action_taken, outcome_success, impact_score, roi_estimate, net_value, evidence_type, evidence_quality_score, criticality_tier, created_at")
    .not("outcome_success", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const normalized = (data || []).map((o: any) => ({
    ...o,
    evidence_tier: o.criticality_tier || o.evidence_type || null,
  }));

  return json({ data: normalized, count: normalized.length });
}

async function handlePriorityDecisions(sb: any, _orgId: string) {
  // Get top signals by impact, enriched with cross-domain context
  const { data: signals, error } = await sb
    .from("global_signals")
    .select("id, title, category, impact_score, urgency_score, confidence_score, affected_sectors, recommended_actions, affected_regions, latest_update_at, status")
    .in("status", ["confirmed", "pending_enrichment", "enriched"])
    .order("impact_score", { ascending: false, nullsFirst: false })
    .limit(5);

  if (error) throw error;

  const priorities = (signals || []).map((s: any) => ({
    signal_id: s.id,
    title: s.title,
    category: s.category,
    priority_score: s.impact_score || 50,
    urgency_level: (s.urgency_score ?? 0) >= 80 ? "critical" : (s.impact_score ?? 0) >= 70 ? "high" : "medium",
    affected_domains: s.affected_sectors || [s.category],
    recommended_action: Array.isArray(s.recommended_actions) ? s.recommended_actions[0] : (s.recommended_actions || "Review and assess impact"),
    estimated_impact: (s.impact_score ?? 0) >= 80 ? "High" : (s.impact_score ?? 0) >= 50 ? "Medium" : "Low",
    region: Array.isArray(s.affected_regions) ? s.affected_regions[0] : s.affected_regions,
    published_at: s.latest_update_at,
  }));

  return json({ data: priorities, count: priorities.length });
}

async function handleHealth(sb: any) {
  const { data: logs } = await sb
    .from("automation_logs")
    .select("status, executed_at")
    .order("executed_at", { ascending: false })
    .limit(10);

  const errors = (logs || []).filter((l: any) => l.status === "error").length;
  const lastRun = logs?.[0]?.executed_at;

  return json({
    status: errors > 3 ? "degraded" : "healthy",
    last_automation_run: lastRun,
    recent_errors: errors,
    timestamp: new Date().toISOString(),
  });
}

async function handleDomains(sb: any, url: URL) {
  const { data, error } = await sb
    .from("country_performance_snapshots")
    .select("domain")
    .limit(1000);

  if (error) throw error;

  const domains = [...new Set((data || []).map((d: any) => d.domain))];
  return json({ data: domains, count: domains.length });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleMLPredictions(sb: any, url: URL) {
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
  const domain = url.searchParams.get("domain");
  const { data: latest } = await sb.from("risk_ml_predictions")
    .select("generation_batch_id").order("generated_at", { ascending: false }).limit(1).maybeSingle();
  if (!latest) return json({ data: [], count: 0 });
  let q = sb.from("risk_ml_predictions")
    .select("country_iso3, domain, risk_probability, horizon_days, model_version, generated_at")
    .eq("generation_batch_id", latest.generation_batch_id)
    .order("risk_probability", { ascending: false }).limit(limit);
  if (domain) q = q.eq("domain", domain);
  const { data, error } = await q;
  if (error) throw error;
  return json({ data, count: data?.length || 0 });
}

async function handlePropagation(sb: any, url: URL) {
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
  const domain = url.searchParams.get("domain");
  const { data: latest } = await sb.from("risk_propagation_score")
    .select("generation_batch_id").order("computed_at", { ascending: false }).limit(1).maybeSingle();
  if (!latest) return json({ data: [], count: 0 });
  let q = sb.from("risk_propagation_score")
    .select("origin_iso3, target_iso3, domain, propagation_score, hop_count, computed_at")
    .eq("generation_batch_id", latest.generation_batch_id)
    .order("propagation_score", { ascending: false }).limit(limit);
  if (domain) q = q.eq("domain", domain);
  const { data, error } = await q;
  if (error) throw error;
  return json({ data, count: data?.length || 0 });
}

async function handleSimulations(sb: any, url: URL) {
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
  const { data, error } = await sb.from("simulation_runs")
    .select("id, scenario_name, shock_domain, shock_iso3, shock_magnitude, shock_direction, estimated_global_impact, affected_countries, created_at")
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return json({ data, count: data?.length || 0 });
}

async function handleRiskRanking(sb: any, url: URL) {
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
  const domain = url.searchParams.get("domain");
  const { data: latest } = await sb.from("risk_ranking_predictions")
    .select("generation_batch_id").order("generated_at", { ascending: false }).limit(1).maybeSingle();
  if (!latest) return json({ data: [], count: 0 });
  let q = sb.from("risk_ranking_predictions")
    .select("country_iso3, domain, risk_score, rank_position, momentum_score, volatility, generated_at")
    .eq("generation_batch_id", latest.generation_batch_id)
    .order("rank_position", { ascending: true }).limit(limit);
  if (domain) q = q.eq("domain", domain);
  const { data, error } = await q;
  if (error) throw error;
  return json({ data, count: data?.length || 0 });
}
