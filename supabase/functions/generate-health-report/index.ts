import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiChat } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) return json({ ok: false, error: "Unauthorized" }, 401);

    const [healthResult, foodResult] = await Promise.all([
      supabaseClient.from("health_data").select("*").order("risk_level", { ascending: false }),
      supabaseClient.from("food_security").select("*").order("alert_level", { ascending: false }),
    ]);

    if (healthResult.error) throw healthResult.error;
    if (foodResult.error) throw foodResult.error;

    const healthData = healthResult.data ?? [];
    const foodData = foodResult.data ?? [];
    const evidence = {
      health_records: healthData,
      food_security_records: foodData,
      evidence_counts: { health: healthData.length, food_security: foodData.length },
      generated_at: new Date().toISOString(),
    };

    if (healthData.length === 0 && foodData.length === 0) {
      return json({
        ok: false,
        code: "insufficient_evidence",
        message: "No health or food-security observations are available. AICIS will not fabricate a report.",
        evidence_counts: evidence.evidence_counts,
      }, 409);
    }

    const aiResult = await aiChat({
      messages: [
        {
          role: "system",
          content: "You generate an AICIS health and food-security evidence briefing. Use ONLY the supplied database records. Never invent case counts, mortality, disease spread, food shortages, causal links, current status, or forecasts. Treat null/missing fields as unmeasured. Distinguish observed records from interpretation. Do not produce a 24-hour outlook unless an explicit forecast/outlook field is present in the supplied evidence; otherwise write 'No validated short-term forecast available.' Flag stale/undated records when timestamps are absent or old. Recommendations are advisory and must be tied to specific supplied observations. Format concise markdown with: Evidence coverage, Health observations, Food-security observations, Cross-domain considerations, Data limitations, Review actions, Forecast availability.",
        },
        { role: "user", content: JSON.stringify(evidence) },
      ],
      temperature: 0.2,
      maxTokens: 1800,
      timeoutMs: 15000,
    });

    const reportContent = aiResult.content;

    const { data: report, error: insertError } = await supabaseClient
      .from("ai_reports")
      .insert({
        report_type: "health_food_security",
        content: reportContent,
        generated_by: user.id,
      })
      .select()
      .single();
    if (insertError) throw insertError;

    await supabaseClient.from("system_logs").insert({
      action: "health_food_report_generated",
      details: "Generated evidence-grounded health & food security report",
      performed_by: user.id,
      metadata: {
        report_id: report?.id ?? null,
        provider: aiResult.provider,
        model: aiResult.model,
        evidence_counts: evidence.evidence_counts,
      },
    });

    return json({
      ok: true,
      report: reportContent,
      report_id: report?.id ?? null,
      timestamp: evidence.generated_at,
      provenance: {
        provider: aiResult.provider,
        model: aiResult.model,
        evidence_counts: evidence.evidence_counts,
      },
    });
  } catch (error) {
    console.error("Error in generate-health-report:", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
