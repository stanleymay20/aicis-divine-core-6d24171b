import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { startProviderRun, finishProviderRun, failProviderRun } from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );
  const run = await startProviderRun(supabase, {
    provider_name: "fetch-satellite-global",
    endpoint: "fetch-satellite-global",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  try {

    const observations: any[] = [];
    
    // NASA POWER API - Solar/Weather data
    try {
      const countries = ['USA', 'GBR', 'DEU', 'NRU', 'KEN', 'GHA'];
      const coords: Record<string, {lat: number, lon: number}> = {
        'USA': {lat: 39, lon: -98},
        'GBR': {lat: 54, lon: -2},
        'DEU': {lat: 51, lon: 10},
        'NRU': {lat: -0.5228, lon: 166.9315},
        'KEN': {lat: 0.0236, lon: 37.9062},
        'GHA': {lat: 7.9465, lon: -1.0232}
      };
      
      for (const iso of countries) {
        const {lat, lon} = coords[iso];
        const nasaUrl = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=ALLSKY_SFC_SW_DWN,PRECTOTCORR,T2M&community=AG&longitude=${lon}&latitude=${lat}&start=20240101&end=20240131&format=JSON`;
        
        const response = await fetch(nasaUrl);
        if (response.ok) {
          const data = await response.json();
          const params = data.properties?.parameter;
          
          if (params?.T2M) {
            const dates = Object.keys(params.T2M);
            const lastDate = dates[dates.length - 1];
            
            observations.push({
              iso_code: iso,
              lat, lon,
              timestamp: new Date(`${lastDate.slice(0,4)}-${lastDate.slice(4,6)}-${lastDate.slice(6,8)}`).toISOString(),
              source: 'NASA_POWER',
              layer: 'TEMPERATURE',
              value: params.T2M[lastDate],
              confidence: 0.95,
              metadata: {
                solar: params.ALLSKY_SFC_SW_DWN?.[lastDate],
                precipitation: params.PRECTOTCORR?.[lastDate]
              }
            });
          }
        }
      }
    } catch (error) {
      console.error('NASA POWER error:', error);
    }

    // Insert observations
    let inserted = 0;
    for (const obs of observations) {
      try {
        const { error } = await supabase
          .from('satellite_observations')
          .insert(obs);
        
        if (!error) inserted++;
      } catch (error) {
        console.error('Insert error:', error);
      }
    }

    console.log(`Fetched ${observations.length} satellite observations, inserted ${inserted}`);

    await finishProviderRun(supabase, run, {
      records_fetched: observations.length,
      records_inserted: inserted,
      records_normalized: inserted,
    });

    return new Response(JSON.stringify({
      ok: true,
      fetched: observations.length,
      inserted
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in fetch-satellite-global:', error);
    await failProviderRun(supabase, run, error);

    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
