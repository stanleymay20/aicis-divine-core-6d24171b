import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  // Promotion is deliberately HUMAN-admin only. Cron secrets and service-role
  // Edge-to-Edge callers are not accepted at this boundary.
  const auth = await requireAdminUser(req, corsHeaders);
  if (auth.response) return auth.response;
  if (!auth.user?.id) return json({ ok: false, error: "Authenticated admin identity required" }, 401);

  try {
    const body = asRecord(await req.json().catch(() => ({})));
    const modelVersion = typeof body.model_version === "string"
      ? body.model_version.trim()
      : "";
    const confirmed = body.confirm === true;

    if (!modelVersion) {
      return json({ ok: false, error: "model_version is required" }, 400);
    }
    if (!confirmed) {
      return json({
        ok: false,
        error: "Explicit confirmation required",
        required: { confirm: true },
        note: "Model promotion changes the active production probability model and is never automatic.",
      }, 409);
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: model, error: modelError } = await sb
      .from("ml_model_weights")
      .select("model_version,promotion_status,active,training_run_id,model_semantics,validation_metrics,test_metrics")
      .eq("model_version", modelVersion)
      .maybeSingle();
    if (modelError) throw modelError;
    if (!model) return json({ ok: false, error: "Candidate model not found" }, 404);
    if (model.active || model.promotion_status !== "candidate") {
      return json({
        ok: false,
        error: "Model is not an inactive candidate",
        promotion_status: model.promotion_status,
        active: model.active,
      }, 409);
    }
    if (!model.training_run_id) {
      return json({ ok: false, error: "Candidate has no training-run lineage" }, 409);
    }

    const { data: run, error: runError } = await sb
      .from("ml_model_training_runs")
      .select("id,status,manifest_checksum,train_rows,validation_rows,test_rows,validation_metrics,test_metrics,feature_version,split_strategy")
      .eq("id", model.training_run_id)
      .maybeSingle();
    if (runError) throw runError;
    if (!run || run.status !== "completed" || !run.manifest_checksum) {
      return json({ ok: false, error: "Training lineage is incomplete or not completed" }, 409);
    }

    const { data: promoted, error: promotionError } = await sb.rpc(
      "promote_ml_model_candidate",
      {
        p_model_version: modelVersion,
        p_actor_user_id: auth.user.id,
        p_expected_manifest_checksum: run.manifest_checksum,
      },
    );
    if (promotionError) {
      return json({
        ok: false,
        error: "Promotion gate rejected candidate",
        detail: promotionError.message,
        candidate_evidence: {
          model_semantics: model.model_semantics,
          feature_version: run.feature_version,
          split_strategy: run.split_strategy,
          rows: {
            train: run.train_rows,
            validation: run.validation_rows,
            test: run.test_rows,
          },
          validation_metrics: run.validation_metrics,
          test_metrics: run.test_metrics,
        },
      }, 422);
    }

    console.log(JSON.stringify({
      level: "info",
      function: "promote-risk-model",
      message: "human_admin_model_promotion",
      actor_user_id: auth.user.id,
      model_version: modelVersion,
      training_run_id: run.id,
      timestamp: new Date().toISOString(),
    }));

    return json({
      ok: true,
      promoted,
      human_admin_confirmed: true,
      automatic_promotion: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({
      level: "error",
      function: "promote-risk-model",
      message,
      timestamp: new Date().toISOString(),
    }));
    return json({ ok: false, error: "Model promotion failed", detail: message }, 500);
  }
});
