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

const SOURCE_URL = "https://covid.ourworldindata.org/data/owid-covid-data.csv";
const WATCH = new Set(["GHA", "NGA", "KEN", "ZAF", "USA", "OWID_EUR", "OWID_AFR", "OWID_WRL"]);

type CsvRow = Record<string, string>;

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
    provider_name: "owid_health",
    endpoint: "pull-owid-health",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  try {
    const response = await fetch(SOURCE_URL);
    if (!response.ok) throw new Error(`OWID health fetch error: ${response.status}`);
    const rows = parseCsv(await response.text());

    const latestByCode = new Map<string, CsvRow>();
    for (const row of rows) {
      const code = row.iso_code;
      const date = row.date;
      if (!code || !date || !WATCH.has(code)) continue;
      const current = latestByCode.get(code);
      if (!current || date > String(current.date ?? "")) latestByCode.set(code, row);
    }

    const normalizedRows: NormalizedRow[] = [];
    for (const [code, row] of latestByCode.entries()) {
      const period = row.date;
      pushObserved(normalizedRows, code, period, "covid_new_cases", row.new_cases, "people");
      pushObserved(normalizedRows, code, period, "covid_new_deaths", row.new_deaths, "people");
      pushObserved(normalizedRows, code, period, "covid_hospital_patients", row.hosp_patients, "people");
      pushObserved(normalizedRows, code, period, "covid_icu_patients", row.icu_patients, "people");
      pushObserved(normalizedRows, code, period, "covid_people_vaccinated", row.people_vaccinated, "people");
      pushObserved(normalizedRows, code, period, "covid_people_fully_vaccinated", row.people_fully_vaccinated, "people");
      pushObserved(normalizedRows, code, period, "covid_positive_rate", row.positive_rate, "ratio");
    }

    if (normalizedRows.length === 0) throw new Error("OWID health returned no usable observations for watched regions");

    const writeResult = await writeNormalized(supabase, normalizedRows);
    if (writeResult.errors.length > 0) {
      throw new Error(`OWID health normalized write failed: ${writeResult.errors.join(" | ")}`);
    }

    await supabase.from("compliance_audit").insert({
      action_type: "data_pull",
      division: "health",
      action_description: "Pulled observed OWID COVID-19 metrics",
      compliance_status: "compliant",
      data_accessed: {
        provider: "OWID",
        resource: "owid-covid-data.csv",
        destination: "normalized_metrics",
        synthetic_severity_disabled: true,
      },
    });

    await supabase.from("system_logs").insert({
      division: "health",
      action: "pull_owid_health",
      result: "success",
      log_level: "info",
      metadata: {
        normalized_rows: writeResult.inserted,
        regions: latestByCode.size,
        synthetic_risk_level_disabled: true,
        synthetic_affected_count_disabled: true,
      },
    });

    await finishProviderRun(supabase, run, {
      records_fetched: latestByCode.size,
      records_inserted: writeResult.inserted,
      records_normalized: writeResult.inserted,
    });

    return json({
      ok: true,
      normalized_rows: writeResult.inserted,
      regions: latestByCode.size,
      message: "Stored observed OWID health metrics only",
    });
  } catch (error) {
    console.error("pull-owid-health error:", error);
    await failProviderRun(supabase, run, error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

function pushObserved(
  rows: NormalizedRow[],
  iso3: string,
  period: string,
  metricName: string,
  rawValue: string | undefined,
  unit: string,
) {
  if (rawValue === undefined || rawValue === "") return;
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return;
  rows.push({
    provider_name: "owid_health",
    domain: "health",
    metric_name: metricName,
    iso3,
    period,
    value,
    unit,
    confidence: 0.98,
    provenance_source: SOURCE_URL,
  });
}

function parseCsv(csv: string): CsvRow[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const rows: CsvRow[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const values = parseCsvLine(lines[index]);
    const row: CsvRow = {};
    headers.forEach((header, column) => {
      row[header] = values[column] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" },
  });
}
