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
    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(Math.max(Number(body?.batch_size ?? 24), 1), 75);
    const offset = Math.max(Number(body?.offset ?? 0), 0);

    const end = new Date();
    end.setUTCDate(end.getUTCDate() - 2); // NASA POWER daily data can lag by 24-48h
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 6);
    const fmt = (d: Date) => d.toISOString().slice(0, 10).replaceAll('-', '');
    
    // NASA POWER API - Solar/Weather data
    try {
      const { data: countries, error: countryError } = await supabase
        .from('canonical_entities')
        .select('iso3,lat,lon')
        .eq('entity_type', 'country')
        .not('iso3', 'is', null)
        .not('lat', 'is', null)
        .not('lon', 'is', null)
        .order('iso3', { ascending: true })
        .range(offset, offset + batchSize - 1);

      if (countryError) throw countryError;

      for (const country of countries ?? []) {
        const iso = country.iso3;
        const lat = Number(country.lat);
        const lon = Number(country.lon);
        const nasaUrl = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=ALLSKY_SFC_SW_DWN,PRECTOTCORR,T2M&community=AG&longitude=${lon}&latitude=${lat}&start=${fmt(start)}&end=${fmt(end)}&format=JSON`;
        
        const response = await fetch(nasaUrl);
        if (response.ok) {
          const data = await response.json();
          const params = data.properties?.parameter;
          
          if (params?.T2M) {
            const dates = Object.keys(params.T2M);
            const lastDate = dates[dates.length - 1];
            
              const observedAt = new Date(`${lastDate.slice(0,4)}-${lastDate.slice(4,6)}-${lastDate.slice(6,8)}T00:00:00Z`).toISOString();
              observations.push(
                {
                  iso_code: iso,
                  lat, lon,
                  timestamp: observedAt,
                  source: 'NASA_POWER',
                  layer: 'TEMPERATURE',
                  value: params.T2M[lastDate],
                  confidence: 0.95,
                  metadata: { window_start: fmt(start), window_end: fmt(end), batch_offset: offset },
                },
                {
                  iso_code: iso,
                  lat, lon,
                  timestamp: observedAt,
                  source: 'NASA_POWER',
                  layer: 'SOLAR_IRRADIANCE',
                  value: params.ALLSKY_SFC_SW_DWN?.[lastDate] ?? null,
                  confidence: 0.95,
                  metadata: { window_start: fmt(start), window_end: fmt(end), batch_offset: offset },
                },
                {
                  iso_code: iso,
                  lat, lon,
                  timestamp: observedAt,
                  source: 'NASA_POWER',
                  layer: 'PRECIPITATION',
                  value: params.PRECTOTCORR?.[lastDate] ?? null,
                  confidence: 0.95,
                  metadata: { window_start: fmt(start), window_end: fmt(end), batch_offset: offset },
                }
              );
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

    await supabase.from('automation_logs').insert({
      job_name: 'fetch-satellite-global',
      status: inserted > 0 ? 'success' : 'warning',
      message: `Fetched ${observations.length}, inserted ${inserted}, offset=${offset}, batch=${batchSize}`,
    });

    await finishProviderRun(supabase, run, {
      records_fetched: observations.length,
      records_inserted: inserted,
      records_normalized: inserted,
    });

    return new Response(JSON.stringify({
      ok: true,
      fetched: observations.length,
      inserted,
      offset,
      batch_size: batchSize,
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
