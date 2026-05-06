// Shared helper: record firehose health + exponential backoff into firehose_health.
// On failure: backoff doubles up to 1h cap. On success: backoff resets to 0.

const BACKOFF_BASE_SEC = 60;     // 1 min after first failure
const BACKOFF_MAX_SEC = 3600;    // cap 1 hour

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
  const now = new Date();
  const { data: existing } = await supabase
    .from("firehose_health")
    .select("consecutive_failures,backoff_seconds")
    .eq("firehose_name", args.name)
    .maybeSingle();

  const prevFails = existing?.consecutive_failures ?? 0;
  const consecutive_failures = args.success ? 0 : prevFails + 1;

  let backoff_seconds = 0;
  let next_retry_at: string | null = null;
  if (!args.success) {
    backoff_seconds = Math.min(
      BACKOFF_MAX_SEC,
      BACKOFF_BASE_SEC * Math.pow(2, Math.max(0, consecutive_failures - 1)),
    );
    next_retry_at = new Date(now.getTime() + backoff_seconds * 1000).toISOString();
  }

  const patch: Record<string, unknown> = {
    firehose_name: args.name,
    trust_tier: args.trustTier,
    consecutive_failures,
    last_inserted_count: args.insertedCount ?? null,
    last_duration_ms: args.durationMs ?? null,
    backoff_seconds,
    next_retry_at,
    updated_at: now.toISOString(),
  };
  if (args.success) {
    patch.last_success_at = now.toISOString();
    patch.last_error_message = null;
  } else {
    patch.last_failure_at = now.toISOString();
    patch.last_error_message = (args.errorMessage ?? "unknown").slice(0, 500);
  }

  await supabase.from("firehose_health").upsert(patch, { onConflict: "firehose_name" });
}

/**
 * Returns true if the firehose should skip this run because backoff has not elapsed.
 * Read-only check — does not mutate state.
 */
export async function shouldSkipForBackoff(supabase: any, name: string): Promise<{ skip: boolean; nextRetryAt?: string }> {
  const { data } = await supabase
    .from("firehose_health")
    .select("next_retry_at")
    .eq("firehose_name", name)
    .maybeSingle();
  if (!data?.next_retry_at) return { skip: false };
  const nextMs = new Date(data.next_retry_at).getTime();
  if (Number.isFinite(nextMs) && nextMs > Date.now()) {
    return { skip: true, nextRetryAt: data.next_retry_at };
  }
  return { skip: false };
}
