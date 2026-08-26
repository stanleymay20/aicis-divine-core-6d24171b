import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
// Sub-National Hybrid Inference Worker
// Downscales national metrics to admin1/admin2/village rows using:
//   1. Population weights (deterministic, transparent)
//   2. Stored confidence scaling (lower = deeper level)
// Marked as "inferred" + ingestion_source='downscaled' so dashboards can filter.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LEVEL_CONFIDENCE: Record<number, number> = { 1: 0.7, 2: 0.55, 3: 0.4 };
const BATCH_REGIONS = 250;

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Open run record up-front so even hard crashes leave evidence
  const runRow = await supabase
    .from("subnational_inference_runs")
    .insert({
      function_name: "subnational-hybrid-inference",
      status: "started",
      metadata: { method: req.method },
    })
    .select("run_id")
    .single();
  const runId: string | null = runRow.data?.run_id ?? null;

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const targetLevel: number = body.admin_level ?? 1;
    const domain: string | undefined = body.domain; // optional; if omitted, all domains

    // Cursor for chunked rollout across regions
    const cursorKey = `subnat_inference_cursor_l${targetLevel}`;
    const { data: cur } = await supabase
      .from("backfill_state")
      .select("value_int")
      .eq("key", cursorKey)
      .maybeSingle();
    const offset = cur?.value_int ?? 0;

    // Pull a slice of admin regions at the target level
    const { data: regions, error: regErr } = await supabase
      .from("admin_regions")
      .select("id, country_iso3, admin_level, name, population_est")
      .eq("admin_level", targetLevel)
      .order("id")
      .range(offset, offset + BATCH_REGIONS - 1);
    if (regErr) throw regErr;
    if (!regions || regions.length === 0) {
      // Loop back to start
      await supabase
        .from("backfill_state")
        .upsert({ key: cursorKey, value_int: 0, updated_at: new Date().toISOString() }, { onConflict: "key" });
      return new Response(
        JSON.stringify({ ok: true, message: "Wrapped cursor", admin_level: targetLevel }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get country populations to compute weight = region_pop / country_pop
    const isoSet = Array.from(new Set(regions.map((r) => r.country_iso3)));
    const { data: countryPops } = await supabase
      .from("metrics")
      .select("iso3, value, period")
      .eq("domain", "population")
      .eq("metric", "SP.POP.TOTL")
      .in("iso3", isoSet)
      .order("period", { ascending: false });
    const countryPopMap = new Map<string, number>();
    for (const p of countryPops ?? []) {
      if (!countryPopMap.has(p.iso3) && p.value) countryPopMap.set(p.iso3, p.value);
    }

    // Pull latest national metrics for these countries (optional domain filter)
    let metricQuery = supabase
      .from("metrics")
      .select("iso3, domain, metric, value, period, unit, source")
      .in("iso3", isoSet)
      .is("geo_id", null)
      .order("period", { ascending: false })
      .limit(2000);
    if (domain) metricQuery = metricQuery.eq("domain", domain);
    const { data: nationalMetrics } = await metricQuery;

    // Index latest national metric per (iso3, domain, metric)
    const latestByKey = new Map<string, any>();
    for (const m of nationalMetrics ?? []) {
      const k = `${m.iso3}|${m.domain}|${m.metric}`;
      if (!latestByKey.has(k)) latestByKey.set(k, m);
    }

    const inserts: any[] = [];
    let inferred = 0;
    const conf = LEVEL_CONFIDENCE[targetLevel] ?? 0.4;

    for (const region of regions) {
      const countryPop = countryPopMap.get(region.country_iso3) ?? 0;
      const regionPop = region.population_est ?? 0;
      const weight = countryPop > 0 && regionPop > 0 ? regionPop / countryPop : null;

      // For every (domain, metric) cell available at national level, downscale
      for (const [k, nat] of latestByKey) {
        if (nat.iso3 !== region.country_iso3) continue;
        // Stocks (population, GDP totals) → scale by weight
        // Rates/indices → carry over (use confidence to mark)
        const isStock = /TOTL|MKTP|POP|XPD/.test(nat.metric);
        const value = isStock && weight !== null
          ? nat.value * weight
          : nat.value;
        if (value === null || value === undefined) continue;

        inserts.push({
          domain: nat.domain,
          metric: `${nat.metric}.subnat.l${targetLevel}`,
          // geo_id intentionally NULL — geo_catalog is unused; region is in raw
          iso3: region.country_iso3,
          period: nat.period,
          value,
          unit: nat.unit,
          confidence: conf * (weight !== null ? 1.0 : 0.7),
          source: "downscaled",
          raw: {
            origin: "subnational-hybrid-inference",
            method: isStock && weight !== null ? "population_weight" : "carry_over",
            weight,
            region_id: region.id,
            region_name: region.name,
            admin_level: targetLevel,
            national_metric: nat.metric,
            national_source: nat.source,
            inferred: true,
          },
        });
        inferred++;
        if (inserts.length >= 500) break;
      }
      if (inserts.length >= 500) break;
    }

    // Bulk insert
    let insertedCount = 0;
    if (inserts.length > 0) {
      for (let i = 0; i < inserts.length; i += 200) {
        const slice = inserts.slice(i, i + 200);
        const { error } = await supabase.from("metrics").insert(slice);
        if (!error) insertedCount += slice.length;
      }
    }

    // Advance cursor
    await supabase
      .from("backfill_state")
      .upsert(
        { key: cursorKey, value_int: offset + regions.length, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );

    await supabase.from("automation_logs").insert({
      job_name: "subnational-hybrid-inference",
      status: "success",
      message: `level=${targetLevel} regions=${regions.length} inferred=${inferred} inserted=${insertedCount} offset=${offset}`,
    });

    // Close run record honestly: zero_write if nothing landed
    if (runId) {
      await supabase.from("subnational_inference_runs").update({
        status: insertedCount === 0 ? "zero_write" : "succeeded",
        admin_level: targetLevel,
        rows_written: insertedCount,
        rows_attempted: inserts.length,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - start,
        metadata: {
          regions_processed: regions.length,
          offset,
          domain: domain ?? null,
        },
      }).eq("run_id", runId);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        run_id: runId,
        admin_level: targetLevel,
        regions_processed: regions.length,
        inferred_metrics: inferred,
        rows_written: insertedCount,
        next_offset: offset + regions.length,
        duration_ms: Date.now() - start,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("subnational-hybrid-inference error:", msg);
    if (runId) {
      await supabase.from("subnational_inference_runs").update({
        status: "failed",
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - start,
        error_message: msg,
      }).eq("run_id", runId);
    }
    return new Response(JSON.stringify({ error: msg, run_id: runId }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

