import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const { data: activeModel, error: activeError } = await supabase
      .from("decision_models")
      .select("version,last_calibrated_at")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeError) throw activeError;
    if (!activeModel) return json({ ok: false, error: "No active model to rollback" }, 400);

    const { data: priorModel, error: priorError } = await supabase
      .from("decision_models")
      .select("version")
      .neq("version", activeModel.version)
      .neq("status", "rejected")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (priorError) throw priorError;
    if (!priorModel) return json({ ok: false, error: "No valid prior model to rollback to" }, 400);

    const [{ data: evaluation }, { data: modelData }] = await Promise.all([
      supabase.from("model_evaluations")
        .select("improvement_over_heuristic,calibration_error,acceptance_rate")
        .eq("model_version", activeModel.version)
        .order("evaluated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("decision_models")
        .select("rollback_reason")
        .eq("version", activeModel.version)
        .maybeSingle(),
    ]);
    const reason = modelData?.rollback_reason || "Rollback requested; no stored rollback reason was provided.";

    const { error: supersedeError } = await supabase.from("decision_models")
      .update({ status: "superseded", rollback_required: false, rolled_back_from_version: priorModel.version })
      .eq("version", activeModel.version);
    if (supersedeError) throw supersedeError;

    const { error: promoteError } = await supabase.from("decision_models")
      .update({ status: "active", promoted_from_version: activeModel.version })
      .eq("version", priorModel.version);
    if (promoteError) {
      const { error: compensationError } = await supabase.from("decision_models")
        .update({ status: "active", rollback_required: true })
        .eq("version", activeModel.version);
      if (compensationError) console.error("model rollback compensation failed", compensationError.message);
      throw promoteError;
    }

    const actor = auth.via === "cron" ? "cron" : auth.user?.id ?? "admin";
    const auditWarnings: string[] = [];
    const { error: historyError } = await supabase.from("model_rollback_history").insert({
      rolled_back_version: activeModel.version,
      rolled_back_to_version: priorModel.version,
      rollback_reason: reason,
      triggered_by: actor,
      improvement_over_heuristic: evaluation?.improvement_over_heuristic ?? null,
      calibration_error: evaluation?.calibration_error ?? null,
    });
    if (historyError) auditWarnings.push(`rollback_history:${historyError.message}`);

    const { error: logError } = await supabase.from("system_logs").insert({
      action: "model_rollback",
      result: JSON.stringify({ from: activeModel.version, to: priorModel.version, reason }),
      log_level: "warn",
      division: "decision-engine",
      metadata: { triggered_by: actor, acceptance_rate: evaluation?.acceptance_rate ?? null },
    });
    if (logError) auditWarnings.push(`system_log:${logError.message}`);

    return json({
      ok: true,
      rolled_back_from: activeModel.version,
      rolled_back_to: priorModel.version,
      reason,
      audit_warnings: auditWarnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("model-rollback error", message);
    return json({ error: message }, 500);
  }
});
