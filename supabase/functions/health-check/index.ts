import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type HealthStatus = "healthy" | "degraded" | "unreachable" | "unknown";

type Check = {
  status: HealthStatus;
  latency_ms?: number | null;
  detail?: string;
  error?: string;
  observation_count?: number | null;
  semantics: string;
};

type ThresholdEvent = {
  signal: string;
  severity: "warn" | "critical";
  observed_value: number;
  configured_threshold: number;
  unit: string;
  semantics: "configured_operational_threshold_not_empirically_validated_slo";
};

const THRESHOLDS = {
  database_latency_warn_ms: 500,
  database_latency_critical_ms: 2000,
  auth_latency_warn_ms: 1000,
  execution_error_rate_warn_pct: 5,
  execution_error_rate_critical_pct: 15,
} as const;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (auth.response) return auth.response;

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(url, serviceRole, { auth: { persistSession: false } });

  const checks: Record<string, Check> = {};
  const thresholdEvents: ThresholdEvent[] = [];
  const startedAt = Date.now();

  // Database: observed service-role query and latency only.
  try {
    const started = Date.now();
    const { error } = await supabase.from("organizations").select("id").limit(1);
    if (error) throw error;
    const latency = Date.now() - started;
    checks.database = {
      status: "healthy",
      latency_ms: latency,
      semantics: "observed_service_role_read_query",
    };
    if (latency > THRESHOLDS.database_latency_critical_ms) {
      thresholdEvents.push({
        signal: "database_latency",
        severity: "critical",
        observed_value: latency,
        configured_threshold: THRESHOLDS.database_latency_critical_ms,
        unit: "ms",
        semantics: "configured_operational_threshold_not_empirically_validated_slo",
      });
    } else if (latency > THRESHOLDS.database_latency_warn_ms) {
      thresholdEvents.push({
        signal: "database_latency",
        severity: "warn",
        observed_value: latency,
        configured_threshold: THRESHOLDS.database_latency_warn_ms,
        unit: "ms",
        semantics: "configured_operational_threshold_not_empirically_validated_slo",
      });
    }
  } catch (error) {
    checks.database = {
      status: "unreachable",
      error: messageOf(error),
      semantics: "database_probe_failed",
    };
  }

  // Auth: service-role admin list call verifies the Auth control plane is responsive.
  try {
    const started = Date.now();
    const { error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) throw error;
    const latency = Date.now() - started;
    checks.auth = {
      status: "healthy",
      latency_ms: latency,
      semantics: "observed_service_role_auth_admin_probe",
    };
    if (latency > THRESHOLDS.auth_latency_warn_ms) {
      thresholdEvents.push({
        signal: "auth_latency",
        severity: "warn",
        observed_value: latency,
        configured_threshold: THRESHOLDS.auth_latency_warn_ms,
        unit: "ms",
        semantics: "configured_operational_threshold_not_empirically_validated_slo",
      });
    }
  } catch (error) {
    checks.auth = {
      status: "unreachable",
      error: messageOf(error),
      semantics: "auth_probe_failed",
    };
  }

  // Storage: bucket-list call verifies the Storage control plane, not object-byte integrity.
  try {
    const started = Date.now();
    const { error } = await supabase.storage.listBuckets();
    if (error) throw error;
    checks.storage = {
      status: "healthy",
      latency_ms: Date.now() - started,
      semantics: "observed_storage_control_plane_probe_not_object_integrity_check",
    };
  } catch (error) {
    checks.storage = {
      status: "unreachable",
      error: messageOf(error),
      semantics: "storage_probe_failed",
    };
  }

  // Cron: preserve recent-run evidence without inventing a universal staleness threshold.
  // Exact schedules differ by job and remain cutover evidence, so schedule-relative staleness
  // must stay unknown until those schedules are restored and governed.
  try {
    const { data, error } = await supabase
      .from("cron_run_log")
      .select("job_name,status,started_at,duration_ms,error_message")
      .order("started_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    const latestByJob = new Map<string, { status: string | null; started_at: string | null }>();
    for (const row of data ?? []) {
      if (!latestByJob.has(row.job_name)) {
        latestByJob.set(row.job_name, {
          status: row.status ?? null,
          started_at: row.started_at ?? null,
        });
      }
    }
    const lastFailed = [...latestByJob.values()].filter((row) => row.status === "failed").length;
    checks.cron_jobs = {
      status: lastFailed > 0 ? "degraded" : latestByJob.size > 0 ? "healthy" : "unknown",
      observation_count: latestByJob.size,
      detail: `${latestByJob.size} distinct jobs observed; ${lastFailed} have failed as their latest recorded status`,
      semantics: "latest_recorded_run_status_only_schedule_relative_staleness_withheld_until_exact_schedules_are_proven",
    };
  } catch (error) {
    checks.cron_jobs = {
      status: "unknown",
      error: messageOf(error),
      semantics: "cron_run_log_unavailable_no_staleness_or_health_inference",
    };
  }

  // Execution engine: observed one-hour error rate only. No observations means unknown, not healthy.
  try {
    const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("execution_run_log")
      .select("status,duration_ms,started_at")
      .gte("started_at", windowStart)
      .limit(500);
    if (error) throw error;

    const runs = data ?? [];
    if (runs.length === 0) {
      checks.execution_engine = {
        status: "unknown",
        observation_count: 0,
        detail: "No execution runs observed in the last hour",
        semantics: "no_recent_observations_health_withheld",
      };
    } else {
      const failures = runs.filter((row) => row.status === "failed").length;
      const errorRate = (failures / runs.length) * 100;
      checks.execution_engine = {
        status: errorRate > THRESHOLDS.execution_error_rate_critical_pct ? "degraded" : "healthy",
        observation_count: runs.length,
        detail: `${failures}/${runs.length} observed runs failed in the last hour (${errorRate.toFixed(2)}%)`,
        semantics: "observed_one_hour_execution_error_rate",
      };
      if (errorRate > THRESHOLDS.execution_error_rate_critical_pct) {
        thresholdEvents.push({
          signal: "execution_error_rate",
          severity: "critical",
          observed_value: errorRate,
          configured_threshold: THRESHOLDS.execution_error_rate_critical_pct,
          unit: "percent",
          semantics: "configured_operational_threshold_not_empirically_validated_slo",
        });
      } else if (errorRate > THRESHOLDS.execution_error_rate_warn_pct) {
        thresholdEvents.push({
          signal: "execution_error_rate",
          severity: "warn",
          observed_value: errorRate,
          configured_threshold: THRESHOLDS.execution_error_rate_warn_pct,
          unit: "percent",
          semantics: "configured_operational_threshold_not_empirically_validated_slo",
        });
      }
    }
  } catch (error) {
    checks.execution_engine = {
      status: "unknown",
      error: messageOf(error),
      semantics: "execution_run_log_unavailable_no_error_rate_inference",
    };
  }

  checks.edge_runtime = {
    status: "healthy",
    latency_ms: Date.now() - startedAt,
    semantics: "this_function_executed_successfully_not_a_claim_about_all_edge_functions",
  };

  const values = Object.values(checks);
  const status: HealthStatus = values.some((check) => check.status === "unreachable")
    ? "unreachable"
    : values.some((check) => check.status === "degraded")
    ? "degraded"
    : values.some((check) => check.status === "unknown")
    ? "unknown"
    : "healthy";

  return new Response(JSON.stringify({
    status,
    authenticated_via: auth.via,
    observed_at: new Date().toISOString(),
    checks,
    threshold_events: thresholdEvents,
    threshold_semantics: "configured operational thresholds; not represented as empirically validated SLOs",
    schedule_staleness_semantics: "withheld until exact per-job schedules are recovered and governed",
  }), {
    status: status === "unreachable" ? 503 : 200,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-cache, no-store" },
  });
});
