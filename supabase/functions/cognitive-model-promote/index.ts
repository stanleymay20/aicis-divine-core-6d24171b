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
  minimum_relative_brier_improvement?: number;
  maximum_calibration_regression?: number;
  confirm_promotion?: boolean;
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
    validateTighteningOnlyInputs(body);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Promotion authority lives in one database transaction. The RPC:
    // - loads the exact server-governed scope policy;
    // - rejects any attempt to weaken policy floors;
    // - derives high-consequence status server-side;
    // - recomputes full-population current verified metrics and fingerprints;
    // - locks registry/policy rows;
    // - updates the model registry and writes the governance audit event atomically.
    const { data, error } = await supabase.rpc("promote_aicis_model_cortex_atomic_v4", {
      p_challenger_model_id: body.challenger_model_id,
      p_baseline_model_id: body.baseline_model_id,
      p_domain: body.domain ?? "general",
      p_modality: body.modality,
      p_task: body.task,
      p_confirm_promotion: body.confirm_promotion === true,
      p_requested_minimum_relative_brier_improvement:
        body.minimum_relative_brier_improvement ?? null,
      p_requested_maximum_calibration_regression:
        body.maximum_calibration_regression ?? null,
    });
    if (error) throw error;

    return new Response(JSON.stringify(data), {
      headers: { ...cors, "content-type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "model promotion failed" }),
      { status: 400, headers: { ...cors, "content-type": "application/json" } },
    );
  }
});

function validateTighteningOnlyInputs(body: PromotionRequest): void {
  if (
    body.minimum_relative_brier_improvement !== undefined &&
    (!Number.isFinite(body.minimum_relative_brier_improvement) ||
      body.minimum_relative_brier_improvement < 0 ||
      body.minimum_relative_brier_improvement > 1)
  ) {
    throw new Error("minimum_relative_brier_improvement must be finite between 0 and 1");
  }
  if (
    body.maximum_calibration_regression !== undefined &&
    (!Number.isFinite(body.maximum_calibration_regression) ||
      body.maximum_calibration_regression < 0 ||
      body.maximum_calibration_regression > 1)
  ) {
    throw new Error("maximum_calibration_regression must be finite between 0 and 1");
  }
}
