import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, corsHeaders, errorResponse, jsonResponse } from "../_shared/resilience.ts";
import { startProviderRun, finishProviderRun, failProviderRun } from "../_shared/provider-telemetry.ts";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "fetch-finance-global";
const TIMEOUT_MS = 15_000;

type AlphaRow = { date?: unknown; value?: unknown };
type BinanceRow = { symbol?: unknown; price?: unknown };
type EiaRow = { value?: unknown; period?: unknown; series?: unknown };
type WorldBankRow = {
  value?: unknown;
  date?: unknown;
  countryiso3code?: unknown;
  country?: { value?: unknown };
  indicator?: { id?: unknown };
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const numeric = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const run = await startProviderRun(supabase, {
    provider_name: FN,
    endpoint: FN,
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  try {
    const alphaKey = Deno.env.get("ALPHAVANTAGE_API_KEY");
    const eiaKey = Deno.env.get("EIA_API_KEY");
    structuredLog("info", FN, "Starting finance data collection");
    const results: { finance: number; errors: string[] } = { finance: 0, errors: [] };

    if (alphaKey) {
      await resilientCall(`${FN}:alphavantage`, async () => {
        const response = await fetch(
          `https://www.alphavantage.co/query?function=REAL_GDP&interval=annual&apikey=${encodeURIComponent(alphaKey)}`,
          { signal: AbortSignal.timeout(TIMEOUT_MS) },
        );
        if (!response.ok) throw new Error(`Alpha Vantage API: ${response.status}`);
        const payload = await response.json() as { data?: unknown };
        const rows = Array.isArray(payload.data) ? payload.data as AlphaRow[] : [];
        const records = rows.slice(0, 5).flatMap((item) => {
          const value = numeric(item.value);
          const year = text(item.date);
          if (value == null || !year) return [];
          return [{
            country: "United States",
            iso_code: "USA",
            source: "alphavantage",
            indicator_name: "real_gdp",
            value,
            date: `${year}-01-01`,
            metadata: { unit: "billions_usd" },
          }];
        });
        if (records.length === 0) return;
        const { error } = await supabase.from("finance_data").insert(records);
        if (error) throw new Error(`DB insert: ${error.message}`);
        results.finance += records.length;
      }, { timeoutMs: TIMEOUT_MS }).catch((error: unknown) => {
        const message = `Alpha Vantage: ${messageOf(error)}`;
        results.errors.push(message);
        structuredLog("warn", FN, message);
      });
    } else {
      structuredLog("warn", FN, "ALPHAVANTAGE_API_KEY missing; Alpha Vantage source skipped");
    }

    await resilientCall(`${FN}:binance`, async () => {
      const response = await fetch(
        "https://api.binance.com/api/v3/ticker/price",
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      if (!response.ok) throw new Error(`Binance API: ${response.status}`);
      const payload = await response.json() as unknown;
      const prices = Array.isArray(payload) ? payload as BinanceRow[] : [];
      const allowed = new Set(["BTCUSDT", "ETHUSDT", "BNBUSDT"]);
      const records = prices.flatMap((row) => {
        const symbol = text(row.symbol);
        const value = numeric(row.price);
        if (!symbol || !allowed.has(symbol) || value == null) return [];
        return [{
          country: "Global",
          iso_code: "WORLD",
          source: "binance",
          indicator_name: `crypto_${symbol}`,
          value,
          currency: "USD",
          date: new Date().toISOString().slice(0, 10),
        }];
      });
      if (records.length === 0) return;
      const { error } = await supabase.from("finance_data").insert(records);
      if (error) throw new Error(`DB insert: ${error.message}`);
      results.finance += records.length;
    }, { timeoutMs: TIMEOUT_MS }).catch((error: unknown) => {
      const message = `Binance: ${messageOf(error)}`;
      results.errors.push(message);
      structuredLog("warn", FN, message);
    });

    await resilientCall(`${FN}:eia`, async () => {
      const query = "frequency=daily&data[0]=value&facets[series][]=RWTC&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=30";
      const eiaUrl = eiaKey
        ? `https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${encodeURIComponent(eiaKey)}&${query}`
        : `https://api.eia.gov/v2/petroleum/pri/spt/data/?${query}`;
      const response = await fetch(eiaUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new Error(`EIA API: ${response.status}`);
      const payload = await response.json() as { response?: { data?: unknown } };
      const rows = Array.isArray(payload.response?.data) ? payload.response?.data as EiaRow[] : [];
      const records = rows.flatMap((item) => {
        const value = numeric(item.value);
        const period = text(item.period);
        if (value == null || !period) return [];
        return [{
          country: "Global",
          iso_code: "WORLD",
          source: "eia",
          indicator_name: "crude_oil_wti",
          value,
          currency: "USD",
          date: period,
          metadata: { unit: "dollars_per_barrel", series: text(item.series) },
        }];
      });
      if (records.length === 0) return;
      const { error } = await supabase.from("finance_data").insert(records);
      if (error) throw new Error(`DB insert: ${error.message}`);
      results.finance += records.length;
    }, { timeoutMs: TIMEOUT_MS }).catch((error: unknown) => {
      const message = `EIA: ${messageOf(error)}`;
      results.errors.push(message);
      structuredLog("warn", FN, message);
    });

    await resilientCall(`${FN}:worldbank`, async () => {
      for (const iso3 of ["USA", "CHN", "DEU", "GBR", "FRA", "JPN"]) {
        try {
          const response = await fetch(
            `https://api.worldbank.org/v2/country/${iso3}/indicator/NY.GDP.MKTP.CD?format=json&per_page=5`,
            { signal: AbortSignal.timeout(TIMEOUT_MS) },
          );
          if (!response.ok) continue;
          const payload = await response.json() as unknown;
          if (!Array.isArray(payload) || !Array.isArray(payload[1])) continue;
          const records = (payload[1] as WorldBankRow[]).flatMap((row) => {
            const value = numeric(row.value);
            const year = text(row.date);
            const country = text(row.country?.value);
            if (value == null || !year || !country) return [];
            return [{
              country,
              iso_code: text(row.countryiso3code) ?? iso3,
              source: "worldbank",
              indicator_name: "gdp_current_usd",
              value,
              currency: "USD",
              date: `${year}-01-01`,
              metadata: { indicator_code: text(row.indicator?.id) },
            }];
          });
          if (records.length === 0) continue;
          const { error } = await supabase.from("finance_data").insert(records);
          if (error) throw error;
          results.finance += records.length;
        } catch (error) {
          structuredLog("warn", FN, `World Bank ${iso3}: ${messageOf(error)}`);
        }
      }
    }, { timeoutMs: TIMEOUT_MS }).catch((error: unknown) => {
      const message = `World Bank: ${messageOf(error)}`;
      results.errors.push(message);
      structuredLog("warn", FN, message);
    });

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: results.errors.length === 0 ? "success" : results.finance > 0 ? "partial" : "error",
      message: `Fetched ${results.finance} finance records. Errors: ${results.errors.length}${results.errors.length ? ` [${results.errors.join("; ")}]` : ""}`,
    });

    structuredLog("info", FN, `Complete: ${results.finance} records, ${results.errors.length} errors`, undefined, start);
    await finishProviderRun(supabase, run, {
      records_inserted: results.finance,
      records_normalized: results.finance,
      error_count: results.errors.length,
      error_summary: results.errors[0] ?? null,
    });
    return jsonResponse({ ok: true, message: `Fetched ${results.finance} finance records`, data: results });
  } catch (error) {
    const message = messageOf(error);
    structuredLog("error", FN, message, undefined, start);
    await supabase.from("automation_logs").insert({ job_name: FN, status: "error", message });
    await failProviderRun(supabase, run, error);
    return errorResponse(error);
  }
});
