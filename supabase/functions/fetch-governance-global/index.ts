import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, corsHeaders, errorResponse, jsonResponse } from "../_shared/resilience.ts";
import { startProviderRun, finishProviderRun, failProviderRun } from "../_shared/provider-telemetry.ts";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "fetch-governance-global";
const TIMEOUT_MS = 30_000;
const PER_PAGE = 20_000;
const LOOKBACK_YEARS = 6;

interface IndicatorSpec {
  code: string;
  name: string;
}

type WorldBankRow = {
  value?: unknown;
  date?: unknown;
  countryiso3code?: unknown;
  country?: { value?: unknown };
};

type GovernanceRecord = {
  country: string;
  iso_code: string;
  source: string;
  indicator_name: string;
  value: number;
  category: string;
  year: number;
  metadata: { indicator_code: string };
};

const INDICATORS: IndicatorSpec[] = [
  { code: "IQ.CPA.PUBS.XQ", name: "quality_of_public_administration" },
  { code: "IQ.CPA.TRAN.XQ", name: "transparency_accountability_corruption" },
  { code: "IQ.CPA.PROP.XQ", name: "property_rights_rule_based_governance" },
  { code: "VC.IHR.PSRC.P5", name: "intentional_homicides_per_100k" },
  { code: "GC.TAX.TOTL.GD.ZS", name: "tax_revenue_pct_gdp" },
];

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
    structuredLog("info", FN, "Starting governance data collection");
    const results: { governance: number; errors: string[]; indicators: Record<string, number> } = {
      governance: 0,
      errors: [],
      indicators: {},
    };
    const currentYear = new Date().getUTCFullYear();

    for (const indicator of INDICATORS) {
      await resilientCall(`${FN}:${indicator.code}`, async () => {
        const response = await fetch(
          `https://api.worldbank.org/v2/country/all/indicator/${indicator.code}?format=json&per_page=${PER_PAGE}`,
          { signal: AbortSignal.timeout(TIMEOUT_MS) },
        );
        if (!response.ok) throw new Error(`World Bank ${indicator.code}: ${response.status}`);
        const payload = await response.json() as unknown;
        const rows = Array.isArray(payload) && Array.isArray(payload[1])
          ? payload[1] as WorldBankRow[]
          : [];

        const records: GovernanceRecord[] = rows.flatMap((item) => {
          const value = numeric(item.value);
          const year = numeric(item.date);
          const iso3 = text(item.countryiso3code);
          const country = text(item.country?.value);
          if (value == null || year == null || !iso3 || !country || year < currentYear - LOOKBACK_YEARS) {
            return [];
          }
          return [{
            country,
            iso_code: iso3,
            source: "worldbank",
            indicator_name: indicator.name,
            value,
            category: "governance",
            year: Math.round(year),
            metadata: { indicator_code: indicator.code },
          }];
        });

        if (records.length > 0) {
          const years = [...new Set(records.map((record) => record.year))];
          const { error: deleteError } = await supabase
            .from("governance_global")
            .delete()
            .eq("source", "worldbank")
            .eq("indicator_name", indicator.name)
            .in("year", years);
          if (deleteError) throw new Error(`DB cleanup ${indicator.code}: ${deleteError.message}`);

          const { error: insertError } = await supabase.from("governance_global").insert(records);
          if (insertError) throw new Error(`DB insert ${indicator.code}: ${insertError.message}`);
        }

        results.indicators[indicator.name] = records.length;
        results.governance += records.length;
        structuredLog("info", FN, `${indicator.code}: ${records.length} records`);
      }, { timeoutMs: TIMEOUT_MS }).catch((error: unknown) => {
        const message = `${indicator.code}: ${messageOf(error)}`;
        results.errors.push(message);
        structuredLog("warn", FN, message);
      });
    }

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: results.errors.length === 0 ? "success" : results.governance > 0 ? "partial" : "error",
      message: `Fetched ${results.governance} governance records. Errors: ${results.errors.length}`,
    });

    await supabase.rpc("register_pipeline_heartbeat", {
      _pipeline_name: FN,
      _success: results.governance > 0,
      _error: results.governance > 0 ? null : results.errors[0] ?? "No governance records inserted",
      _metadata: {
        inserted: results.governance,
        indicators: results.indicators,
        errors: results.errors.length,
      },
    });

    structuredLog("info", FN, `Complete: ${results.governance} records, ${results.errors.length} errors`, undefined, start);
    await finishProviderRun(supabase, run, {
      records_inserted: results.governance,
      records_normalized: results.governance,
      error_count: results.errors.length,
      error_summary: results.errors[0] ?? null,
    });
    return jsonResponse({
      ok: results.governance > 0,
      message: `Fetched ${results.governance} governance records`,
      data: results,
    });
  } catch (error) {
    const message = messageOf(error);
    structuredLog("error", FN, message, undefined, start);
    await supabase.from("automation_logs").insert({ job_name: FN, status: "error", message });
    await supabase.rpc("register_pipeline_heartbeat", {
      _pipeline_name: FN,
      _success: false,
      _error: message,
    });
    await failProviderRun(supabase, run, error);
    return errorResponse(error);
  }
});
