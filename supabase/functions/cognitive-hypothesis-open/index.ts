import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "cognitive-hypothesis-open";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Candidate = { statement: string; prior?: number; assumptions?: string[] };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { user, via, response } = await requireAdminOrCron(req, corsHeaders);
  if (response) return response;

  let body: {
    question?: string;
    subject_entity_id?: string;
    candidates?: Candidate[];
    metadata?: Record<string, unknown>;
  } = {};
  try { body = await req.json(); } catch { /* validation below */ }

  const question = body.question?.trim();
  const candidates = (body.candidates ?? []).filter((item) => item.statement?.trim());
  if (!question) return json({ error: "question is required" }, 400);
  if (candidates.length < 2 || candidates.length > 12) {
    return json({ error: "Provide between 2 and 12 competing hypotheses" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const now = new Date().toISOString();

  const { data: setRow, error: setError } = await supabase
    .from("aicis_hypothesis_sets")
    .insert({
      question,
      subject_entity_id: body.subject_entity_id ?? null,
      metadata: {
        ...(body.metadata ?? {}),
        opened_by: user?.id ?? "cron",
        opened_via: via,
      },
    })
    .select("id")
    .single();
  if (setError || !setRow) return json({ error: "Failed to create hypothesis set" }, 500);

  const created: Array<{ id: string; statement: string; prior: number }> = [];
  for (const candidate of candidates) {
    const prior = clampPrior(candidate.prior ?? 0.5);
    const { data: hypothesis, error } = await supabase
      .from("aicis_hypotheses")
      .insert({
        statement: candidate.statement.trim(),
        status: "active",
        confidence: prior,
        assumptions: candidate.assumptions ?? [],
        created_by: FN,
        metadata: {
          hypothesis_set_id: setRow.id,
          generated_as_candidate: true,
          trusted_fact: false,
        },
      })
      .select("id,statement")
      .single();
    if (error || !hypothesis) return json({ error: "Failed to create hypothesis candidate" }, 500);

    await supabase.from("aicis_hypothesis_set_members").insert({
      hypothesis_set_id: setRow.id,
      hypothesis_id: hypothesis.id,
      prior,
    });
    created.push({ id: hypothesis.id, statement: hypothesis.statement, prior });

    await supabase.from("aicis_cognitive_events").insert({
      event_type: "hypothesis.created",
      epistemic_status: "hypothesized",
      confidence: prior,
      subject_entity_id: body.subject_entity_id ?? null,
      occurred_at: now,
      observed_at: now,
      producer: FN,
      payload: {
        hypothesis_set_id: setRow.id,
        hypothesis_id: hypothesis.id,
        question,
        statement: hypothesis.statement,
        assumptions: candidate.assumptions ?? [],
      },
      provenance: [{
        sourceId: `hypothesis-set:${setRow.id}`,
        sourceType: "hypothesis-generation",
        observedAt: now,
        extractor: FN,
        extractorVersion: "1",
      }],
    });
  }

  await supabase.from("system_logs").insert({
    action: "cognitive_hypothesis_open",
    user_id: user?.id ?? null,
    log_level: "info",
    result: `Opened competition with ${created.length} hypotheses`,
    metadata: { hypothesis_set_id: setRow.id, question, auth_via: via },
  });

  return json({ success: true, hypothesis_set_id: setRow.id, question, candidates: created });
});

function clampPrior(value: number) {
  return Math.min(0.95, Math.max(0.05, Number.isFinite(value) ? value : 0.5));
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
