// AICIS Relevance Engine v1 — score-relevance
// Scores a global signal's relevance to an organization using either an
// OpenAI-compatible model endpoint OR a deterministic fallback rule engine.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PROMPT_VERSION = "aicis-relevance-v1";
const FALLBACK_MODEL = "fallback-rules-v1";

interface SignalPayload {
  signal_id?: string;
  signal_title?: string;
  signal_summary?: string;
  source?: string;
  country?: string;
  domain?: string;
  severity?: string | number;
  confidence?: number;
  affected_entities?: any[];
}

interface OrgContext {
  organization_id?: string;
  name?: string;
  industries?: string[];
  countries?: string[];
  domains?: string[];
  keywords?: string[];
  watched_entities?: string[];
  risk_priorities?: string[];
  operating_regions?: string[];
  business_functions?: string[];
  alert_preferences?: Record<string, unknown>;
}

function structuredLog(level: string, msg: string, meta?: Record<string, unknown>) {
  const entry = {
    level,
    fn: "score-relevance",
    msg,
    ts: new Date().toISOString(),
    ...meta,
  };
  console.log(JSON.stringify(entry));
}

function severityToScore(sev: unknown): number {
  if (typeof sev === "number") return Math.max(0, Math.min(100, sev));
  if (!sev) return 40;
  const s = String(sev).toLowerCase();
  if (s.includes("crit")) return 95;
  if (s.includes("high")) return 80;
  if (s.includes("med") || s.includes("mod")) return 55;
  if (s.includes("low")) return 30;
  if (s.includes("info") || s.includes("noise")) return 15;
  const n = Number(s);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 40;
}

function tierFromScore(score: number): string {
  if (score >= 85) return "critical";
  if (score >= 70) return "high";
  if (score >= 50) return "moderate";
  if (score >= 30) return "low";
  return "noise";
}

