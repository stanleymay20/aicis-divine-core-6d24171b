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
  competence: number | string | null;
  competence_semantics: string | null;
  calibration: number | string | null;
  calibration_semantics: string | null;
  reliability: number | string | null;
  reliability_semantics: string | null;
  latency_ms_p95: number | string | null;
  latency_semantics: string | null;
  evaluation_status: string | null;
  aicis_model_registry: RegistryModel;
};

type Candidate = {
  row: CompetencyRow;
  model: RegistryModel;
  score: number;
};

const ROUTING_SCORE_SEMANTICS =
  "deterministic_model_selection_priority_score_v2_not_probability_or_confidence";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    if (body.ensemble_size !== undefined && (!Number.isInteger(body.ensemble_size) || body.ensemble_size < 1 || body.ensemble_size > 5)) {
      throw new Error("ensemble_size must be an integer from 1 through 5");
    }
    if (body.max_latency_ms !== undefined && (!Number.isFinite(body.max_latency_ms) || body.max_latency_ms < 0)) {
      throw new Error("max_latency_ms must be a finite non-negative number");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const domain = body.domain ?? "general";
    const { data, error } = await supabase
      .from("aicis_model_competency")
      .select("sample_size,competence,competence_semantics,calibration,calibration_semantics,reliability,reliability_semantics,latency_ms_p95,latency_semantics,evaluation_status,aicis_model_registry!inner(id,model_key,family,version,enabled,production_approved)")
      .eq("modality", body.modality)
      .eq("task", body.task)
      .in("domain", [domain, "general"]);
    if (error) throw error;

    const rows = (data ?? []) as unknown as CompetencyRow[];
    const minimumSamples = body.high_consequence ? 100 : 20;
    const candidates: Candidate[] = rows
      .filter((row) => {
        const model = row.aicis_model_registry;
        if (!model.enabled) return false;
        if (body.high_consequence && !model.production_approved) return false;
        if (!Number.isInteger(row.sample_size) || row.sample_size < minimumSamples) return false;
        if (!hasCompleteMeasuredRoutingInputs(row)) return false;
        const latency = numericNonNegativeOrNull(row.latency_ms_p95);
        if (latency === null) return false;
        if (body.max_latency_ms !== undefined && latency > body.max_latency_ms) return false;
        return true;
      })
      .map((row) => {
        const competence = numericUnitOrNull(row.competence);
        const calibration = numericUnitOrNull(row.calibration);
        const reliability = numericUnitOrNull(row.reliability);
        const latencyMsP95 = numericNonNegativeOrNull(row.latency_ms_p95);
        if (competence === null || calibration === null || reliability === null || latencyMsP95 === null) {
          throw new Error("routing invariant failed after eligibility filter");
        }

        const evidence = clamp01(Math.log10(Math.max(10, row.sample_size)) / 4);
        const latency = body.max_latency_ms !== undefined
          ? clamp01(1 - latencyMsP95 / Math.max(1, body.max_latency_ms))
          : clamp01(1 / (1 + latencyMsP95 / 10_000));
        const score = clamp01(
          0.34 * competence +
          0.24 * calibration +
          0.22 * reliability +
          0.12 * evidence +
          0.08 * latency,
        );
        return { row, model: row.aicis_model_registry, score };
      })
      .sort((a, b) => b.score - a.score);

    const desired = body.ensemble_size ?? 1;
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

    const evidenceStatus = selected.length > 0
      ? "complete_measured_routing_inputs"
      : "abstained_no_eligible_complete_measured_model";
    const reasons = selected.length > 0
      ? selected.map(
        (entry) => `${entry.model.model_key}@${entry.model.version} selected by deterministic measured-competency routing policy`,
      )
      : ["No model had complete semantically usable competency, calibration, reliability, latency and sample-size evidence"];

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
          score_semantics: ROUTING_SCORE_SEMANTICS,
          sample_size: entry.row.sample_size,
          evaluation_status: entry.row.evaluation_status,
        })),
        policy_version: "cortex-v2-truth-floor",
        score_semantics: ROUTING_SCORE_SEMANTICS,
        evidence_status: evidenceStatus,
        reasons,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;

    return new Response(
      JSON.stringify({
        routing_decision_id: decision.id,
        routing_status: selected.length > 0 ? "issued" : "abstained",
        score_semantics: ROUTING_SCORE_SEMANTICS,
        evidence_status: evidenceStatus,
        selected: selected.map((entry) => ({
          id: entry.model.id,
          model_key: entry.model.model_key,
          family: entry.model.family,
          version: entry.model.version,
          score: entry.score,
          score_semantics: ROUTING_SCORE_SEMANTICS,
        })),
        candidate_count: candidates.length,
        minimum_sample_policy: minimumSamples,
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

function hasCompleteMeasuredRoutingInputs(row: CompetencyRow): boolean {
  return numericUnitOrNull(row.competence) !== null &&
    hasUsableSemantics(row.competence_semantics) &&
    numericUnitOrNull(row.calibration) !== null &&
    hasUsableSemantics(row.calibration_semantics) &&
    numericUnitOrNull(row.reliability) !== null &&
    hasUsableSemantics(row.reliability_semantics) &&
    numericNonNegativeOrNull(row.latency_ms_p95) !== null &&
    hasUsableSemantics(row.latency_semantics) &&
    hasUsableEvaluationStatus(row.evaluation_status);
}

function hasUsableEvaluationStatus(status: string | null): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return !normalized.includes("legacy") &&
    !normalized.includes("unknown") &&
    !normalized.includes("unverified") &&
    !normalized.includes("pending");
}

function hasUsableSemantics(semantics: string | null): boolean {
  if (!semantics) return false;
  const normalized = semantics.toLowerCase();
  return !normalized.includes("legacy") &&
    !normalized.includes("unknown") &&
    !normalized.includes("unverified") &&
    !normalized.includes("unspecified") &&
    !normalized.includes("not_quantified");
}

function numericUnitOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1 ? numeric : null;
}

function numericNonNegativeOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
