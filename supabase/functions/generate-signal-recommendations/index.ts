import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { aiChat } from "../_shared/ai-gateway.ts";

const FN = "generate-signal-recommendations";
const SIGNAL_SCORE_SEMANTICS =
  "deterministic_source_registry_trust_and_source_event_recency_screen_v1_not_probability_source_independence_excluded";
const RECOMMENDATION_CONFIDENCE_SEMANTICS = "no_calibrated_recommendation_confidence_issued";
const SOURCE_INDEPENDENCE_SEMANTICS =
  "explicit_signal_source_origin_lineage_required_absence_never_implies_independence";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type Signal = {
  id: string;
  title: string;
  summary: string | null;
  category: string;
  confidence_score: number;
  confidence_score_semantics: string;
  urgency_score: number;
  impact_score: number;
  affected_countries: string[] | null;
  affected_sectors: string[] | null;
  source_identifier_count: number | null;
  independent_origin_count: number | null;
  source_independence_status: string | null;
  source_independence_semantics: string | null;
};

type ActionChoice = {
  action: string;
  rationale: string;
  provider?: string;
  model?: string;
};

const SEVERITY = (signal: Signal): "low" | "medium" | "high" | "critical" => {
  const score = Math.max(signal.urgency_score, signal.impact_score);
  if (score >= 90) return "critical";
  if (score >= 80) return "high";
  if (score >= 65) return "medium";
  return "low";
};

const TIME_TO_ACTION = (severity: string) =>
  severity === "critical" ? "24h" : severity === "high" ? "72h" : severity === "medium" ? "7d" : "30d";

const TEMPLATES: Record<string, { action: string; rationale: string }> = {
  climate_disaster: {
    action: "Pre-position contingency stock and verify alternate logistics corridors for the affected market(s); brief operations on the current disruption risk.",
    rationale: "The canonical climate/disaster signal has material urgency or impact and warrants continuity review.",
  },
  defense_conflict: {
    action: "Pause new exposure in the affected market(s) pending review; assess counterparty and personnel safety; verify insurance and force-majeure terms.",
    rationale: "The canonical defense/conflict signal indicates elevated operational and counterparty risk in the affected market(s).",
  },
  public_health: {
    action: "Review health-screening protocols for affected market(s), staff travel, and continuity of relevant medical supplies.",
    rationale: "The canonical public-health signal has material urgency or impact and warrants operational review.",
  },
  food_agriculture: {
    action: "Review alternate sourcing for impacted commodities and reassess price and inventory exposure in the affected market(s).",
    rationale: "The canonical food/agriculture signal indicates a material supply or price-risk condition requiring review.",
  },
  economic_financial: {
    action: "Recheck FX, credit and counterparty exposure to affected market(s) and validate existing hedge coverage.",
    rationale: "The canonical economic/financial signal has material urgency or impact and warrants exposure review.",
  },
  financial_markets: {
    action: "Recheck FX, credit, liquidity and counterparty exposure in affected market(s) and validate existing controls.",
    rationale: "The canonical financial-market signal indicates a material market-risk condition requiring review.",
  },
  cybersecurity: {
    action: "Increase incident-response readiness for affected market(s), review exposed credentials, and assess third-party dependencies.",
    rationale: "The canonical cyber signal has material urgency or impact and warrants defensive readiness review.",
  },
  cyber_security: {
    action: "Increase incident-response readiness for affected market(s), review exposed credentials, and assess third-party dependencies.",
    rationale: "The canonical cyber signal has material urgency or impact and warrants defensive readiness review.",
  },
  migration_displacement: {
    action: "Review staffing, humanitarian-corridor and local-partner exposure in affected market(s).",
    rationale: "The canonical displacement signal indicates a material operational or humanitarian condition requiring review.",
  },
  supply_chain: {
    action: "Review alternate suppliers and buffer-stock adequacy for impacted SKUs in affected market(s).",
    rationale: "The canonical supply-chain signal indicates a material continuity risk requiring review.",
  },
  energy: {
    action: "Verify energy-supply continuity, backup capacity and hedge coverage for operations in affected market(s).",
    rationale: "The canonical energy signal indicates a material supply or price-risk condition requiring review.",
  },
};