function fallbackScore(signal: SignalPayload, org: OrgContext) {
  const sevScore = severityToScore(signal.severity);
  const conf = typeof signal.confidence === "number"
    ? Math.max(0, Math.min(100, signal.confidence > 1 ? signal.confidence : signal.confidence * 100))
    : 60;

  const reasons: string[] = [];
  const contributors: Array<{ kind: string; label: string; weight: number; matched?: string[] }> = [];
  let score = 0;
  // Severity contributes up to 40
  const sevContrib = (sevScore / 100) * 40;
  score += sevContrib;
  reasons.push(`severity ${Math.round(sevScore)}`);
  contributors.push({ kind: "severity", label: `Severity ${Math.round(sevScore)}`, weight: Math.round(sevContrib) });

  // Confidence contributes up to 15
  const confContrib = (conf / 100) * 15;
  score += confContrib;
  contributors.push({ kind: "confidence", label: `Confidence ${Math.round(conf)}`, weight: Math.round(confContrib) });

  // Country match: +20
  const sigCountry = (signal.country || "").toLowerCase();
  const orgCountries = (org.countries || []).map((c) => c.toLowerCase());
  const orgRegions = (org.operating_regions || []).map((c) => c.toLowerCase());
  if (sigCountry && (orgCountries.includes(sigCountry) || orgRegions.some((r) => sigCountry.includes(r) || r.includes(sigCountry)))) {
    score += 20;
    reasons.push(`country match (${signal.country})`);
    contributors.push({ kind: "country", label: `Country: ${signal.country}`, weight: 20, matched: [signal.country!] });
  }

  // Domain match: +15
  const sigDomain = (signal.domain || "").toLowerCase();
  const orgDomains = [
    ...(org.domains || []),
    ...(org.industries || []),
  ].map((d) => d.toLowerCase());
  const matchedDomains = orgDomains.filter((d) => d && (d === sigDomain || sigDomain.includes(d) || d.includes(sigDomain)));
  if (sigDomain && matchedDomains.length > 0) {
    score += 15;
    reasons.push(`domain match (${signal.domain})`);
    contributors.push({ kind: "domain", label: `Domain: ${signal.domain}`, weight: 15, matched: matchedDomains });
  }

  // Affected entities match: +10
  const watched = (org.watched_entities || []).map((e) => e.toLowerCase());
  const affected = (signal.affected_entities || [])
    .map((e: any) => (typeof e === "string" ? e : e?.name || ""))
    .filter(Boolean)
    .map((e: string) => e.toLowerCase());
  const entityHits = affected.filter((e) => watched.includes(e));
  if (entityHits.length > 0) {
    score += 10;
    reasons.push(`${entityHits.length} watched entity match`);
    contributors.push({ kind: "entity", label: `Watched entities (${entityHits.length})`, weight: 10, matched: entityHits });
  }

  // Keyword hits in title/summary: up to +15
  const keywords = (org.keywords || []).map((k) => k.toLowerCase()).filter(Boolean);
  const priorities = (org.risk_priorities || []).map((k) => k.toLowerCase()).filter(Boolean);
  const text = `${signal.signal_title || ""} ${signal.signal_summary || ""}`.toLowerCase();
  const kwHits = keywords.filter((k) => text.includes(k));
  const prHits = priorities.filter((k) => text.includes(k));
  if (kwHits.length > 0) {
    const w = Math.min(15, kwHits.length * 5);
    score += w;
    reasons.push(`keywords: ${kwHits.slice(0, 3).join(", ")}`);
    contributors.push({ kind: "keyword", label: `Keywords (${kwHits.length})`, weight: w, matched: kwHits });
  }
  if (prHits.length > 0) {
    const w = Math.min(10, prHits.length * 5);
    score += w;
    reasons.push(`risk priorities: ${prHits.slice(0, 2).join(", ")}`);
    contributors.push({ kind: "risk_priority", label: `Risk priority (${prHits.length})`, weight: w, matched: prHits });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const tier = tierFromScore(score);
  const why = reasons.length > 0
    ? `Scored ${score}/100 based on ${reasons.join("; ")}.`
    : `Scored ${score}/100 from severity and confidence; no organization-specific match found.`;

  const action = tier === "critical"
    ? "Escalate to leadership within 1 hour and trigger contingency review."
    : tier === "high"
    ? "Assign owner today and schedule mitigation review within 24 hours."
    : tier === "moderate"
    ? "Add to weekly risk review; monitor for escalation."
    : tier === "low"
    ? "Log for trend tracking; no immediate action required."
    : "Archive — below relevance threshold.";

  return {
    relevance_score: score,
    relevance_tier: tier,
    explanation: why,
    why_this_matters: reasons.length
      ? `This signal intersects your operational footprint via ${reasons.slice(1).join(", ") || "severity"}.`
      : `Generic global signal; no direct operational intersection detected.`,
    recommended_action: action,
    confidence_score: Math.round(conf * 0.7 + (entityHits.length || kwHits.length ? 20 : 5)),
    model_used: FALLBACK_MODEL,
    prompt_version: PROMPT_VERSION,
    used_fallback: true,
    match_contributors: contributors,
  };
}

async function modelScore(
  endpoint: string,
  apiKey: string | undefined,
  signal: SignalPayload,
  org: OrgContext,
) {
  const sys = `You are AICIS Relevance Engine v1. Score how relevant a global signal is to an organization on 0-100. Reply ONLY with compact JSON: {"relevance_score":number,"relevance_tier":"critical|high|moderate|low|noise","explanation":string,"why_this_matters":string,"recommended_action":string,"confidence_score":number}`;
  const user = JSON.stringify({ signal, organization: org });

  const res = await fetch(endpoint.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: Deno.env.get("AICIS_MODEL_NAME") || "gpt-4o-mini",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`model endpoint ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("model returned empty content");
  const parsed = JSON.parse(content);
  return {
    relevance_score: Number(parsed.relevance_score) || 0,
    relevance_tier: parsed.relevance_tier || tierFromScore(Number(parsed.relevance_score) || 0),
    explanation: parsed.explanation || "",
    why_this_matters: parsed.why_this_matters || "",
    recommended_action: parsed.recommended_action || "",
    confidence_score: Number(parsed.confidence_score) || 60,
    model_used: data.model || "openai-compatible",
    prompt_version: PROMPT_VERSION,
    used_fallback: false,
    match_contributors: [],
  };
}

Deno.serve(async (req) => {
  const started = Date.now();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const signal: SignalPayload = body.signal || body;
    const org: OrgContext = body.organization_context || body.organization || {};
    const organization_id: string | null = body.organization_id || org.organization_id || null;

    if (!signal || (!signal.signal_id && !signal.signal_title)) {
      return new Response(
        JSON.stringify({ ok: false, error: "signal payload required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const endpoint = Deno.env.get("AICIS_MODEL_ENDPOINT");
    const apiKey = Deno.env.get("AICIS_MODEL_API_KEY");

    let result;
    let notice: string | null = null;
    if (endpoint) {
      try {
        result = await modelScore(endpoint, apiKey, signal, org);
        structuredLog("info", "model_score_ok", { model: result.model_used, ms: Date.now() - started });
      } catch (err) {
        structuredLog("warn", "model_score_failed_using_fallback", { error: String(err) });
        result = fallbackScore(signal, org);
        notice = "Model endpoint failed; used fallback rules.";
      }
    } else {
      result = fallbackScore(signal, org);
      notice = "Using fallback relevance scoring. Connect model endpoint for AI scoring.";
      structuredLog("info", "fallback_score_ok", { score: result.relevance_score, tier: result.relevance_tier });
    }

    // Persist with service role
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const insertPayload = {
      signal_id: signal.signal_id || null,
      organization_id,
      signal_title: signal.signal_title || null,
      signal_summary: signal.signal_summary || null,
      source: signal.source || null,
      country: signal.country || null,
      domain: signal.domain || null,
      severity: signal.severity ? String(signal.severity) : null,
      confidence: typeof signal.confidence === "number" ? signal.confidence : null,
      affected_entities: signal.affected_entities || [],
      organization_context: org,
      relevance_score: result.relevance_score,
      relevance_tier: result.relevance_tier,
      explanation: result.explanation,
      why_this_matters: result.why_this_matters,
      recommended_action: result.recommended_action,
      confidence_score: result.confidence_score,
      model_used: result.model_used,
      prompt_version: result.prompt_version,
    };

    const { data: row, error } = await supabase
      .from("aicis_relevance_evaluations")
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      structuredLog("error", "db_insert_failed", { error: error.message });
      return new Response(
        JSON.stringify({ ok: false, error: error.message, ...result, notice }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        evaluation_id: row.id,
        ...result,
        notice,
        duration_ms: Date.now() - started,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    structuredLog("error", "unhandled", { error: String(err) });
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
