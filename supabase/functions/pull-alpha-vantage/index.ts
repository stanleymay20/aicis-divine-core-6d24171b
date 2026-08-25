import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { startProviderRun, finishProviderRun, failProviderRun } from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-scheduler-source",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AlphaSeriesPoint = { date?: string; value?: string | number };
type AlphaResponse = {
  data?: AlphaSeriesPoint[];
  unit?: string;
  Information?: string;
  Note?: string;
};

type EconomicIndicatorRow = {
  indicator_name: string;
  country: string;
  value: number;
  unit: string;
  date: string;
  source: "alpha_vantage";
  metadata: { raw: AlphaSeriesPoint };
};

const INDICATORS = [
  { function: "REAL_GDP", name: "Real GDP", country: "USA" },
  { function: "UNEMPLOYMENT", name: "Unemployment Rate", country: "USA" },
  { function: "CPI", name: "Consumer Price Index", country: "USA" },
  { function: "FEDERAL_FUNDS_RATE", name: "Federal Funds Rate", country: "USA" },
];

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
    provider_name: "alpha_vantage",
    endpoint: "pull-alpha-vantage",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  try {
    const apiKey = Deno.env.get("ALPHA_VANTAGE_API_KEY") ?? "";
    if (!apiKey) throw new Error("Alpha Vantage API key not configured");

    const records: EconomicIndicatorRow[] = [];
    const providerErrors: string[] = [];

    for (const indicator of INDICATORS) {
      try {
        const url = `https://www.alphavantage.co/query?function=${indicator.function}&apikey=${encodeURIComponent(apiKey)}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as AlphaResponse;
        if (data.Note || data.Information) throw new Error(data.Note ?? data.Information ?? "Provider throttled request");

        const latest = Array.isArray(data.data) ? data.data[0] : undefined;
        const value = Number(latest?.value);
        const date = latest?.date;
        if (latest && date && Number.isFinite(value)) {
          records.push({
            indicator_name: indicator.name,
            country: indicator.country,
            value,
            unit: data.unit ?? "",
            date,
            source: "alpha_vantage",
            metadata: { raw: latest },
          });
        }
      } catch (error) {
        providerErrors.push(`${indicator.function}: ${error instanceof Error ? error.message : String(error)}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 12_000));
    }

    if (records.length > 0) {
      const { error: insertError } = await supabase
        .from("economic_indicators")
        .upsert(records, { onConflict: "indicator_name,country,date", ignoreDuplicates: false });
      if (insertError) throw insertError;
    }

    if (records.length === 0 && providerErrors.length > 0) {
      throw new Error(`Alpha Vantage returned no usable observations: ${providerErrors.join(" | ")}`);
    }

    await supabase.from("system_logs").insert({
      source: "alpha_vantage",
      level: providerErrors.length > 0 ? "warning" : "info",
      message: `Fetched ${records.length} Alpha Vantage economic indicators`,
      metadata: { records_count: records.length, provider_errors: providerErrors },
    });

    await finishProviderRun(supabase, run, {
      records_fetched: records.length,
      records_inserted: records.length,
      error_count: providerErrors.length,
      error_summary: providerErrors.length > 0 ? providerErrors.join(" | ").slice(0, 2000) : null,
    });

    return json({
      ok: true,
      records_count: records.length,
      partial_errors: providerErrors,
      message: `Fetched ${records.length} observed Alpha Vantage economic indicators`,
    });
  } catch (error) {
    console.error("pull-alpha-vantage error:", error);
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
