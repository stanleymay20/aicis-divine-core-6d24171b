import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, corsHeaders, errorResponse, jsonResponse } from "../_shared/resilience.ts";

const FN = "generate-predictions";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    structuredLog('info', FN, 'Starting prediction generation');

    const divisions = ['health', 'food', 'energy', 'governance', 'finance', 'security'];
    const predictions: any[] = [];

    for (const division of divisions) {
      const historicalData = await resilientCall(`${FN}:fetch:${division}`, async () => {
        const tableMap: Record<string, { table: string; order: string }> = {
          health: { table: 'health_data', order: 'updated_at' },
          food: { table: 'food_security', order: 'updated_at' },
          energy: { table: 'energy_grid', order: 'updated_at' },
          governance: { table: 'governance_global', order: 'created_at' },
          finance: { table: 'finance_data', order: 'updated_at' },
          security: { table: 'security_incidents', order: 'created_at' },
        };
        const conf = tableMap[division];
        const { data, error } = await supabase
          .from(conf.table)
          .select('*')
          .order(conf.order, { ascending: false })
          .limit(division === 'finance' ? 100 : 50);
        if (error) throw error;
        return data || [];
      }, { maxRetries: 1, timeoutMs: 15000 });

      if (historicalData.length === 0) continue;

      const byCountry = historicalData.reduce((acc: any, item: any) => {
        const country = item.country || item.region || item.iso_code || 'Global';
        if (!acc[country]) acc[country] = [];
        acc[country].push(item);
        return acc;
      }, {});

      const countryEntries = Object.entries(byCountry).slice(0, 2);
      for (const [country, data] of countryEntries) {
        const dataArray = data as any[];
        if (dataArray.length < 1) continue;

        const today = new Date();
        const formatDate = (d: Date) => d.toISOString().split('T')[0];
        const futureDate1 = new Date(today); futureDate1.setDate(today.getDate() + 30);
        const futureDate2 = new Date(today); futureDate2.setDate(today.getDate() + 60);
        const futureDate3 = new Date(today); futureDate3.setDate(today.getDate() + 90);

        try {
          const forecast = await resilientCall(`${FN}:ai:${division}:${country}`, async () => {
            const prompt = `Analyze this ${division} data for ${country} and provide a 90-day FUTURE forecast starting from today (${formatDate(today)}).

Historical Data:
${JSON.stringify(dataArray.slice(0, 5), null, 2)}

Provide a JSON response with these exact fields:
{
  "summary": "Brief 1-2 sentence forecast summary",
  "trend": "increasing" | "stable" | "decreasing",
  "risk_level": "low" | "medium" | "high" | "critical",
  "confidence": 0.0-0.95,
  "key_factors": ["factor1", "factor2"],
  "timeline": [
    {"date": "${formatDate(futureDate1)}", "value": 100},
    {"date": "${formatDate(futureDate2)}", "value": 105},
    {"date": "${formatDate(futureDate3)}", "value": 110}
  ]
}

IMPORTANT: All dates MUST be future. Confidence MUST NOT exceed 0.95. Return ONLY JSON.`;

            const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${LOVABLE_API_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                model: 'google/gemini-2.5-flash-lite',
                messages: [
                  { role: 'system', content: 'You are AICIS predictive analytics AI. Provide forecasts in valid JSON format only. No markdown.' },
                  { role: 'user', content: prompt }
                ],
                temperature: 0.2,
                max_tokens: 500
              })
            });

            if (!aiResponse.ok) throw new Error(`AI API error: ${aiResponse.status}`);
            const aiResult = await aiResponse.json();
            const forecastText = aiResult.choices?.[0]?.message?.content || '{}';

            try {
              return JSON.parse(forecastText);
            } catch {
              const match = forecastText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
              if (match) return JSON.parse(match[1]);
              return { summary: `Forecast pending for ${country}`, confidence: 0.5, trend: 'stable', risk_level: 'medium' };
            }
          }, { maxRetries: 1, timeoutMs: 20000 });

          const cappedConfidence = Math.min(forecast.confidence || 0.7, 0.95);

          predictions.push({
            division, country, forecast,
            confidence: cappedConfidence,
            volatility_index: forecast.risk_level === 'critical' ? 0.8 :
                             forecast.risk_level === 'high' ? 0.6 :
                             forecast.risk_level === 'medium' ? 0.4 : 0.2,
            predicted_at: new Date().toISOString()
          });
        } catch (err) {
          structuredLog('warn', FN, `Prediction failed for ${country}/${division}`, { error: (err as Error).message });
        }
      }
    }

    let inserted = 0;
    let prospectiveInserted = 0;
    for (const pred of predictions) {
      const { data: predRow, error } = await supabase.from('predictions').insert({
        division: pred.division, country: pred.country,
        forecast: pred.forecast, confidence: pred.confidence,
        volatility_index: pred.volatility_index, predicted_at: pred.predicted_at
      }).select('id').single();
      if (!error) {
        inserted++;

        // Insert into prospective evaluation pipeline
        const timeline = pred.forecast?.timeline;
        const horizons = [30, 60, 90];
        for (let i = 0; i < horizons.length; i++) {
          const timelineEntry = timeline?.[i];
          const predictedValue = timelineEntry?.value ?? (pred.confidence * 100);
          const trendDir = pred.forecast?.trend === 'increasing' ? 'increasing' : pred.forecast?.trend === 'decreasing' ? 'decreasing' : 'stable';
          const predictedAt = new Date();
          const dueAt = new Date(predictedAt);
          dueAt.setDate(dueAt.getDate() + horizons[i]);

          const { error: prospErr } = await supabase.from('forecast_prospective_evaluations').insert({
            forecast_id: predRow?.id ?? null,
            domain: pred.division,
            iso3: pred.country?.length === 3 ? pred.country : 'GLB',
            model_version: 'gemini-2.5-flash-lite',
            horizon_days: horizons[i],
            predicted_value: predictedValue,
            predicted_direction: trendDir,
            predicted_at: predictedAt.toISOString(),
            realization_due_at: dueAt.toISOString(),
            evaluation_window: `${horizons[i]}d`,
            metadata: { source: 'generate-predictions', forecast_id: predRow?.id },
          });
          if (!prospErr) prospectiveInserted++;
        }
      }
    }

    await supabase.from('system_logs').insert({
      division: 'intelligence', action: 'generate_predictions',
      result: 'success', log_level: 'info',
      metadata: { predictions_generated: inserted, divisions_processed: divisions.length }
    });

    structuredLog('info', FN, `Generated ${inserted} predictions, ${prospectiveInserted} prospective evaluations`, undefined, start);
    return jsonResponse({ success: true, predictions_generated: inserted, prospective_evaluations: prospectiveInserted, total_processed: predictions.length });
  } catch (error) {
    structuredLog('error', FN, (error as Error).message, undefined, start);
    return errorResponse(error);
  }
});
