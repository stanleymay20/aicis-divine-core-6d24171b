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

type RegistryModel = {
  id: string;
  model_key: string;
  family: string;
  version: string;
  enabled: boolean;
  production_approved: boolean;
};

type CompetencyRow = {
  sample_size: number;
  competence: number | string;
  calibration: number | string;
  reliability: number | string;
  latency_ms_p95: number;
  aicis_model_registry: RegistryModel;
};

type Candidate = {
  row: CompetencyRow;
  model: RegistryModel;
  score: number;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = await requireAdminOrCron(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { ...cors, "content-type": "application/json" },
    });
  }

  try {
    const body = (await req.json()) as RequestBody;
    if (!body.modality || !body.task) throw new Error("modality and task are required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const domain = body.domain ?? "general";
    const { data, error } = await supabase
      .from("aicis_model_competency")
      .select("*,aicis_model_registry!inner(id,model_key,family,version,enabled,production_approved)")
      .eq("modality", body.modality)
      .eq("task", body.task)
      .in("domain", [domain, "general"]);
    if (error) throw error;

    const rows = (data ?? []) as unknown as CompetencyRow[];
    const minimumSamples = body.high_consequence ? 100 : 20;
    const candidates: Candidate[] = rows
      .filter((row) => {
        const model = row.aicis_model_registry;
        return (
          model.enabled &&
          (!body.high_consequence || model.production_approved) &&
          row.sample_size >= minimumSamples &&
          (!body.max_latency_ms || row.latency_ms_p95 <= body.max_latency_ms)
        );
      })
      .map((row) => {
        const evidence = clamp01(Math.log10(Math.max(10, row.sample_size)) / 4);
        const latency = body.max_latency_ms
          ? clamp01(1 - row.latency_ms_p95 / body.max_latency_ms)
          : clamp01(1 / (1 + row.latency_ms_p95 / 10000));
        const score = clamp01(
          0.34 * Number(row.competence) +
            0.24 * Number(row.calibration) +
            0.22 * Number(row.reliability) +
            0.12 * evidence +
            0.08 * latency,
        );
        return { row, model: row.aicis_model_registry, score };
      })
      .sort((a, b) => b.score - a.score);

    const desired = Math.max(1, Math.min(body.ensemble_size ?? 1, 5));
    const selected: Candidate[] = [];
    const families = new Set<string>();

    if (body.prefer_diversity && desired > 1) {
      for (const candidate of candidates) {
        if (selected.length >= desired) break;
        if (!families.has(candidate.model.family)) {
          selected.push(candidate);
          families.add(candidate.model.family);
        }
      }
    }

    for (const candidate of candidates) {
      if (selected.length >= desired) break;
      if (!selected.some((entry) => entry.model.id === candidate.model.id)) {
        selected.push(candidate);
      }
    }

    const { data: decision, error: insertError } = await supabase
      .from("aicis_model_routing_decisions")
      .insert({
        modality: body.modality,
        task: body.task,
        domain,
        high_consequence: Boolean(body.high_consequence),
        selected_model_ids: selected.map((entry) => entry.model.id),
        candidate_scores: candidates.slice(0, 20).map((entry) => ({
          model_id: entry.model.id,
          model_key: entry.model.model_key,
          family: entry.model.family,
          score: entry.score,
        })),
        reasons: selected.map(
          (entry) => `${entry.model.model_key}@${entry.model.version} selected from measured competency`,
        ),
      })
      .select("id")
      .single();
    if (insertError) throw insertError;

    return new Response(
      JSON.stringify({
        routing_decision_id: decision.id,
        selected: selected.map((entry) => ({
          id: entry.model.id,
          model_key: entry.model.model_key,
          family: entry.model.family,
          version: entry.model.version,
          score: entry.score,
        })),
        candidate_count: candidates.length,
      }),
      { headers: { ...cors, "content-type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "routing failed" }),
      { status: 400, headers: { ...cors, "content-type": "application/json" } },
    );
  }
});
