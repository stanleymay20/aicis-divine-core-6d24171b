import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, corsHeaders, errorResponse, jsonResponse } from "../_shared/resilience.ts";

const FN = "fetch-governance-global";
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

    structuredLog('info', FN, 'Starting governance data collection');
    const results: { governance: number; errors: string[] } = { governance: 0, errors: [] };
    const currentYear = new Date().getFullYear();

    // World Bank - Governance effectiveness
    await resilientCall(`${FN}:worldbank`, async () => {
      const resp = await fetch('https://api.worldbank.org/v2/en/indicator/GE.EST?format=json&per_page=100');
      if (!resp.ok) throw new Error(`World Bank API: ${resp.status}`);
      const data = await resp.json();

      if (Array.isArray(data) && data[1]) {
        const govRecords = data[1]
          .filter((item: any) => item.value && item.date >= (currentYear - 3))
          .slice(0, 50)
          .map((item: any) => ({
            country: item.country.value, iso_code: item.countryiso3code,
            source: 'worldbank', indicator_name: 'government_effectiveness',
            value: parseFloat(item.value), category: 'governance',
            year: parseInt(item.date),
            metadata: { indicator_code: 'GE.EST' }
          }));

        if (govRecords.length > 0) {
          const { error } = await supabase.from('governance_global').insert(govRecords);
          if (error) throw new Error(`DB insert: ${error.message}`);
          results.governance += govRecords.length;
          structuredLog('info', FN, `World Bank: ${govRecords.length} records`);
        }
      }
    }, { timeoutMs: TIMEOUT_MS }).catch(e => {
      const msg = `World Bank: ${(e as Error).message}`;
      results.errors.push(msg);
      structuredLog('warn', FN, msg);
    });

    // World Bank - Rule of Law
    await resilientCall(`${FN}:worldbank-rl`, async () => {
      const resp = await fetch('https://api.worldbank.org/v2/en/indicator/RL.EST?format=json&per_page=100');
      if (!resp.ok) throw new Error(`World Bank RL API: ${resp.status}`);
      const data = await resp.json();

      if (Array.isArray(data) && data[1]) {
        const records = data[1]
          .filter((item: any) => item.value && item.date >= (currentYear - 3))
          .slice(0, 50)
          .map((item: any) => ({
            country: item.country.value, iso_code: item.countryiso3code,
            source: 'worldbank', indicator_name: 'rule_of_law',
            value: parseFloat(item.value), category: 'governance',
            year: parseInt(item.date),
            metadata: { indicator_code: 'RL.EST' }
          }));

        if (records.length > 0) {
          const { error } = await supabase.from('governance_global').insert(records);
          if (!error) results.governance += records.length;
        }
      }
    }, { timeoutMs: TIMEOUT_MS }).catch(e => {
      const msg = `World Bank RL: ${(e as Error).message}`;
      results.errors.push(msg);
      structuredLog('warn', FN, msg);
    });

    // World Bank — Voice & Accountability (replaces GDELT 429-prone source)
    await resilientCall(`${FN}:worldbank-va`, async () => {
      const resp = await fetch('https://api.worldbank.org/v2/en/indicator/VA.EST?format=json&per_page=100');
      if (!resp.ok) throw new Error(`World Bank VA API: ${resp.status}`);
      const data = await resp.json();
      if (Array.isArray(data) && data[1]) {
        const records = data[1]
          .filter((item: any) => item.value && item.date >= (currentYear - 3))
          .slice(0, 50)
          .map((item: any) => ({
            country: item.country.value, iso_code: item.countryiso3code,
            source: 'worldbank', indicator_name: 'voice_accountability',
            value: parseFloat(item.value), category: 'governance',
            year: parseInt(item.date),
            metadata: { indicator_code: 'VA.EST' }
          }));
        if (records.length > 0) {
          const { error } = await supabase.from('governance_global').insert(records);
          if (!error) results.governance += records.length;
        }
      }
    }, { timeoutMs: TIMEOUT_MS }).catch(e => {
      const msg = `World Bank VA: ${(e as Error).message}`;
      results.errors.push(msg);
      structuredLog('warn', FN, msg);
    });

    // World Bank — Control of Corruption
    await resilientCall(`${FN}:worldbank-cc`, async () => {
      const resp = await fetch('https://api.worldbank.org/v2/en/indicator/CC.EST?format=json&per_page=100');
      if (!resp.ok) throw new Error(`World Bank CC API: ${resp.status}`);
      const data = await resp.json();
      if (Array.isArray(data) && data[1]) {
        const records = data[1]
          .filter((item: any) => item.value && item.date >= (currentYear - 3))
          .slice(0, 50)
          .map((item: any) => ({
            country: item.country.value, iso_code: item.countryiso3code,
            source: 'worldbank', indicator_name: 'control_of_corruption',
            value: parseFloat(item.value), category: 'governance',
            year: parseInt(item.date),
            metadata: { indicator_code: 'CC.EST' }
          }));
        if (records.length > 0) {
          const { error } = await supabase.from('governance_global').insert(records);
          if (!error) results.governance += records.length;
        }
      }
    }, { timeoutMs: TIMEOUT_MS }).catch(e => {
      const msg = `World Bank CC: ${(e as Error).message}`;
      results.errors.push(msg);
      structuredLog('warn', FN, msg);
    });

    await supabase.from('automation_logs').insert({
      job_name: FN,
      status: results.errors.length === 0 ? 'success' : (results.governance > 0 ? 'partial' : 'error'),
      message: `Fetched ${results.governance} governance records. Errors: ${results.errors.length}${results.errors.length > 0 ? ` [${results.errors.join('; ')}]` : ''}`
    });

    structuredLog('info', FN, `Complete: ${results.governance} records, ${results.errors.length} errors`, undefined, start);
    return jsonResponse({ ok: true, message: `Fetched ${results.governance} governance records`, data: results });
  } catch (e) {
    structuredLog('error', FN, (e as Error).message, undefined, start);
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    await supabase.from('automation_logs').insert({ job_name: FN, status: 'error', message: (e as Error).message });
    return errorResponse(e);
  }
});
