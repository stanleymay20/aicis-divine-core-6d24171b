import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiChat } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function classifySignalDensity(counts: { snapshots: number; anomalies: number; alerts: number; crises: number }): "strong" | "moderate" | "weak" | "insufficient" {
  const total = counts.snapshots + counts.anomalies + counts.alerts + counts.crises;
  const sources = [counts.snapshots > 0, counts.anomalies > 0, counts.alerts > 0, counts.crises > 0].filter(Boolean).length;
  if (total >= 30 && sources >= 3) return "strong";
  if (total >= 10 && sources >= 2) return "moderate";
  if (total >= 3) return "weak";
  return "insufficient";
}

const PRIORITIES = new Set(["critical", "high", "medium", "low"]);
const URGENCIES = new Set(["immediate", "24h", "7d", "30d", "monitor"]);

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { country_iso3, domain } = await req.json().catch(() => ({}));

    let snapshotQuery = supabase
      .from("country_performance_snapshots")
      .select("iso3, domain, performance_index, momentum_score, risk_pressure_score, systemic_fragility_score, forecast_direction, confidence_score, structural_break_count")
      .order("risk_pressure_score", { ascending: false })
      .limit(50);
    if (country_iso3) snapshotQuery = snapshotQuery.eq("iso3", country_iso3);
    if (domain) snapshotQuery = snapshotQuery.eq("domain", domain);

    const anomalyQuery = supabase
      .from("anomaly_detections")
      .select("division, anomaly_type, severity, description, deviation_percentage, detected_at")
      .eq("status", "active")
      .order("detected_at", { ascending: false })
      .limit(20);

    const alertQuery = supabase
      .from("critical_alerts")
      .select("headline, level, country, severity, event_type, triggered_at")
      .eq("acknowledged", false)
      .order("triggered_at", { ascending: false })
      .limit(15);

    const crisisQuery = supabase
      .from("crisis_events")
      .select("region, kind, severity, status, details_md")
      .neq("status", "resolved")
      .order("severity", { ascending: false })
      .limit(10);

    const [snapshots, anomalies, alerts, crises] = await Promise.all([
      snapshotQuery, anomalyQuery, alertQuery, crisisQuery
    ]);

    const signalCounts = {
      snapshots: (snapshots.data || []).length,
      anomalies: (anomalies.data || []).length,
      alerts: (alerts.data || []).length,
      crises: (crises.data || []).length,
    };

    const evidenceDensity = classifySignalDensity(signalCounts);

    if (evidenceDensity === "insufficient") {
      return new Response(JSON.stringify({
        ok: true,
        recommendations: [],
        global_assessment: "Insufficient signal data available to generate actionable recommendations. The system is in monitor-only mode for the requested scope.",
        signal_quality: "insufficient",
        evidence_density: "insufficient",
        outcome_trained: false,
        generated_at: new Date().toISOString(),
        scope: { country_iso3: country_iso3 || "global", domain: domain || "all" },
        signal_counts: signalCounts,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const signalContext = {
      performance_snapshots: snapshots.data || [],
      active_anomalies: anomalies.data || [],
      unacknowledged_alerts: alerts.data || [],
      active_crises: crises.data || [],
      request_scope: { country_iso3: country_iso3 || "global", domain: domain || "all" },
    };

    const systemPrompt = `You are the AICIS Decision Recommendation Engine, an AI-assisted advisory layer over AICIS evidence.

EVIDENCE DENSITY: ${evidenceDensity}
${evidenceDensity === "weak" ? "Signal evidence is sparse. Be conservative and prefer monitor recommendations." : ""}

Rules:
- Use ONLY the supplied AICIS evidence.
- Every recommendation must cite concrete evidence in signal_summary.
- Separate observed evidence from AI interpretation.
- Recommendations are advisory, not autonomous decisions.
- Confidence is heuristic, not a calibrated probability.
- Never invent countries, metrics, incidents, or outcomes.
- If evidence is weak, prefer monitor.
- Return STRICT JSON only in this shape:
{"recommendations":[{"id":"REC-001","priority":"critical|high|medium|low","title":"...","domain":"...","affected_countries":["ISO3"],"signal_summary":"...","ai_reasoning":"...","recommended_action":"...","alternatives":["..."],"confidence":0,"urgency":"immediate|24h|7d|30d|monitor","expected_impact":"...","risk_if_ignored":"..."}],"global_assessment":"...","signal_quality":"strong|moderate|weak|insufficient"}`;

    const userPrompt = `Analyze these AICIS signals and generate at most 8 recommendations.\n\n${JSON.stringify(signalContext, null, 2)}`;

    const ai = await aiChat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      responseFormat: { type: "json_object" },
      timeoutMs: 25_000,
    });

    let parsed: any;
    try { parsed = JSON.parse(ai.content); }
    catch { throw new Error("AI did not return valid structured recommendations"); }

    const confidenceCap = evidenceDensity === "weak" ? 75 : evidenceDensity === "moderate" ? 85 : 92;
    const cappedRecs = (Array.isArray(parsed.recommendations) ? parsed.recommendations : [])
      .slice(0, 8)
      .filter((r: any) => r && typeof r === "object" && typeof r.title === "string" && typeof r.signal_summary === "string" && typeof r.recommended_action === "string")
      .map((r: any, index: number) => {
        const rawConfidence = Number(r.confidence);
        const confidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(confidenceCap, rawConfidence)) : 0;
        return {
          id: typeof r.id === "string" && r.id ? r.id.slice(0, 40) : `REC-${String(index + 1).padStart(3, "0")}`,
          priority: PRIORITIES.has(r.priority) ? r.priority : "medium",
          title: r.title.slice(0, 300),
          domain: typeof r.domain === "string" ? r.domain.slice(0, 80) : (domain || "system"),
          affected_countries: Array.isArray(r.affected_countries) ? r.affected_countries.filter((c: any) => typeof c === "string" && /^[A-Z]{3}$/.test(c)).slice(0, 20) : [],
          signal_summary: r.signal_summary.slice(0, 2000),
          ai_reasoning: typeof r.ai_reasoning === "string" ? r.ai_reasoning.slice(0, 2000) : "",
          recommended_action: r.recommended_action.slice(0, 2000),
          alternatives: Array.isArray(r.alternatives) ? r.alternatives.filter((a: any) => typeof a === "string").slice(0, 5).map((a: string) => a.slice(0, 500)) : [],
          confidence,
          urgency: URGENCIES.has(r.urgency) ? r.urgency : "monitor",
          expected_impact: typeof r.expected_impact === "string" ? r.expected_impact.slice(0, 1000) : "",
          risk_if_ignored: typeof r.risk_if_ignored === "string" ? r.risk_if_ignored.slice(0, 1000) : "",
        };
      });

    const globalAssessment = typeof parsed.global_assessment === "string" ? parsed.global_assessment.slice(0, 4000) : "No global assessment returned.";
    const signalQuality = ["strong", "moderate", "weak", "insufficient"].includes(parsed.signal_quality) ? parsed.signal_quality : evidenceDensity;

    const runPayload = {
      scope_country_iso3: country_iso3 || "global",
      scope_domain: domain || "all",
      evidence_density: evidenceDensity,
      signal_counts: signalCounts,
      model_used: ai.model,
      recommendation_count: cappedRecs.length,
      global_assessment: globalAssessment,
      recommendations_payload: cappedRecs,
      outcome_trained: false,
    };

    await Promise.all([
      supabase.from("ai_decision_logs").insert({
        division_key: domain || "system",
        model_name: ai.model,
        input_summary: `Decision recommendation for ${country_iso3 || "global"} / ${domain || "all domains"}`,
        output_summary: globalAssessment,
        confidence: cappedRecs[0]?.confidence || 0,
        explanation: { signal_counts: signalCounts, evidence_density: evidenceDensity, provider: ai.provider, model: ai.model, advisory_only: true },
      }),
      supabase.from("decision_recommendation_runs").insert(runPayload),
    ]);

    return new Response(JSON.stringify({
      ok: true,
      recommendations: cappedRecs,
      global_assessment: globalAssessment,
      signal_quality: signalQuality,
      evidence_density: evidenceDensity,
      outcome_trained: false,
      provider: ai.provider,
      model: ai.model,
      generated_at: new Date().toISOString(),
      scope: { country_iso3: country_iso3 || "global", domain: domain || "all" },
      signal_counts: signalCounts,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Decision recommend error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
