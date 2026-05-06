// Phase 5 — Decision-loop generator.
// For every canonical signal meeting confidence/urgency/impact thresholds,
// create a signal_action_recommendation (template-first, AI only for critical),
// then queue notifications to users whose tracked markets overlap.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

const SEVERITY = (s: Signal): "low" | "medium" | "high" | "critical" => {
  const score = Math.max(s.urgency_score, s.impact_score);
  if (score >= 90) return "critical";
  if (score >= 80) return "high";
  if (score >= 65) return "medium";
  return "low";
};

const TIME_TO_ACTION = (sev: string) =>
  sev === "critical" ? "24h" : sev === "high" ? "72h" : sev === "medium" ? "7d" : "30d";

// Deterministic templates per category
const TEMPLATES: Record<string, { action: string; rationale: string }> = {
  climate_disaster: {
    action: "Pre-position contingency stock and verify alternate logistics corridors for the affected market(s); brief operations on 72h disruption window.",
    rationale: "Climate/disaster signals at this confidence typically trigger 3–14 day logistics and supply disruption windows.",
  },
  defense_conflict: {
    action: "Freeze new exposure in the affected market(s); review counterparty and personnel safety; activate insurance/force-majeure review.",
    rationale: "Defense/conflict events at this severity are associated with rapid liquidity, insurance and counterparty repricing.",
  },
  public_health: {
    action: "Activate health-screening protocols for affected market(s); review staff travel; engage local procurement for medical supplies if applicable.",
    rationale: "Public-health canonical events historically precede 1–4 week mobility and workforce constraints.",
  },
  food_agriculture: {
    action: "Lock alternative sourcing for impacted commodities and review price-hedging exposure for the affected market(s).",
    rationale: "Food/agriculture shocks of this magnitude routinely propagate into 30–90 day price volatility.",
  },
  economic_financial: {
    action: "Recheck FX, credit and counterparty exposure to affected market(s); validate hedging coverage for the next 30 days.",
    rationale: "Economic/financial canonical events at this confidence typically move pricing and credit conditions within days.",
  },
  financial_markets: {
    action: "Recheck FX, credit and counterparty exposure to affected market(s); validate hedging coverage for the next 30 days.",
    rationale: "Market-structure events at this severity propagate into pricing and counterparty risk quickly.",
  },
  cybersecurity: {
    action: "Trigger incident-response readiness for affected market(s); rotate relevant credentials and review third-party exposure.",
    rationale: "Cyber events of this severity routinely cascade through supply-chain partners within 24–72 hours.",
  },
  cyber_security: {
    action: "Trigger incident-response readiness for affected market(s); rotate relevant credentials and review third-party exposure.",
    rationale: "Cyber events of this severity routinely cascade through supply-chain partners within 24–72 hours.",
  },
  migration_displacement: {
    action: "Review staffing plans and humanitarian-corridor exposure in affected market(s); coordinate with local partners.",
    rationale: "Displacement signals at this confidence are associated with 2–8 week labour and logistics distortion.",
  },
  supply_chain: {
    action: "Activate alternate-supplier shortlist and confirm 30-day buffer stock for impacted SKUs in affected market(s).",
    rationale: "Supply-chain events at this confidence routinely produce multi-week lead-time slippage.",
  },
  energy: {
    action: "Confirm energy-supply continuity and short-term hedge coverage for operations in affected market(s).",
    rationale: "Energy events at this severity historically produce 1–6 week price and supply volatility.",
  },
};

const FALLBACK = {
  action: "Review exposure to the affected market(s) and validate continuity plans within the suggested action window.",
  rationale: "Canonical event with high confidence and material urgency or impact warrants explicit review.",
};

async function aiAction(signal: Signal): Promise<{ action: string; rationale: string } | null> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "You write 1-sentence concrete supply-chain / risk actions and 1-sentence rationales. JSON only." },
          { role: "user", content: `Signal: ${signal.title}\nCategory: ${signal.category}\nCountries: ${(signal.affected_countries||[]).join(",")}\nSummary: ${signal.summary?.slice(0,500)}\n\nReturn JSON {"action":"...","rationale":"..."}.` },
        ],
        temperature: 0.2,
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const txt = j?.choices?.[0]?.message?.content ?? "";
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const obj = JSON.parse(m[0]);
    if (obj?.action && obj?.rationale) return { action: String(obj.action), rationale: String(obj.rationale) };
    return null;
  } catch {
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
  const limit = Math.min(Number(body.limit ?? 100), 300);
  const aiBudget = Math.min(Number(body.ai_budget ?? 5), 20); // critical-only cap

  try {
    // 1. Candidate canonical signals without an existing recommendation
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
      let chosen = TEMPLATES[sig.category] ?? FALLBACK;
      let method = "template";
      if (sev === "critical" && aiUsed < aiBudget) {
        const ai = await aiAction(sig);
        if (ai) {
          chosen = ai;
          method = "ai";
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
      if (rErr) {
        // unique-violation = race; skip
        continue;
      }
      createdRecs++;

      // 2. Subscriber matching via watchlist_items
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
        // honour alert_threshold against signal severity score
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
            },
          });
        if (!qErr) queued++;
      }
    }

    await sb.from("automation_logs").insert({
      job_name: "generate-signal-recommendations",
      status: "success",
      message: `Created ${createdRecs} recs (${aiUsed} via AI), queued ${queued} notifications, scanned ${signals?.length ?? 0}`,
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
