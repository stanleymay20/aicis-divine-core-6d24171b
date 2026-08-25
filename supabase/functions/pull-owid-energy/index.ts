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

const SOURCE_URL = "https://raw.githubusercontent.com/owid/energy-data/master/owid-energy-data.csv";

const TARGETS: Record<string, string> = {
  "World": "OWID_WRL",
  "United States": "USA",
  "China": "CHN",
  "European Union (27)": "OWID_EU27",
  "European Union": "OWID_EU27",
};

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
    provider_name: "owid_energy",
    endpoint: "pull-owid-energy",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  try {
    const response = await fetch(SOURCE_URL);
    if (!response.ok) throw new Error(`OWID energy fetch error: ${response.status}`);
    const csv = await response.text();
    const rows = parseCsv(csv);

    const latestByCountry = new Map<string, CsvRow>();
    for (const row of rows) {
      const country = row.country;
      if (!country || !(country in TARGETS)) continue;
      const year = Number(row.year);
      if (!Number.isFinite(year)) continue;
      const current = latestByCountry.get(country);
      if (!current || year > Number(current.year)) latestByCountry.set(country, row);
    }

    const normalizedRows: NormalizedRow[] = [];
    for (const [country, row] of latestByCountry.entries()) {
      const iso3 = TARGETS[country];
      const year = Number(row.year);
      const period = `${year}-01-01`;

      pushObserved(normalizedRows, iso3, period, "electricity_generation_twh", row.electricity_generation, "TWh");
      pushObserved(normalizedRows, iso3, period, "renewables_share_electricity_pct", row.renewables_share_elec, "%");
      pushObserved(normalizedRows, iso3, period, "renewables_share_primary_energy_pct", row.renewables_share_energy, "%");
      pushObserved(normalizedRows, iso3, period, "electricity_demand_twh", row.electricity_demand, "TWh");
      pushObserved(normalizedRows, iso3, period, "electricity_per_capita_kwh", row.electricity_demand_per_capita, "kWh/person");
      pushObserved(normalizedRows, iso3, period, "carbon_intensity_electricity_gco2_kwh", row.carbon_intensity_elec, "gCO2/kWh");
    }

    if (normalizedRows.length === 0) throw new Error("OWID energy returned no usable observations for target regions");

    const writeResult = await writeNormalized(supabase, normalizedRows);
    if (writeResult.errors.length > 0) {
      throw new Error(`OWID normalized write failed: ${writeResult.errors.join(" | ")}`);
    }

    await supabase.from("compliance_audit").insert({
      action_type: "data_pull",
      division: "energy",
      action_description: "Pulled observed OWID energy metrics",
      compliance_status: "compliant",
      data_accessed: {
        provider: "OWID",
        resource: "owid-energy-data.csv",
        destination: "normalized_metrics",
        synthetic_grid_proxies_disabled: true,
      },
    });

    await supabase.from("system_logs").insert({
      division: "energy",
      action: "pull_owid_energy",
      result: "success",
      log_level: "info",
      metadata: {
        normalized_rows: writeResult.inserted,
        regions: latestByCountry.size,
        synthetic_grid_load_disabled: true,
        synthetic_stability_disabled: true,
        synthetic_outage_risk_disabled: true,
      },
    });

    await finishProviderRun(supabase, run, {
      records_fetched: latestByCountry.size,
      records_inserted: writeResult.inserted,
      records_normalized: writeResult.inserted,
    });

    return json({
      ok: true,
      normalized_rows: writeResult.inserted,
      regions: latestByCountry.size,
      message: "Stored observed OWID energy metrics only",
    });
  } catch (error) {
    console.error("pull-owid-energy error:", error);
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
    provider_name: "owid_energy",
    domain: "energy",
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
