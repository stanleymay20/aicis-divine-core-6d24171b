import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiChat } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_DIVISIONS = ["finance", "energy", "health", "food", "governance", "defense", "diplomacy", "crisis"];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "POST" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const body = await req.json().catch(() => ({}));
    const requestedDivisions = Array.isArray(body?.divisions)
      ? body.divisions.filter((value: unknown): value is string => typeof value === "string" && value.length <= 64).slice(0, 16)
      : [];
    const targetDivisions = requestedDivisions.length ? requestedDivisions : DEFAULT_DIVISIONS;
    const startTime = Date.now();

    console.log("Predicting risks:", { divisions: targetDivisions, user: user.id });

    const [recentEvents, anomalies, crises, threats, defensePosture] = await Promise.all([
      supabaseClient.from("intel_events").select("id,division,title,severity,confidence,published_at").in("division", targetDivisions).order("published_at", { ascending: false }).limit(40),
      supabaseClient.from("anomaly_detections").select("id,division,anomaly_type,severity,confidence,status,detected_at").in("division", targetDivisions).eq("status", "active").limit(40),
      supabaseClient.from("crisis_events").select("id,kind,region,severity,status,opened_at").in("status", ["monitoring", "escalated"]).limit(40),
      supabaseClient.from("threat_logs").select("id,threat_type,severity,location,description,created_at").eq("neutralized", false).limit(40),
      supabaseClient.from("defense_posture").select("*").order("threat_level", { ascending: false }).limit(20),
    ]);

    const evidence = {
      recent_events: recentEvents.data ?? [],
      active_anomalies: anomalies.data ?? [],
      active_crises: crises.data ?? [],
      active_threats: threats.data ?? [],
      defense_posture: defensePosture.data ?? [],
    };
    const evidenceCounts = {
      recent_events: evidence.recent_events.length,
      active_anomalies: evidence.active_anomalies.length,
      active_crises: evidence.active_crises.length,
      active_threats: evidence.active_threats.length,
      defense_posture_rows: evidence.defense_posture.length,
    };

    if (Object.values(evidenceCounts).every((count) => count === 0)) {
      return new Response(JSON.stringify({
        success: true,
        message: "No evidence available for a defensible risk forecast.",
        predictions: [],
        evidence_counts: evidenceCounts,
        execution_time_ms: Date.now() - startTime,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiResult = await aiChat({
      messages: [
        {
          role: "system",
          content: "You are AICIS Predictive Risk Analyzer. Produce forecasts only when supported by the supplied evidence. Never invent incidents, actors, locations, or measurements. Probabilities and impact scores are model estimates, not observed facts. Return valid JSON with shape {\"predictions\":[...]}. Each prediction must contain title, affected_divisions, probability (0-100), impact_score (0-100), risk_level (low|medium|high|critical), description, predicted_timeframe, confidence_level (0-100), indicators (array of evidence references or concise evidence statements), and mitigation_strategies (string). If evidence is insufficient, return fewer predictions or an empty array.",
        },
        {
          role: "user",
          content: `Forecast defensible risks for these AICIS divisions: ${targetDivisions.join(", ")}\n\nEvidence snapshot:\n${JSON.stringify(evidence).slice(0, 24000)}`,
        },
      ],
      responseFormat: { type: "json_object" },
      temperature: 0.1,
      maxTokens: 1800,
      timeoutMs: 15000,
    });

    let parsed: any;
    try {
      parsed = JSON.parse(aiResult.content);
    } catch {
      throw new Error("AI provider returned invalid structured risk output");
    }
    const predictions = Array.isArray(parsed?.predictions) ? parsed.predictions.slice(0, 5) : [];
    const results = [];

    for (const pred of predictions) {
      const probability = clampNumber(pred?.probability, 0, 100, 50);
      const impactScore = clampNumber(pred?.impact_score, 0, 100, 50);
      const confidence = clampNumber(pred?.confidence_level, 0, 100, 60);
      const riskLevel = ["low", "medium", "high", "critical"].includes(pred?.risk_level) ? pred.risk_level : deriveRiskLevel(probability, impactScore);
      const indicators = Array.isArray(pred?.indicators) ? pred.indicators.slice(0, 20) : [];
      if (!pred?.title || indicators.length === 0) continue;

      const { data: risk, error: insertError } = await supabaseClient
        .from("risk_predictions")
        .insert({
          prediction_type: "ai_forecast_grounded",
          affected_divisions: Array.isArray(pred.affected_divisions) && pred.affected_divisions.length ? pred.affected_divisions : targetDivisions,
          risk_level: riskLevel,
          probability,
          impact_score: impactScore,
          title: String(pred.title).slice(0, 300),
          description_md: String(pred.description ?? "Model forecast derived from current AICIS evidence."),
          indicators: {
            evidence_statements: indicators,
            evidence_counts: evidenceCounts,
            evidence_window: "current active/recent records",
          },
          mitigation_strategies_md: String(pred.mitigation_strategies ?? "Review source evidence and monitor leading indicators."),
          predicted_timeframe: String(pred.predicted_timeframe ?? "Unspecified").slice(0, 200),
          confidence_level: confidence,
          model_version: `${aiResult.provider}:${aiResult.model}`,
        })
        .select()
        .single();

      if (!insertError && risk) results.push(risk);
    }

    const executionTime = Date.now() - startTime;

    await supabaseClient.from("compliance_audit").insert({
      action_type: "risk_prediction",
      user_id: user.id,
      action_description: `Predicted ${results.length} grounded risks for ${targetDivisions.length} divisions`,
      compliance_status: "compliant",
      data_accessed: { divisions: targetDivisions, evidence_counts: evidenceCounts, model: aiResult.model, provider: aiResult.provider },
    });

    await supabaseClient.from("system_logs").insert({
      action: "risk_prediction",
      division: "system",
      user_id: user.id,
      log_level: "info",
      result: `Predicted ${results.length} grounded risks`,
      metadata: { divisions: targetDivisions, evidence_counts: evidenceCounts, execution_time_ms: executionTime, model: aiResult.model, provider: aiResult.provider },
    });

    return new Response(JSON.stringify({
      success: true,
      message: `Generated ${results.length} evidence-grounded risk predictions`,
      predictions: results,
      evidence_counts: evidenceCounts,
      model: aiResult.model,
      provider: aiResult.provider,
      execution_time_ms: executionTime,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Risk prediction error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: message === "Unauthorized" ? 401 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function deriveRiskLevel(probability: number, impact: number): string {
  const score = 0.5 * probability + 0.5 * impact;
  if (score >= 80) return "critical";
  if (score >= 65) return "high";
  if (score >= 40) return "medium";
  return "low";
}
