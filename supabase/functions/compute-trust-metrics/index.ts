import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type ObservationStatus = "observed" | "observed_absence" | "unknown_no_evidence";

interface MetricObservation {
  type: string;
  value: number | null;
  unit: "percent";
  observationStatus: ObservationStatus;
  semantics: string;
  evidenceCount: number | null;
  metadata: Record<string, unknown>;
}

function normalizePercent(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (numeric <= 1) return numeric * 100;
  if (numeric <= 100) return numeric;
  return null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampPercent(value: number | null): number | null {
  if (value === null) return null;
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

async function sha256Hex(input: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const computedAt = new Date().toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    const [decisionsResult, rootResult, consentTotalResult, consentActiveResult, sdgResult, logsResult] = await Promise.all([
      supabase.from("ai_decision_logs").select("confidence").order("created_at", { ascending: false }).limit(1000),
      supabase.from("ledger_root_hashes").select("timestamp").order("timestamp", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("user_consent").select("id", { count: "exact", head: true }),
      supabase.from("user_consent").select("id", { count: "exact", head: true }).is("revoked_at", null),
      supabase.from("sdg_progress").select("progress_percent"),
      supabase.from("automation_logs").select("status").gte("executed_at", oneDayAgo),
    ]);

    const queryErrors = [
      decisionsResult.error,
      rootResult.error,
      consentTotalResult.error,
      consentActiveResult.error,
      sdgResult.error,
      logsResult.error,
    ].filter(Boolean);
    if (queryErrors.length > 0) {
      throw new Error(queryErrors.map((error) => error?.message ?? "unknown_query_error").join(" | "));
    }

    const confidenceValues = (decisionsResult.data ?? [])
      .map((row) => normalizePercent(row.confidence))
      .filter((value): value is number => value !== null);
    const aiRecordedConfidence = clampPercent(mean(confidenceValues));

    const lastRootAt = rootResult.data?.timestamp ? new Date(rootResult.data.timestamp).toISOString() : null;
    const ledgerRootGenerated24h = lastRootAt && new Date(lastRootAt).getTime() >= new Date(oneDayAgo).getTime() ? 100 : 0;

    const totalConsents = consentTotalResult.count ?? 0;
    const activeConsents = consentActiveResult.count ?? 0;
    const activeConsentRatio = totalConsents > 0
      ? clampPercent((activeConsents / totalConsents) * 100)
      : null;

    const sdgValues = (sdgResult.data ?? [])
      .map((row) => normalizePercent(row.progress_percent))
      .filter((value): value is number => value !== null);
    const sdgProgressMean = clampPercent(mean(sdgValues));

    const completedAutomationLogs = (logsResult.data ?? []).filter((row) => row.status !== "running");
    const successfulAutomationLogs = completedAutomationLogs.filter((row) => row.status === "success").length;
    const automationSuccessRate24h = completedAutomationLogs.length > 0
      ? clampPercent((successfulAutomationLogs / completedAutomationLogs.length) * 100)
      : null;

    const observations: MetricObservation[] = [
      {
        type: "ai_recorded_confidence",
        value: aiRecordedConfidence,
        unit: "percent",
        observationStatus: confidenceValues.length > 0 ? "observed" : "unknown_no_evidence",
        semantics: "mean_recorded_model_confidence_not_accuracy_or_trust_certification",
        evidenceCount: confidenceValues.length,
        metadata: {
          source: "ai_decision_logs.confidence",
          sample_size: confidenceValues.length,
          interpretation: "Mean recorded model confidence only. NULL means no valid confidence observations were available; zero is never manufactured for missing evidence.",
        },
      },
      {
        type: "ledger_root_generated_24h",
        value: ledgerRootGenerated24h,
        unit: "percent",
        observationStatus: lastRootAt ? "observed" : "observed_absence",
        semantics: "binary_presence_of_ledger_root_in_last_24h_not_ledger_integrity",
        evidenceCount: lastRootAt ? 1 : 0,
        metadata: {
          source: "ledger_root_hashes.timestamp",
          last_root_at: lastRootAt,
          interpretation: "100 means at least one ledger root was observed in the last 24 hours; 0 means none was observed. This does not prove full ledger integrity.",
        },
      },
      {
        type: "active_consent_ratio",
        value: activeConsentRatio,
        unit: "percent",
        observationStatus: totalConsents > 0 ? "observed" : "unknown_no_evidence",
        semantics: "ratio_of_non_revoked_stored_consent_records_not_compliance_score",
        evidenceCount: totalConsents,
        metadata: {
          source: "user_consent",
          total_records: totalConsents,
          active_records: activeConsents,
          sample_size: totalConsents,
          interpretation: "Share of stored consent records that are not revoked. NULL means there are no consent records to form a denominator. This is not a GDPR compliance score.",
        },
      },
      {
        type: "sdg_progress_index",
        value: sdgProgressMean,
        unit: "percent",
        observationStatus: sdgValues.length > 0 ? "observed" : "unknown_no_evidence",
        semantics: "arithmetic_mean_of_recorded_sdg_progress_values",
        evidenceCount: sdgValues.length,
        metadata: {
          source: "sdg_progress.progress_percent",
          sample_size: sdgValues.length,
          interpretation: "Arithmetic mean of valid recorded SDG progress percentages. NULL means no valid source observations were available.",
        },
      },
      {
        type: "automation_success_rate_24h",
        value: automationSuccessRate24h,
        unit: "percent",
        observationStatus: completedAutomationLogs.length > 0 ? "observed" : "unknown_no_evidence",
        semantics: "share_of_completed_automation_log_rows_marked_success_in_24h_not_uptime",
        evidenceCount: completedAutomationLogs.length,
        metadata: {
          source: "automation_logs.status",
          completed_runs: completedAutomationLogs.length,
          successful_runs: successfulAutomationLogs,
          interpretation: "Share of completed automation-log rows marked success in the last 24 hours. NULL means no completed runs were observed; it is not infrastructure uptime.",
        },
      },
    ];

    for (const observation of observations) {
      const payload = JSON.stringify({
        metric_type: observation.type,
        metric_value: observation.value,
        metric_unit: observation.unit,
        computed_at: computedAt,
        observation_status: observation.observationStatus,
        metric_semantics: observation.semantics,
        evidence_count: observation.evidenceCount,
        metadata: observation.metadata,
      });
      const digest = await sha256Hex(payload);
      const { error } = await supabase.from("trust_metrics").insert({
        metric_type: observation.type,
        metric_value: observation.value,
        metric_unit: observation.unit,
        computed_at: computedAt,
        signature: digest,
        observation_status: observation.observationStatus,
        metric_semantics: observation.semantics,
        evidence_count: observation.evidenceCount,
        metadata: {
          ...observation.metadata,
          integrity_marker: "sha256_digest_not_authenticity_signature",
          computed_by: "compute-trust-metrics",
          authenticated_via: auth.via,
        },
      });
      if (error) throw error;
    }

    return new Response(JSON.stringify({
      success: true,
      computed_at: computedAt,
      authenticated_via: auth.via,
      metrics: Object.fromEntries(observations.map((observation) => [observation.type, {
        value: observation.value,
        observation_status: observation.observationStatus,
        metric_semantics: observation.semantics,
        evidence_count: observation.evidenceCount,
      }])),
      caveat: "Operational observations only. Unknown evidence remains NULL. No metric is a legal, security, accuracy, integrity, or certification attestation unless its explicit semantics say otherwise.",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in compute-trust-metrics:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
