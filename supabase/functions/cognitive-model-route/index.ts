import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

type RequestBody = {
  modality: string;
  task: string;
  domain?: string;
  high_consequence?: boolean;
  ensemble_size?: number;
  prefer_diversity?: boolean;
  max_latency_ms?: number;
};

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = await requireAdminOrCron(req);
  if (!auth.ok) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: { ...cors, "content-type": "application/json" } });

  try {
    const body = (await req.json()) as RequestBody;
    if (!body.modality || !body.task) throw new Error("modality and task are required");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const domain = body.domain ?? "general";
    const { data, error } = await supabase
      .from("aicis_model_competency")
      .select("*,aicis_model_registry!inner(id,model_key,family,version,enabled,production_approved)")
      .eq("modality", body.modality)
      .eq("task", body.task)
      .in("domain", [domain, "general"]);
    if (error) throw error;

    const minimumSamples = body.high_consequence ? 100 : 20;
    const candidates = (data ?? []).filter((row: any) => {
      const model = row.aicis_model_registry;
      return model?.enabled && (!body.high_consequence || model.production_approved) && row.sample_size >= minimumSamples && (!body.max_latency_ms || row.latency_ms_p95 <= body.max_latency_ms);
    }).map((row: any) => {
      const evidence = clamp01(Math.log10(Math.max(10, row.sample_size)) / 4);
      const latency = body.max_latency_ms ? clamp01(1 - row.latency_ms_p95 / body.max_latency_ms) : clamp01(1 / (1 + row.latency_ms_p95 / 10000));
      const score = clamp01(0.34 * Number(row.competence) + 0.24 * Number(row.calibration) + 0.22 * Number(row.reliability) + 0.12 * evidence + 0.08 * latency);
      return { row, model: row.aicis_model_registry, score };
    }).sort((a: any, b: any) => b.score - a.score);

    const desired = Math.max(1, Math.min(body.ensemble_size ?? 1, 5));
    const selected: any[] = [];
    const families = new Set<string>();
    if (body.prefer_diversity && desired > 1) {
      for (const c of candidates) if (selected.length < desired && !families.has(c.model.family)) { selected.push(c); families.add(c.model.family); }
    }
    for (const c of candidates) if (selected.length < desired && !selected.some((x) => x.model.id === c.model.id)) selected.push(c);

    const { data: decision, error: insertError } = await supabase.from("aicis_model_routing_decisions").insert({
      modality: body.modality,
      task: body.task,
      domain,
      high_consequence: Boolean(body.high_consequence),
      selected_model_ids: selected.map((x) => x.model.id),
      candidate_scores: candidates.slice(0, 20).map((x: any) => ({ model_id: x.model.id, model_key: x.model.model_key, family: x.model.family, score: x.score })),
      reasons: selected.map((x) => `${x.model.model_key}@${x.model.version} selected from measured competency`),
    }).select("id").single();
    if (insertError) throw insertError;

    return new Response(JSON.stringify({ routing_decision_id: decision.id, selected: selected.map((x) => ({ id: x.model.id, model_key: x.model.model_key, family: x.model.family, version: x.model.version, score: x.score })), candidate_count: candidates.length }), { headers: { ...cors, "content-type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "routing failed" }), { status: 400, headers: { ...cors, "content-type": "application/json" } });
  }
});
