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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const apiKey = Deno.env.get("EIA_API_KEY");
    if (!apiKey) throw new Error("EIA API key not configured");

    console.log("Fetching energy data from EIA...");

    // Fetch electricity generation data by region
    const regions = [
      { id: "USA-CA", name: "California" },
      { id: "USA-TEX", name: "Texas" },
      { id: "USA-NY", name: "New York" },
      { id: "USA-FL", name: "Florida" },
    ];

    const records = [];
    
    for (const region of regions) {
      try {
        // EIA API v2: Get electricity generation data
        const url = `https://api.eia.gov/v2/electricity/rto/region-data/data/?api_key=${apiKey}&frequency=hourly&data[0]=value&facets[respondent][]=${region.id}&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=1`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        console.log(`Fetched EIA data for ${region.name}:`, data);

        if (data.response && data.response.data && data.response.data.length > 0) {
          const latest = data.response.data[0];
          
          // Only values actually reported by EIA are persisted.
          // stability_index / renewable_percentage were previously randomised —
          // synthetic operational data — and are now left NULL until a real
          // provider series backs them.
          const gridLoad = parseFloat(latest.value) || 0;

          records.push({
            region: region.name,
            grid_load: gridLoad,
            capacity: null,
            stability_index: null,
            renewable_percentage: null,
            outage_risk: 'unknown',
            updated_at: new Date().toISOString()
          });

        }

        // Respect API rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error fetching EIA data for ${region.name}:`, error);
      }
    }

    if (records.length > 0) {
      for (const record of records) {
        await supabase
          .from('energy_grid')
          .upsert(record, {
            onConflict: 'region',
            ignoreDuplicates: false
          });
      }
    }

    await supabase.from('system_logs').insert({
      source: 'eia',
      level: 'info',
      message: `Successfully fetched energy data for ${records.length} regions`,
      metadata: { records_count: records.length }
    });

    return new Response(
      JSON.stringify({ 
        ok: true, 
        message: `Fetched energy data for ${records.length} regions`,
        data: records 
      }), 
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("pull-eia-energy error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), 
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