const FALLBACK = {
  action: "Review exposure to the affected market(s) and validate continuity plans within the suggested action window.",
  rationale: "The canonical event has a governed evidence-screen score and material urgency or impact warranting explicit review.",
};

async function aiAction(signal: Signal): Promise<ActionChoice | null> {
  try {
    const result = await aiChat({
      messages: [
        {
          role: "system",
          content: "You refine an advisory action from one canonical AICIS signal. Use ONLY the supplied signal fields. Do not add external facts, statistics, actors, timelines, causal claims, historical-frequency claims, or confidence claims. Return strict JSON with keys action and rationale. Each must be one concise sentence and remain advisory, not an autonomous command.",
        },
        {
          role: "user",
          content: JSON.stringify({
            title: signal.title,
            category: signal.category,
            countries: signal.affected_countries ?? [],
            sectors: signal.affected_sectors ?? [],
            summary: signal.summary?.slice(0, 700) ?? "",
            signal_evidence_screen_score: signal.confidence_score,
            signal_evidence_screen_semantics: signal.confidence_score_semantics,
            urgency_score: signal.urgency_score,
            impact_score: signal.impact_score,
            source_identifier_count: signal.source_identifier_count,
            source_independence_status: signal.source_independence_status ?? "not_assessed",
            independent_origin_count: signal.source_independence_status === "established"
              ? signal.independent_origin_count
              : null,
          }),
        },
      ],
      responseFormat: { type: "json_object" },
      temperature: 0.2,
      timeoutMs: 12000,
    });
    const parsed = JSON.parse(result.content) as Record<string, unknown>;
    const action = typeof parsed.action === "string" ? parsed.action.trim().slice(0, 1000) : "";
    const rationale = typeof parsed.rationale === "string" ? parsed.rationale.trim().slice(0, 1000) : "";
    if (!action || !rationale) return null;
    return { action, rationale, provider: result.provider, model: result.model };
  } catch (error) {
    console.warn("AI recommendation refinement unavailable; using deterministic template:", error);
    return null;
  }
}

