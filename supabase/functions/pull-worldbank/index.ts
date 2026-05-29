import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  startProviderRun,
  finishProviderRun,
  failProviderRun,
} from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Use service role for system operations (cron jobs)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const run = await startProviderRun(supabase, {
    provider_name: "worldbank",
    endpoint: "pull-worldbank",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  try {
    console.log("Fetching World Bank data...");
    
    // Expanded indicator coverage — all free, no key required
    const indicators = [
      'NY.GDP.MKTP.CD',          // GDP (current US$)
      'NY.GDP.PCAP.CD',          // GDP per capita
      'NY.GDP.MKTP.KD.ZG',       // GDP growth (annual %)
      'SP.POP.TOTL',             // Population, total
      'SP.POP.GROW',             // Population growth (annual %)
      'SL.UEM.TOTL.ZS',          // Unemployment, total
      'FP.CPI.TOTL.ZG',          // Inflation (consumer prices)
      'SE.XPD.TOTL.GD.ZS',       // Education expenditure (% of GDP)
      'SH.XPD.CHEX.GD.ZS',       // Health expenditure (% of GDP)
      'EG.USE.ELEC.KH.PC',       // Electric power consumption
      'IT.NET.USER.ZS',          // Internet users (% of pop)
      'EN.ATM.CO2E.PC',          // CO2 emissions per capita
    ];

    // 50 priority countries spanning all regions for planetary signal density
    const countries = [
      'USA','CHN','JPN','DEU','GBR','FRA','IND','ITA','BRA','CAN',
      'RUS','KOR','AUS','ESP','MEX','IDN','NLD','SAU','TUR','CHE',
      'POL','SWE','BEL','ARG','THA','NOR','ARE','ISR','EGY','ZAF',
      'NGA','KEN','GHA','ETH','UGA','MAR','DZA','TZA','VNM','PHL',
      'BGD','PAK','IRN','IRQ','UKR','COL','CHL','PER','VEN','PRT'
    ];
    // Use a 5-year rolling window (server caches anyway)
    const currentYear = new Date().getFullYear();
    const dateRange = `${currentYear - 5}:${currentYear - 1}`;

    const records: any[] = [];

    for (const indicator of indicators) {
      const url = `https://api.worldbank.org/v2/country/${countries.join(';')}/indicator/${indicator}?date=${dateRange}&format=json&per_page=2000`;

      const response = await fetch(url);
      if (!response.ok) {
        console.error(`World Bank API error for ${indicator}:`, response.status);
        continue;
      }

      const data = await response.json();
      const values = data[1] || [];

      for (const item of values) {
        if (item.value !== null && item.value !== undefined) {
          records.push({
            country: item.country.value,
            indicator_name: item.indicator.value,
            value: parseFloat(item.value),
            date: `${item.date}-01-01`,
            unit: item.unit || '',
            source: 'WorldBank',
            metadata: {
              country_code: item.countryiso3code,
              indicator_code: item.indicator.id,
              decimal: item.decimal,
              year: parseInt(item.date)
            }
          });
        }
      }
    }

    if (records.length > 0) {
      const { error: insertError } = await supabase
        .from('economic_indicators')
        .insert(records);

      if (insertError) throw insertError;
    }

    // Log the operation
    await supabase.from('compliance_audit').insert({
      action: 'data_pull',
      source: 'WorldBank',
      status: 'success',
      records_affected: records.length
    });

    await supabase.from('system_logs').insert({
      division: 'economy',
      action: 'worldbank_data_pull',
      result: 'success',
      log_level: 'info',
      metadata: { records_count: records.length }
    });

    await finishProviderRun(supabase, run, {
      records_fetched: records.length,
      records_inserted: records.length,
      records_normalized: records.length,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        message: `Fetched ${records.length} World Bank indicators`,
        records_count: records.length
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("pull-worldbank error:", e);
    await failProviderRun(supabase, run, e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
