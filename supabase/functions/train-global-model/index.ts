import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FUNCTION_NAME = "train-global-model";
const ANALYSIS_TYPE = "pretraining_source_diagnostic_v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AlertRow = {
  meta: unknown;
  severity: number | string | null;
};

type SourceAccumulator = {
  alertCount: number;
  severityObservedCount: number;
  severitySum: number;
};

type SourceDiagnostic = {
  alert_count: number;
  severity_observed_count: number;
  average_observed_severity: number | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sourceName(meta: unknown): string {
  const source = asRecord(meta).source;
  if (typeof source !== "string" || source.trim() === "") {
    return "unattributed";
  }
  return source.trim().slice(0, 120);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "POST" },
    });
  }

  const { response: authResponse } = await requireAdminOrCron(req, corsHeaders);
  if (authResponse) return authResponse;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: vulnerabilities, error: vulnerabilityError } = await supabase
      .from("vulnerability_scores")
      .select("id")
      .gte("computed_at", thirtyDaysAgo);
    if (vulnerabilityError) throw vulnerabilityError;

    const { data: alertData, error: alertError } = await supabase
      .from("critical_alerts")
      .select("meta, severity")
      .gte("triggered_at", thirtyDaysAgo);
    if (alertError) throw alertError;

    const alerts = (alertData ?? []) as unknown as AlertRow[];
    const accumulators = new Map<string, SourceAccumulator>();

    for (const alert of alerts) {
      const source = sourceName(alert.meta);
      const current = accumulators.get(source) ?? {
        alertCount: 0,
        severityObservedCount: 0,
        severitySum: 0,
      };

      current.alertCount += 1;
      const severity = finiteNumber(alert.severity);
      if (severity !== null) {
        current.severityObservedCount += 1;
        current.severitySum += severity;
      }
      accumulators.set(source, current);
    }

    const sourceDiagnostics: Record<string, SourceDiagnostic> = {};
    for (const [source, accumulator] of accumulators.entries()) {
      sourceDiagnostics[source] = {
        alert_count: accumulator.alertCount,
        severity_observed_count: accumulator.severityObservedCount,
        average_observed_severity: accumulator.severityObservedCount > 0
          ? accumulator.severitySum / accumulator.severityObservedCount
          : null,
      };
    }

    const diagnostic = {
      analysis_type: ANALYSIS_TYPE,
      period: "30_days",
      vulnerabilities_observed: vulnerabilities?.length ?? 0,
      alerts_observed: alerts.length,
      sources_observed: accumulators.size,
      source_diagnostics: sourceDiagnostics,
      model_training: {
        performed: false,
        model_version_created: null,
        weights_updated: false,
        validation_metrics_computed: false,
        calibration_computed: false,
        reason: "This compatibility endpoint currently performs source diagnostics only; no proven training implementation is executed.",
      },
      truth_floor: {
        missing_severity_defaulted_to_zero: false,
        unattributed_source_label: "unattributed",
      },
      observed_at: new Date().toISOString(),
    };

    const { error: logError } = await supabase.from("ai_learning_log").insert({
      source_table: "critical_alerts",
      success: true,
      insight: JSON.stringify(diagnostic),
    });
    if (logError) throw logError;

    console.log(JSON.stringify({
      level: "info",
      function: FUNCTION_NAME,
      message: "Pre-training source diagnostic complete; no model training performed",
      analysis_type: ANALYSIS_TYPE,
      sources_observed: accumulators.size,
      timestamp: new Date().toISOString(),
    }));

    return new Response(JSON.stringify({
      ok: true,
      endpoint_name: FUNCTION_NAME,
      analysis_type: ANALYSIS_TYPE,
      training_performed: false,
      model_version_created: null,
      analyzed: {
        vulnerabilities: vulnerabilities?.length ?? 0,
        alerts: alerts.length,
        sources: accumulators.size,
      },
      source_diagnostics: sourceDiagnostics,
      note: "Endpoint name is retained for caller compatibility. This invocation does not train, validate, calibrate, or promote a model.",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      function: FUNCTION_NAME,
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));

    return new Response(JSON.stringify({
      ok: false,
      error: "Pre-training source diagnostic failed",
      training_performed: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});