import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CATEGORIES = [
  "geopolitical","economic","financial_markets","central_banking",
  "public_health","climate_disaster","energy","technology",
  "cybersecurity","defense_conflict","legal_regulatory",
  "supply_chain","elections","social_unrest","infrastructure"
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const enrichStart = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Fetch pending signals (max 4 per run for speed)
    const { data: pending, error: fetchErr } = await supabase
      .from("global_signals")
      .select("*")
      .eq("enrichment_status", "pending_enrichment")
      .order("ingested_at", { ascending: true })
      .limit(4);

    if (fetchErr) throw new Error(`Fetch pending failed: ${fetchErr.message}`);
    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({ ok: true, enriched: 0, message: "No pending signals" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark as enriching to prevent double-processing
    const pendingIds = pending.map(s => s.id);
    await supabase.from("global_signals")
      .update({ enrichment_status: "enriching", enrichment_attempts: pending[0].enrichment_attempts + 1 } as any)
      .in("id", pendingIds);

    // Load routing thresholds
    const { data: thresholds } = await supabase
      .from("routing_threshold_config")
      .select("*")
      .eq("enabled", true)
      .order("rule_name");
    
    const defaultThreshold = thresholds?.find(t => t.rule_name === "default") || {
      min_impact: 70, min_confidence: 60, official_boost: 10, multi_source_boost: 5, misinfo_penalty: 15,
    };
    const highTrustThreshold = thresholds?.find(t => t.rule_name === "high_trust_override") || defaultThreshold;

    // AI Classification batch
    const articlesSummary = pending.map((s: any, i: number) =>
      `[${i}] "${s.title}" — ${s.summary || "No description"} (Source: ${s.primary_source || "Unknown"})`
    ).join("\n");

    let classifications: any[] = [];
    const classifyStart = Date.now();

    try {
      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content: `Classify articles. Return JSON array with objects: index, category (one of: ${CATEGORIES.join(",")}), confidence_score (0-100), impact_score (0-100), urgency_score (0-100), affected_regions (array), affected_countries (ISO3 array), affected_sectors (array), strategic_implications (1 sentence), likely_consequences (1 sentence), recommended_actions ({government,media,business,public}), misinformation_risk (0-100), impact_reasoning (1-2 sentences). JSON only, no markdown.`
            },
            { role: "user", content: `Classify:\n${articlesSummary}` }
          ],
        }),
      });

      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        const content = aiData.choices?.[0]?.message?.content || "";
        try {
          classifications = JSON.parse(content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
        } catch (e) {
          console.error("AI parse error:", e);
        }
      } else {
        const errText = await aiResponse.text();
        console.error("AI gateway error:", aiResponse.status, errText);
        // On AI failure, mark signals back to pending with error
        await supabase.from("global_signals")
          .update({ enrichment_status: "pending_enrichment", enrichment_error: `AI error: ${aiResponse.status}` } as any)
          .in("id", pendingIds);
        return new Response(JSON.stringify({ ok: false, error: "AI classification failed", status: aiResponse.status }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch (aiErr) {
      console.error("AI call failed:", aiErr);
      await supabase.from("global_signals")
        .update({ enrichment_status: "pending_enrichment", enrichment_error: `AI exception: ${(aiErr as Error).message}` } as any)
        .in("id", pendingIds);
      return new Response(JSON.stringify({ ok: false, error: "AI call exception" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const classificationTimeMs = Date.now() - classifyStart;

    // Enrich each signal
    let enrichedCount = 0;
    let routedCount = 0;

    for (let i = 0; i < pending.length; i++) {
      const signal = pending[i];
      const cls = classifications.find((c: any) => c.index === i) || {};
      const isOfficial = signal.official_source || signal.official_source_present;
      const trustTier = signal.source_trust_tier || "tier_3";

      // Trust-weighted impact adjustment
      let impactScore = cls.impact_score || 40;
      if (trustTier === "tier_1") impactScore = Math.min(100, impactScore + 5);
      else if (trustTier === "tier_3") impactScore = Math.max(0, impactScore - 10);
      if (isOfficial) impactScore = Math.min(100, impactScore + (defaultThreshold as any).official_boost || 10);
      if (signal.multi_source_confirmed) impactScore = Math.min(100, impactScore + (defaultThreshold as any).multi_source_boost || 5);

      const confidenceScore = Math.min(100, Math.max(0, cls.confidence_score || 50));
      const urgencyScore = Math.min(100, Math.max(0, cls.urgency_score || 40));
      const misinfoRisk = cls.misinformation_risk || 0;

      // Category validation
      const category = CATEGORIES.includes(cls.category) ? cls.category : signal.category;

      // Routing decision
      const threshold = (isOfficial || trustTier === "tier_1") ? highTrustThreshold : defaultThreshold;
      const meetsRouting = impactScore >= (threshold as any).min_impact && confidenceScore >= (threshold as any).min_confidence;
      const suppressedByMisinfo = misinfoRisk > 70 && trustTier === "tier_3";

      let routingScore = impactScore * 0.4 + confidenceScore * 0.3 + urgencyScore * 0.3;
      if (isOfficial) routingScore += 10;
      if (signal.multi_source_confirmed) routingScore += 5;
      if (misinfoRisk > 50) routingScore -= (defaultThreshold as any).misinfo_penalty || 15;

      const shouldRoute = meetsRouting && !suppressedByMisinfo;
      const suppressReason = suppressedByMisinfo ? "high_misinfo_weak_source" :
        !meetsRouting ? `below_threshold(impact=${impactScore},conf=${confidenceScore})` : null;

      // Update the signal with enrichment data
      await supabase.from("global_signals").update({
        category,
        confidence_score: confidenceScore,
        impact_score: Math.min(100, Math.max(0, impactScore)),
        urgency_score: urgencyScore,
        misinformation_risk: misinfoRisk,
        affected_regions: cls.affected_regions || signal.affected_regions || [],
        affected_countries: cls.affected_countries || signal.affected_countries || [],
        affected_sectors: cls.affected_sectors || signal.affected_sectors || [],
        strategic_implications: cls.strategic_implications || null,
        likely_consequences: cls.likely_consequences || null,
        normalized_summary: cls.strategic_implications || signal.summary,
        recommended_actions: cls.recommended_actions || {},
        audience_framing: cls.recommended_actions || {},
        impact_reasoning: cls.impact_reasoning || cls.strategic_implications || null,
        model_version: "gemini-3-flash-preview",
        classification_time_ms: classificationTimeMs,
        enrichment_status: "enriched",
        enrichment_error: null,
        enriched_at: new Date().toISOString(),
        routing_score: routingScore,
        routing_suppressed_reason: suppressReason,
        status: shouldRoute ? "confirmed" : "new",
      } as any).eq("id", signal.id);

      enrichedCount++;

      // Route to decisions if qualified
      if (shouldRoute) {
        const domain = category === "public_health" ? "health" :
          category === "defense_conflict" ? "security" :
          (category === "economic" || category === "financial_markets") ? "economy" :
          category === "energy" ? "energy" :
          category === "climate_disaster" ? "food" : "governance";

        await supabase.from("decision_outcome_log").insert({
          signal_title: `[SIGNAL] ${signal.title}`,
          signal_id: signal.id,
          signal_date: new Date().toISOString().split("T")[0],
          domain,
          action_taken: false,
          evidence_type: "hypothetical",
        });

        await supabase.from("global_signals").update({ routed_at: new Date().toISOString() } as any).eq("id", signal.id);
        routedCount++;
      }
    }

    // Audit log
    await supabase.from("audit_log").insert({
      action: "global_signal_enrichment",
      resource_type: "global_signals",
      severity: "info",
      metadata: {
        signals_enriched: enrichedCount,
        signals_routed: routedCount,
        classification_time_ms: classificationTimeMs,
        total_duration_ms: Date.now() - enrichStart,
        model: "gemini-3-flash-preview",
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      enriched: enrichedCount,
      routed: routedCount,
      classification_time_ms: classificationTimeMs,
      total_duration_ms: Date.now() - enrichStart,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Enrichment error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
