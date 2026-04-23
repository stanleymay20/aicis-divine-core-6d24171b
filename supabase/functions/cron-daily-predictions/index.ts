import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function refreshCrossBorderSignals(supabase: any) {
  const { data: latestBatch } = await supabase
    .from("risk_ranking_predictions")
    .select("generation_batch_id")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestBatch?.generation_batch_id) {
    return { created: 0, reason: "no_risk_batch" };
  }

  const { data: risks, error: riskErr } = await supabase
    .from("risk_ranking_predictions")
    .select("country_iso3, domain, risk_probability")
    .eq("generation_batch_id", latestBatch.generation_batch_id)
    .gte("risk_probability", 0.55)
    .limit(150);
  if (riskErr) throw riskErr;
  if (!risks || risks.length === 0) return { created: 0, reason: "no_high_risk_rows" };

  const iso3s = Array.from(new Set(risks.map((r: any) => r.country_iso3).filter(Boolean)));
  const { data: countries, error: countriesErr } = await supabase
    .from("canonical_entities")
    .select("id, iso3")
    .in("entity_type", ["country", "territory"])
    .in("iso3", iso3s);
  if (countriesErr) throw countriesErr;

  const idToIso = new Map((countries ?? []).map((c: any) => [c.id, c.iso3]));
  const isoToId = new Map((countries ?? []).map((c: any) => [c.iso3, c.id]));
  const countryIds = Array.from(idToIso.keys());
  if (countryIds.length === 0) return { created: 0, reason: "no_country_entities" };

  const { data: links, error: linksErr } = await supabase
    .from("entity_links")
    .select("source_entity_id, target_entity_id, strength, link_type")
    .eq("link_type", "borders")
    .in("source_entity_id", countryIds)
    .in("target_entity_id", countryIds);
  if (linksErr) throw linksErr;

  const neighbors = new Map<string, Array<{ iso3: string; strength: number }>>();
  for (const link of links ?? []) {
    const a = idToIso.get(link.source_entity_id);
    const b = idToIso.get(link.target_entity_id);
    if (!a || !b) continue;
    const strength = Number(link.strength ?? 0.5);
    neighbors.set(a, [...(neighbors.get(a) ?? []), { iso3: b, strength }]);
    neighbors.set(b, [...(neighbors.get(b) ?? []), { iso3: a, strength }]);
  }

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 2);
  await supabase
    .from("cross_border_signals")
    .delete()
    .eq("signal_type", "border_risk_propagation")
    .gte("detected_at", cutoff.toISOString());

  const rows = risks.flatMap((risk: any) => {
    const adjacent = (neighbors.get(risk.country_iso3) ?? []).slice(0, 5);
    return adjacent.map((n) => ({
      signal_type: "border_risk_propagation",
      origin_iso3: risk.country_iso3,
      affected_iso3: [n.iso3],
      domain: risk.domain,
      intensity: Number((Number(risk.risk_probability) * Math.max(0.25, n.strength)).toFixed(4)),
      description: `${risk.domain} risk in ${risk.country_iso3} may spill into ${n.iso3}`,
      detected_at: new Date().toISOString(),
      metadata: {
        generated_by: "cron-daily-predictions",
        generation_batch_id: latestBatch.generation_batch_id,
        border_strength: n.strength,
        base_risk_probability: risk.risk_probability,
      },
    }));
  });

  if (rows.length === 0) return { created: 0, reason: "no_neighbor_links" };

  const { error: insertErr } = await supabase.from("cross_border_signals").insert(rows);
  if (insertErr) throw insertErr;
  return { created: rows.length, reason: "ok" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const trainingWindow = {
      start_date: isoDaysAgo(21),
      end_date: isoDaysAgo(7),
      horizon_days: 7,
      chunk_days: 1,
    };

    const [forecastRun, trainingRun, rankingRun, influenceRun] = await Promise.all([
      supabase.functions.invoke("generate-predictions"),
      supabase.functions.invoke("build-training-dataset", { body: trainingWindow }),
      supabase.functions.invoke("predict-risk-ranking", { body: { mode: "refresh", top_n: 200 } }),
      supabase.rpc("compute_cross_domain_influence"),
    ]);

    if (forecastRun.error) throw forecastRun.error;
    if (trainingRun.error) throw trainingRun.error;
    if (rankingRun.error) throw rankingRun.error;
    if (influenceRun.error) throw influenceRun.error;

    const crossBorder = await refreshCrossBorderSignals(supabase);
    const predictionsGenerated = forecastRun.data?.predictions_generated || 0;
    const rankingInserted = rankingRun.data?.rows_inserted || 0;
    const trainingInserted = trainingRun.data?.stats?.rows_inserted || trainingRun.data?.stats?.rows_inserted === 0
      ? trainingRun.data.stats.rows_inserted
      : 0;
    const influenceInserted = influenceRun.data?.rows_inserted || 0;

    await supabase.from("automation_logs").insert({
      job_name: "cron-daily-predictions",
      status: "success",
      message: `predictions=${predictionsGenerated}, training=${trainingInserted}, ranking=${rankingInserted}, influence=${influenceInserted}, cross_border=${crossBorder.created}`,
    });

    await supabase.rpc("register_pipeline_heartbeat", {
      _pipeline_name: "cron-daily-predictions",
      _success: true,
      _metadata: {
        predictions_generated: predictionsGenerated,
        training_rows: trainingInserted,
        risk_rows: rankingInserted,
        cross_domain_rows: influenceInserted,
        cross_border_rows: crossBorder.created,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        predictions: forecastRun.data,
        training: trainingRun.data,
        ranking: rankingRun.data,
        cross_domain: influenceRun.data,
        cross_border: crossBorder,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in daily predictions:", error);

    await supabase.from("automation_logs").insert({
      job_name: "cron-daily-predictions",
      status: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    });

    await supabase.rpc("register_pipeline_heartbeat", {
      _pipeline_name: "cron-daily-predictions",
      _success: false,
      _error: error instanceof Error ? error.message : "Unknown error",
    });

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});