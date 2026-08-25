import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { aiChat } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const InputSchema = z.object({
  jurisdiction: z.string().trim().min(1).max(100).optional(),
  topics: z.array(z.string().trim().min(1).max(100)).min(1).max(20).optional(),
  topic: z.string().trim().min(1).max(100).optional(),
  country: z.string().trim().min(1).max(100).optional(),
});

const norm = (value: unknown) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const validation = InputSchema.safeParse(await req.json().catch(() => ({})));
    if (!validation.success) {
      return new Response(JSON.stringify({ error: "Invalid input", details: validation.error.issues }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { jurisdiction, topics, topic, country } = validation.data;
    const resolvedJurisdiction = jurisdiction || country || "Global";
    const topicsArray = topics?.length ? topics : topic ? [topic] : ["AI Regulation", "Data Protection", "Cybersecurity", "Trade Policy", "Environmental"];
    const startTime = Date.now();

    const service = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Policy intelligence must be grounded in AICIS evidence, not model memory.
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: candidateSignals, error: signalError } = await service
      .from("global_signals")
      .select("id,title,summary,normalized_summary,category,subcategory,confidence_score,impact_score,urgency_score,primary_source,source_references,first_detected_at,latest_update_at,affected_countries,affected_regions,strategic_implications,likely_consequences,uncertainty_notes,evidence_hash,source_trust_tier,multi_source_confirmed,official_source_present")
      .gte("first_detected_at", since)
      .order("first_detected_at", { ascending: false })
      .limit(500);
    if (signalError) throw signalError;

    const jurisdictionNeedle = norm(resolvedJurisdiction);
    const jurisdictionIsGlobal = jurisdictionNeedle === "global";
    const baseSignals = (candidateSignals || []).filter((s: any) => {
      const categoryText = norm(`${s.category} ${s.subcategory}`);
      const governanceLike = /govern|policy|politic|regulat|legal|cyber|trade|environment|privacy|data protection/.test(categoryText + " " + norm(`${s.title} ${s.summary}`));
      if (!governanceLike) return false;
      if (jurisdictionIsGlobal) return true;
      const geoText = norm(`${(s.affected_countries || []).join(" ")} ${(s.affected_regions || []).join(" ")} ${s.title} ${s.summary}`);
      return geoText.includes(jurisdictionNeedle);
    });

    const results: any[] = [];
    const skipped: any[] = [];

    for (const topicName of topicsArray) {
      const topicTerms = norm(topicName).split(" ").filter((x) => x.length > 2);
      const evidence = baseSignals
        .filter((s: any) => {
          const hay = norm(`${s.title} ${s.summary} ${s.normalized_summary} ${s.category} ${s.subcategory} ${s.strategic_implications}`);
          return topicTerms.length === 0 || topicTerms.some((t) => hay.includes(t));
        })
        .slice(0, 20);

      if (evidence.length === 0) {
        skipped.push({ topic: topicName, reason: "no_recent_supporting_evidence" });
        continue;
      }

      const evidenceEnvelope = evidence.map((s: any) => ({
        signal_id: s.id,
        title: s.title,
        summary: s.normalized_summary || s.summary,
        primary_source: s.primary_source,
        first_detected_at: s.first_detected_at,
        latest_update_at: s.latest_update_at,
        confidence_score: s.confidence_score,
        source_trust_tier: s.source_trust_tier,
        multi_source_confirmed: s.multi_source_confirmed,
        official_source_present: s.official_source_present,
        evidence_hash: s.evidence_hash,
        uncertainty_notes: s.uncertainty_notes,
      }));

      let summary: string;
      let provider = "deterministic";
      let model = "none";
      try {
        const ai = await aiChat({
          temperature: 0.1,
          maxTokens: 1200,
          timeoutMs: 18000,
          messages: [{
            role: "system",
            content: `You are AICIS Governance Intelligence. Summarize ONLY the supplied evidence. Do not rely on model memory for laws, regulations, dates, requirements, penalties, or compliance status. Do not claim that an organization is legally compliant or non-compliant. If evidence is insufficient to establish current law, say so. Distinguish official-source evidence from media/reporting signals. Produce concise markdown with: Evidence-backed developments; Potential implications; Uncertainties / verification required; Sources observed. This is policy intelligence, not legal advice.`,
          }, {
            role: "user",
            content: `Jurisdiction: ${resolvedJurisdiction}\nTopic: ${topicName}\nEvidence:\n${JSON.stringify(evidenceEnvelope, null, 2)}`,
          }],
        });
        summary = ai.content;
        provider = ai.provider;
        model = ai.model;
      } catch (error) {
        console.error(`Governance AI summary unavailable for ${topicName}:`, error);
        summary = `### Evidence-backed developments\n${evidenceEnvelope.slice(0, 8).map((e: any) => `- ${e.title} — ${e.primary_source || "source unavailable"} (${e.first_detected_at})`).join("\n")}\n\n### Verification required\nA model summary was unavailable. These records are AICIS-observed signals and must be checked against authoritative legal texts before any compliance decision.`;
      }

      const groundedSummary = `${summary}\n\n---\n**AICIS evidence provenance:** ${evidence.length} supporting signal(s); synthesis provider: ${provider}; model: ${model}. **Compliance status is intentionally set to review because this scan is not a legal determination.**`;

      const { data: policy, error: insertError } = await service
        .from("gov_policies")
        .upsert({
          jurisdiction: resolvedJurisdiction,
          topic: topicName,
          summary_md: groundedSummary,
          compliance_level: "review",
          last_reviewed: new Date().toISOString(),
        }, { onConflict: "jurisdiction,topic" })
        .select()
        .single();

      if (insertError) console.error("Governance policy upsert error:", insertError);
      else results.push({ ...policy, evidence_signal_ids: evidence.map((e: any) => e.id), synthesis_provider: provider, synthesis_model: model });
    }

    const executionTime = Date.now() - startTime;
    await service.from("system_logs").insert({
      action: "governance_scan",
      division: "governance",
      user_id: user.id,
      log_level: "info",
      result: `Grounded ${results.length} policy intelligence record(s) for ${resolvedJurisdiction}; skipped ${skipped.length} without evidence`,
      metadata: { jurisdiction: resolvedJurisdiction, topics: topicsArray, skipped, execution_time_ms: executionTime, evidence_window_days: 90 },
    });

    return new Response(JSON.stringify({
      success: true,
      message: `Grounded ${results.length} ${resolvedJurisdiction} policy intelligence record(s)`,
      policies: results,
      skipped,
      legal_status: "intelligence_only_not_legal_advice",
      execution_time_ms: executionTime,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Governance scan error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
