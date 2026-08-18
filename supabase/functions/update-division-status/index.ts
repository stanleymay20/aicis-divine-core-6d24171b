import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    console.log("Updating division status for all divisions...");

    // Get all divisions
    const { data: divisions } = await supabase
      .from('ai_divisions')
      .select('*');

    if (!divisions) throw new Error("No divisions found");

    const updates = [];

    for (const division of divisions) {
      const divisionKey = division.division_key;
      let performance = 100;
      let uptime = 100;
      let status = 'operational';
      let apiConnected = false;

      // Calculate performance based on recent data freshness
      const timeSinceSync = division.last_synced_at 
        ? Date.now() - new Date(division.last_synced_at).getTime()
        : Infinity;
      
      const minutesSinceSync = timeSinceSync / (1000 * 60);

      // Deterministic freshness-derived health. Previously these scores carried a
      // Math.random() component, which made an operational KPI partly fabricated.
      // Performance is now a pure, reproducible function of measured data freshness.
      if (minutesSinceSync < 60) {
        status = 'operational';
        uptime = 99.9;
        performance = 100 - (minutesSinceSync / 60) * 5;          // 100 -> 95
        apiConnected = true;
      } else if (minutesSinceSync < 360) {
        status = 'operational';
        uptime = 99.5;
        performance = 95 - ((minutesSinceSync - 60) / 300) * 10;  // 95 -> 85
        apiConnected = true;
      } else if (minutesSinceSync < 1440) {
        status = 'degraded';
        uptime = 95.0;
        performance = 85 - ((minutesSinceSync - 360) / 1080) * 15; // 85 -> 70
        apiConnected = false;
      } else {
        status = 'offline';
        uptime = 80.0;
        performance = Math.max(30, 70 - ((minutesSinceSync - 1440) / 1440) * 20);
        apiConnected = false;
      }
      performance = Math.round(performance * 100) / 100;


      // Check division-specific metrics for additional adjustments
      if (divisionKey === 'crisis') {
        const { count: crisisCount } = await supabase
          .from('crisis_events')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'active');
        
        if (crisisCount && crisisCount > 5) {
          performance = Math.max(performance - 10, 60);
        }
      }

      updates.push({
        division_key: divisionKey,
        performance_score: performance,
        uptime_percentage: uptime,
        status,
        api_connected: apiConnected
      });

      // Log performance
      await supabase.from('division_performance_logs').insert({
        division_key: divisionKey,
        performance_score: performance,
        uptime_percentage: uptime,
        data_freshness_minutes: Math.round(minutesSinceSync),
        success_rate: uptime
      });
    }

    // Batch update all divisions
    for (const update of updates) {
      await supabase
        .from('ai_divisions')
        .update({
          performance_score: update.performance_score,
          uptime_percentage: update.uptime_percentage,
          status: update.status,
          api_connected: update.api_connected,
          updated_at: new Date().toISOString()
        })
        .eq('division_key', update.division_key);
    }

    await supabase.from('system_logs').insert({
      level: 'info',
      category: 'division_status',
      message: `Updated status for ${updates.length} divisions`,
      metadata: { updates }
    });

    return new Response(
      JSON.stringify({ 
        ok: true, 
        message: "Division statuses updated",
        updates 
      }), 
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("update-division-status error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), 
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
