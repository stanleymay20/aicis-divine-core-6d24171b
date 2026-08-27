import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.25.76";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "cognitive-event-ingest";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const epistemicStatus = z.enum([
  "observed",
  "derived",
  "inferred",
  "predicted",
  "hypothesized",
  "simulated",
  "unverified",
  "contradicted",
]);

const eventType = z.enum([
  "signal.observed",
  "entity.resolved",
  "claim.extracted",
  "claim.verified",
  "claim.contradicted",
  "relationship.proposed",
  "relationship.verified",
  "event.detected",
  "anomaly.detected",
  "novelty.detected",
  "graph.updated",
  "topology.changed",
  "cascade.detected",
  "feedback_loop.detected",
  "hypothesis.created",
  "hypothesis.updated",
  "hypothesis.refuted",
  "forecast.generated",
  "decision.proposed",
  "decision.approved",
  "action.executed",
  "outcome.observed",
  "model.degraded",
  "model.promoted",
  "model.promotion_evaluated",
  "sensor.degraded",
]);

const provenance = z.object({
  sourceId: z.string().trim().min(1).max(300),
  sourceType: z.string().trim().min(1).max(80),
  sourceUri: z.string().url().max(2_000).optional(),
  publishedAt: z.string().datetime().optional(),
  observedAt: z.string().datetime(),
  extractor: z.string().trim().max(160).optional(),
  extractorVersion: z.string().trim().max(80).optional(),
  evidenceHash: z.string().trim().max(256).optional(),
});

const inputSchema = z.object({
  eventType,
  epistemicStatus,
  confidence: z.number().min(0).max(1).nullable().optional(),
  confidenceSemantics: z.string().trim().min(1).max(240).optional(),
  subjectEntityId: z.string().uuid().optional(),
  correlationId: z.string().uuid().optional(),
  causationId: z.string().uuid().optional(),
  occurredAt: z.string().datetime().nullable().optional(),
  observedAt: z.string().datetime().optional(),
  timeSemantics: z.string().trim().min(1).max(300).optional(),
  producer: z.string().trim().min(1).max(160),
  payload: z.record(z.unknown()).default({}),
  provenance: z.array(provenance).max(100).default([]),
}).superRefine((value, ctx) => {
  // Observed facts must have at least one source. This is the first hard
  // epistemic boundary in the cognitive pipeline.
  if (value.epistemicStatus === "observed" && value.provenance.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["provenance"],
      message: "Observed events require provenance",
    });
  }

  // If a caller supplies explicit semantics it must not contradict the value's
  // presence. NULL confidence means the quantity is not numerically expressed.
  if (value.confidence === null && value.confidenceSemantics?.toLowerCase().includes("calibrated")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confidenceSemantics"],
      message: "NULL confidence cannot be labeled calibrated numeric confidence",
    });
  }
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "POST" },
    });
  }

  const { user, via, response } = await requireAdminOrCron(req, corsHeaders);
  if (response) return response;

  const parsed = inputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid cognitive event", issues: parsed.error.flatten() }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const value = parsed.data;
  const observedAt = value.observedAt ?? new Date().toISOString();
  const confidence = value.confidence ?? null;
  const confidenceSemantics = confidence === null
    ? value.confidenceSemantics ?? "unknown_not_quantified"
    : value.confidenceSemantics ?? "caller_supplied_numeric_semantics_unspecified";
  const occurredAt = value.occurredAt ?? null;
  const timeSemantics = occurredAt === null
    ? value.timeSemantics ?? "occurrence_time_unknown_observation_time_not_substituted"
    : value.timeSemantics ?? "caller_supplied_occurrence_time_semantics_unspecified";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data, error } = await supabase
    .from("aicis_cognitive_events")
    .insert({
      event_type: value.eventType,
      epistemic_status: value.epistemicStatus,
      confidence,
      confidence_semantics: confidenceSemantics,
      subject_entity_id: value.subjectEntityId ?? null,
      correlation_id: value.correlationId ?? null,
      causation_id: value.causationId ?? null,
      occurred_at: occurredAt,
      observed_at: observedAt,
      time_semantics: timeSemantics,
      producer: value.producer,
      payload: value.payload,
      provenance: value.provenance,
    })
    .select("id,event_type,epistemic_status,confidence,confidence_semantics,occurred_at,observed_at,time_semantics,producer")
    .single();

  if (error) {
    console.error(JSON.stringify({
      level: "error",
      function: FN,
      message: "event_insert_failed",
      error: error.message,
      timestamp: new Date().toISOString(),
    }));
    return new Response(JSON.stringify({ error: "Failed to persist cognitive event" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  await supabase.from("system_logs").insert({
    action: "cognitive_event_ingested",
    user_id: user?.id ?? null,
    log_level: "info",
    result: `${value.eventType} persisted`,
    metadata: {
      cognitive_event_id: data.id,
      epistemic_status: value.epistemicStatus,
      confidence,
      confidence_semantics: confidenceSemantics,
      occurred_at: occurredAt,
      observed_at: observedAt,
      time_semantics: timeSemantics,
      auth_via: via,
      producer: value.producer,
    },
  });

  return new Response(JSON.stringify({
    success: true,
    event: data,
    epistemic_contract: {
      missing_confidence_remains_null: true,
      missing_occurrence_time_remains_null: true,
      observation_time_substituted_for_occurrence_time: false,
    },
  }), {
    status: 201,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
