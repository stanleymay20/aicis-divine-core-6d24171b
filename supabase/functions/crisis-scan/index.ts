import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, errorResponse, jsonResponse } from "../_shared/resilience.ts";
import { aiChat, AiProviderError } from "../_shared/ai-gateway.ts";

const FN = "crisis-scan";
type SupabaseClientType = ReturnType<typeof createClient>;

type SignalRow = {
  id: string;
  affected_regions: unknown;
  geo_admin0_iso3: string | null;
  impact_score: number | null;
  urgency_score: number | null;
};

type CrisisFocus = {
  region: string;
  severity: number;
  evidence_signal_count: number;
  evidence_signal_ids: string[];
};

type CrisisAssessment = {
  kind: string;
  region: string;
  details: string | null;
  focus: CrisisFocus;
} | null;

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const start = Date.now();

  try {
    const authHeader = req.headers.get("Authorization");
    let supabaseClient: SupabaseClientType;
    let userId = "system-cron";

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "___";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "___";
    const isSystemCall = !authHeader || authHeader.includes(anonKey) || authHeader.includes(serviceRoleKey);

    if (!isSystemCall) {
      supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader ?? "" } } },
      );
      const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
      if (authError || !user) throw new Error("Unauthorized");
      userId = user.id;
    } else {
      supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      );
    }

    structuredLog("info", FN, "Starting crisis scan", { user_id: userId });

    const crisisTypes = ["weather", "seismic", "outage", "health"];
    const KIND_CATEGORIES: Record<string, string[]> = {
      weather: ["climate_disaster", "water_hydrology"],
      seismic: ["climate_disaster", "infrastructure"],
      outage: ["energy", "infrastructure"],
      health: ["public_health"],
    };
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    async function deriveFocus(kind: string): Promise<CrisisFocus | null> {
      const { data, error } = await supabaseClient
        .from("global_signals")
        .select("id, affected_regions, geo_admin0_iso3, impact_score, urgency_score")
        .in("category", KIND_CATEGORIES[kind] ?? [])
        .gte("first_detected_at", since24h)
        .order("impact_score", { ascending: false, nullsFirst: false })
        .limit(200);
      if (error || !data || data.length === 0) return null;

      const tally = new Map<string, number>();
      for (const row of data) {
        const keys: string[] = Array.isArray(row.affected_regions) && row.affected_regions.length
          ? row.affected_regions as string[]
          : (row.geo_admin0_iso3 ? [row.geo_admin0_iso3 as string] : []);
        for (const key of keys) tally.set(key, (tally.get(key) ?? 0) + 1);
      }
      const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!top) return null;

      const focused = (data as SignalRow[]).filter((row: SignalRow) => {
        const keys: string[] = Array.isArray(row.affected_regions) && row.affected_regions.length
          ? row.affected_regions as string[]
          : (row.geo_admin0_iso3 ? [row.geo_admin0_iso3 as string] : []);
        return keys.includes(top[0]);
      });
      const avg = (fn: (row: SignalRow) => number) =>
        focused.reduce((sum: number, row: SignalRow) => sum + (fn(row) || 0), 0) / Math.max(1, focused.length);
      const severity = Math.max(0, Math.min(10,
        Math.round((0.6 * avg((row: SignalRow) => row.impact_score ?? 0) + 0.4 * avg((row: SignalRow) => row.urgency_score ?? 0)) / 10),
      ));

      return {
        region: top[0],
        severity,
        evidence_signal_count: focused.length,
        evidence_signal_ids: focused.slice(0, 25).map((row: SignalRow) => row.id),
      };
    }

    const results = [];
    const escalations = [];
    let aiSkipped = false;
    const HARD_DEADLINE_MS = 50000;
    const deadlineExceeded = () => (Date.now() - start) > HARD_DEADLINE_MS;

    try {
      await aiChat({
        messages: [{ role: "user", content: "Reply with OK." }],
        maxTokens: 2,
        timeoutMs: 4000,
      });
    } catch (error) {
      aiSkipped = true;
      structuredLog("warn", FN, "AI provider preflight unavailable; using deterministic fallback", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const aiPromises: Array<Promise<CrisisAssessment>> = crisisTypes.map(async (kind) => {
      const focus = await deriveFocus(kind);
      if (!focus) return null;
      const region = focus.region;
      let details: string | null = null;

      if (!aiSkipped) {
        try {
          details = await resilientCall(`${FN}:ai:${kind}`, async () => {
            const result = await aiChat({
              messages: [
                {
                  role: "system",
                  content: "You are a crisis response coordinator. Provide factual assessments and response recommendations. Keep responses under 150 words.",
                },
                {
                  role: "user",
                  content: `Assess current ${kind} crisis risks in ${region}. Rate severity 0-10. Provide response recommendations. Format as markdown.`,
                },
              ],
              maxTokens: 300,
              timeoutMs: 12000,
            });
            return result.content;
          }, { maxRetries: 0, timeoutMs: 15000 });
        } catch (aiErr) {
          const msg = aiErr instanceof Error ? aiErr.message : String(aiErr);
          const status = aiErr instanceof AiProviderError ? aiErr.status : undefined;
          structuredLog("warn", FN, `AI call failed for ${kind}`, { error: msg, status });
          if (status === 402 || status === 429) aiSkipped = true;
          details = `[AI assessment unavailable] Crisis type: ${kind}, Region: ${region}`;
        }
      } else {
        details = `[AI assessment unavailable] Crisis type: ${kind}, Region: ${region}`;
      }

      return { kind, region, details, focus };
    });

    const remainingMs = Math.max(1, HARD_DEADLINE_MS - (Date.now() - start));
    const aiResults = await Promise.race([
      Promise.allSettled(aiPromises),
      new Promise<PromiseSettledResult<CrisisAssessment>[]>((resolve) =>
        setTimeout(() => resolve(crisisTypes.map(() => ({ status: "rejected", reason: "deadline" } as PromiseRejectedResult))), remainingMs),
      ),
    ]);

    for (const settled of aiResults) {
      if (settled.status !== "fulfilled" || !settled.value) continue;
      if (deadlineExceeded()) {
        structuredLog("warn", FN, "deadline reached, skipping remaining writes");
        break;
      }
      const { kind, region, details, focus } = settled.value;
      const severity = focus.severity;
      const status = severity >= 7 ? "escalated" : "monitoring";
      const evidenceNote = `\n\n---\n**Evidence:** ${focus.evidence_signal_count} corroborating signals in the last 24h (severity derived from measured impact/urgency scores).`;

      const { data: crisis, error: insertError } = await supabaseClient
        .from("crisis_events")
        .insert({ kind, region, severity, status, details_md: (details ?? "") + evidenceNote, opened_at: new Date().toISOString() })
        .select()
        .single();

      if (insertError) {
        structuredLog("warn", FN, `Insert failed for ${kind}`, { error: insertError.message });
        continue;
      }
      results.push(crisis);

      const domain = kind === "health" ? "health"
        : kind === "weather" ? "climate"
        : kind === "seismic" ? "climate"
        : "infrastructure";
      const usedAI = !!details && !details.startsWith("[AI assessment unavailable");
      const playbook = {
        weather: ["Activate regional met-office advisory", "Pre-position relief supplies", "Issue early-warning alert to civic nodes"],
        seismic: ["Trigger USGS shake-map review", "Open humanitarian coordination channel", "Pre-stage urban search-and-rescue assets"],
        outage: ["Notify utility operators", "Activate backup grid corridors", "Issue conservation guidance to high-load regions"],
        health: ["Notify WHO regional office", "Issue surveillance ramp-up to clinics", "Pre-deploy diagnostic kits"],
      } as Record<string, string[]>;
      const options = (playbook[kind] || ["Monitor", "Notify partners", "Escalate to division lead"]).map((label, index) => ({
        rank: index + 1,
        label,
        expected_impact: severity >= 7 ? "high" : severity >= 4 ? "medium" : "low",
      }));

      await supabaseClient.from("adi_decisions").insert({
        signal_source: "crisis-scan",
        signal_summary: `${kind} risk in ${region} (severity ${severity}/10)`,
        domain,
        region,
        severity_score: severity,
        confidence: usedAI ? 0.7 : 0.55,
        options,
        recommended_option_rank: 1,
        reasoning_md: details ?? `Deterministic playbook for ${kind} crisis in ${region}.`,
        status: severity >= 7 ? "pending_review" : "auto_approved",
      });

      if (severity >= 7) {
        const { data: approval } = await supabaseClient
          .from("approvals")
          .insert({
            requester: userId,
            division: "crisis",
            action: `Escalate ${kind} crisis in ${region}`,
            payload: { crisis_id: crisis.id, severity, region, kind },
            status: "pending",
          })
          .select()
          .single();
        if (approval) escalations.push(approval);
      }
    }

    await supabaseClient.from("automation_logs").insert({
      job_name: "crisis-scan",
      status: escalations.length > 0 ? "warning" : "success",
      message: `Detected ${results.length} crisis events, ${escalations.length} escalations, ${results.length} decisions emitted${aiSkipped ? " (deterministic fallback — AI provider unavailable)" : ""} (${Date.now() - start}ms)`,
    });

    structuredLog("info", FN, `Scan complete: ${results.length} events, ${results.length} decisions`, undefined, start);
    return jsonResponse({
      success: true,
      message: `Scanned: ${results.length} events, ${escalations.length} escalated, ${results.length} decisions`,
      events: results,
      escalations,
      ai_skipped: aiSkipped,
      execution_time_ms: Date.now() - start,
    });
  } catch (error) {
    structuredLog("error", FN, (error as Error).message, undefined, start);
    return errorResponse(error);
  }
});
