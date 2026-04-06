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

const MAX_BATCH = 4;
const AI_TIMEOUT_MS = 25000;
const MAX_ENRICHMENT_ATTEMPTS = 3;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const enrichStart = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!supabaseUrl || !supabaseKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch pending signals — exclude those that exceeded max attempts
    const { data: pending, error: fetchErr } = await supabase
      .from("global_signals")
      .select("*")
      .eq("enrichment_status", "pending_enrichment")
      .lt("enrichment_attempts", MAX_ENRICHMENT_ATTEMPTS)
      .order("ingested_at", { ascending: true })
      .limit(MAX_BATCH);

    if (fetchErr) throw new Error(`Fetch pending failed: ${fetchErr.message}`);
    if (!pending || pending.length === 0) {
      // Also check for permanently stuck signals and mark them failed
      const { data: stuck } = await supabase
        .from("global_signals")
        .select("id")
        .eq("enrichment_status", "enriching")
        .lt("updated_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
        .limit(10);

      if (stuck && stuck.length > 0) {
        await supabase.from("global_signals")
          .update({ enrichment_status: "pending_enrichment", enrichment_error: "Stuck in enriching >10min, reset" } as any)
          .in("id", stuck.map(s => s.id));
        console.log(`Reset ${stuck.length} stuck signals`);
      }

      return new Response(JSON.stringify({ ok: true, enriched: 0, message: "No pending signals" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Atomically mark as enriching to prevent double-processing
    const pendingIds = pending.map(s => s.id);
    for (const signal of pending) {
      await supabase.from("global_signals")
        .update({
          enrichment_status: "enriching",
          enrichment_attempts: (signal.enrichment_attempts || 0) + 1,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", signal.id)
        .eq("enrichment_status", "pending_enrichment"); // CAS guard
    }

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
      `[${i}] "${s.title}" — ${(s.summary || "No description").slice(0, 200)} (Source: ${s.primary_source || "Unknown"})`
    ).join("\n");

    let classifications: any[] = [];
    const classifyStart = Date.now();

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        signal: ctrl.signal,
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

      clearTimeout(timeout);

      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        const content = aiData.choices?.[0]?.message?.content || "";
        try {
          const parsed = JSON.parse(content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
          if (Array.isArray(parsed)) {
            classifications = parsed;
          } else {
            console.error("AI returned non-array:", typeof parsed);
          }
        } catch (e) {
          console.error("AI parse error:", e, "content:", content.slice(0, 300));
        }
      } else {
        const errText = await aiResponse.text();
        console.error("AI gateway error:", aiResponse.status, errText.slice(0, 200));

        // Graceful degradation: revert to pending with error
        await supabase.from("global_signals")
          .update({ enrichment_status: "pending_enrichment", enrichment_error: `AI error: ${aiResponse.status}` } as any)
          .in("id", pendingIds);

        return new Response(JSON.stringify({ ok: false, error: "AI classification failed", status: aiResponse.status }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch (aiErr) {
      const errMsg = (aiErr as Error).message || "Unknown AI error";
      console.error("AI call failed:", errMsg);

      await supabase.from("global_signals")
        .update({ enrichment_status: "pending_enrichment", enrichment_error: `AI exception: ${errMsg.slice(0, 200)}` } as any)
        .in("id", pendingIds);

      return new Response(JSON.stringify({ ok: false, error: "AI call exception" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const classificationTimeMs = Date.now() - classifyStart;

    // Enrich each signal
    let enrichedCount = 0;
    let routedCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < pending.length; i++) {
      const signal = pending[i];

      try {
        const cls = classifications.find((c: any) => c.index === i) || {};
        const isOfficial = signal.official_source || signal.official_source_present;
        const trustTier = signal.source_trust_tier || "tier_3";

        // Trust-weighted impact adjustment
        let impactScore = Math.min(100, Math.max(0, cls.impact_score || 40));
        if (trustTier === "tier_1") impactScore = Math.min(100, impactScore + 5);
        else if (trustTier === "tier_3") impactScore = Math.max(0, impactScore - 10);
        if (isOfficial) impactScore = Math.min(100, impactScore + ((defaultThreshold as any).official_boost || 10));
        if (signal.multi_source_confirmed) impactScore = Math.min(100, impactScore + ((defaultThreshold as any).multi_source_boost || 5));

        const confidenceScore = Math.min(100, Math.max(0, cls.confidence_score || 50));
        const urgencyScore = Math.min(100, Math.max(0, cls.urgency_score || 40));
        const misinfoRisk = Math.min(100, Math.max(0, cls.misinformation_risk || 0));

        // Category validation
        const category = CATEGORIES.includes(cls.category) ? cls.category : signal.category;

        // Routing decision
        const threshold = (isOfficial || trustTier === "tier_1") ? highTrustThreshold : defaultThreshold;
        const meetsRouting = impactScore >= ((threshold as any).min_impact || 70) && confidenceScore >= ((threshold as any).min_confidence || 60);
        const suppressedByMisinfo = misinfoRisk > 70 && trustTier === "tier_3";

        let routingScore = impactScore * 0.4 + confidenceScore * 0.3 + urgencyScore * 0.3;
        if (isOfficial) routingScore += 10;
        if (signal.multi_source_confirmed) routingScore += 5;
        if (misinfoRisk > 50) routingScore -= ((defaultThreshold as any).misinfo_penalty || 15);

        const shouldRoute = meetsRouting && !suppressedByMisinfo;
        const suppressReason = suppressedByMisinfo ? "high_misinfo_weak_source" :
          !meetsRouting ? `below_threshold(impact=${impactScore},conf=${confidenceScore})` : null;

        // Validate arrays
        const affectedRegions = Array.isArray(cls.affected_regions) ? cls.affected_regions.filter((r: any) => typeof r === "string").slice(0, 10) : [];
        const affectedCountries = Array.isArray(cls.affected_countries) ? cls.affected_countries.filter((c: any) => typeof c === "string" && c.length <= 5).slice(0, 10) : [];
        const affectedSectors = Array.isArray(cls.affected_sectors) ? cls.affected_sectors.filter((s: any) => typeof s === "string").slice(0, 10) : [];

        // Validate recommended_actions
        const recActions: Record<string, string> = {};
        if (cls.recommended_actions && typeof cls.recommended_actions === "object") {
          for (const key of ["government", "media", "business", "public"]) {
            if (typeof cls.recommended_actions[key] === "string") {
              recActions[key] = cls.recommended_actions[key].slice(0, 500);
            }
          }
        }

        // Update the signal
        await supabase.from("global_signals").update({
          category,
          confidence_score: confidenceScore,
          impact_score: Math.min(100, Math.max(0, impactScore)),
          urgency_score: urgencyScore,
          misinformation_risk: misinfoRisk,
          affected_regions: affectedRegions,
          affected_countries: affectedCountries,
          affected_sectors: affectedSectors,
          strategic_implications: typeof cls.strategic_implications === "string" ? cls.strategic_implications.slice(0, 1000) : null,
          likely_consequences: typeof cls.likely_consequences === "string" ? cls.likely_consequences.slice(0, 1000) : null,
          normalized_summary: (typeof cls.strategic_implications === "string" ? cls.strategic_implications : signal.summary)?.slice(0, 2000),
          recommended_actions: recActions,
          audience_framing: recActions,
          impact_reasoning: (typeof cls.impact_reasoning === "string" ? cls.impact_reasoning : cls.strategic_implications || null)?.slice(0, 1000) || null,
          model_version: "gemini-3-flash-preview",
          classification_time_ms: classificationTimeMs,
          enrichment_status: "enriched",
          enrichment_error: null,
          enriched_at: new Date().toISOString(),
          routing_score: Math.round(routingScore * 100) / 100,
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

          // Check for existing decision to avoid duplicates
          const { data: existingDecision } = await supabase
            .from("decision_outcome_log")
            .select("id")
            .eq("signal_id", signal.id)
            .limit(1);

          if (!existingDecision || existingDecision.length === 0) {
            await supabase.from("decision_outcome_log").insert({
              signal_title: `[SIGNAL] ${signal.title.slice(0, 500)}`,
              signal_id: signal.id,
              signal_date: new Date().toISOString().split("T")[0],
              domain,
              action_taken: false,
              evidence_type: "hypothetical",
            });
          }

          await supabase.from("global_signals").update({ routed_at: new Date().toISOString() } as any).eq("id", signal.id);
          routedCount++;
        }
      } catch (signalErr) {
        const errMsg = (signalErr as Error).message || "Unknown";
        errors.push(`Signal ${signal.id}: ${errMsg.slice(0, 100)}`);
        console.error(`Error enriching signal ${signal.id}:`, errMsg);

        // Mark individual signal as failed if max attempts reached
        const attempts = (signal.enrichment_attempts || 0) + 1;
        await supabase.from("global_signals").update({
          enrichment_status: attempts >= MAX_ENRICHMENT_ATTEMPTS ? "failed" : "pending_enrichment",
          enrichment_error: errMsg.slice(0, 500),
        } as any).eq("id", signal.id);
      }
    }

    // Audit log
    await supabase.from("audit_log").insert({
      action: "global_signal_enrichment",
      resource_type: "global_signals",
      severity: errors.length > 0 ? "warn" : "info",
      metadata: {
        signals_enriched: enrichedCount,
        signals_routed: routedCount,
        classification_time_ms: classificationTimeMs,
        total_duration_ms: Date.now() - enrichStart,
        model: "gemini-3-flash-preview",
        errors: errors.length > 0 ? errors : undefined,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      enriched: enrichedCount,
      routed: routedCount,
      errors: errors.length,
      classification_time_ms: classificationTimeMs,
      total_duration_ms: Date.now() - enrichStart,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Enrichment error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message?.slice(0, 500) || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
