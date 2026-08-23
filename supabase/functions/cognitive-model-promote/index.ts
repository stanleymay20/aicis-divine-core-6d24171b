import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminUser } from "../_shared/auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type PromotionRequest = {
  challenger_model_id: string;
  baseline_model_id: string;
  domain?: string;
  modality: string;
  task: string;
  high_consequence?: boolean;
  minimum_relative_brier_improvement?: number;
  maximum_calibration_regression?: number;
};

type RegistryRow = {
  id: string;
  model_key: string;
  version: string;
  production_approved: boolean;
  metadata: Record<string, unknown> | null;
};

type CompetencyRow = {
  model_id: string;
  sample_size: number;
  brier_score: number | string | null;
  ece: number | string | null;
  competence: number | string;
  calibration: number | string;
  reliability: number | string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = await requireAdminUser(req, cors);
  if (auth.response) return auth.response;

  try {
    const body = (await req.json()) as PromotionRequest;
    if (!body.challenger_model_id || !body.baseline_model_id || !body.modality || !body.task) {
      throw new Error("challenger_model_id, baseline_model_id, modality and task are required");
    }
    if (body.challenger_model_id === body.baseline_model_id) {
      throw new Error("challenger and baseline must be different models");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const domain = body.domain ?? "general";

    const { data: registryData, error: registryError } = await supabase
      .from("aicis_model_registry")
      .select("id,model_key,version,production_approved,metadata")
      .in("id", [body.challenger_model_id, body.baseline_model_id]);
    if (registryError) throw registryError;

    const registry = (registryData ?? []) as RegistryRow[];
    const challenger = registry.find((row) => row.id === body.challenger_model_id);
    const baseline = registry.find((row) => row.id === body.baseline_model_id);
    if (!challenger || !baseline) throw new Error("challenger or baseline model not found");
    if (baseline.metadata?.role !== "baseline") {
      throw new Error("baseline_model_id must reference a registered baseline model");
    }

    const { data: competencyData, error: competencyError } = await supabase
      .from("aicis_model_competency")
      .select("model_id,sample_size,brier_score,ece,competence,calibration,reliability")
      .in("model_id", [challenger.id, baseline.id])
      .eq("domain", domain)
      .eq("modality", body.modality)
      .eq("task", body.task);
    if (competencyError) throw competencyError;

    const competency = (competencyData ?? []) as CompetencyRow[];
    const challengerMetric = competency.find((row) => row.model_id === challenger.id);
    const baselineMetric = competency.find((row) => row.model_id === baseline.id);
    if (!challengerMetric || !baselineMetric) {
      throw new Error("both challenger and baseline require matching competency evaluations");
    }

    const minimumSamples = body.high_consequence ? 250 : 75;
    const minimumBrierImprovement = body.minimum_relative_brier_improvement ?? 0.05;
    const maximumCalibrationRegression = body.maximum_calibration_regression ?? 0.01;
    const reasons: string[] = [];

    if (challengerMetric.sample_size < minimumSamples) {
      reasons.push(`insufficient challenger sample size ${challengerMetric.sample_size}/${minimumSamples}`);
    }

    const baselineBrier = numericOrNull(baselineMetric.brier_score);
    const challengerBrier = numericOrNull(challengerMetric.brier_score);
    let relativeBrierImprovement: number | null = null;
    if (baselineBrier === null || challengerBrier === null || baselineBrier <= 0) {
      reasons.push("comparable Brier evidence is unavailable");
    } else {
      relativeBrierImprovement = (baselineBrier - challengerBrier) / baselineBrier;
      if (relativeBrierImprovement < minimumBrierImprovement) {
        reasons.push(`Brier improvement ${(relativeBrierImprovement * 100).toFixed(1)}% is below required ${(minimumBrierImprovement * 100).toFixed(1)}%`);
      }
    }

    const baselineEce = numericOrNull(baselineMetric.ece);
    const challengerEce = numericOrNull(challengerMetric.ece);
    let calibrationImprovement: number | null = null;
    if (baselineEce === null || challengerEce === null) {
      reasons.push("comparable calibration evidence is unavailable");
    } else {
      calibrationImprovement = baselineEce - challengerEce;
      if (calibrationImprovement < -maximumCalibrationRegression) {
        reasons.push(`calibration regressed by ${Math.abs(calibrationImprovement).toFixed(4)}`);
      }
    }

    const eligible = reasons.length === 0;
    if (eligible && !challenger.production_approved) {
      const { error: updateError } = await supabase
        .from("aicis_model_registry")
        .update({
          production_approved: true,
          updated_at: new Date().toISOString(),
          metadata: {
            ...(challenger.metadata ?? {}),
            promoted_against: baseline.model_key,
            promoted_domain: domain,
            promoted_modality: body.modality,
            promoted_task: body.task,
            promoted_at: new Date().toISOString(),
            promotion_policy: "baseline-gate-v1",
          },
        })
        .eq("id", challenger.id);
      if (updateError) throw updateError;
    }

    await supabase.from("aicis_cognitive_events").insert({
      event_type: eligible ? "model.promoted" : "model.promotion_rejected",
      epistemic_status: "derived",
      confidence: eligible ? 0.95 : 0.9,
      severity: body.high_consequence ? 0.7 : 0.4,
      source_system: "cognitive-model-promote",
      payload: {
        challenger_model_id: challenger.id,
        challenger_model_key: challenger.model_key,
        baseline_model_id: baseline.id,
        baseline_model_key: baseline.model_key,
        domain,
        modality: body.modality,
        task: body.task,
        high_consequence: Boolean(body.high_consequence),
        relative_brier_improvement: relativeBrierImprovement,
        calibration_improvement: calibrationImprovement,
        eligible,
        reasons,
      },
    });

    return new Response(JSON.stringify({
      eligible,
      promoted: eligible,
      challenger: `${challenger.model_key}@${challenger.version}`,
      baseline: `${baseline.model_key}@${baseline.version}`,
      relative_brier_improvement: relativeBrierImprovement,
      calibration_improvement: calibrationImprovement,
      reasons,
    }), { headers: { ...cors, "content-type": "application/json" } });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "model promotion failed" }),
      { status: 400, headers: { ...cors, "content-type": "application/json" } },
    );
  }
});

function numericOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
