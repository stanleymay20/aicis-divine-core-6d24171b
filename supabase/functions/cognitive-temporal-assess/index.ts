import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "cognitive-temporal-assess";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type EventRow = {
  id: string;
  occurred_at: string;
  observed_at: string;
  confidence: number;
  event_type: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { user, via, response } = await requireAdminOrCron(req, corsHeaders);
  if (response) return response;

  let body: { cause_event_id?: string; effect_event_id?: string; tolerance_ms?: number } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  if (!body.cause_event_id || !body.effect_event_id) {
    return json({ error: "cause_event_id and effect_event_id are required" }, 400);
  }
  if (body.cause_event_id === body.effect_event_id) return json({ error: "Events must be distinct" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data: rows, error } = await supabase
    .from("aicis_cognitive_events")
    .select("id,occurred_at,observed_at,confidence,event_type")
    .in("id", [body.cause_event_id, body.effect_event_id]);
  if (error) return json({ error: "Failed to load events" }, 500);
  if (!rows || rows.length !== 2) return json({ error: "One or both events were not found" }, 404);

  const byId = new Map((rows as EventRow[]).map((row) => [row.id, row]));
  const cause = byId.get(body.cause_event_id);
  const effect = byId.get(body.effect_event_id);
  if (!cause || !effect) return json({ error: "Event lookup failed" }, 500);

  const toleranceMs = Math.max(0, Math.min(Number(body.tolerance_ms ?? 60_000), 86_400_000));
  const assessment = assess(cause, effect, toleranceMs);

  const { data: persisted, error: persistError } = await supabase
    .from("aicis_temporal_relations")
    .upsert({
      cause_event_id: cause.id,
      effect_event_id: effect.id,
      relation: assessment.relation,
      plausible_forward_causation: assessment.plausible_forward_causation,
      confidence: assessment.confidence,
      lag_ms: assessment.lag_ms,
      reasons: assessment.reasons,
      assessed_at: new Date().toISOString(),
    }, { onConflict: "cause_event_id,effect_event_id" })
    .select("id")
    .single();
  if (persistError) return json({ error: "Failed to persist temporal assessment" }, 500);

  if (!assessment.plausible_forward_causation && assessment.relation === "after") {
    await supabase.from("aicis_cognitive_events").insert({
      event_type: "claim.contradicted",
      epistemic_status: "derived",
      confidence: assessment.confidence,
      occurred_at: new Date().toISOString(),
      observed_at: new Date().toISOString(),
      producer: FN,
      payload: {
        contradiction_type: "temporal-order",
        cause_event_id: cause.id,
        effect_event_id: effect.id,
        cause_event_type: cause.event_type,
        effect_event_type: effect.event_type,
        relation: assessment.relation,
        reasons: assessment.reasons,
        note: "Temporal inconsistency rejects ordinary forward causation but does not rule out common causes or data timestamp errors.",
      },
      provenance: [{
        sourceId: `temporal-relation:${persisted.id}`,
        sourceType: "derived-temporal-assessment",
        observedAt: new Date().toISOString(),
        extractor: FN,
        extractorVersion: "1",
      }],
    });
  }

  await supabase.from("system_logs").insert({
    action: "cognitive_temporal_assess",
    user_id: user?.id ?? null,
    log_level: "info",
    result: `${cause.event_type} ${assessment.relation} ${effect.event_type}`,
    metadata: {
      cause_event_id: cause.id,
      effect_event_id: effect.id,
      plausible_forward_causation: assessment.plausible_forward_causation,
      lag_ms: assessment.lag_ms,
      auth_via: via,
    },
  });

  return json({ success: true, relation_id: persisted.id, ...assessment });
});

function assess(cause: EventRow, effect: EventRow, toleranceMs: number) {
  const causeTime = Date.parse(cause.occurred_at || cause.observed_at);
  const effectTime = Date.parse(effect.occurred_at || effect.observed_at);
  const confidence = clamp01(Math.min(Number(cause.confidence), Number(effect.confidence)));
  if (!Number.isFinite(causeTime) || !Number.isFinite(effectTime)) {
    return { relation: "unknown", plausible_forward_causation: false, confidence: 0.2, lag_ms: null, reasons: ["Invalid event timestamp"] };
  }

  const lag = effectTime - causeTime;
  if (lag > toleranceMs) {
    return { relation: "before", plausible_forward_causation: true, confidence, lag_ms: lag, reasons: ["Proposed cause precedes effect"] };
  }
  if (lag < -toleranceMs) {
    return { relation: "after", plausible_forward_causation: false, confidence, lag_ms: lag, reasons: ["Proposed cause occurs after effect"] };
  }
  return {
    relation: "simultaneous",
    plausible_forward_causation: false,
    confidence: confidence * 0.7,
    lag_ms: lag,
    reasons: ["Events are approximately simultaneous; ordering cannot establish direction"],
  };
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
