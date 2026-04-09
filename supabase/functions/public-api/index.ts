import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  // Edge function path: /public-api/{resource}
  // pathParts after filter: ["public-api", resource, ...]
  const resource = pathParts[1] || "";
  const subResource = pathParts[2] || "";

  // --- Authenticate via API key ---
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) {
    return json({ error: "Missing x-api-key header" }, 401);
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const keyHash = await hashKey(apiKey);

  const { data: keyRow, error: keyErr } = await supabaseAdmin
    .from("api_keys")
    .select("id, org_id, rate_limit_per_minute, revoked, last_used_at")
    .eq("key_hash", keyHash)
    .eq("revoked", false)
    .single();

  if (keyErr || !keyRow) {
    return json({ error: "Invalid or revoked API key" }, 403);
  }

  // Update last_used_at
  await supabaseAdmin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyRow.id);

  const orgId = keyRow.org_id;

  try {
    switch (resource) {
      case "signals":
        return await handleSignals(supabaseAdmin, url, orgId);
      case "decisions":
        return await handleDecisions(supabaseAdmin, url, req, orgId);
      case "outcomes":
        return await handleOutcomes(supabaseAdmin, url, orgId);
      case "priority-decisions":
        return await handlePriorityDecisions(supabaseAdmin, orgId);
      case "health":
        return await handleHealth(supabaseAdmin);
      case "domains":
        return await handleDomains(supabaseAdmin, url);
      default:
        return json({
          api: "AICIS Public API",
          version: "1.0",
          endpoints: [
            "GET /signals",
            "GET /decisions",
            "POST /decisions",
            "GET /outcomes",
            "GET /priority-decisions",
            "GET /domains",
            "GET /health",
          ],
        });
    }
  } catch (e) {
    console.error("Public API error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

// ── Handlers ─────────────────────────────────────────────

async function handleSignals(sb: any, url: URL, _orgId: string) {
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
  const category = url.searchParams.get("category");
  const minImpact = parseInt(url.searchParams.get("min_impact") || "0");

  let query = sb
    .from("global_signals")
    .select("id, title, category, impact_score, urgency, confidence_score, affected_sectors, source_type, region, published_at, recommendation")
    .order("published_at", { ascending: false })
    .limit(limit);

  if (category) query = query.eq("category", category);
  if (minImpact > 0) query = query.gte("impact_score", minImpact);

  const { data, error } = await query;
  if (error) throw error;

  return json({ data, count: data?.length || 0 });
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
    .select("id, signal_title, action_taken, outcome_success, impact_score, roi_estimate, net_value, evidence_tier, created_at")
    .not("outcome_success", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return json({ data, count: data?.length || 0 });
}

async function handlePriorityDecisions(sb: any, _orgId: string) {
  // Get top signals by impact, enriched with cross-domain context
  const { data: signals, error } = await sb
    .from("global_signals")
    .select("id, title, category, impact_score, urgency, confidence_score, affected_sectors, recommendation, region, published_at")
    .in("status", ["confirmed", "pending_enrichment", "enriched"])
    .order("impact_score", { ascending: false })
    .limit(5);

  if (error) throw error;

  const priorities = (signals || []).map((s: any) => ({
    signal_id: s.id,
    title: s.title,
    category: s.category,
    priority_score: s.impact_score || 50,
    urgency_level: s.urgency === "critical" ? "critical" : s.impact_score >= 70 ? "high" : "medium",
    affected_domains: s.affected_sectors || [s.category],
    recommended_action: s.recommendation || "Review and assess impact",
    estimated_impact: s.impact_score >= 80 ? "High" : s.impact_score >= 50 ? "Medium" : "Low",
    region: s.region,
    published_at: s.published_at,
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
