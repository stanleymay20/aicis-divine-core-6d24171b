// Shared helper: record firehose health into firehose_health table.
// Idempotent — upserts a single row per firehose_name.

export async function recordFirehoseHealth(
  supabase: any,
  args: {
    name: string;
    trustTier: "tier_1" | "tier_2" | "tier_3";
    success: boolean;
    insertedCount?: number;
    durationMs?: number;
    errorMessage?: string;
  },
) {
  const now = new Date().toISOString();
  // Read current row to compute consecutive_failures
  const { data: existing } = await supabase
    .from("firehose_health")
    .select("consecutive_failures")
    .eq("firehose_name", args.name)
    .maybeSingle();

  const prevFails = existing?.consecutive_failures ?? 0;
  const consecutive_failures = args.success ? 0 : prevFails + 1;

  const patch: Record<string, unknown> = {
    firehose_name: args.name,
    trust_tier: args.trustTier,
    consecutive_failures,
    last_inserted_count: args.insertedCount ?? null,
    last_duration_ms: args.durationMs ?? null,
    updated_at: now,
  };
  if (args.success) {
    patch.last_success_at = now;
    patch.last_error_message = null;
  } else {
    patch.last_failure_at = now;
    patch.last_error_message = (args.errorMessage ?? "unknown").slice(0, 500);
  }

  await supabase.from("firehose_health").upsert(patch, { onConflict: "firehose_name" });
}
