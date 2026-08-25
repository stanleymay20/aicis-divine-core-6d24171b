// Phase 5 — Decision-loop generator.
// For every canonical signal meeting confidence/urgency/impact thresholds,
// create a signal_action_recommendation (template-first, AI only for critical),
// then queue notifications to users whose tracked markets overlap.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { aiChat } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Signal = {
  id: string;
  title: string;
  summary: string;
  category: string;
  confidence_score: number;
  urgency_score: number;
  impact_score: number;
  affected_countries: string[] | null;
  affected_sectors: string[] | null;
  source_count: number | null;
  merged_source_count: number | null;
};

type ActionChoice = {
  action: string;
  rationale: string;
  provider?: string;
  model?: string;
};

const SEVERITY = (s: Signal): "low" | "medium" | "high" | "critical" => {
  const score = Math.max(s.urgency_score, s.impact_score);
  if (score >= 90) return "critical";
  if (score >= 80) return "high";
  if (score >= 65) return "medium";
  return "low";
};

const TIME_TO_ACTION = (sev: string) =>
  sev === "critical" ? "24h" : sev === "high" ? "72h" : sev === "medium" ? "7d" : "30d";

// Deterministic advisory templates. Rationales describe why a review is warranted
// from the current AICIS signal, not unverified historical-frequency claims.
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
  rationale: "The canonical event has sufficient confidence and material urgency or impact to warrant explicit review.",
};

async function aiAction(signal: Signal): Promise<ActionChoice | null> {
  try {
    const result = await aiChat({
      messages: [
        {
          role: "system",
          content: "You refine an advisory action from one canonical AICIS signal. Use ONLY the supplied signal fields. Do not add external facts, statistics, actors, timelines, causal claims, or historical-frequency claims. Return strict JSON with keys action and rationale. Each must be one concise sentence and must remain advisory, not an autonomous command.",
        },
        {
          role: "user",
          content: JSON.stringify({
            title: signal.title,
            category: signal.category,
            countries: signal.affected_countries ?? [],
            sectors: signal.affected_sectors ?? [],
            summary: signal.summary?.slice(0, 700) ?? "",
            confidence_score: signal.confidence_score,
            urgency_score: signal.urgency_score,
            impact_score: signal.impact_score,
            evidence_count: Math.max(1, Number(signal.merged_source_count ?? signal.source_count ?? 1)),
          }),
        },
      ],
      responseFormat: { type: "json_object" },
      temperature: 0.2,
      timeoutMs: 12000,
    });
    const obj = JSON.parse(result.content);
    const action = typeof obj?.action === "string" ? obj.action.trim().slice(0, 1000) : "";
    const rationale = typeof obj?.rationale === "string" ? obj.rationale.trim().slice(0, 1000) : "";
    if (!action || !rationale) return null;
    return { action, rationale, provider: result.provider, model: result.model };
  } catch (error) {
    console.warn("AI recommendation refinement unavailable; using deterministic template:", error);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const started = Date.now();
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const limit = Math.min(Math.max(Number(body.limit ?? 100), 1), 300);
  const aiBudget = Math.min(Math.max(Number(body.ai_budget ?? 5), 0), 20);

  try {
    const { data: signals, error: sErr } = await sb
      .from("global_signals")
      .select("id,title,summary,category,confidence_score,urgency_score,impact_score,affected_countries,affected_sectors,source_count,merged_source_count")
      .eq("canonical_event_status", "canonical")
      .gte("confidence_score", 65)
      .or("urgency_score.gte.65,impact_score.gte.70")
      .order("latest_update_at", { ascending: false })
      .limit(limit);
    if (sErr) throw sErr;

    const ids = (signals ?? []).map((s) => s.id);
    let existing = new Set<string>();
    if (ids.length > 0) {
      const { data: ex } = await sb
        .from("signal_action_recommendations")
        .select("signal_id")
        .in("signal_id", ids);
      existing = new Set((ex ?? []).map((r) => r.signal_id));
    }

    const todo = (signals ?? []).filter((s) => !existing.has(s.id)) as Signal[];

    let createdRecs = 0;
    let aiUsed = 0;
    let queued = 0;

    for (const sig of todo) {
      const sev = SEVERITY(sig);
      let chosen: ActionChoice = TEMPLATES[sig.category] ?? FALLBACK;
      let method = "template";
      if (sev === "critical" && aiUsed < aiBudget) {
        const ai = await aiAction(sig);
        if (ai) {
          chosen = ai;
          method = `ai:${ai.provider ?? "unknown"}:${ai.model ?? "unknown"}`.slice(0, 240);
          aiUsed++;
        }
      }

      const evidence = Math.max(1, Number(sig.merged_source_count ?? sig.source_count ?? 1));
      const conf = Math.min(0.99, Math.max(0.4, sig.confidence_score / 100));

      const { data: rec, error: rErr } = await sb
        .from("signal_action_recommendations")
        .insert({
          signal_id: sig.id,
          category: sig.category,
          severity: sev,
          affected_countries: sig.affected_countries ?? [],
          affected_sectors: sig.affected_sectors ?? [],
          recommended_action: chosen.action,
          rationale: chosen.rationale,
          confidence: conf,
          urgency_score: sig.urgency_score,
          impact_score: sig.impact_score,
          evidence_count: evidence,
          suggested_time_to_action: TIME_TO_ACTION(sev),
          generation_method: method,
        })
        .select("id")
        .single();
      if (rErr) continue;
      createdRecs++;

      const countries = (sig.affected_countries ?? []).filter(Boolean);
      if (countries.length === 0) continue;
      const { data: watchers } = await sb
        .from("watchlist_items")
        .select("user_id,country_iso3,priority_level,alert_threshold")
        .eq("is_active", true)
        .in("country_iso3", countries);

      const userSeen = new Set<string>();
      for (const w of watchers ?? []) {
        if (!w.user_id || userSeen.has(w.user_id)) continue;
        const threshold = Number(w.alert_threshold ?? 0);
        const score = Math.max(sig.urgency_score, sig.impact_score);
        if (threshold && score < threshold) continue;
        userSeen.add(w.user_id);

        const dedup = `sigrec:${rec.id}:${w.user_id}`;
        const { error: qErr } = await sb
          .from("risk_notification_queue")
          .insert({
            user_id: w.user_id,
            recommendation_id: rec.id,
            signal_id: sig.id,
            channel: "in_app",
            dedup_key: dedup,
            payload: {
              title: sig.title,
              category: sig.category,
              severity: sev,
              countries,
              action: chosen.action,
              generation_method: method,
            },
          });
        if (!qErr) queued++;
      }
    }

    await sb.from("automation_logs").insert({
      job_name: "generate-signal-recommendations",
      status: "success",
      message: `Created ${createdRecs} recs (${aiUsed} AI refinements), queued ${queued} notifications, scanned ${signals?.length ?? 0}`,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        scanned: signals?.length ?? 0,
        created: createdRecs,
        ai_used: aiUsed,
        notifications_queued: queued,
        elapsed_ms: Date.now() - started,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("automation_logs").insert({
      job_name: "generate-signal-recommendations",
      status: "error",
      message: msg.slice(0, 500),
    });
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
