import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type JsonRecord = Record<string, unknown>;

interface KpiRow {
  division: string;
  composite_score: number | string | null;
  risk_score: number | string | null;
  metric: unknown;
}

interface WalletRow {
  division: string | null;
  balance: number | string | null;
  locked: number | string | null;
}

interface Move {
  from_division: string;
  to_division: string;
  amount_sc: number;
  reason: string;
  requires_approval: boolean;
}

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};

const finiteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const positiveNumber = (record: JsonRecord, key: string): number | null => {
  const value = finiteNumber(record[key]);
  return value !== null && value >= 0 ? value : null;
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
    const body = await req.json().catch(() => ({})) as JsonRecord;
    const policyKey = typeof body.policy_key === "string" && body.policy_key.trim() ? body.policy_key.trim() : "default_v1";

    const { data: policy, error: policyError } = await supabase
      .from("sc_allocation_policies")
      .select("weights,constraints")
      .eq("policy_key", policyKey)
      .eq("enabled", true)
      .single();
    if (policyError || !policy) throw policyError ?? new Error("Policy not found or disabled");

    const weights = asRecord(policy.weights);
    const constraints = asRecord(policy.constraints);
    const needWeight = positiveNumber(weights, "need");
    const riskWeight = positiveNumber(weights, "risk");
    const impactWeight = positiveNumber(weights, "impact");
    const minPct = positiveNumber(constraints, "min_pct_per_division");
    const maxPct = positiveNumber(constraints, "max_pct_per_division");
    const maxMove = positiveNumber(constraints, "max_move_per_epoch_sc");
    const approvalThreshold = positiveNumber(constraints, "require_approval_over_sc");

    if ([needWeight, riskWeight, impactWeight, minPct, maxPct, maxMove, approvalThreshold].some((value) => value === null)) {
      return json({ ok: false, error: "invalid_allocation_policy", policy_key: policyKey }, 409);
    }

    const { data: kpiRaw, error: kpiError } = await supabase
      .from("division_kpis")
      .select("division,composite_score,risk_score,metric")
      .order("captured_at", { ascending: false });
    if (kpiError) throw kpiError;
    const latestKpis = new Map<string, KpiRow>();
    for (const row of (kpiRaw ?? []) as KpiRow[]) {
      if (!latestKpis.has(row.division)) latestKpis.set(row.division, row);
    }

    const { data: walletRaw, error: walletError } = await supabase
      .from("sc_wallets")
      .select("division,balance,locked")
      .is("user_id", null)
      .not("division", "is", null);
    if (walletError) throw walletError;
    const wallets = (walletRaw ?? []) as WalletRow[];
    if (wallets.length === 0) throw new Error("No division wallets found");

    const walletDivisions = [...new Set(wallets.map((wallet) => wallet.division).filter((division): division is string => Boolean(division)))];
    const missingCalibration: string[] = [];
    const scores = new Map<string, number>();
    let totalScore = 0;

    for (const division of walletDivisions) {
      const kpi = latestKpis.get(division);
      const composite = finiteNumber(kpi?.composite_score);
      const risk = finiteNumber(kpi?.risk_score);
      const metric = asRecord(kpi?.metric);
      const impact = finiteNumber(metric.impact_score);

      const needsComposite = (needWeight ?? 0) > 0;
      const needsRisk = (riskWeight ?? 0) > 0;
      const needsImpact = (impactWeight ?? 0) > 0;
      if (!kpi || (needsComposite && composite === null) || (needsRisk && risk === null) || (needsImpact && impact === null)) {
        missingCalibration.push(division);
        continue;
      }

      const need = composite === null ? 0 : 100 - composite;
      const score = (needWeight ?? 0) * need + (riskWeight ?? 0) * (risk ?? 0) + (impactWeight ?? 0) * (impact ?? 0);
      if (!Number.isFinite(score) || score < 0) {
        missingCalibration.push(division);
        continue;
      }
      scores.set(division, score);
      totalScore += score;
    }

    if (missingCalibration.length > 0 || scores.size !== walletDivisions.length || totalScore <= 0) {
      const { error: logError } = await supabase.from("system_logs").insert({
        action: "simulate_rebalance_blocked",
        result: `Blocked: calibrated KPI scores unavailable for ${missingCalibration.join(", ") || "all divisions"}`,
        log_level: "warning",
        division: "system",
      });
      if (logError) console.error("simulate-rebalance block log failed", logError.message);
      return json({
        ok: false,
        error: "calibrated_kpis_required",
        message: "Rebalancing is disabled until every wallet division has calibrated KPI inputs required by the active policy.",
        missing_divisions: missingCalibration,
        policy_key: policyKey,
      }, 409);
    }

    const targets = new Map<string, number>();
    for (const division of walletDivisions) {
      const rawPct = (scores.get(division) ?? 0) / totalScore * 100;
      const boundedPct = Math.max((minPct ?? 0) * 100, Math.min((maxPct ?? 1) * 100, rawPct));
      targets.set(division, boundedPct);
    }
    const totalTarget = [...targets.values()].reduce((sum, value) => sum + value, 0);
    if (totalTarget <= 0) return json({ ok: false, error: "invalid_target_distribution" }, 409);
    for (const [division, pct] of targets) targets.set(division, pct / totalTarget * 100);

    const current = new Map<string, number>();
    for (const wallet of wallets) {
      if (!wallet.division) continue;
      const balance = finiteNumber(wallet.balance) ?? 0;
      const locked = finiteNumber(wallet.locked) ?? 0;
      current.set(wallet.division, Math.max(0, balance - locked));
    }
    const currentTotal = [...current.values()].reduce((sum, value) => sum + value, 0);
    if (currentTotal <= 0) return json({ ok: false, error: "no_available_division_balance" }, 409);

    const overweight: Array<{ division: string; excess: number }> = [];
    const underweight: Array<{ division: string; needed: number }> = [];
    for (const division of walletDivisions) {
      const targetPct = targets.get(division) ?? 0;
      const currentPct = ((current.get(division) ?? 0) / currentTotal) * 100;
      const deltaAmount = ((targetPct - currentPct) / 100) * currentTotal;
      if (deltaAmount > 100) underweight.push({ division, needed: deltaAmount });
      else if (deltaAmount < -100) overweight.push({ division, excess: -deltaAmount });
    }

    const moves: Move[] = [];
    let totalMoved = 0;
    for (const under of underweight) {
      for (const over of overweight) {
        if (totalMoved >= (maxMove ?? 0) || under.needed <= 100) break;
        const amount = Math.min(under.needed, over.excess, (maxMove ?? 0) - totalMoved);
        if (amount <= 100) continue;
        moves.push({
          from_division: over.division,
          to_division: under.division,
          amount_sc: amount,
          reason: `Policy ${policyKey}: ${over.division} above target, ${under.division} below target`,
          requires_approval: amount > (approvalThreshold ?? 0),
        });
        totalMoved += amount;
        over.excess -= amount;
        under.needed -= amount;
      }
    }

    const { data: run, error: runError } = await supabase.from("sc_rebalance_runs").insert({
      policy_key: policyKey,
      mode: "simulate",
      status: "success",
      total_available_sc: currentTotal,
      total_moved_sc: totalMoved,
      notes: `Evidence-calibrated simulation: ${moves.length} moves`,
      finished_at: new Date().toISOString(),
    }).select("id").single();
    if (runError || !run) throw runError ?? new Error("Failed to create simulation run");

    if (moves.length > 0) {
      const { error: moveError } = await supabase.from("sc_rebalance_moves").insert(
        moves.map((move) => ({ ...move, run_id: run.id })),
      );
      if (moveError) throw moveError;
    }

    return json({
      ok: true,
      run_id: run.id,
      moves: moves.length,
      total_moved_sc: totalMoved,
      plan: moves,
      policy_key: policyKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("system_logs").insert({
      action: "simulate_rebalance",
      result: `Error: ${message}`,
      log_level: "error",
      division: "system",
    });
    return json({ error: message }, 500);
  }
});
