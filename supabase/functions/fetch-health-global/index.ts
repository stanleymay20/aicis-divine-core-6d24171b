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

    // CDC - Weekly hospital admissions (active dataset aemt-mg7g, correct column: week_end_date)
    await resilientCall(`${FN}:cdc`, async () => {
      const cdcResponse = await fetch(
        'https://data.cdc.gov/resource/aemt-mg7g.json?$limit=100&$order=week_end_date%20DESC',
        { headers: { 'Accept': 'application/json', 'User-Agent': 'AICIS/1.0' } }
      );
      if (!cdcResponse.ok) throw new Error(`CDC API: ${cdcResponse.status}`);
      const cdcData = await cdcResponse.json();

      if (Array.isArray(cdcData) && cdcData.length > 0) {
        const cdcRecords = cdcData
          .filter((item: any) => item.jurisdiction && item.num_hospitals_previous_day_admission_adult_covid_confirmed)
          .map((item: any) => ({
            country: 'United States',
            iso_code: 'USA',
            source: 'cdc',
            metric_name: 'covid_adult_admissions_weekly',
            value: parseFloat(item.num_hospitals_previous_day_admission_adult_covid_confirmed) || 0,
            unit: 'admissions',
            date: item.week_end_date?.split('T')[0] || new Date().toISOString().split('T')[0],
            metadata: {
              jurisdiction: item.jurisdiction,
              pediatric_admissions: item.num_hospitals_previous_day_admission_pediatric_covid_confirmed,
              influenza_admissions: item.num_hospitals_previous_day_admission_influenza_confirmed
            }
          }));

        if (cdcRecords.length > 0) {
          const { error } = await supabase.from('health_metrics').insert(cdcRecords);
          if (error) throw new Error(`DB insert: ${error.message}`);
          results.health += cdcRecords.length;
          structuredLog('info', FN, `CDC: ${cdcRecords.length} records`);
        }
      }
    }, { timeoutMs: TIMEOUT_MS }).catch(e => {
      const msg = `CDC: ${(e as Error).message}`;
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
