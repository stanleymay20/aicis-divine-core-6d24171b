import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, corsHeaders, errorResponse, jsonResponse } from "../_shared/resilience.ts";

const FN = "fetch-finance-global";
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

    const ALPHA_KEY = Deno.env.get("ALPHAVANTAGE_API_KEY");
    const EIA_KEY = Deno.env.get("EIA_API_KEY");
    structuredLog('info', FN, 'Starting finance data collection');
    const results: { finance: number; errors: string[] } = { finance: 0, errors: [] };

    // Alpha Vantage - Global GDP
    await resilientCall(`${FN}:alphavantage`, async () => {
      const resp = await fetch(`https://www.alphavantage.co/query?function=REAL_GDP&interval=annual&apikey=${ALPHA_KEY}`);
      if (!resp.ok) throw new Error(`Alpha Vantage API: ${resp.status}`);
      const data = await resp.json();

      if (data.data) {
        const records = data.data.slice(0, 5).map((item: any) => ({
          country: 'United States', iso_code: 'USA', source: 'alphavantage',
          indicator_name: 'real_gdp', value: parseFloat(item.value),
          date: `${item.date}-01-01`, metadata: { unit: 'billions_usd' }
        }));
        const { error } = await supabase.from('finance_data').insert(records);
        if (error) throw new Error(`DB insert: ${error.message}`);
        results.finance += records.length;
      }
    }, { timeoutMs: TIMEOUT_MS }).catch(e => {
      const msg = `Alpha Vantage: ${(e as Error).message}`;
      results.errors.push(msg);
      structuredLog('warn', FN, msg);
    });

    // Binance - Crypto
    await resilientCall(`${FN}:binance`, async () => {
      const resp = await fetch('https://api.binance.com/api/v3/ticker/price');
      if (!resp.ok) throw new Error(`Binance API: ${resp.status}`);
      const prices = await resp.json();

      const records = prices
        .filter((p: any) => ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'].includes(p.symbol))
        .map((p: any) => ({
          country: 'Global', iso_code: 'WORLD', source: 'binance',
          indicator_name: `crypto_${p.symbol}`, value: parseFloat(p.price),
          currency: 'USD', date: new Date().toISOString().split('T')[0]
        }));

      const { error } = await supabase.from('finance_data').insert(records);
      if (error) throw new Error(`DB insert: ${error.message}`);
      results.finance += records.length;
    }, { timeoutMs: TIMEOUT_MS }).catch(e => {
      const msg = `Binance: ${(e as Error).message}`;
      results.errors.push(msg);
      structuredLog('warn', FN, msg);
    });

    // EIA v2 - WTI crude oil daily spot price (free, no key needed for public series)
    await resilientCall(`${FN}:eia`, async () => {
      const eiaUrl = EIA_KEY
        ? `https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${EIA_KEY}&frequency=daily&data[0]=value&facets[series][]=RWTC&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=30`
        : `https://api.eia.gov/v2/petroleum/pri/spt/data/?frequency=daily&data[0]=value&facets[series][]=RWTC&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=30`;
      const resp = await fetch(eiaUrl);
      if (!resp.ok) throw new Error(`EIA API: ${resp.status}`);
      const data = await resp.json();
      const rows = data?.response?.data ?? [];
      if (rows.length > 0) {
        const records = rows.map((item: any) => ({
          country: 'Global', iso_code: 'WORLD', source: 'eia',
          indicator_name: 'crude_oil_wti', value: parseFloat(item.value),
          currency: 'USD', date: `${item.period}`, metadata: { unit: 'dollars_per_barrel', series: item.series }
        }));
        const { error } = await supabase.from('finance_data').insert(records);
        if (error) throw new Error(`DB insert: ${error.message}`);
        results.finance += records.length;
      }
    }, { timeoutMs: TIMEOUT_MS }).catch(e => {
      const msg = `EIA: ${(e as Error).message}`;
      results.errors.push(msg);
      structuredLog('warn', FN, msg);
    });

    // World Bank - GDP multi-country
    await resilientCall(`${FN}:worldbank`, async () => {
      const countries = ['USA', 'CHN', 'DEU', 'GBR', 'FRA', 'JPN'];
      for (const iso of countries) {
        try {
          const resp = await fetch(`https://api.worldbank.org/v2/country/${iso}/indicator/NY.GDP.MKTP.CD?format=json&per_page=5`);
          if (!resp.ok) continue;
          const data = await resp.json();
          if (Array.isArray(data) && data[1]) {
            const records = data[1].filter((d: any) => d.value).map((d: any) => ({
              country: d.country.value, iso_code: d.countryiso3code,
              source: 'worldbank', indicator_name: 'gdp_current_usd',
              value: parseFloat(d.value), currency: 'USD',
              date: `${d.date}-01-01`, metadata: { indicator_code: d.indicator.id }
            }));
            if (records.length > 0) {
              const { error } = await supabase.from('finance_data').insert(records);
              if (!error) results.finance += records.length;
            }
          }
        } catch (e) {
          structuredLog('warn', FN, `World Bank ${iso}: ${(e as Error).message}`);
        }
      }
    }, { timeoutMs: TIMEOUT_MS }).catch(e => {
      const msg = `World Bank: ${(e as Error).message}`;
      results.errors.push(msg);
      structuredLog('warn', FN, msg);
    });

    await supabase.from('automation_logs').insert({
      job_name: FN,
      status: results.errors.length === 0 ? 'success' : (results.finance > 0 ? 'partial' : 'error'),
      message: `Fetched ${results.finance} finance records. Errors: ${results.errors.length}${results.errors.length > 0 ? ` [${results.errors.join('; ')}]` : ''}`
    });

    structuredLog('info', FN, `Complete: ${results.finance} records, ${results.errors.length} errors`, undefined, start);
    return jsonResponse({ ok: true, message: `Fetched ${results.finance} finance records`, data: results });
  } catch (e) {
    structuredLog('error', FN, (e as Error).message, undefined, start);
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    await supabase.from('automation_logs').insert({ job_name: FN, status: 'error', message: (e as Error).message });
    return errorResponse(e);
  }
});
