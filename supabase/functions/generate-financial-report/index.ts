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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) return json({ ok: false, error: "Unauthorized" }, 401);

    const [revenuesResult, divisionsResult, threatsResult] = await Promise.all([
      supabaseClient.from("revenue_streams").select("*").order("created_at", { ascending: false }).limit(50),
      supabaseClient.from("ai_divisions").select("*"),
      supabaseClient.from("threat_logs").select("*").order("created_at", { ascending: false }).limit(10),
    ]);

    if (revenuesResult.error) throw revenuesResult.error;
    if (divisionsResult.error) throw divisionsResult.error;
    if (threatsResult.error) throw threatsResult.error;

    const revenues = revenuesResult.data ?? [];
    const divisions = divisionsResult.data ?? [];
    const threats = threatsResult.data ?? [];

    const evidence = {
      revenue_records: revenues,
      divisions,
      recent_threat_records: threats,
      evidence_counts: {
        revenue_records: revenues.length,
        divisions: divisions.length,
        threats: threats.length,
      },
      provenance_warning: "These are AICIS database records. Historical revenue rows may predate the current truth-floor controls. Do not describe a revenue amount, profit, savings figure, growth rate, or performance metric as externally verified unless the supplied record itself contains adequate source/provenance evidence.",
    };

    const aiResult = await aiChat({
      messages: [
        {
          role: "system",
          content: "You are the AICIS executive financial briefing generator. Use ONLY the supplied AICIS database records. Clearly separate recorded database values from verified external financial evidence. Do not calculate or claim growth rates, savings, profit performance, market prices, or causality unless the supplied records contain the required values and time basis. Never invent missing financial figures. If provenance is insufficient, state that explicitly. Threat records are risk context, not proof of financial impact. Format as concise professional markdown with sections: Evidence coverage, Recorded financial observations, Risk context, Data-quality caveats, Review actions. Recommendations are advisory only.",
        },
        { role: "user", content: JSON.stringify(evidence) },
      ],
      temperature: 0.2,
      maxTokens: 1800,
      timeoutMs: 15000,
    });

    const reportContent = aiResult.content;
    const generatedAt = new Date().toISOString();

    const { data: report, error: reportError } = await supabaseClient
      .from("ai_reports")
      .insert({
        title: `AICIS Executive Financial Report - ${generatedAt.slice(0, 10)}`,
        content: reportContent,
        division: "executive",
      })
      .select()
      .single();
    if (reportError) throw reportError;

    await supabaseClient.from("system_logs").insert({
      user_id: user.id,
      division: "executive",
      action: "report_generation",
      result: "success",
      log_level: "info",
      metadata: {
        report_id: report?.id,
        provider: aiResult.provider,
        model: aiResult.model,
        evidence_counts: evidence.evidence_counts,
        historical_revenue_provenance_warning: true,
      },
    });

    return json({
      ok: true,
      report,
      provenance: {
        provider: aiResult.provider,
        model: aiResult.model,
        evidence_counts: evidence.evidence_counts,
        financial_values_externally_verified: false,
      },
    });
  } catch (error) {
    console.error("Error in generate-financial-report:", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
