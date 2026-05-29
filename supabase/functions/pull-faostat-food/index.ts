import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  startProviderRun,
  finishProviderRun,
  failProviderRun,
} from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Use service role for system operations (cron jobs)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const run = await startProviderRun(supabase, {
    provider_name: "faostat",
    endpoint: "pull-faostat-food",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  try {
    console.log("Fetching FAOSTAT food data...");

    const startTime = Date.now();
    // Public FAOSTAT API (no key)
    const countries = [288, 566, 404, 710]; // Ghana, Nigeria, Kenya, South Africa
    const items = [562, 27, 15]; // maize, rice, wheat
    const year = new Date().getUTCFullYear() - 1;

    const pulls: any[] = [];
    for (const area_code of countries) {
      for (const item_code of items) {
        try {
          const url = `https://fenixservices.fao.org/faostat/api/v1/en/data/QCL?area_codes=${area_code}&item_codes=${item_code}&years=${year}`;
          const r = await fetch(url);
          if (!r.ok) continue;
          const j = await r.json();
          pulls.push(...(j?.data ?? []));
        } catch (e) {
          console.warn("FAOSTAT fetch error for", area_code, item_code, e);
        }
      }
    }

    console.log("Fetched", pulls.length, "FAOSTAT records");

    let inserted = 0;
    const now = new Date().toISOString();
    
    for (const row of pulls) {
      const region = row.Area ?? String(row.AreaCode);
      const item = row.Item ?? String(row.ItemCode);
      const value = Number(row.Value ?? 0);
      const yieldIndex = Math.min(100, Math.max(0, value / 1000));
      const supplyDays = Math.max(15, Math.min(120, Math.round(value / 500)));
      const risk = yieldIndex >= 50 ? 'stable' : (yieldIndex >= 25 ? 'watch' : 'critical');

      const { error: insertError } = await supabase.from('food_security').insert({
        region, 
        crop: item,
        yield_index: Number(yieldIndex.toFixed(2)), 
        supply_days: supplyDays,
        alert_level: risk, 
        updated_at: now,
        metadata: { item, raw_value_tonnes: value, year }
      });
      
      if (!insertError) inserted++;
    }

    await supabase.from('compliance_audit').insert({
      action_type: 'data_pull', 
      division: 'food', 
      action_description: 'Pulled FAOSTAT QCL production data', 
      compliance_status: 'compliant',
      data_accessed: { provider: 'FAOSTAT', domain: 'QCL', countries, items, year }
    });
    
    const latencyMs = Date.now() - startTime;

    // Log to data_source_log
    await supabase.from('data_source_log').insert({
      division: 'food',
      source: 'faostat',
      records_ingested: inserted,
      latency_ms: latencyMs,
      status: 'success',
      last_success: now
    });

    await supabase.from('system_logs').insert({
      division: 'food', 
      action: 'pull_faostat_food', 
      result: 'success', 
      log_level: 'info', 
      metadata: { inserted, latency_ms: latencyMs }
    });

    console.log("FAOSTAT data pull complete:", inserted, "records");

    return new Response(
      JSON.stringify({ ok: true, inserted, message: `Inserted ${inserted} food security records` }), 
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("pull-faostat-food error:", e);
    
    // Log failure
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );
    await supabase.from('data_source_log').insert({
      division: 'food',
      source: 'faostat',
      records_ingested: 0,
      status: 'failure',
      error_message: e instanceof Error ? e.message : 'Unknown error'
    });

    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), 
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
