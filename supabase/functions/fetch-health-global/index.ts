import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, corsHeaders, errorResponse, jsonResponse } from "../_shared/resilience.ts";

const FN = "fetch-health-global";
const TIMEOUT_MS = 15000;

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const start = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    structuredLog('info', FN, 'Starting health data collection');
    const results: { health: number; errors: string[] } = { health: 0, errors: [] };

    // WHO - Global health indicators
    await resilientCall(`${FN}:who`, async () => {
      const whoResponse = await fetch('https://ghoapi.azureedge.net/api/WHOSIS_000001?$top=100');
      if (!whoResponse.ok) throw new Error(`WHO API: ${whoResponse.status}`);
      const whoData = await whoResponse.json();

      if (whoData.value) {
        const healthRecords = whoData.value
          .filter((item: any) => item.Value && item.SpatialDim)
          .slice(0, 50)
          .map((item: any) => ({
            country: item.SpatialDim,
            iso_code: item.SpatialDim,
            source: 'who',
            metric_name: 'life_expectancy',
            value: parseFloat(item.Value),
            unit: 'years',
            sex: item.Dim1 || 'all',
            date: `${item.TimeDim || new Date().getFullYear()}-01-01`,
            metadata: { indicator_code: item.IndicatorCode, display_value: item.DisplayValue }
          }));

        const { error } = await supabase.from('health_metrics').insert(healthRecords);
        if (error) throw new Error(`DB insert: ${error.message}`);
        results.health += healthRecords.length;
        structuredLog('info', FN, `WHO: ${healthRecords.length} records`);
      }
    }, { timeoutMs: TIMEOUT_MS }).catch(e => {
      const msg = `WHO: ${(e as Error).message}`;
      results.errors.push(msg);
      structuredLog('warn', FN, msg);
    });

    // OpenFDA drug adverse-event signals — free, no auth, reliable from edge IPs.
    // Replaces broken CDC SOQL endpoints.
    await resilientCall(`${FN}:openfda`, async () => {
      const resp = await fetch(
        'https://api.fda.gov/drug/event.json?count=patient.reaction.reactionmeddrapt.exact&limit=50',
        { headers: { 'Accept': 'application/json', 'User-Agent': 'AICIS/1.0' } }
      );
      if (!resp.ok) throw new Error(`OpenFDA: ${resp.status}`);
      const data = await resp.json();
      const items: { term: string; count: number }[] = data.results || [];
      if (items.length > 0) {
        const today = new Date().toISOString().split('T')[0];
        const records = items.slice(0, 50).map((it) => ({
          country: 'United States',
          iso_code: 'USA',
          source: 'openfda',
          metric_name: `adverse_event_${it.term.toLowerCase().replace(/\s+/g, '_').slice(0, 60)}`,
          value: it.count,
          unit: 'reports',
          date: today,
          metadata: { reaction: it.term, dataset: 'drug_event' },
        }));
        const { error } = await supabase.from('health_metrics').insert(records);
        if (error) throw new Error(`DB insert: ${error.message}`);
        results.health += records.length;
        structuredLog('info', FN, `OpenFDA: ${records.length} adverse-event signals`);
      }
    }, { timeoutMs: TIMEOUT_MS }).catch(e => {
      const msg = `OpenFDA: ${(e as Error).message}`;
      results.errors.push(msg);
      structuredLog('warn', FN, msg);
    });

    // WHO GHO - Additional indicators (lighter than OWID COVID full dump)
    await resilientCall(`${FN}:who-gho`, async () => {
      const indicators = ['WHOSIS_000002', 'MDG_0000000001']; // Healthy life expectancy, Under-5 mortality
      for (const indicator of indicators) {
        const resp = await fetch(`https://ghoapi.azureedge.net/api/${indicator}?$top=50&$orderby=TimeDim%20desc`);
        if (!resp.ok) continue;
        const data = await resp.json();
        if (data.value) {
          const records = data.value
            .filter((item: any) => item.Value && item.SpatialDim)
            .slice(0, 25)
            .map((item: any) => ({
              country: item.SpatialDim,
              iso_code: item.SpatialDim,
              source: 'who',
              metric_name: indicator === 'WHOSIS_000002' ? 'healthy_life_expectancy' : 'under5_mortality',
              value: parseFloat(item.Value),
              unit: indicator === 'WHOSIS_000002' ? 'years' : 'per_1000',
              date: `${item.TimeDim || new Date().getFullYear()}-01-01`,
              metadata: { indicator_code: item.IndicatorCode }
            }));
          if (records.length > 0) {
            const { error } = await supabase.from('health_metrics').insert(records);
            if (!error) results.health += records.length;
          }
        }
      }
    }, { timeoutMs: TIMEOUT_MS }).catch(e => {
      const msg = `WHO-GHO: ${(e as Error).message}`;
      results.errors.push(msg);
      structuredLog('warn', FN, msg);
    });

    // Log completion - ALWAYS logs
    await supabase.from('automation_logs').insert({
      job_name: FN,
      status: results.errors.length === 0 ? 'success' : (results.health > 0 ? 'partial' : 'error'),
      message: `Fetched ${results.health} health records. Errors: ${results.errors.length}${results.errors.length > 0 ? ` [${results.errors.join('; ')}]` : ''}`
    });

    structuredLog('info', FN, `Complete: ${results.health} records, ${results.errors.length} errors`, undefined, start);
    return jsonResponse({ ok: true, message: `Fetched ${results.health} health metrics`, data: results });
  } catch (e) {
    structuredLog('error', FN, (e as Error).message, undefined, start);
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    await supabase.from('automation_logs').insert({ job_name: FN, status: 'error', message: (e as Error).message });
    return errorResponse(e);
  }
});
