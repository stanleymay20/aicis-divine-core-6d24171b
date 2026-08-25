import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.25.76";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const OutcomeSchema = z.object({
  decision_id: z.string().uuid(),
  action_taken: z.boolean().optional(),
  outcome_success: z.boolean().optional(),
  impact_score: z.number().finite().min(0).max(100).optional(),
  outcome_description: nullableText(5000),
  recommendation_accepted: z.boolean().optional(),
  recommendation_rejected_reason: nullableText(2000),
  actor_role: nullableText(120),
  cost_of_action: z.number().finite().min(0).optional(),
  outcome_source: z.string().trim().min(1).max(120).optional(),
  execution_note: nullableText(5000),
  evidence_note: nullableText(5000),
  evidence_url: nullableText(2000),
  outcome_confidence: z.enum(["low", "medium", "high", "unknown"]).optional(),
  execution_owner: nullableText(200),
  execution_status: nullableText(80),
  execution_blocker: nullableText(2000),
}).superRefine((value, ctx) => {
  if (value.evidence_url) {
    try {
      const url = new URL(value.evidence_url);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence_url"], message: "Evidence URL must use http or https" });
      }
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence_url"], message: "Evidence URL is invalid" });
    }
  }

  if (value.outcome_success !== undefined) {
    const narrative = `${value.outcome_description ?? ""} ${value.evidence_note ?? ""}`.trim();
    if (!value.evidence_url && narrative.length < 30) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence_note"],
        message: "Outcome evidence requires an http(s) evidence URL or at least 30 characters of evidence notes",
      });
    }
  }
});

type UpdatePayload = Record<string, unknown>;
type AuditEvent = {
  action: string;
  resource_type: string;
  resource_id: string;
  severity: "info";
  metadata: Record<string, unknown>;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req, corsHeaders);
  if (auth.response || !auth.ctx) return auth.response ?? json({ error: "Unauthorized" }, 401);

  const parsed = OutcomeSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: "Invalid input", issues: parsed.error.flatten() }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const body = parsed.data;
  const now = new Date().toISOString();

  try {
    const { data: existing, error: existingError } = await supabase
      .from("decision_outcome_log")
      .select("id,created_at,evidence_type,cost_of_action,outcome_success")
      .eq("id", body.decision_id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return json({ error: "Decision outcome record not found" }, 404);

    const update: UpdatePayload = { updated_at: now };

    if (body.recommendation_accepted !== undefined) {
      update.recommendation_accepted = body.recommendation_accepted;
      update.recommendation_rejected_reason = body.recommendation_accepted
        ? null
        : body.recommendation_rejected_reason ?? null;
    }
    if (body.actor_role !== undefined) update.actor_role = body.actor_role;

    if (body.action_taken !== undefined) {
      update.action_taken = body.action_taken;
      if (body.action_taken) {
        update.action_taken_at = now;
        update.action_timestamp = now;
      }
    }
    if (body.execution_note !== undefined) update.execution_note = body.execution_note;
    if (body.execution_owner !== undefined) update.execution_owner = body.execution_owner;
    if (body.execution_status !== undefined) update.execution_status = body.execution_status;
    if (body.execution_blocker !== undefined) update.execution_blocker = body.execution_blocker;

    if (body.outcome_success !== undefined) {
      update.outcome_success = body.outcome_success;
      update.outcome_timestamp = now;
      update.outcome_source = body.outcome_source ?? "manual";
      update.evidence_source_type = body.outcome_source === "manual" || !body.outcome_source
        ? "operator"
        : body.outcome_source;
      if (existing.created_at) {
        const createdMs = new Date(existing.created_at).getTime();
        if (Number.isFinite(createdMs)) {
          update.time_to_outcome_days = Math.max(0, Math.round((Date.now() - createdMs) / 86_400_000));
        }
      }
    }

    if (body.impact_score !== undefined) update.impact_score = body.impact_score;
    if (body.cost_of_action !== undefined) update.cost_of_action = body.cost_of_action;
    if (body.outcome_description !== undefined) update.measured_outcome = body.outcome_description;
    if (body.evidence_note !== undefined) update.evidence_note = body.evidence_note;
    else if (body.outcome_description !== undefined) update.evidence_note = body.outcome_description;
    if (body.evidence_url !== undefined) update.evidence_url = body.evidence_url;
    if (body.outcome_confidence !== undefined) update.outcome_confidence = body.outcome_confidence;

    // Deliberately do NOT compute ROI/net value from impact score or signal confidence.
    // Deliberately do NOT promote evidence_type to "measured" here. The database
    // evidence-quality trigger and downstream learning jobs decide whether a
    // reported outcome is strong enough to learn from.
    const { data: updated, error: updateError } = await supabase
      .from("decision_outcome_log")
      .update(update)
      .eq("id", body.decision_id)
      .select("id,evidence_type,evidence_quality_score,evidence_checklist,outcome_success,outcome_confidence,roi_estimate,net_value")
      .single();
    if (updateError) throw updateError;

    const auditEvents: AuditEvent[] = [];
    if (body.action_taken) {
      auditEvents.push({
        action: "execution_started",
        resource_type: "decision_outcome_log",
        resource_id: body.decision_id,
        severity: "info",
        metadata: { execution_owner: body.execution_owner ?? null, execution_status: body.execution_status ?? null, actor_user_id: auth.ctx.user.id },
      });
    }
    if (body.execution_status === "completed") {
      auditEvents.push({
        action: "execution_completed",
        resource_type: "decision_outcome_log",
        resource_id: body.decision_id,
        severity: "info",
        metadata: { actor_user_id: auth.ctx.user.id },
      });
    }
    if (body.outcome_success !== undefined) {
      auditEvents.push({
        action: "outcome_reported",
        resource_type: "decision_outcome_log",
        resource_id: body.decision_id,
        severity: "info",
        metadata: {
          actor_user_id: auth.ctx.user.id,
          evidence_type: updated.evidence_type,
          evidence_quality_score: updated.evidence_quality_score,
          outcome_success: body.outcome_success,
          impact_score_reported: body.impact_score ?? null,
          roi_autocomputed: false,
          direct_training_override: false,
        },
      });
    }
    if (auditEvents.length === 0) {
      auditEvents.push({
        action: "decision_updated",
        resource_type: "decision_outcome_log",
        resource_id: body.decision_id,
        severity: "info",
        metadata: { actor_user_id: auth.ctx.user.id },
      });
    }

    const { error: auditError } = await supabase.from("audit_log").insert(auditEvents);
    if (auditError) console.error("record-decision-outcome audit failed", auditError.message);

    return json({
      ok: true,
      evidence_type: updated.evidence_type,
      evidence_quality_score: updated.evidence_quality_score,
      evidence_checklist: updated.evidence_checklist,
      learning_status: Number(updated.evidence_quality_score ?? 0) >= 0.5 ? "eligible_by_quality_gate" : "excluded_weak_evidence",
      roi_status: updated.roi_estimate == null && updated.net_value == null ? "not_computed_without_measured_financials" : "preexisting_measured_values_retained",
      message: "Outcome reported and evidence quality evaluated",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("record-decision-outcome error", message);
    return json({ error: message }, 500);
  }
});
