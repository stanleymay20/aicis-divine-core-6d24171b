import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { aiChat } from '../_shared/ai-gateway.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type HealthRecord = {
  affected_count?: number | null;
  risk_level?: string | null;
  [key: string]: unknown;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const { data, error: fetchError } = await supabaseClient
      .from('health_data')
      .select('*')
      .order('risk_level', { ascending: false });

    if (fetchError) throw fetchError;
    const healthData = (data ?? []) as HealthRecord[];

    const totalCases = healthData.reduce((sum, record) => sum + Number(record.affected_count ?? 0), 0);
    const criticalRegions = healthData.filter((record) => record.risk_level === 'critical').length;
    const highRiskRegions = healthData.filter((record) => record.risk_level === 'high').length;

    let analysis = healthData.length === 0
      ? 'No health records are currently available for evidence-based analysis.'
      : `AICIS has ${healthData.length} health records available for analysis. ${criticalRegions} are marked critical and ${highRiskRegions} are marked high risk.`;
    let modelProvider: string | null = null;
    let modelName: string | null = null;

    if (healthData.length > 0) {
      try {
        const result = await aiChat({
          messages: [
            {
              role: 'system',
              content: 'You are AICIS Health Intelligence. Analyze only the supplied database records. Do not add outside medical facts, fabricate trends, infer causality, or make forecasts unless explicit time-series or forecast evidence is present. Clearly distinguish observed counts from recommendations and state data limitations.',
            },
            {
              role: 'user',
              content: `Health records:\n${JSON.stringify(healthData).slice(0, 12000)}\n\nSummarize: (1) highest observed risks, (2) patterns directly supported by these records, (3) cautious monitoring or response recommendations.`,
            },
          ],
          temperature: 0.2,
        });
        analysis = result.content;
        modelProvider = result.provider;
        modelName = result.model;
      } catch (error) {
        console.error('Health narrative generation failed; returning deterministic metrics:', error);
      }
    }

    await supabaseClient.from('system_logs').insert({
      action: 'health_analysis',
      details: `Analyzed ${healthData.length} health records. Critical: ${criticalRegions}, High Risk: ${highRiskRegions}`,
      performed_by: user.id,
    });

    return new Response(JSON.stringify({
      success: true,
      metrics: {
        total_cases: totalCases,
        critical_regions: criticalRegions,
        high_risk_regions: highRiskRegions,
        total_tracked: healthData.length,
      },
      analysis,
      evidence_basis: 'health_data',
      model_provider: modelProvider,
      model_name: modelName,
      timestamp: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in analyze-health:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
