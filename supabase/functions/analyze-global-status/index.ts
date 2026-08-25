import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiChat } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const startTime = Date.now();

    const [divisionsData, revenueData, energyData, healthData, foodData, governanceData, defenseData, diplomacyData, crisisData, threatsData, anomaliesData] = await Promise.all([
      supabaseClient.from("ai_divisions").select("id, name, status"),
      supabaseClient.from("revenue_streams").select("division, source, amount_usd, timestamp").order("timestamp", { ascending: false }).limit(10),
      supabaseClient.from("energy_grid").select("region, grid_load, capacity, stability_index, renewable_percentage, outage_risk, updated_at").order("updated_at", { ascending: false }).limit(5),
      supabaseClient.from("health_data").select("*").order("updated_at", { ascending: false }).limit(5),
      supabaseClient.from("food_security").select("*").order("updated_at", { ascending: false }).limit(5),
      supabaseClient.from("gov_policies").select("jurisdiction, topic, compliance_level, last_reviewed").order("last_reviewed", { ascending: false }).limit(5),
      supabaseClient.from("defense_posture").select("region, threat_level, updated_at").order("updated_at", { ascending: false }).limit(10),
      supabaseClient.from("diplo_signals").select("country, sentiment, risk_index, updated_at").order("updated_at", { ascending: false }).limit(5),
      supabaseClient.from("crisis_events").select("region, kind, severity, status, created_at").eq("status", "escalated").limit(20),
      supabaseClient.from("threat_logs").select("threat_type, severity, region, created_at").eq("neutralized", false).order("created_at", { ascending: false }).limit(10),
      supabaseClient.from("anomaly_detections").select("division, anomaly_type, severity, detected_at").eq("status", "active").limit(20),
    ]);

    const datasets = {
      divisions: divisionsData.data || [],
      revenue: revenueData.data || [],
      energy: energyData.data || [],
      health: healthData.data || [],
      food: foodData.data || [],
      governance: governanceData.data || [],
      defense: defenseData.data || [],
      diplomacy: diplomacyData.data || [],
      crises: crisisData.data || [],
      threats: threatsData.data || [],
      anomalies: anomaliesData.data || [],
    };

    const statusSummary = {
      divisions: datasets.divisions.length,
      revenue_streams: datasets.revenue.length,
      energy_regions: datasets.energy.length,
      health_regions: datasets.health.length,
      food_regions: datasets.food.length,
      governance_policies: datasets.governance.length,
      defense_regions: datasets.defense.length,
      diplomacy_countries: datasets.diplomacy.length,
      active_crises: datasets.crises.length,
      active_threats: datasets.threats.length,
      active_anomalies: datasets.anomalies.length,
    };

    const evidenceDomains = ["revenue", "energy", "health", "food", "governance", "defense", "diplomacy", "crises", "threats", "anomalies"] as const;
    const populatedDomains = evidenceDomains.filter((key) => datasets[key].length > 0).length;
    const evidenceCoveragePct = Math.round((populatedDomains / evidenceDomains.length) * 100);

    const evidence = {
      counts: statusSummary,
      evidence_coverage_pct: evidenceCoveragePct,
      samples: datasets,
    };

    const ai = await aiChat({
      messages: [
        {
          role: "system",
          content: "You are the AICIS cross-division intelligence summarizer. Use ONLY supplied evidence. Do not invent an overall health score, financial totals, incidents, correlations, or causal claims. Distinguish observed counts/records from interpretation. If two domains merely move together in this snapshot, call it an association requiring validation, not causation. Provide: observed status, top evidence-backed priorities, possible cross-domain associations, data gaps, and advisory next steps. Markdown output.",
        },
        {
          role: "user",
          content: `Current AICIS evidence snapshot:\n${JSON.stringify(evidence, null, 2)}`,
        },
      ],
      temperature: 0.2,
      timeoutMs: 25_000,
    });

    const analysis = ai.content;
    const confidenceScore = Math.min(90, Math.max(20, evidenceCoveragePct));

    const { data: intelligence, error: insertError } = await supabaseClient
      .from("intelligence_index")
      .insert({
        index_type: "global_status",
        priority: 10,
        title: "AICIS Global Status Report",
        summary_md: analysis,
        affected_divisions: ["finance", "energy", "health", "food", "governance", "defense", "diplomacy", "crisis"],
        metrics: { ...statusSummary, evidence_coverage_pct: evidenceCoveragePct, provider: ai.provider, model: ai.model },
        confidence_score: confidenceScore,
      })
      .select()
      .single();

    if (insertError) console.error("Intelligence index insert error:", insertError);

    const executionTime = Date.now() - startTime;

    await supabaseClient.from("compliance_audit").insert({
      action_type: "global_status_analysis",
      user_id: user.id,
      action_description: "Generated AI-assisted global AICIS status synthesis from observed cross-division evidence",
      compliance_status: "review",
      data_accessed: { divisions: Object.keys(statusSummary), evidence_coverage_pct: evidenceCoveragePct, provider: ai.provider, model: ai.model },
    });

    await supabaseClient.from("system_logs").insert({
      action: "global_status_analysis",
      division: "system",
      user_id: user.id,
      log_level: "info",
      result: "Global status synthesized from observed evidence",
      metadata: { execution_time_ms: executionTime, metrics: statusSummary, evidence_coverage_pct: evidenceCoveragePct, provider: ai.provider, model: ai.model },
    });

    return new Response(JSON.stringify({
      success: true,
      analysis,
      metrics: statusSummary,
      evidence_coverage_pct: evidenceCoveragePct,
      confidence_score: confidenceScore,
      provider: ai.provider,
      model: ai.model,
      intelligence,
      execution_time_ms: executionTime,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Global status analysis error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
