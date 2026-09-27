import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import {
  generateOpportunityHypotheses,
  OPPORTUNITY_HYPOTHESIS_VERSION,
} from "../_shared/opportunity-hypothesis-v1.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type JsonRecord = Record<string, unknown>;

type RelevanceRow = {
  signal_id: string;
  relevance_score: number;
  relevance_tier: string;
  relevance_reason: unknown;
  computed_at: string;
};

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await sb.auth.getUser();
  if (authError || !user) return json({ ok: false, error: "Unauthorized" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body.limit ?? 100), 1), 300);

    const { data: prefs } = await sb
      .from("aicis_relevance_preferences")
      .select("alert_preferences")
      .eq("user_id", user.id)
      .maybeSingle();

    const alertPreferences = asRecord(prefs?.alert_preferences);
    const opportunityProfile = asRecord(alertPreferences.opportunity_profile);
    const minRelevance = Number.isFinite(Number(body.min_relevance_score))
      ? Number(body.min_relevance_score)
      : Number.isFinite(Number(opportunityProfile.min_relevance_score))
        ? Number(opportunityProfile.min_relevance_score)
        : 45;

    const { data: relevanceRows, error: relevanceError } = await sb
      .from("signal_relevance_scores")
      .select("signal_id,relevance_score,relevance_tier,relevance_reason,computed_at")
      .eq("user_id", user.id)
      .gte("relevance_score", minRelevance)
      .order("relevance_score", { ascending: false })
      .limit(limit);
    if (relevanceError) throw relevanceError;

    const typedRelevanceRows = (relevanceRows ?? []) as RelevanceRow[];
    const ids = typedRelevanceRows.map((row) => row.signal_id).filter(Boolean);
    if (ids.length === 0) {
      return json({
        ok: true,
        hypothesis_version: OPPORTUNITY_HYPOTHESIS_VERSION,
        min_relevance_score: minRelevance,
        signals_scanned: 0,
        hypotheses: [],
      });
    }

    const { data: signals, error: signalError } = await sb
      .from("global_signals")
      .select("id,title,summary,category,subcategory,affected_countries,affected_regions,affected_sectors,affected_stakeholders,source_references,evidence_hash,source_identifier_count,source_independence_status")
      .in("id", ids);
    if (signalError) throw signalError;

    const relevanceBySignal: Record<string, RelevanceRow> = {};
    for (const row of typedRelevanceRows) {
      relevanceBySignal[row.signal_id] = row;
    }

    const hypotheses = generateOpportunityHypotheses(signals ?? [], relevanceBySignal);

    await sb.from("system_logs").insert({
      user_id: user.id,
      division: "finance",
      action: "generate_opportunity_hypotheses",
      result: hypotheses.length ? "hypotheses_generated" : "no_supported_product_hypotheses",
      log_level: "info",
      metadata: {
        hypothesis_version: OPPORTUNITY_HYPOTHESIS_VERSION,
        min_relevance_score: minRelevance,
        signals_scanned: signals?.length ?? 0,
        hypotheses_generated: hypotheses.length,
        transaction_eligible: 0,
      },
    });

    return json({
      ok: true,
      hypothesis_version: OPPORTUNITY_HYPOTHESIS_VERSION,
      min_relevance_score: minRelevance,
      signals_scanned: signals?.length ?? 0,
      hypotheses,
      guardrail: "Hypotheses are personalized research prompts only. They contain no verified transaction economics and are not execution recommendations.",
    });
  } catch (error) {
    console.error("generate-opportunity-hypotheses failed", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Opportunity hypothesis generation failed",
    }, 500);
  }
});
