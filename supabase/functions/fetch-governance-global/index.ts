import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, errorResponse, jsonResponse } from "../_shared/resilience.ts";

const FN = "fetch-governance-global";
const TIMEOUT_MS = 30000;
const PER_PAGE = 20000;
const LOOKBACK_YEARS = 6;

interface IndicatorSpec {
  code: string;
  name: string;
}

const INDICATORS: IndicatorSpec[] = [
  { code: "GE.EST", name: "government_effectiveness" },
  { code: "RL.EST", name: "rule_of_law" },
  { code: "VA.EST", name: "voice_accountability" },
  { code: "CC.EST", name: "control_of_corruption" },
];

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const start = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    structuredLog("info", FN, "Starting governance data collection");
    const results: { governance: number; errors: string[]; indicators: Record<string, number> } = {
      governance: 0,
      errors: [],
      indicators: {},
    };
    const currentYear = new Date().getUTCFullYear();

    for (const indicator of INDICATORS) {
      await resilientCall(`${FN}:${indicator.code}`, async () => {
        const resp = await fetch(
          `https://api.worldbank.org/v2/country/all/indicator/${indicator.code}?format=json&per_page=${PER_PAGE}`,
        );
        if (!resp.ok) throw new Error(`World Bank ${indicator.code}: ${resp.status}`);
        const data = await resp.json();
        const rows = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];

        const records = rows
          .filter((item: any) => item?.value !== null && item?.countryiso3code && item.countryiso3code !== "")
          .filter((item: any) => Number(item.date) >= currentYear - LOOKBACK_YEARS)
          .map((item: any) => ({
            country: item.country.value,
            iso_code: item.countryiso3code,
            source: "worldbank",
            indicator_name: indicator.name,
            value: Number(item.value),
            category: "governance",
            year: Number(item.date),
            metadata: { indicator_code: indicator.code },
          }));

        if (records.length > 0) {
          // Delete existing rows for this indicator+year set, then insert (idempotent)
          const years = Array.from(new Set(records.map((r: any) => r.year)));
          await supabase.from("governance_global")
            .delete()
            .eq("source", "worldbank")
            .eq("indicator_name", indicator.name)
            .in("year", years);
          const { error } = await supabase.from("governance_global").insert(records);
          if (error) throw new Error(`DB insert ${indicator.code}: ${error.message}`);
        }

        results.indicators[indicator.name] = records.length;
        results.governance += records.length;
        structuredLog("info", FN, `${indicator.code}: ${records.length} records`);
      }, { timeoutMs: TIMEOUT_MS }).catch((e) => {
        const msg = `${indicator.code}: ${(e as Error).message}`;
        results.errors.push(msg);
        structuredLog("warn", FN, msg);
      });
    }

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: results.errors.length === 0 ? "success" : (results.governance > 0 ? "partial" : "error"),
      message: `Fetched ${results.governance} governance records. Errors: ${results.errors.length}`,
    });

    await supabase.rpc("register_pipeline_heartbeat", {
      _pipeline_name: FN,
      _success: results.governance > 0,
      _error: results.governance > 0 ? null : (results.errors[0] ?? "No governance records inserted"),
      _metadata: {
        inserted: results.governance,
        indicators: results.indicators,
        errors: results.errors.length,
      },
    });

    structuredLog("info", FN, `Complete: ${results.governance} records, ${results.errors.length} errors`, undefined, start);
    return jsonResponse({ ok: results.governance > 0, message: `Fetched ${results.governance} governance records`, data: results });
  } catch (e) {
    structuredLog("error", FN, (e as Error).message, undefined, start);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    await supabase.from("automation_logs").insert({ job_name: FN, status: "error", message: (e as Error).message });
    await supabase.rpc("register_pipeline_heartbeat", {
      _pipeline_name: FN,
      _success: false,
      _error: e instanceof Error ? e.message : String(e),
    });
    return errorResponse(e);
  }
});