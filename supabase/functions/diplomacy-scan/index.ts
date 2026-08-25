import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { aiChat } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const InputSchema = z.object({
  countries: z.array(z.string().trim().min(1).max(100)).min(1).max(50).optional(),
  country: z.string().trim().min(1).max(100).optional(),
  region: z.string().trim().min(1).max(100).optional(),
});

const clamp = (n: unknown, min: number, max: number, fallback: number) => {
  const value = Number(n);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const validation = InputSchema.safeParse(await req.json().catch(() => ({})));
    if (!validation.success) {
      return new Response(JSON.stringify({ error: "Invalid input", details: validation.error.issues }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { countries, country, region } = validation.data;
    const startTime = Date.now();
    let countryList: string[] = [];

    if (countries?.length) countryList = countries;
    else if (country) countryList = [country];
    else if (region) {
      try {
        const response = await fetch(`https://api.worldbank.org/v2/country?region=${encodeURIComponent(region)}&format=json&per_page=100`, { signal: AbortSignal.timeout(8000) });
        const data = await response.json();
        if (Array.isArray(data) && Array.isArray(data[1])) countryList = data[1].map((c: any) => String(c.name)).filter(Boolean);
      } catch (error) {
        console.warn("Region lookup failed:", error);
      }
    }

    if (countryList.length === 0) {
      const { data } = await serviceClient.from("country_profiles").select("country_name").order("compiled_at", { ascending: false }).limit(10);
      countryList = [...new Set((data || []).map((p: any) => String(p.country_name || "")).filter(Boolean))];
    }

    if (countryList.length === 0) {
      return new Response(JSON.stringify({ success: true, signals: [], message: "No countries available for evidence-backed diplomacy scan" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentSignals, error: signalError } = await serviceClient
      .from("global_signals")
      .select("id,title,summary,normalized_summary,category,confidence_score,impact_score,urgency_score,primary_source,source_references,source_trust_tier,multi_source_confirmed,official_source_present,evidence_hash,affected_countries,affected_regions,first_detected_at,latest_update_at,uncertainty_notes")
      .in("category", ["governance", "security", "trade", "finance", "political_stability"])
      .gte("first_detected_at", since)
      .order("first_detected_at", { ascending: false })
      .limit(500);
    if (signalError) throw signalError;

    const results: any[] = [];
    for (const countryName of countryList.slice(0, 50)) {
      const needle = countryName.toLowerCase();
      const evidence = (recentSignals || []).filter((s: any) => {
        const countries = Array.isArray(s.affected_countries) ? s.affected_countries.map((v: unknown) => String(v).toLowerCase()) : [];
        const regions = Array.isArray(s.affected_regions) ? s.affected_regions.map((v: unknown) => String(v).toLowerCase()) : [];
        const text = `${s.title || ""} ${s.summary || ""} ${s.normalized_summary || ""}`.toLowerCase();
        return countries.some((v: string) => v === needle || v.includes(needle) || needle.includes(v)) ||
          regions.some((v: string) => v === needle || v.includes(needle) || needle.includes(v)) || text.includes(needle);
      }).slice(0, 25);

      if (evidence.length === 0) continue;

      const weighted = evidence.map((e: any) => {
        const corroboration = e.multi_source_confirmed ? 1.1 : 1;
        const official = e.official_source_present ? 1.1 : 1;
        const confidence = clamp(e.confidence_score, 0, 100, 50) / 100;
        return { e, weight: Math.max(0.2, confidence * corroboration * official) };
      });
      const weightSum = weighted.reduce((sum, x) => sum + x.weight, 0) || 1;
      const avgImpact = weighted.reduce((sum, x) => sum + clamp(x.e.impact_score, 0, 100, 0) * x.weight, 0) / weightSum;
      const avgUrgency = weighted.reduce((sum, x) => sum + clamp(x.e.urgency_score, 0, 100, 0) * x.weight, 0) / weightSum;
      const riskIndex = Math.round(clamp(0.6 * avgImpact + 0.4 * avgUrgency, 0, 100, 0));

      // Diplomatic sentiment is not inferable from generic risk signals without a validated polarity model.
      // Persist a neutral sentinel rather than fabricating a positive/negative score.
      const sentiment = 0;
      const evidencePayload = evidence.map((e: any) => ({
        id: e.id,
        title: e.title,
        category: e.category,
        confidence_score: e.confidence_score,
        impact_score: e.impact_score,
        urgency_score: e.urgency_score,
        source: e.primary_source,
        source_trust_tier: e.source_trust_tier,
        multi_source_confirmed: e.multi_source_confirmed,
        official_source_present: e.official_source_present,
        evidence_hash: e.evidence_hash,
        detected_at: e.first_detected_at,
        uncertainty_notes: e.uncertainty_notes,
      }));

      let summary = `Evidence-backed diplomacy risk scan for ${countryName}: ${evidence.length} recent signals; deterministic risk index ${riskIndex}/100. Sentiment not measured by this scanner.`;
      try {
        const ai = await aiChat({
          messages: [
            { role: "system", content: "You are an AICIS geopolitical evidence summarizer. Use only the supplied evidence. Do not invent events, diplomatic positions, sentiment, probabilities, or current facts not present in the evidence. State uncertainty explicitly. Keep the briefing under 180 words." },
            { role: "user", content: `Country: ${countryName}\nDeterministic risk index: ${riskIndex}/100\nSentiment: not measured (stored neutral sentinel 0)\nEvidence:\n${JSON.stringify(evidencePayload).slice(0, 12000)}` },
          ],
          temperature: 0.15,
          maxTokens: 500,
          timeoutMs: 12000,
        });
        summary = `${ai.content}\n\nEvidence basis: ${evidence.length} AICIS signals. Risk index is deterministic; sentiment is not inferred. Provider: ${ai.provider}; model: ${ai.model}.`;
      } catch (error) {
        console.warn(`AI summary unavailable for ${countryName}:`, error);
      }

      const { data: signal, error: insertError } = await serviceClient.from("diplo_signals").upsert({
        country: countryName,
        sentiment,
        risk_index: riskIndex,
        summary_md: summary,
        updated_at: new Date().toISOString(),
      }, { onConflict: "country" }).select().single();

      if (insertError) console.error("Diplomacy upsert failed:", insertError.message);
      else if (signal) results.push(signal);
    }

    const executionTime = Date.now() - startTime;
    await serviceClient.from("system_logs").insert({
      action: "diplomacy_scan",
      division: "diplomacy",
      user_id: user.id,
      log_level: "info",
      result: `Persisted ${results.length} evidence-backed diplomacy signals`,
      metadata: { countries_considered: countryList.length, results: results.length, evidence_window_days: 14, sentiment_method: "not_measured_neutral_sentinel", risk_method: "weighted_impact_urgency", execution_time_ms: executionTime },
    });

    return new Response(JSON.stringify({
      success: true,
      message: `Scanned diplomacy evidence for ${results.length} countries`,
      signals: results,
      methodology: { risk_index: "weighted evidence impact/urgency", sentiment: "not measured; neutral sentinel 0" },
      execution_time_ms: executionTime,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Diplomacy scan error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
