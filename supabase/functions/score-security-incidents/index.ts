import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type IncidentRow = {
  id: string;
  source: string;
  title: string;
  event_type: string | null;
  severity: number | null;
  killed: number | null;
  injured: number | null;
  displaced: number | null;
  iso3: string | null;
  country: string | null;
  raw: Record<string, unknown> | null;
};

const finiteNonNegative = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

function calculateSeverity(incident: IncidentRow): number {
  const existing = finiteNonNegative(incident.severity);
  if (existing > 0) return Math.min(100, existing);

  const killed = finiteNonNegative(incident.killed);
  const injured = finiteNonNegative(incident.injured);
  const displaced = finiteNonNegative(incident.displaced);

  const fatalityComponent = Math.min(60, Math.log10(killed + 1) * 30);
  const injuryComponent = Math.min(25, Math.log10(injured + 1) * 12.5);
  const displacementComponent = Math.min(15, Math.log10(displaced + 1) * 5);

  return Math.min(100, fatalityComponent + injuryComponent + displacementComponent);
}

function alertLevel(severity: number): "urgent" | "high" | "medium" | "low" | null {
  if (severity >= 80) return "urgent";
  if (severity >= 60) return "high";
  if (severity >= 40) return "medium";
  if (severity >= 20) return "low";
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error: fetchError } = await supabase
      .from("security_incidents")
      .select("id,source,title,event_type,severity,killed,injured,displaced,iso3,country,raw")
      .in("source", ["acled", "ucdp"])
      .gte("created_at", since)
      .limit(2000);

    if (fetchError) throw fetchError;

    let scored = 0;
    let alerted = 0;
    let unchanged = 0;

    for (const incident of (data ?? []) as IncidentRow[]) {
      const severity = calculateSeverity(incident);
      const priorSeverity = incident.severity == null ? null : Number(incident.severity);
      const scoringMetadata = {
        ...(incident.raw ?? {}),
        severity_method: priorSeverity != null && Number.isFinite(priorSeverity) && priorSeverity > 0
          ? "event_provider_normalized"
          : "event_grade_casualty_v1",
        severity_scored_at: new Date().toISOString(),
      };

      if (priorSeverity == null || Math.abs(priorSeverity - severity) > 0.001) {
        const { error: updateError } = await supabase
          .from("security_incidents")
          .update({ severity, raw: scoringMetadata })
          .eq("id", incident.id);
        if (updateError) throw updateError;
        scored += 1;
      } else {
        unchanged += 1;
      }

      const level = alertLevel(severity);
      if (!level) continue;

      const { data: existingAlert, error: alertLookupError } = await supabase
        .from("critical_alerts")
        .select("id")
        .eq("incident_id", incident.id)
        .limit(1)
        .maybeSingle();
      if (alertLookupError) throw alertLookupError;
      if (existingAlert) continue;

      const { error: alertError } = await supabase.from("critical_alerts").insert({
        level,
        headline: incident.title,
        incident_id: incident.id,
        iso3: incident.iso3,
        country: incident.country,
        event_type: incident.event_type,
        severity,
        meta: {
          source: incident.source,
          killed: incident.killed,
          injured: incident.injured,
          displaced: incident.displaced,
          severity_method: scoringMetadata.severity_method,
          analytical_alert: true,
        },
      });

      if (!alertError) alerted += 1;
    }

    await supabase.from("automation_logs").insert({
      job_name: "score-security-incidents",
      status: "success",
      message: `Event-grade scoring complete: scored=${scored}, unchanged=${unchanged}, alerts=${alerted}`,
    });

    return new Response(JSON.stringify({
      ok: true,
      scoring_policy: "event_evidence_only",
      scored,
      unchanged,
      alerted,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("score-security-incidents error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
