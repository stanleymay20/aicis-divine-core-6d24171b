import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUserOrTrustedWorker } from "../_shared/auth.ts";
import { resilientCall, structuredLog, handleCors, errorResponse, jsonResponse, corsHeaders } from "../_shared/resilience.ts";
import { aiChat } from "../_shared/ai-gateway.ts";

const FN = "adi-analyze";
const clamp = (n: unknown, min: number, max: number, fallback: number) => {
  const value = Number(n);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const start = Date.now();

  try {
    const auth = await requireUserOrTrustedWorker(req, corsHeaders);
    if (auth.response) return auth.response;

    const userId = auth.via === "user" && auth.ctx?.user?.id
      ? String(auth.ctx.user.id)
      : auth.via === "cron"
      ? "system-cron"
      : "system-service-role";

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const { mode = "auto", signal_id, domain, region, custom_query } = body;
    structuredLog("info", FN, `ADI analysis: mode=${mode}`, { auth_via: auth.via, userId, domain, region });

    let signals: any[] = [];
    if (mode === "manual" && typeof custom_query === "string" && custom_query.trim()) {
      signals = [{
        type: "manual_query",
        summary: custom_query.trim().slice(0, 4000),
        severity: 5,
        domain: domain || "general",
        region: region || null,
        evidence_class: "user_supplied_unverified_premise",
      }];
    } else if (signal_id) {
      const [{ data: crisis }, { data: conflict }, { data: anomaly }] = await Promise.all([
        supabase.from("crisis_events").select("*").eq("id", signal_id).maybeSingle(),
        supabase.from("conflict_signals").select("*").eq("id", signal_id).maybeSingle(),
        supabase.from("anomaly_detections").select("*").eq("id", signal_id).maybeSingle(),
      ]);
      if (crisis) signals.push({ ...crisis, type: "crisis_event", evidence_class: "persisted_observation" });
      else if (conflict) signals.push({ ...conflict, type: "conflict_signal", evidence_class: "persisted_observation" });
      else if (anomaly) signals.push({ ...anomaly, type: "anomaly", evidence_class: "persisted_observation" });
    } else {
      const [{ data: crises }, { data: conflicts }, { data: anomalies }] = await Promise.all([
        supabase.from("crisis_events").select("*").gte("severity", 6).in("status", ["active", "escalated", "monitoring"]).order("opened_at", { ascending: false }).limit(5),
        supabase.from("conflict_signals").select("*").eq("status", "active").gte("escalation_probability", 40).order("created_at", { ascending: false }).limit(5),
        supabase.from("anomaly_detections").select("*").in("severity", ["high", "critical"]).eq("status", "active").order("created_at", { ascending: false }).limit(5),
      ]);
      if (crises) signals.push(...crises.map((c) => ({ ...c, type: "crisis_event", evidence_class: "persisted_observation" })));
      if (conflicts) signals.push(...conflicts.map((c) => ({ ...c, type: "conflict_signal", evidence_class: "persisted_observation" })));
      if (anomalies) signals.push(...anomalies.map((a) => ({ ...a, type: "anomaly", evidence_class: "persisted_observation" })));
    }

    if (signals.length === 0) return jsonResponse({ success: true, message: "No high-severity signals to analyze", decisions: [] });

    const decisions: any[] = [];
    for (const signal of signals.slice(0, 3)) {
      const signalSummary = signal.type === "manual_query"
        ? signal.summary
        : `${signal.type}: ${signal.kind || signal.anomaly_type || signal.conflict_type || "unknown"} in ${signal.region || signal.country_iso3 || "unknown region"}, severity: ${signal.severity ?? signal.escalation_probability ?? "N/A"}`;

      const evidenceEnvelope = {
        evidence_class: signal.evidence_class || "persisted_observation",
        signal_id: signal.id || null,
        signal_type: signal.type,
        summary: signalSummary,
        region: signal.region || null,
        country_iso3: signal.country_iso3 || null,
        domain: signal.domain || domain || "general",
        measured_severity: signal.severity ?? null,
        escalation_probability: signal.escalation_probability ?? null,
        metrics: signal.metrics || null,
        baseline_metrics: signal.baseline_metrics || null,
        deviation_percentage: signal.deviation_percentage ?? null,
      };

      const aiResult = await resilientCall(
        `${FN}:ai`,
        async () => aiChat({
          messages: [{
            role: "system",
            content: `You are ADI, AICIS's decision advisory co-pilot operating strictly in SHADOW MODE. Generate decision hypotheses for human analyst review. Use only the supplied evidence envelope. Never present an option as a validated directive, observed fact, guaranteed outcome, or autonomous action. If evidence_class says user_supplied_unverified_premise, state that the premise is unverified and do not transform it into a fact. Return ONLY valid JSON with exactly three options: {"options":[{"rank":1,"action":"...","description":"...","effectiveness_pct":0,"risk_level":"low|medium|high","risk_assessment":"...","tradeoffs":"...","timeframe":"immediate|7_days|30_days|90_days","resources_required":"minimal|moderate|significant|massive"}],"reasoning":"...","confidence":0,"domain":"..."}. Effectiveness and confidence are model estimates, not measurements.`,
          }, {
            role: "user",
            content: `Evidence envelope:\n${JSON.stringify(evidenceEnvelope, null, 2)}\n\nGenerate exactly three conservative decision hypotheses grounded only in this evidence.`,
          }],
          responseFormat: { type: "json_object" },
          temperature: 0.2,
          maxTokens: 1400,
          timeoutMs: 20000,
        }),
        { maxRetries: 1, timeoutMs: 25000 },
      );

      let parsed: any;
      try {
        parsed = JSON.parse(aiResult.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      } catch {
        structuredLog("warn", FN, "Failed to parse decision AI response", { raw: aiResult.content.slice(0, 200) });
        continue;
      }
      if (!Array.isArray(parsed.options) || parsed.options.length !== 3) {
        structuredLog("warn", FN, "Decision AI did not return exactly three options");
        continue;
      }

      const options = parsed.options.map((option: any, index: number) => ({
        rank: index + 1,
        action: String(option.action || `Option ${index + 1}`).slice(0, 200),
        description: String(option.description || "").slice(0, 1200),
        effectiveness_pct: clamp(option.effectiveness_pct, 0, 100, 50),
        risk_level: ["low", "medium", "high"].includes(option.risk_level) ? option.risk_level : "medium",
        risk_assessment: String(option.risk_assessment || "Uncertainty requires analyst review").slice(0, 800),
        tradeoffs: String(option.tradeoffs || "Not established").slice(0, 800),
        timeframe: ["immediate", "7_days", "30_days", "90_days"].includes(option.timeframe) ? option.timeframe : "30_days",
        resources_required: ["minimal", "moderate", "significant", "massive"].includes(option.resources_required) ? option.resources_required : "moderate",
        evidence_basis: evidenceEnvelope,
        output_class: "shadow_mode_hypothesis",
      }));

      const evidenceLabel = signal.evidence_class === "user_supplied_unverified_premise"
        ? "Unverified user-supplied premise"
        : "Persisted AICIS observation";
      const { data: decision, error } = await supabase.from("adi_decisions").insert({
        signal_source: signal.type,
        signal_id: signal.id || null,
        signal_summary: signalSummary,
        region: signal.region || null,
        country_iso3: signal.country_iso3 || null,
        domain: String(parsed.domain || signal.domain || "general").slice(0, 100),
        severity_score: clamp(signal.severity ?? signal.escalation_probability, 0, 100, 5),
        options,
        recommended_option_rank: 1,
        reasoning_md: `**Evidence status:** ${evidenceLabel}.\n\n${String(parsed.reasoning || "").slice(0, 5000)}\n\n> SHADOW MODE: AI-assisted hypothesis for human review; not validated intelligence or an autonomous directive. Provider: ${aiResult.provider}; model: ${aiResult.model}.`,
        confidence: Math.min(clamp(parsed.confidence, 0, 95, 60), signal.type === "manual_query" ? 60 : 90) / 100,
        status: "pending",
      }).select().single();

      if (error || !decision) {
        structuredLog("warn", FN, `Insert failed: ${error?.message || "unknown"}`);
        continue;
      }
      decisions.push(decision);

      if (signal.type === "manual_query") continue;

      const topOption = options[0];
      const scenarioAI = await resilientCall(
        `${FN}:scenarios`,
        async () => aiChat({
          messages: [{
            role: "system",
            content: `Generate exactly three model-simulated counterfactuals: best_case, baseline, worst_case. These numbers are hypothetical sensitivity estimates, NOT observed forecasts. Use only the supplied evidence and decision hypothesis. Return ONLY valid JSON: {"scenarios":[{"type":"best_case|baseline|worst_case","name":"...","stability_delta_30d":0,"stability_delta_60d":0,"stability_delta_90d":0,"confidence":0,"reasoning":"..."}]}.`,
          }, {
            role: "user",
            content: `Evidence: ${JSON.stringify(evidenceEnvelope)}\nDecision hypothesis: ${JSON.stringify(topOption)}`,
          }],
          responseFormat: { type: "json_object" },
          temperature: 0.25,
          maxTokens: 1000,
          timeoutMs: 15000,
        }),
        { maxRetries: 0, timeoutMs: 18000 },
      ).catch(() => null);

      if (scenarioAI) {
        let scenarioParsed: any = null;
        try { scenarioParsed = JSON.parse(scenarioAI.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()); } catch { /* malformed simulation is discarded */ }
        const scenarios = Array.isArray(scenarioParsed?.scenarios) ? scenarioParsed.scenarios : [];
        const requiredTypes = ["best_case", "baseline", "worst_case"];
        const uniqueTypes = new Set(scenarios.map((s: any) => s?.type));
        if (scenarios.length === 3 && requiredTypes.every((type) => uniqueTypes.has(type))) {
          for (const sc of scenarios) {
            if (!requiredTypes.includes(sc.type)) continue;
            await supabase.from("adi_scenarios").insert({
              decision_id: decision.id,
              scenario_name: String(sc.name || `${sc.type} — ${topOption.action}`).slice(0, 250),
              scenario_type: sc.type,
              input_params: {
                action: topOption.action,
                timeframe: topOption.timeframe,
                evidence: evidenceEnvelope,
                simulation_class: "llm_hypothetical_sensitivity",
                provider: scenarioAI.provider,
                model: scenarioAI.model,
              },
              projection_30d: { stability_delta: clamp(sc.stability_delta_30d, -50, 50, 0), estimate_type: "simulated_not_observed" },
              projection_60d: { stability_delta: clamp(sc.stability_delta_60d, -70, 70, 0), estimate_type: "simulated_not_observed" },
              projection_90d: { stability_delta: clamp(sc.stability_delta_90d, -100, 100, 0), estimate_type: "simulated_not_observed" },
              confidence: clamp(sc.confidence, 0, 80, 40) / 100,
              reasoning_md: `${String(sc.reasoning || "").slice(0, 3000)}\n\n> SIMULATION ONLY: hypothetical sensitivity estimate, not an observed or validated forecast.`,
              created_by: userId.startsWith("system-") ? null : userId,
            });
          }
        } else {
          structuredLog("warn", FN, "Discarded scenario output: exact best/baseline/worst set required");
        }
      }
    }

    await supabase.from("system_logs").insert({
      action: "adi_analysis",
      division: "adi",
      user_id: userId.startsWith("system-") ? null : userId,
      log_level: "info",
      result: `Generated ${decisions.length} shadow-mode decision analyses`,
      metadata: { decisions_count: decisions.length, mode, execution_time_ms: Date.now() - start, output_class: "shadow_mode_hypothesis", auth_via: auth.via },
    });

    structuredLog("info", FN, `Complete: ${decisions.length} decisions`, undefined, start);
    return jsonResponse({ success: true, decisions, execution_time_ms: Date.now() - start, mode: "shadow" });
  } catch (e) {
    structuredLog("error", FN, (e as Error).message, undefined, start);
    return errorResponse(e);
  }
});
