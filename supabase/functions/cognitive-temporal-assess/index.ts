import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "cognitive-temporal-assess";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RELATION_SEMANTICS = "deterministic_timestamp_ordering_with_explicit_tolerance_v2";
const CONFIDENCE_SEMANTICS = "not_applicable_deterministic_timestamp_ordering";

type EventRow = {
  id: string;
  occurred_at: string | null;
  observed_at: string;
  time_semantics: string | null;
  confidence: number | null;
  confidence_semantics: string | null;
  epistemic_status: string;
  event_type: string;
};

type TemporalAssessment = {
  relation: "before" | "after" | "simultaneous" | "unknown";
  plausible_forward_causation: boolean;
  confidence: null;
  confidence_semantics: string;
  relation_semantics: string;
  lag_ms: number | null;
  tolerance_ms: number;
  reasons: string[];
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
  if (body.cause_event_id === body.effect_event_id) {
    return json({ error: "Events must be distinct" }, 400);
  }

  const toleranceResult = parseTolerance(body.tolerance_ms);
  if (!toleranceResult.ok) return json({ error: toleranceResult.error }, 400);
  const toleranceMs = toleranceResult.value;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data: rows, error } = await supabase
    .from("aicis_cognitive_events")
    .select("id,occurred_at,observed_at,time_semantics,confidence,confidence_semantics,epistemic_status,event_type")
    .in("id", [body.cause_event_id, body.effect_event_id]);
  if (error) return json({ error: "Failed to load events" }, 500);
  if (!rows || rows.length !== 2) return json({ error: "One or both events were not found" }, 404);

  const byId = new Map((rows as EventRow[]).map((row) => [row.id, row]));
  const cause = byId.get(body.cause_event_id);
  const effect = byId.get(body.effect_event_id);
  if (!cause || !effect) return json({ error: "Event lookup failed" }, 500);

  const assessment = assess(cause, effect, toleranceMs);
  const assessedAt = new Date().toISOString();

  const { data: persisted, error: persistError } = await supabase
    .from("aicis_temporal_relations")
    .upsert({
      cause_event_id: cause.id,
      effect_event_id: effect.id,
      relation: assessment.relation,
      plausible_forward_causation: assessment.plausible_forward_causation,
      confidence: assessment.confidence,
      confidence_semantics: assessment.confidence_semantics,
      relation_semantics: assessment.relation_semantics,
      lag_ms: assessment.lag_ms,
      reasons: assessment.reasons,
      assessed_at: assessedAt,
    }, { onConflict: "cause_event_id,effect_event_id" })
    .select("id")
    .single();
  if (persistError || !persisted) return json({ error: "Failed to persist temporal assessment" }, 500);

  if (!assessment.plausible_forward_causation && assessment.relation === "after") {
    await supabase.from("aicis_cognitive_events").insert({
      event_type: "claim.contradicted",
      epistemic_status: "derived",
      confidence: null,
      confidence_semantics: "not_quantified_temporal_order_contradiction_record",
      occurred_at: assessedAt,
      observed_at: assessedAt,
      time_semantics: "assessment_event_time_not_source_event_time",
      producer: FN,
      payload: {
        contradiction_type: "temporal-order",
        cause_event_id: cause.id,
        effect_event_id: effect.id,
        cause_event_type: cause.event_type,
        effect_event_type: effect.event_type,
        relation: assessment.relation,
        lag_ms: assessment.lag_ms,
        tolerance_ms: assessment.tolerance_ms,
        relation_semantics: assessment.relation_semantics,
        reasons: assessment.reasons,
        note: "The proposed cause occurs after the proposed effect under the selected timestamp tolerance. This rules out ordinary forward temporal order only; it does not establish an alternative cause or rule out timestamp error/common causes.",
      },
      provenance: [{
        sourceId: `temporal-relation:${persisted.id}`,
        sourceType: "derived-temporal-assessment",
        observedAt: assessedAt,
        extractor: FN,
        extractorVersion: "2",
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
      cause_time_semantics: cause.time_semantics,
      effect_time_semantics: effect.time_semantics,
      cause_epistemic_status: cause.epistemic_status,
      effect_epistemic_status: effect.epistemic_status,
      cause_confidence: cause.confidence,
      cause_confidence_semantics: cause.confidence_semantics,
      effect_confidence: effect.confidence,
      effect_confidence_semantics: effect.confidence_semantics,
      plausible_forward_causation: assessment.plausible_forward_causation,
      relation_semantics: assessment.relation_semantics,
      confidence_semantics: assessment.confidence_semantics,
      lag_ms: assessment.lag_ms,
      tolerance_ms: assessment.tolerance_ms,
      auth_via: via,
    },
  });

  return json({
    success: true,
    relation_id: persisted.id,
    ...assessment,
    source_event_epistemics: {
      cause: {
        status: cause.epistemic_status,
        confidence: cause.confidence,
        confidence_semantics: cause.confidence_semantics,
        occurred_at: cause.occurred_at,
        observed_at: cause.observed_at,
        time_semantics: cause.time_semantics,
      },
      effect: {
        status: effect.epistemic_status,
        confidence: effect.confidence,
        confidence_semantics: effect.confidence_semantics,
        occurred_at: effect.occurred_at,
        observed_at: effect.observed_at,
        time_semantics: effect.time_semantics,
      },
    },
  });
});

