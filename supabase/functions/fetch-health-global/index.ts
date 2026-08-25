import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, corsHeaders, errorResponse, jsonResponse } from "../_shared/resilience.ts";
import { startProviderRun, finishProviderRun, failProviderRun } from "../_shared/provider-telemetry.ts";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "fetch-health-global";
const TIMEOUT_MS = 15_000;

type WhoRow = {
  Value?: unknown;
  SpatialDim?: unknown;
  Dim1?: unknown;
  TimeDim?: unknown;
  IndicatorCode?: unknown;
  DisplayValue?: unknown;
};

type OpenFdaRow = { term?: unknown; count?: unknown };

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const numeric = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const whoRecords = (
  rows: WhoRow[],
  metricName: string,
  unit: string,
  limit: number,
) => rows.slice(0, limit).flatMap((item) => {
  const value = numeric(item.Value);
  const iso3 = text(item.SpatialDim);
  if (value == null || !iso3) return [];
  const year = numeric(item.TimeDim) ?? new Date().getUTCFullYear();
  return [{
    country: iso3,
    iso_code: iso3,
    source: "who",
    metric_name: metricName,
    value,
    unit,
    sex: text(item.Dim1) ?? "all",
    date: `${Math.round(year)}-01-01`,
    metadata: {
      indicator_code: text(item.IndicatorCode),
      display_value: text(item.DisplayValue),
      provenance: "WHO GHO",
    },
  }];
});

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
    structuredLog("info", FN, "Starting health data collection");
    const results: { health: number; errors: string[] } = { health: 0, errors: [] };

    await resilientCall(`${FN}:who`, async () => {
      const response = await fetch(
        "https://ghoapi.azureedge.net/api/WHOSIS_000001?$top=100",
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      if (!response.ok) throw new Error(`WHO API: ${response.status}`);
      const payload = await response.json() as { value?: unknown };
      const rows = Array.isArray(payload.value) ? payload.value as WhoRow[] : [];
      const records = whoRecords(rows, "life_expectancy", "years", 50);
      if (records.length === 0) return;

      const { error } = await supabase.from("health_metrics").insert(records);
      if (error) throw new Error(`DB insert: ${error.message}`);
      results.health += records.length;
      structuredLog("info", FN, `WHO: ${records.length} records`);
    }, { timeoutMs: TIMEOUT_MS }).catch((error: unknown) => {
      const message = `WHO: ${messageOf(error)}`;
      results.errors.push(message);
      structuredLog("warn", FN, message);
    });

    await resilientCall(`${FN}:openfda`, async () => {
      const response = await fetch(
        "https://api.fda.gov/drug/event.json?count=patient.reaction.reactionmeddrapt.exact&limit=50",
        {
          headers: { Accept: "application/json", "User-Agent": "AICIS/1.0" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (!response.ok) throw new Error(`OpenFDA: ${response.status}`);
      const payload = await response.json() as { results?: unknown };
      const rows = Array.isArray(payload.results) ? payload.results as OpenFdaRow[] : [];
      const today = new Date().toISOString().slice(0, 10);
      const records = rows.slice(0, 50).flatMap((item) => {
        const term = text(item.term);
        const count = numeric(item.count);
        if (!term || count == null) return [];
        return [{
          country: "United States",
          iso_code: "USA",
          source: "openfda",
          metric_name: `adverse_event_report_${term.toLowerCase().replace(/\s+/g, "_").slice(0, 60)}`,
          value: count,
          unit: "reports",
          date: today,
          metadata: {
            reaction: term,
            dataset: "drug_event",
            interpretation: "reported adverse-event count; not incidence or causal attribution",
          },
        }];
      });
      if (records.length === 0) return;

      const { error } = await supabase.from("health_metrics").insert(records);
      if (error) throw new Error(`DB insert: ${error.message}`);
      results.health += records.length;
      structuredLog("info", FN, `OpenFDA: ${records.length} report-count signals`);
    }, { timeoutMs: TIMEOUT_MS }).catch((error: unknown) => {
      const message = `OpenFDA: ${messageOf(error)}`;
      results.errors.push(message);
      structuredLog("warn", FN, message);
    });

    await resilientCall(`${FN}:who-gho`, async () => {
      const indicators = [
        { code: "WHOSIS_000002", metric: "healthy_life_expectancy", unit: "years" },
        { code: "MDG_0000000001", metric: "under5_mortality", unit: "per_1000" },
      ];

      for (const indicator of indicators) {
        const response = await fetch(
          `https://ghoapi.azureedge.net/api/${indicator.code}?$top=50&$orderby=TimeDim%20desc`,
          { signal: AbortSignal.timeout(TIMEOUT_MS) },
        );
        if (!response.ok) continue;
        const payload = await response.json() as { value?: unknown };
        const rows = Array.isArray(payload.value) ? payload.value as WhoRow[] : [];
        const records = whoRecords(rows, indicator.metric, indicator.unit, 25);
        if (records.length === 0) continue;
        const { error } = await supabase.from("health_metrics").insert(records);
        if (error) throw error;
        results.health += records.length;
      }
    }, { timeoutMs: TIMEOUT_MS }).catch((error: unknown) => {
      const message = `WHO-GHO: ${messageOf(error)}`;
      results.errors.push(message);
      structuredLog("warn", FN, message);
    });

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: results.errors.length === 0 ? "success" : results.health > 0 ? "partial" : "error",
      message: `Fetched ${results.health} health records. Errors: ${results.errors.length}${results.errors.length ? ` [${results.errors.join("; ")}]` : ""}`,
    });

    structuredLog("info", FN, `Complete: ${results.health} records, ${results.errors.length} errors`, undefined, start);
    await finishProviderRun(supabase, run, {
      records_inserted: results.health,
      records_normalized: results.health,
      error_count: results.errors.length,
      error_summary: results.errors[0] ?? null,
    });
    return jsonResponse({ ok: true, message: `Fetched ${results.health} health metrics`, data: results });
  } catch (error) {
    const message = messageOf(error);
    structuredLog("error", FN, message, undefined, start);
    await supabase.from("automation_logs").insert({ job_name: FN, status: "error", message });
    await failProviderRun(supabase, run, error);
    return errorResponse(error);
  }
});
