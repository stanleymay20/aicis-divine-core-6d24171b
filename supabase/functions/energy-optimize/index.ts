import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization')!;
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    // Read REAL observed grid state. This function previously inserted hard-coded
    // "sample" grid rows into energy_grid and presented them as operational data.
    // It now only analyses measurements produced by real provider ingestion.
    const { data: energyData, error: gridError } = await supabaseClient
      .from('energy_grid')
      .select('region, grid_load, capacity, stability_index, renewable_percentage, outage_risk, updated_at')
      .order('updated_at', { ascending: false })
      .limit(50);

    if (gridError) throw new Error(`energy_grid read failed: ${gridError.message}`);

    if (!energyData || energyData.length === 0) {
      return new Response(JSON.stringify({
        ok: false,
        code: 'no_observed_grid_data',
        message: 'No observed energy grid measurements are available. Optimization is not produced from synthetic data.',
      }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: 'You are an energy grid analyst. Analyse ONLY the measurements provided. Where a field is null, state explicitly that it is unmeasured rather than assuming a value. Provide optimization recommendations with stated uncertainty.'
          },
          { role: 'user', content: `Observed energy grid measurements (JSON):\n${JSON.stringify(energyData)}\n\nAnalyse grid load, stability and renewable integration, and give optimization strategies.` }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const body = await aiResponse.text();
      return new Response(JSON.stringify({ error: 'AI processing failed', status: aiResponse.status, details: body }), {
        status: aiResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiData = await aiResponse.json();
    const optimization = aiData.choices[0].message.content;

    await supabaseClient.from('system_logs').insert({
      user_id: user.id,
      division: 'energy',
      action: 'energy_optimization',
      result: 'completed',
      log_level: 'success',
      metadata: { optimization, regions: energyData.length, source: 'observed_energy_grid' }
    });

    return new Response(JSON.stringify({ optimization, energyData, evidence_rows: energyData.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in energy-optimize:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
