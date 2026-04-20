// Shared helper for writing into normalized_metrics consistently across free-source ingesters.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface NormalizedRow {
  provider_name: string;
  domain: string;
  metric_name: string;
  iso3: string;
  period: string; // ISO date or year-month-day
  value: number;
  unit?: string | null;
  confidence?: number | null;
  provenance_source?: string | null;
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
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize).map((r) => ({
      ...r,
      dedup_key: `${r.provider_name}:${r.metric_name}:${r.iso3}:${r.period}`,
      provenance_observed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      confidence: r.confidence ?? 0.85,
    }));
    const { error } = await supabase
      .from("normalized_metrics")
      .upsert(chunk, { onConflict: "dedup_key", ignoreDuplicates: false });
    if (error) errors.push(error.message);
    else inserted += chunk.length;
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
