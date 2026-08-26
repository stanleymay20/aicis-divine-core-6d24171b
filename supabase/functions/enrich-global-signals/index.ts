import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiChat } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CATEGORIES = [
  "geopolitical", "economic", "financial_markets", "central_banking",
  "public_health", "climate_disaster", "energy", "technology",
  "cybersecurity", "defense_conflict", "legal_regulatory",
  "supply_chain", "elections", "social_unrest", "infrastructure",
];

const MAX_BATCH = 4;
const AI_TIMEOUT_MS = 25000;
const MAX_ENRICHMENT_ATTEMPTS = 3;

const boundedNumber = (value: unknown, min = 0, max = 100): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const enrichStart = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: pending, error: fetchErr } = await supabase
      .from("global_signals")
      .select("*")
      .eq("enrichment_status", "pending_enrichment")
      .lt("enrichment_attempts", MAX_ENRICHMENT_ATTEMPTS)
      .order("ingested_at", { ascending: true })
      .limit(MAX_BATCH);

    if (fetchErr) throw new Error(`Fetch pending failed: ${fetchErr.message}`);
    if (!pending?.length) {
      const { data: stuck } = await supabase
        .from("global_signals")
        .select("id,enrichment_attempts")
        .eq("enrichment_status", "enriching")
        .lt("updated_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
        .limit(10);

      for (const signal of stuck || []) {
        const attempts = Number(signal.enrichment_attempts || 0);
        await supabase.from("global_signals").update({
          enrichment_status: attempts >= MAX_ENRICHMENT_ATTEMPTS ? "failed" : "pending_enrichment",
          enrichment_error: "Stuck in enriching >10min; reset without fabricating enrichment",
        } as any).eq("id", signal.id);
      }

      return new Response(JSON.stringify({ ok: true, enriched: 0, message: "No pending signals" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pendingIds = pending.map((s: any) => s.id);
    for (const signal of pending) {
      await supabase.from("global_signals").update({
        enrichment_status: "enriching",
        enrichment_attempts: Number(signal.enrichment_attempts || 0) + 1,
        updated_at: new Date().toISOString(),
      } as any).eq("id", signal.id).eq("enrichment_status", "pending_enrichment");
    }

    const failPending = async (reason: string) => {
      for (const signal of pending) {
        const attempts = Number(signal.enrichment_attempts || 0) + 1;
        await supabase.from("global_signals").update({
          enrichment_status: attempts >= MAX_ENRICHMENT_ATTEMPTS ? "failed" : "pending_enrichment",
          enrichment_error: reason.slice(0, 500),
        } as any).eq("id", signal.id);
      }
    };

    const { data: thresholds } = await supabase
      .from("routing_threshold_config")
      .select("*")
      .eq("enabled", true)
      .order("rule_name");

    const defaultThreshold = thresholds?.find((t: any) => t.rule_name === "default") || {
      min_impact: 70, min_confidence: 60, official_boost: 10, multi_source_boost: 5, misinfo_penalty: 15,
    };
    const highTrustThreshold = thresholds?.find((t: any) => t.rule_name === "high_trust_override") || defaultThreshold;

    const evidenceBatch = pending.map((s: any, index: number) => ({
      index,
      title: String(s.title || "").slice(0, 500),
      summary: String(s.summary || "").slice(0, 1800),
      primary_source: s.primary_source || null,
      source_references: Array.isArray(s.source_references) ? s.source_references.slice(0, 10) : [],
      source_trust_tier: s.source_trust_tier || null,
      official_source: Boolean(s.official_source || s.official_source_present),
      multi_source_confirmed: Boolean(s.multi_source_confirmed),
      occurred_at: s.occurred_at || null,
      first_detected_at: s.first_detected_at || null,
    }));

    let classifications: any[] = [];
    let aiProvider = "unknown";
    let aiModel = "unknown";
    const classifyStart = Date.now();

    try {
      const ai = await aiChat({
        messages: [
          {
            role: "system",
            content: `You are AICIS's evidence-constrained signal classifier. Use ONLY the supplied title, summary, source metadata and timestamps. Do not add events, actors, locations, consequences or facts not supported by the supplied evidence. Return a JSON object {"classifications":[...]} with exactly one item per input. Each item: index; category (one of ${CATEGORIES.join(",")}); confidence_score 0-100 (confidence in classification, not truth); impact_score 0-100; urgency_score 0-100; affected_regions string[]; affected_countries ISO3 string[] only when evidenced; affected_sectors string[]; strategic_implications string; likely_consequences string; recommended_actions object with government/media/business/public; misinformation_risk 0-100; impact_reasoning string; uncertainty_notes string. If a field is unsupported, use empty array/string rather than inventing it.`,
          },
          { role: "user", content: JSON.stringify({ signals: evidenceBatch }) },
        ],
        responseFormat: { type: "json_object" },
        temperature: 0.05,
        maxTokens: 2600,
        timeoutMs: AI_TIMEOUT_MS,
      });
      aiProvider = ai.provider;
      aiModel = ai.model;
      const parsed = JSON.parse(ai.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      classifications = Array.isArray(parsed?.classifications) ? parsed.classifications : [];
      if (classifications.length !== pending.length) throw new Error(`Expected ${pending.length} classifications, received ${classifications.length}`);
    } catch (aiErr) {
      const message = `AI enrichment unavailable: ${(aiErr as Error).message || "unknown error"}`;
      console.error(message);
      await failPending(message);
      return new Response(JSON.stringify({ ok: false, error: "Enrichment provider unavailable; signals left un-enriched", pending: pendingIds.length }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const classificationTimeMs = Date.now() - classifyStart;
    let enrichedCount = 0;
    let routedCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < pending.length; i++) {
      const signal = pending[i];
      try {
        const cls = classifications.find((c: any) => Number(c.index) === i);
        if (!cls) throw new Error("Missing classifier result");

        const baseImpact = boundedNumber(cls.impact_score);
        const confidenceScore = boundedNumber(cls.confidence_score);
        const urgencyScore = boundedNumber(cls.urgency_score);
        const misinfoRisk = boundedNumber(cls.misinformation_risk);
        if ([baseImpact, confidenceScore, urgencyScore, misinfoRisk].some((v) => v === null)) {
          throw new Error("Classifier returned invalid numeric scores");
        }

        const isOfficial = Boolean(signal.official_source || signal.official_source_present);
        const trustTier = signal.source_trust_tier || "tier_3";
        let impactScore = baseImpact as number;
        if (trustTier === "tier_1") impactScore = Math.min(100, impactScore + 5);
        else if (trustTier === "tier_3") impactScore = Math.max(0, impactScore - 10);
        if (isOfficial) impactScore = Math.min(100, impactScore + Number((defaultThreshold as any).official_boost || 10));
        if (signal.multi_source_confirmed) impactScore = Math.min(100, impactScore + Number((defaultThreshold as any).multi_source_boost || 5));

        const category = CATEGORIES.includes(cls.category) ? cls.category : signal.category;
        const threshold = (isOfficial || trustTier === "tier_1") ? highTrustThreshold : defaultThreshold;
        const meetsRouting = impactScore >= Number((threshold as any).min_impact || 70) && (confidenceScore as number) >= Number((threshold as any).min_confidence || 60);
        const suppressedByMisinfo = (misinfoRisk as number) > 70 && (trustTier === "tier_3" || !signal.multi_source_confirmed);
        const evidenceStrongEnoughToRoute = isOfficial || signal.multi_source_confirmed || trustTier === "tier_1" || trustTier === "tier_2";

        let routingScore = impactScore * 0.4 + (confidenceScore as number) * 0.3 + (urgencyScore as number) * 0.3;
        if (isOfficial) routingScore += 10;
        if (signal.multi_source_confirmed) routingScore += 5;
        if ((misinfoRisk as number) > 50) routingScore -= Number((defaultThreshold as any).misinfo_penalty || 15);

        const shouldRoute = meetsRouting && !suppressedByMisinfo && evidenceStrongEnoughToRoute;
        const suppressReason = suppressedByMisinfo ? "high_misinfo_or_weak_source" :
          !evidenceStrongEnoughToRoute ? "insufficient_source_strength" :
          !meetsRouting ? `below_threshold(impact=${impactScore},conf=${confidenceScore})` : null;

        const affectedRegions = Array.isArray(cls.affected_regions) ? cls.affected_regions.filter((r: any) => typeof r === "string").slice(0, 10) : [];
        const affectedCountries = Array.isArray(cls.affected_countries) ? cls.affected_countries.filter((c: any) => typeof c === "string" && /^[A-Z]{3}$/i.test(c)).map((c: string) => c.toUpperCase()).slice(0, 10) : [];
        const affectedSectors = Array.isArray(cls.affected_sectors) ? cls.affected_sectors.filter((s: any) => typeof s === "string").slice(0, 10) : [];

        const recActions: Record<string, string> = {};
        if (cls.recommended_actions && typeof cls.recommended_actions === "object") {
          for (const key of ["government", "media", "business", "public"]) {
            if (typeof cls.recommended_actions[key] === "string" && cls.recommended_actions[key].trim()) recActions[key] = cls.recommended_actions[key].slice(0, 500);
          }
        }

        const uncertainty = typeof cls.uncertainty_notes === "string" ? cls.uncertainty_notes.slice(0, 1000) : signal.uncertainty_notes || null;
        const update = {
          category,
          confidence_score: confidenceScore,
          impact_score: impactScore,
          urgency_score: urgencyScore,
          misinformation_risk: misinfoRisk,
          affected_regions: affectedRegions,
          affected_countries: affectedCountries,
          affected_sectors: affectedSectors,
          strategic_implications: typeof cls.strategic_implications === "string" ? cls.strategic_implications.slice(0, 1000) : null,
          likely_consequences: typeof cls.likely_consequences === "string" ? cls.likely_consequences.slice(0, 1000) : null,
          normalized_summary: String(signal.summary || "").slice(0, 2000),
          recommended_actions: recActions,
          audience_framing: recActions,
          impact_reasoning: typeof cls.impact_reasoning === "string" ? cls.impact_reasoning.slice(0, 1000) : null,
          uncertainty_notes: uncertainty,
          model_version: `${aiProvider}:${aiModel}`,
          classification_time_ms: classificationTimeMs,
          enrichment_status: "enriched",
          enrichment_error: null,
          enriched_at: new Date().toISOString(),
          routing_score: Math.round(routingScore * 100) / 100,
          routing_suppressed_reason: suppressReason,
          status: shouldRoute ? "confirmed" : "new",
        };

        const { error: updateError } = await supabase.from("global_signals").update(update as any).eq("id", signal.id);
        if (updateError) throw updateError;
        enrichedCount++;

        if (shouldRoute) {
          const domain = category === "public_health" ? "health" :
            category === "defense_conflict" || category === "cybersecurity" ? "security" :
            category === "economic" || category === "financial_markets" || category === "central_banking" ? "economy" :
            category === "energy" ? "energy" :
            category === "climate_disaster" || category === "supply_chain" ? "food" : "governance";

          const { data: existingDecision } = await supabase.from("decision_outcome_log").select("id").eq("signal_id", signal.id).limit(1);
          if (!existingDecision?.length) {
            await supabase.from("decision_outcome_log").insert({
              signal_title: `[SIGNAL] ${String(signal.title || "").slice(0, 500)}`,
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
        const attempts = Number(signal.enrichment_attempts || 0) + 1;
        await supabase.from("global_signals").update({
          enrichment_status: attempts >= MAX_ENRICHMENT_ATTEMPTS ? "failed" : "pending_enrichment",
          enrichment_error: errMsg.slice(0, 500),
        } as any).eq("id", signal.id);
      }
    }

    await supabase.from("audit_log").insert({
      action: "global_signal_enrichment",
      resource_type: "global_signals",
      severity: errors.length > 0 ? "warn" : "info",
      metadata: {
        signals_enriched: enrichedCount,
        signals_routed: routedCount,
        classification_time_ms: classificationTimeMs,
        total_duration_ms: Date.now() - enrichStart,
        provider: aiProvider,
        model: aiModel,
        failure_policy: "fail_closed_no_synthetic_scores",
        errors: errors.length ? errors : undefined,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      enriched: enrichedCount,
      routed: routedCount,
      errors: errors.length,
      provider: aiProvider,
      model: aiModel,
      classification_time_ms: classificationTimeMs,
      total_duration_ms: Date.now() - enrichStart,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Enrichment error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message?.slice(0, 500) || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
