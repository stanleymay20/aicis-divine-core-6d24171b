import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    console.log("Merging global prior...");

    // Get policy
    const { data: policy } = await supabase
      .from("federation_policies")
      .select("*")
      .eq("enabled", true)
      .single();

    if (!policy) {
      return new Response(JSON.stringify({ ok: false, message: "Federation disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { max_daily_weight_drift } = policy;

    // Get recent inbound signals (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const { data: inboundSignals } = await supabase
      .from("federation_inbound_signals")
      .select("*")
      .gte("received_at", sevenDaysAgo.toISOString())
      .eq("signature_valid", true)
      .order("received_at", { ascending: false });

    if (!inboundSignals || inboundSignals.length === 0) {
      console.log("No inbound signals to merge");
      return new Response(JSON.stringify({ ok: false, message: "No inbound signals" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Build global prior per division
    const divisionData = new Map<string, { sum: number; totalWeight: number }>();

    inboundSignals.forEach(signal => {
      const weight = signal.summary_strength;
      (signal.signals as any[]).forEach(s => {
        if (!divisionData.has(s.division)) {
          divisionData.set(s.division, { sum: 0, totalWeight: 0 });
        }
        const data = divisionData.get(s.division)!;
        data.sum += s.impact_per_sc_avg * weight;
        data.totalWeight += weight;
      });
    });

    // Compute weighted averages
    const globalPrior = new Map<string, number>();
    divisionData.forEach((data, division) => {
      if (data.totalWeight > 0) {
        globalPrior.set(division, data.sum / data.totalWeight);
      }
    });

    // Normalize to sum = 1
    let totalPrior = 0;
    globalPrior.forEach(v => totalPrior += Math.max(0, v));
    
    if (totalPrior > 0) {
      globalPrior.forEach((v, k) => {
        globalPrior.set(k, Math.max(0, v) / totalPrior);
      });
    }

    // Get current learning weights
    const { data: currentWeights } = await supabase
      .from("division_learning_weights")
      .select("*");

    const weightUpdates = [];
    const beta = 0.25; // blend factor

    for (const weight of currentWeights || []) {
      const localWeight = Number(weight.impact_weight);
      const globalWeight = globalPrior.get(weight.division) || localWeight;

      // Blend: W' = (1-β)*L + β*G
      let blendedWeight = (1 - beta) * localWeight + beta * globalWeight;

      // Apply drift cap
      const maxDrift = localWeight * max_daily_weight_drift;
      blendedWeight = Math.max(
        localWeight - maxDrift,
        Math.min(localWeight + maxDrift, blendedWeight)
      );

      const trend = blendedWeight - localWeight;

      weightUpdates.push({
        division: weight.division,
        impact_weight: blendedWeight,
        trend,
        last_updated: new Date().toISOString()
      });

      // Notify on large swings
      if (Math.abs(trend) > 0.10) {
        await supabase.from("notifications").insert({
          user_id: null,
          title: "⚙️ Global Prior Update",
          message: `${weight.division} weight ${trend > 0 ? '↑' : '↓'} to ${(blendedWeight * 100).toFixed(1)}% (federated learning)`,
          type: "info",
          division: "system"
        });
      }
    }

    // Update weights
    for (const update of weightUpdates) {
      await supabase
        .from("division_learning_weights")
        .update({
          impact_weight: update.impact_weight,
          trend: update.trend,
          last_updated: update.last_updated
        })
        .eq("division", update.division);
    }

    // Update policy with global prior
    const { data: policyData } = await supabase
      .from("sc_allocation_policies")
      .select("*")
      .eq("policy_key", "default_v1")
      .single();

    if (policyData) {
      const weights = policyData.weights as any;
      await supabase
        .from("sc_allocation_policies")
        .update({
          weights: {
            ...weights,
            global_prior: Object.fromEntries(globalPrior)
          },
          updated_at: new Date().toISOString()
        })
        .eq("policy_key", "default_v1");
    }

    await supabase.from("system_logs").insert({
      action: "fed_merge_global_prior",
      result: `Merged global prior from ${inboundSignals.length} signals`,
      log_level: "info",
      division: "system",
      metadata: { signals: inboundSignals.length, updates: weightUpdates.length }
    });

    console.log(`Merged global prior: ${weightUpdates.length} weights updated`);

    return new Response(
      JSON.stringify({ ok: true, updated: weightUpdates.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("Error merging global prior:", error);
    
    await supabase.from("system_logs").insert({
      action: "fed_merge_global_prior",
      result: `Error: ${errorMessage}`,
      log_level: "error",
      division: "system"
    });

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
