import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";
import {
  startProviderRun,
  finishProviderRun,
  failProviderRun,
} from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-scheduler-source",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type WorldBankItem = {
  country?: { value?: string };
  indicator?: { value?: string; id?: string };
  value?: number | string | null;
  date?: string;
  unit?: string;
  countryiso3code?: string;
  decimal?: number;
};

type EconomicIndicatorRow = {
  country: string;
  indicator_name: string;
  value: number;
  date: string;
  unit: string;
  source: "WorldBank";
  metadata: {
    country_code: string | null;
    indicator_code: string | null;
    decimal: number | null;
    year: number;
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405, { Allow: "POST" });

  const { response: authResponse } = await requireAdminOrCron(req, corsHeaders);
  if (authResponse) return authResponse;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const run = await startProviderRun(supabase, {
    provider_name: "worldbank",
    endpoint: "pull-worldbank",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  try {
    const indicators = [
      "NY.GDP.MKTP.CD",
      "NY.GDP.PCAP.CD",
      "NY.GDP.MKTP.KD.ZG",
      "SP.POP.TOTL",
      "SP.POP.GROW",
      "SL.UEM.TOTL.ZS",
      "FP.CPI.TOTL.ZG",
      "SE.XPD.TOTL.GD.ZS",
      "SH.XPD.CHEX.GD.ZS",
      "EG.USE.ELEC.KH.PC",
      "IT.NET.USER.ZS",
      "EN.ATM.CO2E.PC",
    ];

    const countries = [
      "USA","CHN","JPN","DEU","GBR","FRA","IND","ITA","BRA","CAN",
      "RUS","KOR","AUS","ESP","MEX","IDN","NLD","SAU","TUR","CHE",
      "POL","SWE","BEL","ARG","THA","NOR","ARE","ISR","EGY","ZAF",
      "NGA","KEN","GHA","ETH","UGA","MAR","DZA","TZA","VNM","PHL",
      "BGD","PAK","IRN","IRQ","UKR","COL","CHL","PER","VEN","PRT",
    ];
    const currentYear = new Date().getFullYear();
    const dateRange = `${currentYear - 5}:${currentYear - 1}`;
    const records: EconomicIndicatorRow[] = [];

    for (const indicator of indicators) {
      const url = `https://api.worldbank.org/v2/country/${countries.join(";")}/indicator/${indicator}?date=${dateRange}&format=json&per_page=2000`;
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`World Bank API error for ${indicator}:`, response.status);
        continue;
      }

      const raw: unknown = await response.json();
      const values = Array.isArray(raw) && Array.isArray(raw[1]) ? raw[1] as WorldBankItem[] : [];

      for (const item of values) {
        if (item.value === null || item.value === undefined) continue;
        const numericValue = Number(item.value);
        const year = Number.parseInt(String(item.date ?? ""), 10);
        if (!Number.isFinite(numericValue) || !Number.isFinite(year)) continue;

        records.push({
          country: String(item.country?.value ?? item.countryiso3code ?? "Unknown"),
          indicator_name: String(item.indicator?.value ?? item.indicator?.id ?? indicator),
          value: numericValue,
          date: `${year}-01-01`,
          unit: String(item.unit ?? ""),
          source: "WorldBank",
          metadata: {
            country_code: item.countryiso3code ?? null,
            indicator_code: item.indicator?.id ?? null,
            decimal: typeof item.decimal === "number" ? item.decimal : null,
            year,
          },
        });
      }
    }

    if (records.length > 0) {
      const { error: insertError } = await supabase.from("economic_indicators").insert(records);
      if (insertError) throw insertError;
    }

    await supabase.from("compliance_audit").insert({
      action: "data_pull",
      source: "WorldBank",
      status: "success",
      records_affected: records.length,
    });

    await supabase.from("system_logs").insert({
      division: "economy",
      action: "worldbank_data_pull",
      result: "success",
      log_level: "info",
      metadata: { records_count: records.length },
    });

    await finishProviderRun(supabase, run, {
      records_fetched: records.length,
      records_inserted: records.length,
      records_normalized: records.length,
    });

    return json({
      ok: true,
      message: `Fetched ${records.length} World Bank indicators`,
      records_count: records.length,
    });
  } catch (error) {
    console.error("pull-worldbank error:", error);
    await failProviderRun(supabase, run, error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" },
  });
}
