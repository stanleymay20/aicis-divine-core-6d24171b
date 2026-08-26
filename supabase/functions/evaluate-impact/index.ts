import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, errorResponse, jsonResponse } from "../_shared/resilience.ts";

const FN = "evaluate-impact";

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req);
  if (callerAuth.response) return callerAuth.response;

  const cors = handleCors(req);
  if (cors) return cors;

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const { rebalance_run_id } = await req.json().catch(() => ({}));
    structuredLog('info', FN, 'Evaluating division impact', { rebalance_run_id });

    const { data: run } = rebalance_run_id ? await supabase
      .from("sc_rebalance_runs").select("*").eq("id", rebalance_run_id).single() : { data: null };

    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    const [{ data: beforeKpis }, { data: afterKpis }] = await Promise.all([
      supabase.from("division_kpis").select("*")
        .gte("captured_at", twoDaysAgo.toISOString())
        .lte("captured_at", run?.created_at || new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()),
      supabase.from("division_kpis").select("*")
        .gte("captured_at", run?.finished_at || new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString()),
    ]);

    const beforeMap = new Map();
    beforeKpis?.forEach(kpi => {
      if (!beforeMap.has(kpi.division) || kpi.captured_at > beforeMap.get(kpi.division).captured_at)
        beforeMap.set(kpi.division, kpi);
    });

    const afterMap = new Map();
    afterKpis?.forEach(kpi => {
      if (!afterMap.has(kpi.division) || kpi.captured_at > afterMap.get(kpi.division).captured_at)
        afterMap.set(kpi.division, kpi);
    });

    const { data: moves } = rebalance_run_id ? await supabase
      .from("sc_rebalance_moves").select("*").eq("run_id", rebalance_run_id).eq("executed", true) : { data: [] };

    const scSpent = new Map();
    moves?.forEach(move => {
      scSpent.set(move.to_division, (scSpent.get(move.to_division) || 0) + Number(move.amount_sc));
    });

    const impacts = [];
    const divisions = Array.from(new Set([...beforeMap.keys(), ...afterMap.keys()]));

    for (const div of divisions) {
      const before = beforeMap.get(div);
      const after = afterMap.get(div);
      if (!before || !after) continue;

      const deltaStability = (after.composite_score || 0) - (before.composite_score || 0);
      const deltaRisk = (before.risk_score || 0) - (after.risk_score || 0);
      const impactScore = (0.6 * deltaStability) + (0.4 * deltaRisk);
      const spent = scSpent.get(div) || 1;

      impacts.push({
        division: div, rebalance_run_id: rebalance_run_id || null,
        metric: { delta_stability: deltaStability, delta_risk: deltaRisk, before_score: before.composite_score, after_score: after.composite_score },
        impact_score: impactScore, sc_spent: spent, impact_per_sc: impactScore / spent
      });
    }

    const { data: inserted, error: insertError } = await supabase
      .from("division_impact_metrics").insert(impacts).select();
    if (insertError) throw insertError;

    await supabase.from("system_logs").insert({
      action: "evaluate_impact", result: `Evaluated ${impacts.length} divisions`,
      log_level: "info", division: "system",
      metadata: { avg_impact_per_sc: impacts.reduce((s, i) => s + i.impact_per_sc, 0) / (impacts.length || 1) }
    });

    structuredLog('info', FN, `Impact evaluation: ${impacts.length} divisions`, undefined, start);
    return jsonResponse({ ok: true, divisions: impacts.length, impacts: inserted });
  } catch (error) {
    structuredLog('error', FN, (error as Error).message, undefined, start);
    await supabase.from("system_logs").insert({
      action: "evaluate_impact", result: `Error: ${(error as Error).message}`,
      log_level: "error", division: "system"
    });
    return errorResponse(error);
  }
});