function assess(cause: EventRow, effect: EventRow, toleranceMs: number): TemporalAssessment {
  if (!cause.occurred_at || !effect.occurred_at) {
    return {
      relation: "unknown",
      plausible_forward_causation: false,
      confidence: null,
      confidence_semantics: CONFIDENCE_SEMANTICS,
      relation_semantics: RELATION_SEMANTICS,
      lag_ms: null,
      tolerance_ms: toleranceMs,
      reasons: ["One or both source event occurrence times are unknown; observation/ingestion time is not substituted"],
    };
  }

  const causeTime = Date.parse(cause.occurred_at);
  const effectTime = Date.parse(effect.occurred_at);
  if (!Number.isFinite(causeTime) || !Number.isFinite(effectTime)) {
    return {
      relation: "unknown",
      plausible_forward_causation: false,
      confidence: null,
      confidence_semantics: CONFIDENCE_SEMANTICS,
      relation_semantics: RELATION_SEMANTICS,
      lag_ms: null,
      tolerance_ms: toleranceMs,
      reasons: ["One or both persisted source event occurrence times could not be parsed; temporal order is unknown"],
    };
  }

  const lag = effectTime - causeTime;
  if (lag > toleranceMs) {
    return {
      relation: "before",
      plausible_forward_causation: true,
      confidence: null,
      confidence_semantics: CONFIDENCE_SEMANTICS,
      relation_semantics: RELATION_SEMANTICS,
      lag_ms: lag,
      tolerance_ms: toleranceMs,
      reasons: ["Proposed cause timestamp precedes effect timestamp beyond the selected tolerance; chronology permits but does not prove forward causation"],
    };
  }
  if (lag < -toleranceMs) {
    return {
      relation: "after",
      plausible_forward_causation: false,
      confidence: null,
      confidence_semantics: CONFIDENCE_SEMANTICS,
      relation_semantics: RELATION_SEMANTICS,
      lag_ms: lag,
      tolerance_ms: toleranceMs,
      reasons: ["Proposed cause timestamp follows effect timestamp beyond the selected tolerance; ordinary forward causal order is temporally inconsistent"],
    };
  }
  return {
    relation: "simultaneous",
    plausible_forward_causation: false,
    confidence: null,
    confidence_semantics: CONFIDENCE_SEMANTICS,
    relation_semantics: RELATION_SEMANTICS,
    lag_ms: lag,
    tolerance_ms: toleranceMs,
    reasons: ["Event timestamps fall within the selected tolerance; timestamp ordering cannot establish a direction"],
  };
}

function parseTolerance(value: unknown): { ok: true; value: number } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: 60_000 };
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 86_400_000) {
    return { ok: false, error: "tolerance_ms must be a finite number from 0 through 86400000" };
  }
  return { ok: true, value };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
