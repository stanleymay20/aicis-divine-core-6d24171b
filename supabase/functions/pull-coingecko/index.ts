import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { writeNormalized, type NormalizedRow } from "../_shared/normalized-write.ts";
import { startProviderRun, finishProviderRun, failProviderRun } from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-scheduler-source",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SOURCE_URL = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true";

type CoinGeckoAsset = {
  usd?: number;
  usd_24h_vol?: number;
  usd_24h_change?: number;
};

type CoinGeckoResponse = {
  bitcoin?: CoinGeckoAsset;
  ethereum?: CoinGeckoAsset;
  tether?: CoinGeckoAsset;
};

const ASSETS: Array<{ key: keyof CoinGeckoResponse; symbol: string }> = [
  { key: "bitcoin", symbol: "BTC" },
  { key: "ethereum", symbol: "ETH" },
  { key: "tether", symbol: "USDT" },
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
    provider_name: "coingecko",
    endpoint: "pull-coingecko",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  try {
    const response = await fetch(SOURCE_URL, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`CoinGecko error: ${response.status}`);

    const data = await response.json() as CoinGeckoResponse;
    const observedAt = new Date().toISOString();
    const rows: NormalizedRow[] = [];

    for (const asset of ASSETS) {
      const values = data[asset.key];
      if (!values) continue;

      if (Number.isFinite(values.usd)) {
        rows.push({
          provider_name: "coingecko",
          domain: "finance",
          metric_name: `${asset.symbol.toLowerCase()}_spot_price_usd`,
          iso3: "GLOBAL",
          period: observedAt,
          value: Number(values.usd),
          unit: "USD",
          confidence: 0.98,
          provenance_source: SOURCE_URL,
        });
      }

      if (Number.isFinite(values.usd_24h_vol)) {
        rows.push({
          provider_name: "coingecko",
          domain: "finance",
          metric_name: `${asset.symbol.toLowerCase()}_volume_24h_usd`,
          iso3: "GLOBAL",
          period: observedAt,
          value: Number(values.usd_24h_vol),
          unit: "USD",
          confidence: 0.98,
          provenance_source: SOURCE_URL,
        });
      }

      if (Number.isFinite(values.usd_24h_change)) {
        rows.push({
          provider_name: "coingecko",
          domain: "finance",
          metric_name: `${asset.symbol.toLowerCase()}_change_24h_pct`,
          iso3: "GLOBAL",
          period: observedAt,
          value: Number(values.usd_24h_change),
          unit: "%",
          confidence: 0.98,
          provenance_source: SOURCE_URL,
        });
      }
    }

    if (rows.length === 0) throw new Error("CoinGecko returned no usable market observations");

    const normalized = await writeNormalized(supabase, rows);
    if (normalized.errors.length > 0) {
      throw new Error(`CoinGecko normalized write failed: ${normalized.errors.join(" | ")}`);
    }

    await supabase.from("compliance_audit").insert({
      action_type: "data_pull",
      division: "finance",
      action_description: "Pulled CoinGecko market observations",
      compliance_status: "compliant",
      data_accessed: {
        provider: "coingecko",
        assets: ASSETS.map((asset) => asset.symbol),
        destination: "normalized_metrics",
        revenue_semantics: "not_revenue",
      },
    });

    await supabase.from("data_source_log").insert({
      division: "finance",
      source: "coingecko",
      records_ingested: normalized.inserted,
      status: "success",
      last_success: observedAt,
    });

    await supabase.from("system_logs").insert({
      division: "finance",
      action: "pull_coingecko",
      result: "success",
      log_level: "info",
      metadata: {
        normalized_rows: normalized.inserted,
        destination: "normalized_metrics",
        legacy_revenue_stream_write_disabled: true,
      },
    });

    await finishProviderRun(supabase, run, {
      records_fetched: ASSETS.length,
      records_inserted: normalized.inserted,
      records_normalized: normalized.inserted,
    });

    return json({
      ok: true,
      normalized_rows: normalized.inserted,
      message: "CoinGecko observations stored as market metrics, not revenue",
    });
  } catch (error) {
    console.error("pull-coingecko error:", error);
    await failProviderRun(supabase, run, error);
    await supabase.from("data_source_log").insert({
      division: "finance",
      source: "coingecko",
      records_ingested: 0,
      status: "failure",
      error_message: error instanceof Error ? error.message : "Unknown error",
    });
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" },
  });
}