Deno.serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "POST" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const started = Date.now();
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const limit = Math.min(Math.max(Number(body.limit ?? 100), 1), 300);
  const aiBudget = Math.min(Math.max(Number(body.ai_budget ?? 5), 0), 20);

  try {
    const { data: signals, error: signalError } = await supabase
      .from("global_signals")
      .select("id,title,summary,category,confidence_score,confidence_score_semantics,urgency_score,impact_score,affected_countries,affected_sectors,source_identifier_count,independent_origin_count,source_independence_status,source_independence_semantics")
      .eq("canonical_event_status", "canonical")
      .eq("confidence_score_semantics", SIGNAL_SCORE_SEMANTICS)
      .gte("confidence_score", 65)
      .or("urgency_score.gte.65,impact_score.gte.70")
      .order("latest_update_at", { ascending: false })
      .limit(limit);
    if (signalError) throw signalError;

    const typedSignals = (signals ?? []) as Signal[];
    const ids = typedSignals.map((signal) => signal.id);
    let existing = new Set<string>();
    if (ids.length > 0) {
      const { data } = await supabase
        .from("signal_action_recommendations")
        .select("signal_id")
        .in("signal_id", ids);
      existing = new Set((data ?? []).map((row) => String(row.signal_id)));
    }

    const todo = typedSignals.filter((signal) => !existing.has(signal.id));
    let createdRecommendations = 0;
    let aiUsed = 0;
    let queued = 0;

    for (const signal of todo) {
      const severity = SEVERITY(signal);
      let chosen: ActionChoice = TEMPLATES[signal.category] ?? FALLBACK;
      let method = "template:advisory_v2";
      if (severity === "critical" && aiUsed < aiBudget) {
        const ai = await aiAction(signal);
        if (ai) {
          chosen = ai;
          method = `ai:${ai.provider ?? "unknown"}:${ai.model ?? "unknown"}`.slice(0, 240);
          aiUsed += 1;
        }
      }

      const independenceEstablished =
        signal.source_independence_status === "established" &&
        Number.isInteger(signal.independent_origin_count) &&
        Number(signal.independent_origin_count) >= 2;
      const independentOriginCount = independenceEstablished
        ? Number(signal.independent_origin_count)
        : null;

      const { data: recommendation, error: recommendationError } = await supabase
        .from("signal_action_recommendations")
        .insert({
          signal_id: signal.id,
          category: signal.category,
          severity,
          affected_countries: signal.affected_countries ?? [],
          affected_sectors: signal.affected_sectors ?? [],
          recommended_action: chosen.action,
          rationale: chosen.rationale,
          confidence: null,
          confidence_semantics: RECOMMENDATION_CONFIDENCE_SEMANTICS,
          urgency_score: signal.urgency_score,
          impact_score: signal.impact_score,
          evidence_count: independentOriginCount,
          evidence_count_semantics: independentOriginCount === null
            ? "not_established_source_independence"
            : "explicit_independent_origin_count_from_complete_signal_source_lineage",
          input_signal_score: signal.confidence_score,
          input_signal_score_semantics: signal.confidence_score_semantics,
          source_identifier_count: signal.source_identifier_count,
          independent_origin_count: independentOriginCount,
          source_independence_status: signal.source_independence_status ?? "not_assessed",
          source_independence_semantics: signal.source_independence_semantics ?? SOURCE_INDEPENDENCE_SEMANTICS,
          suggested_time_to_action: TIME_TO_ACTION(severity),
          generation_method: method,
        })
        .select("id")
        .single();
      if (recommendationError || !recommendation) continue;
      createdRecommendations += 1;

      const countries = (signal.affected_countries ?? []).filter(Boolean);
      if (countries.length === 0) continue;
      const { data: watchers } = await supabase
        .from("watchlist_items")
        .select("user_id,country_iso3,priority_level,alert_threshold")
        .eq("is_active", true)
        .in("country_iso3", countries);

      const seenUsers = new Set<string>();
      for (const watcher of watchers ?? []) {
        const userId = watcher.user_id ? String(watcher.user_id) : "";
        if (!userId || seenUsers.has(userId)) continue;
        const threshold = Number(watcher.alert_threshold ?? 0);
        const score = Math.max(signal.urgency_score, signal.impact_score);
        if (threshold && score < threshold) continue;
        seenUsers.add(userId);

        const dedupKey = `sigrec:${recommendation.id}:${userId}`;
        const { error } = await supabase.from("risk_notification_queue").insert({
          user_id: userId,
          recommendation_id: recommendation.id,
          signal_id: signal.id,
          channel: "in_app",
          dedup_key: dedupKey,
          payload: {
            title: signal.title,
            category: signal.category,
            severity,
            countries,
            action: chosen.action,
            generation_method: method,
            recommendation_confidence: null,
            recommendation_confidence_semantics: RECOMMENDATION_CONFIDENCE_SEMANTICS,
            signal_evidence_screen_score: signal.confidence_score,
            signal_evidence_screen_semantics: signal.confidence_score_semantics,
            source_independence_status: signal.source_independence_status ?? "not_assessed",
            independent_origin_count: independentOriginCount,
          },
        });
        if (!error) queued += 1;
      }
    }

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: "success",
      message: `Created ${createdRecommendations} advisory recs (${aiUsed} AI refinements), queued ${queued} notifications, scanned ${typedSignals.length}`,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        scanned: typedSignals.length,
        created: createdRecommendations,
        ai_used: aiUsed,
        notifications_queued: queued,
        recommendation_confidence_semantics: RECOMMENDATION_CONFIDENCE_SEMANTICS,
        signal_score_semantics: SIGNAL_SCORE_SEMANTICS,
        elapsed_ms: Date.now() - started,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: "error",
      message: message.slice(0, 500),
    });
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});