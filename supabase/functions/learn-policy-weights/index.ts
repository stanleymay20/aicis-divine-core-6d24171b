import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMA_ALPHA = 0.3; // Exponential moving average smoothing factor

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    console.log("Learning policy weights from impact data...");

    // Get last 7 days of impact metrics per division
    const sevenDaysAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString();
    const { data: impactData } = await supabase
      .from("division_impact_metrics")
      .select("*")
      .gte("captured_at", sevenDaysAgo)
      .order("captured_at", { ascending: false });

    // Calculate 7-day moving average per division
    const divisionAverages = new Map<string, number>();
    const divisionCounts = new Map<string, number>();

    impactData?.forEach(metric => {
      const current = divisionAverages.get(metric.division) || 0;
      const count = divisionCounts.get(metric.division) || 0;
      divisionAverages.set(metric.division, current + Number(metric.impact_per_sc || 0));
      divisionCounts.set(metric.division, count + 1);
    });

    // Compute averages
    const avgImpactPerSc = new Map<string, number>();
    divisionAverages.forEach((sum, div) => {
      const count = divisionCounts.get(div) || 1;
      avgImpactPerSc.set(div, sum / count);
    });

    // Normalize to sum = 1 (convert to weights)
    let totalImpact = 0;
    avgImpactPerSc.forEach(impact => {
      totalImpact += Math.max(0, impact); // Only positive impacts
    });

    const normalizedWeights = new Map<string, number>();
    if (totalImpact > 0) {
      avgImpactPerSc.forEach((impact, div) => {
        normalizedWeights.set(div, Math.max(0, impact) / totalImpact);
      });
    }

    // Get current weights
    const { data: currentWeights } = await supabase
      .from("division_learning_weights")
      .select("*");

    const weightMap = new Map<string, any>();
    currentWeights?.forEach(w => weightMap.set(w.division, w));

    // Apply EMA smoothing and update
    const updates: Array<{division: string, impact_weight: number, trend: number, last_updated: string}> = [];
    const weightChanges: Array<{division: string, old: number, new: number, change_pct: number}> = [];

    normalizedWeights.forEach((newWeight, div) => {
      const current = weightMap.get(div);
      if (!current) return;

      const oldWeight = Number(current.impact_weight);
      const smoothedWeight = (1 - EMA_ALPHA) * oldWeight + EMA_ALPHA * newWeight;
      const trend = smoothedWeight - oldWeight;

      updates.push({
        division: div,
        impact_weight: smoothedWeight,
        trend: trend,
        last_updated: new Date().toISOString()
      });

      weightChanges.push({
        division: div,
        old: oldWeight,
        new: smoothedWeight,
        change_pct: ((smoothedWeight - oldWeight) / oldWeight) * 100
      });

      // Notify on large swings
      if (Math.abs(trend) > 0.04) { // > 20% change (0.20 * 0.20)
        supabase.from("notifications").insert({
          user_id: null,
          title: "⚙️ Allocator Learning Update",
          message: `${div} priority ${trend > 0 ? '↑' : '↓'} to ${(smoothedWeight * 100).toFixed(1)}%`,
          type: "info",
          division: "system"
        });
      }
    });

    // Upsert weights
    for (const update of updates) {
      await supabase
        .from("division_learning_weights")
        .upsert(update);
    }

    // Update default policy's impact component
    const { data: policy } = await supabase
      .from("sc_allocation_policies")
      .select("*")
      .eq("policy_key", "default_v1")
      .single();

    if (policy) {
      const weights = policy.weights as any;
      // We keep need and risk weights, but update impact dynamically
      // (In practice, you might blend learned weights into the policy more sophisticatedly)
      await supabase
        .from("sc_allocation_policies")
        .update({
          weights: {
            ...weights,
            impact_learned: Object.fromEntries(normalizedWeights)
          },
          updated_at: new Date().toISOString()
        })
        .eq("policy_key", "default_v1");
    }

    await supabase.from("system_logs").insert({
      action: "learn_policy_weights",
      result: `Updated ${updates.length} division weights`,
      log_level: "info",
      division: "system",
      metadata: { weight_changes: weightChanges }
    });

    console.log(`Learning complete: ${updates.length} weights updated`);

    return new Response(
      JSON.stringify({ 
        ok: true, 
        updated: updates.length,
        changes: weightChanges 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("Error learning weights:", error);
    
    await supabase.from("system_logs").insert({
      action: "learn_policy_weights",
      result: `Error: ${errorMessage}`,
      log_level: "error",
      division: "system"
    });

    // Notify admin on failure
    await supabase.from("notifications").insert({
      user_id: null,
      title: "⚠️ Learning Allocator Error",
      message: "Learning allocator encountered error in Phase 10.10",
      type: "alert",
      division: "system"
    });

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
