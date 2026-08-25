import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { writeNormalized, type NormalizedRow } from "../_shared/normalized-write.ts";
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

const AREA_CODES: Record<number, string> = {
  288: "GHA",
  566: "NGA",
  404: "KEN",
  710: "ZAF",
};
const ITEM_CODES = [562, 27, 15];

type FaostatRow = {
  Area?: string;
  AreaCode?: number | string;
  Item?: string;
  ItemCode?: number | string;
  Element?: string;
  ElementCode?: number | string;
  Year?: number | string;
  Value?: number | string | null;
  Unit?: string;
  Flag?: string;
};

type FaostatResponse = {
  data?: FaostatRow[];
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
    provider_name: "faostat",
    endpoint: "pull-faostat-food",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  try {
    const startedAt = Date.now();
    const year = new Date().getUTCFullYear() - 1;
    const observations: FaostatRow[] = [];

    for (const areaCode of Object.keys(AREA_CODES).map(Number)) {
      for (const itemCode of ITEM_CODES) {
        try {
          const url = `https://fenixservices.fao.org/faostat/api/v1/en/data/QCL?area_codes=${areaCode}&item_codes=${itemCode}&years=${year}`;
          const response = await fetch(url);
          if (!response.ok) continue;
          const payload = await response.json() as FaostatResponse;
          observations.push(...(Array.isArray(payload.data) ? payload.data : []));
        } catch (error) {
          console.warn("FAOSTAT fetch error for", areaCode, itemCode, error);
        }
      }
    }

    const normalizedRows: NormalizedRow[] = [];
    for (const row of observations) {
      if (row.Value === null || row.Value === undefined) continue;
      const value = Number(row.Value);
      const rowYear = Number(row.Year ?? year);
      if (!Number.isFinite(value) || !Number.isFinite(rowYear)) continue;

      const areaCode = Number(row.AreaCode);
      const iso3 = AREA_CODES[areaCode];
      if (!iso3) continue;

      const item = slug(row.Item ?? `item_${row.ItemCode ?? "unknown"}`);
      const element = slug(row.Element ?? `element_${row.ElementCode ?? "value"}`);
      normalizedRows.push({
        provider_name: "faostat",
        domain: "food",
        metric_name: `${item}_${element}`,
        iso3,
        period: `${rowYear}-01-01`,
        value,
        unit: row.Unit ?? null,
        confidence: row.Flag ? 0.9 : 0.95,
        provenance_source: "FAOSTAT_QCL",
      });
    }

    if (normalizedRows.length === 0) throw new Error("FAOSTAT returned no usable crop observations");

    const writeResult = await writeNormalized(supabase, normalizedRows);
    if (writeResult.errors.length > 0) {
      throw new Error(`FAOSTAT normalized write failed: ${writeResult.errors.join(" | ")}`);
    }

    await supabase.from("compliance_audit").insert({
      action_type: "data_pull",
      division: "food",
      action_description: "Pulled observed FAOSTAT QCL crop metrics",
      compliance_status: "compliant",
      data_accessed: {
        provider: "FAOSTAT",
        domain: "QCL",
        area_codes: Object.keys(AREA_CODES),
        item_codes: ITEM_CODES,
        year,
        destination: "normalized_metrics",
        synthetic_food_risk_disabled: true,
      },
    });

    const latencyMs = Date.now() - startedAt;
    await supabase.from("data_source_log").insert({
      division: "food",
      source: "faostat",
      records_ingested: writeResult.inserted,
      latency_ms: latencyMs,
      status: "success",
      last_success: new Date().toISOString(),
    });

    await supabase.from("system_logs").insert({
      division: "food",
      action: "pull_faostat_food",
      result: "success",
      log_level: "info",
      metadata: {
        normalized_rows: writeResult.inserted,
        latency_ms: latencyMs,
        synthetic_yield_index_disabled: true,
        synthetic_supply_days_disabled: true,
        synthetic_alert_level_disabled: true,
      },
    });

    await finishProviderRun(supabase, run, {
      records_fetched: observations.length,
      records_inserted: writeResult.inserted,
      records_normalized: writeResult.inserted,
    });

    return json({
      ok: true,
      normalized_rows: writeResult.inserted,
      observations_fetched: observations.length,
      message: "Stored observed FAOSTAT crop metrics only",
    });
  } catch (error) {
    console.error("pull-faostat-food error:", error);
    await failProviderRun(supabase, run, error);
    await supabase.from("data_source_log").insert({
      division: "food",
      source: "faostat",
      records_ingested: 0,
      status: "failure",
      error_message: error instanceof Error ? error.message : "Unknown error",
    });
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "value";
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" },
  });
}
