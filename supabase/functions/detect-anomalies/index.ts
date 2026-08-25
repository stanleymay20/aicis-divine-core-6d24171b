import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, errorResponse, jsonResponse } from "../_shared/resilience.ts";
import { aiChat } from "../_shared/ai-gateway.ts";

const FN = "detect-anomalies";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const start = Date.now();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    structuredLog("info", FN, "Starting anomaly detection", { user_id: user.id });

    const [revenueData, energyData, healthData, foodData, defenseData, diplomacyData, crisisData] = await Promise.all([
      supabaseClient.from("revenue_streams").select("*").order("timestamp", { ascending: false }).limit(20),
      supabaseClient.from("energy_grid").select("*").order("updated_at", { ascending: false }).limit(20),
      supabaseClient.from("health_data").select("*").order("updated_at", { ascending: false }).limit(20),
      supabaseClient.from("food_security").select("*").order("updated_at", { ascending: false }).limit(20),
      supabaseClient.from("defense_posture").select("*").order("updated_at", { ascending: false }).limit(20),
      supabaseClient.from("diplo_signals").select("*").order("updated_at", { ascending: false }).limit(20),
      supabaseClient.from("crisis_events").select("*").order("opened_at", { ascending: false }).limit(20),
    ]);

    const divisionsToCheck = [
      { name: "finance", data: revenueData.data, key: "amount_usd" },
      { name: "energy", data: energyData.data, key: "grid_load" },
      { name: "health", data: healthData.data, key: "affected_count" },
      { name: "food", data: foodData.data, key: "yield_index" },
      { name: "defense", data: defenseData.data, key: "threat_level" },
      { name: "diplomacy", data: diplomacyData.data, key: "risk_index" },
      { name: "crisis", data: crisisData.data, key: "severity" },
    ];

    const detectedAnomalies: any[] = [];

    for (const division of divisionsToCheck) {
      if (!division.data || division.data.length < 5) continue;

      const values = division.data.slice(0, 10)
        .map((d: any) => Number(d[division.key]))
        .filter((v: number) => Number.isFinite(v));
      if (values.length < 3) continue;

      const current = values[0];
      const historical = values.slice(1);
      const baseline = historical.reduce((a: number, b: number) => a + b, 0) / historical.length;
      if (!Number.isFinite(baseline)) continue;

      const absoluteDelta = current - baseline;
      const deviation = baseline === 0
        ? (current === 0 ? 0 : (current > 0 ? 100 : -100))
        : (absoluteDelta / Math.abs(baseline)) * 100;

      if (Math.abs(deviation) <= 30) continue;

      const severity = Math.abs(deviation) > 70 ? "critical"
        : Math.abs(deviation) > 50 ? "high"
        : "medium";
      const anomalyType = `${division.key}_deviation`;

      const { data: existing } = await supabaseClient
        .from("anomaly_detections")
        .select("id")
        .eq("division", division.name)
        .eq("anomaly_type", anomalyType)
        .eq("status", "active")
        .limit(1);
      if (existing?.length) continue;

      const deterministicDescription = `${division.name} ${division.key} moved from a historical baseline of ${baseline.toFixed(2)} to ${current.toFixed(2)} (${deviation.toFixed(1)}% deviation).`;

      const analysis = await resilientCall(`${FN}:ai:${division.name}`, async () => {
        const result = await aiChat({
          messages: [
            {
              role: "system",
              content: "You are AICIS Anomaly Analyzer. Explain only the supplied measured anomaly. Do not invent causes, actors, incidents, or external facts. Separate observations from hypotheses and recommend validation steps. Keep the response under 140 words.",
            },
            {
              role: "user",
              content: `Division: ${division.name}\nMetric: ${division.key}\nMeasured historical baseline: ${baseline.toFixed(2)}\nMeasured current value: ${current.toFixed(2)}\nMeasured deviation: ${deviation.toFixed(1)}%\n\nExplain the anomaly conservatively and recommend what evidence should be checked next.`,
            },
          ],
          temperature: 0.2,
          maxTokens: 220,
          timeoutMs: 12000,
        });
        return result.content;
      }, { maxRetries: 1, timeoutMs: 15000 }).catch(() => `${deterministicDescription} AI explanation unavailable; manual evidence review recommended.`);

      const { data: anomaly, error: anomalyError } = await supabaseClient
        .from("anomaly_detections")
        .insert({
          division: division.name,
          anomaly_type: anomalyType,
          severity,
          description: analysis,
          metrics: { current, baseline, absolute_delta: absoluteDelta, [division.key]: current },
          baseline_metrics: { [division.key]: baseline, sample_size: historical.length },
          deviation_percentage: deviation,
          status: "active",
        })
        .select()
        .single();

      if (anomalyError || !anomaly) {
        structuredLog("warn", FN, `Failed to persist ${division.name} anomaly`, { error: anomalyError?.message });
        continue;
      }

      detectedAnomalies.push(anomaly);
      await supabaseClient.from("intel_events").insert({
        division: division.name,
        event_type: "anomaly_detected",
        severity: severity === "critical" ? "emergency" : "warning",
        title: `Anomaly: ${division.key} ${deviation > 0 ? "spike" : "drop"}`,
        description: analysis,
        payload: {
          anomaly_id: anomaly.id,
          metric: division.key,
          current,
          baseline,
          deviation_percentage: deviation,
          evidence_type: "deterministic_metric_deviation",
        },
        source_system: "anomaly_detector",
        published_by: user.id,
      });
    }

    await supabaseClient.from("compliance_audit").insert({
      action_type: "anomaly_detection",
      user_id: user.id,
      action_description: `Detected ${detectedAnomalies.length} evidence-derived anomalies across divisions`,
      compliance_status: "compliant",
      data_accessed: { divisions: divisionsToCheck.map((d) => d.name) },
    });

    await supabaseClient.from("system_logs").insert({
      action: "anomaly_detection",
      division: "system",
      user_id: user.id,
      log_level: detectedAnomalies.length > 0 ? "warning" : "info",
      result: `Detected ${detectedAnomalies.length} anomalies`,
      metadata: { anomalies: detectedAnomalies.length, execution_time_ms: Date.now() - start, detection_method: "deterministic_metric_deviation" },
    });

    structuredLog("info", FN, `Complete: ${detectedAnomalies.length} anomalies`, undefined, start);
    return jsonResponse({
      success: true,
      message: `Anomaly scan complete: ${detectedAnomalies.length} detected`,
      anomalies: detectedAnomalies,
      execution_time_ms: Date.now() - start,
    });
  } catch (error) {
    structuredLog("error", FN, (error as Error).message, undefined, start);
    return errorResponse(error);
  }
});
