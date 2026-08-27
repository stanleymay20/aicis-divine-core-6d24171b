// Shared helper for writing into normalized_metrics consistently across free-source ingesters.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface NormalizedRow {
  provider_name: string;
  domain: string;
  metric_name: string;
  iso3: string;
  period: string; // ISO date or source period label
  value: number;
  unit?: string | null;
  confidence?: number | null;
  confidence_semantics?: string | null;
  freshness_score?: number | null;
  freshness_semantics?: string | null;
  provenance_source?: string | null;
  provenance_observed_at?: string | null;
  provenance_observed_at_semantics?: string | null;
}

export function svcClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
}

export async function writeNormalized(
  supabase: SupabaseClient,
  rows: NormalizedRow[],
  chunkSize = 500
): Promise<{ inserted: number; errors: string[] }> {
  const errors: string[] = [];
  let inserted = 0;
  const safeChunkSize = Number.isInteger(chunkSize) && chunkSize > 0
    ? Math.min(chunkSize, 1000)
    : 500;

  for (let i = 0; i < rows.length; i += safeChunkSize) {
    const retrievedAt = new Date().toISOString();
    const prepared: Array<Record<string, unknown>> = [];

    for (const row of rows.slice(i, i + safeChunkSize)) {
      const validationError = validateRow(row);
      if (validationError) {
        errors.push(`${row.provider_name}:${row.metric_name}:${row.iso3}:${row.period}: ${validationError}`);
        continue;
      }

      const confidence = row.confidence ?? null;
      const freshness = row.freshness_score ?? null;
      const sourceObservedAt = normalizeTimestampOrNull(row.provenance_observed_at);

      prepared.push({
        ...row,
        confidence,
        confidence_semantics: confidence === null
          ? row.confidence_semantics ?? "unknown_not_quantified"
          : row.confidence_semantics ?? "producer_numeric_semantics_unspecified",
        freshness_score: freshness,
        freshness_semantics: freshness === null
          ? row.freshness_semantics ?? "not_computed"
          : row.freshness_semantics ?? "producer_numeric_semantics_unspecified",
        provenance_observed_at: sourceObservedAt,
        provenance_observed_at_semantics: sourceObservedAt === null
          ? row.provenance_observed_at_semantics ?? "source_observation_time_not_supplied"
          : row.provenance_observed_at_semantics ?? "producer_time_semantics_unspecified",
        retrieved_at: retrievedAt,
        dedup_key: `${row.provider_name}:${row.metric_name}:${row.iso3}:${row.period}`,
        created_at: retrievedAt,
        updated_at: retrievedAt,
      });
    }

    if (prepared.length === 0) continue;
    const { error } = await supabase
      .from("normalized_metrics")
      .upsert(prepared, { onConflict: "dedup_key", ignoreDuplicates: false });
    if (error) errors.push(error.message);
    else inserted += prepared.length;
  }
  return { inserted, errors };
}

export async function logRun(
  supabase: SupabaseClient,
  job: string,
  status: "success" | "partial" | "error",
  message: string
) {
  await supabase.from("automation_logs").insert({ job_name: job, status, message });
}

function validateRow(row: NormalizedRow): string | null {
  if (!row.provider_name?.trim()) return "provider_name is required";
  if (!row.domain?.trim()) return "domain is required";
  if (!row.metric_name?.trim()) return "metric_name is required";
  if (!row.iso3?.trim()) return "iso3 is required";
  if (!row.period?.trim()) return "period is required";
  if (!Number.isFinite(row.value)) return "value must be finite";
  if (row.confidence !== undefined && row.confidence !== null && !isUnitInterval(row.confidence)) {
    return "confidence must be between 0 and 1 when supplied";
  }
  if (row.freshness_score !== undefined && row.freshness_score !== null && !isUnitInterval(row.freshness_score)) {
    return "freshness_score must be between 0 and 1 when supplied";
  }
  if (row.provenance_observed_at && normalizeTimestampOrNull(row.provenance_observed_at) === null) {
    return "provenance_observed_at must be a valid timestamp when supplied";
  }
  return null;
}

function isUnitInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function normalizeTimestampOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}
