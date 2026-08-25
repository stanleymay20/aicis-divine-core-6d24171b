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

const COMBINED_QUERY = "(protest OR conflict OR unrest)";
const THROTTLE_MS = 5_200;
const BATCH_SIZE = 8;

const ALL_COUNTRIES: [string, string][] = [
  ["AFG","Afghanistan"],["AGO","Angola"],["BDI","Burundi"],["BFA","Burkina Faso"],
  ["CAF","Central African Republic"],["COD","Congo"],["ETH","Ethiopia"],
  ["HTI","Haiti"],["IRQ","Iraq"],["LBY","Libya"],["MLI","Mali"],["MMR","Myanmar"],
  ["MOZ","Mozambique"],["NGA","Nigeria"],["PAK","Pakistan"],["SDN","Sudan"],
  ["SOM","Somalia"],["SSD","South Sudan"],["SYR","Syria"],["TCD","Chad"],
  ["UKR","Ukraine"],["VEN","Venezuela"],["YEM","Yemen"],["ZWE","Zimbabwe"],
  ["USA","United States"],["GBR","United Kingdom"],["FRA","France"],
  ["DEU","Germany"],["JPN","Japan"],["CHN","China"],["IND","India"],
  ["BRA","Brazil"],["RUS","Russia"],["ZAF","South Africa"],["MEX","Mexico"],
  ["IDN","Indonesia"],["TUR","Turkey"],["SAU","Saudi Arabia"],["ARG","Argentina"],
  ["KOR","South Korea"],["EGY","Egypt"],["IRN","Iran"],["THA","Thailand"],
  ["COL","Colombia"],["PHL","Philippines"],["KEN","Kenya"],["TZA","Tanzania"],
];

const TOTAL_BATCHES = Math.ceil(ALL_COUNTRIES.length / BATCH_SIZE);

type GdeltArticle = {
  title?: string;
  tone?: number | string;
  goldstein?: number | string;
};

type GdeltResponse = {
  articles?: GdeltArticle[];
};

type RequestBody = { batch?: number; all?: boolean };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405, { Allow: "POST" });

  const { response: authResponse } = await requireAdminOrCron(req, corsHeaders);
  if (authResponse) return authResponse;

  const rawBody: unknown = await req.json().catch(() => ({}));
  const body = isRecord(rawBody) ? rawBody as RequestBody : {};
  let batch = new Date().getUTCHours() % TOTAL_BATCHES;
  if (typeof body.batch === "number" && Number.isFinite(body.batch)) {
    batch = Math.min(Math.max(0, Math.trunc(body.batch)), TOTAL_BATCHES - 1);
  }

  const processAll = body.all === true;
  const countries = processAll
    ? ALL_COUNTRIES
    : ALL_COUNTRIES.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE);
  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const run = await startProviderRun(sb, {
    provider_name: "gdelt_doc",
    endpoint: "ingest-gdelt",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
    params: { batch, batch_size: BATCH_SIZE, evidence_class: "media_coverage" },
  });

  const period = new Date().toISOString().split("T")[0];
  const normalizedRows: NormalizedRow[] = [];
  const errors: string[] = [];
  let countriesWithCoverage = 0;

  try {
    for (let index = 0; index < countries.length; index += 1) {
      const [iso3, name] = countries[index];
      try {
        const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(COMBINED_QUERY)}%20${encodeURIComponent(`"${name}"`)}&mode=artlist&format=json&maxrecords=50`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`GDELT HTTP ${response.status}`);

        const text = await response.text();
        const payload = parseGdeltResponse(text);
        const articles = payload?.articles ?? [];
        if (articles.length > 0) countriesWithCoverage += 1;

        normalizedRows.push({
          provider_name: "gdelt_doc",
          domain: "politics_media",
          metric_name: "conflict_protest_unrest_article_count",
          iso3,
          period,
          value: articles.length,
          unit: "articles",
          confidence: 0.98,
          provenance_source: url,
        });

        const tones = articles.map((article) => Number(article.tone)).filter(Number.isFinite);
        if (tones.length > 0) {
          normalizedRows.push({
            provider_name: "gdelt_doc",
            domain: "politics_media",
            metric_name: "conflict_protest_unrest_article_tone_mean",
            iso3,
            period,
            value: tones.reduce((sum, value) => sum + value, 0) / tones.length,
            unit: "GDELT tone",
            confidence: 0.95,
            provenance_source: url,
          });
        }
      } catch (error) {
        const message = `${iso3}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(message);
        errors.push(message);
      }

      if (index < countries.length - 1) await new Promise((resolve) => setTimeout(resolve, THROTTLE_MS));
    }

    const writeResult = await writeNormalized(sb, normalizedRows);
    errors.push(...writeResult.errors.map((error) => `normalized write: ${error}`));

    await sb.from("automation_logs").insert({
      job_name: "ingest-gdelt",
      status: errors.length === 0 ? "success" : writeResult.inserted > 0 ? "partial" : "error",
      message: `Batch ${batch}/${TOTAL_BATCHES - 1}: ${writeResult.inserted} media metrics; ${countriesWithCoverage}/${countries.length} countries with article coverage`,
    });

    await finishProviderRun(sb, run, {
      records_fetched: countries.length,
      records_inserted: writeResult.inserted,
      records_normalized: writeResult.inserted,
      error_count: errors.length,
      error_summary: errors.length > 0 ? errors.join(" | ").slice(0, 2000) : null,
    });

    if (writeResult.inserted === 0 && errors.length > 0) {
      throw new Error(errors.join(" | "));
    }

    return json({
      ok: errors.length === 0,
      batch,
      normalized_rows: writeResult.inserted,
      countries_with_coverage: countriesWithCoverage,
      errors: errors.length,
      evidence_class: "media_coverage_not_incident_count",
      legacy_political_event_write_disabled: true,
    });
  } catch (error) {
    console.error("ingest-gdelt fatal:", error);
    await failProviderRun(sb, run, error, {
      records_inserted: normalizedRows.length,
      error_count: errors.length,
    });
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

function parseGdeltResponse(text: string): GdeltResponse | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isRecord(parsed)) return null;
    return parsed as GdeltResponse;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" },
  });
}
