import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Bootstrap training data from forecast_validation_results.
 * Uses proxy labeling: if AICIS correctly predicted a direction change,
 * an action aligned with that signal would likely have succeeded.
 */
serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Check existing training data count
    const { count: existingCount } = await supabase
      .from("decision_training_dataset")
      .select("*", { count: "exact", head: true });

    if ((existingCount || 0) > 500) {
      return new Response(JSON.stringify({
        ok: true,
        message: "Training dataset already has sufficient samples",
        count: existingCount,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Pull validated forecasts with direction changes (non-stable)
    const { data: validations, error: vErr } = await supabase
      .from("forecast_validation_results")
      .select("iso3, domain, actual_direction, predicted_direction, direction_hit, absolute_error, predicted_value, actual_value, realized_date")
      .neq("actual_direction", "stable")
      .order("realized_date", { ascending: false })
      .limit(1000);

    if (vErr) throw vErr;
    if (!validations || validations.length === 0) {
      return new Response(JSON.stringify({
        ok: true, message: "No validation data to bootstrap from", count: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Pull corresponding snapshots for feature context (by iso3+domain)
    const uniqueIso3s = [...new Set(validations.map(v => v.iso3))];
    const uniqueDomains = [...new Set(validations.map(v => v.domain))];

    // Build date range for time-windowed context
    const dates = validations.map(v => new Date(v.realized_date));
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())) - 30 * 86400000).toISOString();
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())) + 30 * 86400000).toISOString();

    const [snapshotsRes, anomaliesRes, alertsRes, crisesRes] = await Promise.all([
      supabase
        .from("country_performance_snapshots")
        .select("iso3, domain, performance_index, momentum_score, risk_pressure_score, systemic_fragility_score, confidence_score, structural_break_count, forecast_stability_score, snapshot_date")
        .in("iso3", uniqueIso3s)
        .in("domain", uniqueDomains)
        .limit(2000),
      supabase
        .from("anomaly_detections")
        .select("division, severity, created_at")
        .gte("created_at", minDate)
        .lte("created_at", maxDate)
        .limit(1000),
      supabase
        .from("critical_alerts")
        .select("country, severity, iso3, triggered_at")
        .gte("triggered_at", minDate)
        .lte("triggered_at", maxDate)
        .limit(1000),
      supabase
        .from("crisis_events")
        .select("region, severity, opened_at")
        .gte("opened_at", minDate)
        .lte("opened_at", maxDate)
        .limit(500),
    ]);

    const snapshotMap = new Map<string, any>();
    (snapshotsRes.data || []).forEach(s => {
      snapshotMap.set(`${s.iso3}-${s.domain}`, s);
    });

    // Build time-windowed context maps per iso3+domain
    const anomalies = anomaliesRes.data || [];
    const alerts = alertsRes.data || [];
    const crises = crisesRes.data || [];

    function countInWindow(items: any[], dateField: string, centerDate: string, windowDays: number, filterFn?: (item: any) => boolean): number {
      const center = new Date(centerDate).getTime();
      const halfWindow = windowDays * 86400000 / 2;
      return items.filter(item => {
        const t = new Date(item[dateField]).getTime();
        return Math.abs(t - center) <= halfWindow && (!filterFn || filterFn(item));
      }).length;
    }

    function avgSeverityInWindow(items: any[], dateField: string, centerDate: string, windowDays: number): number {
      const center = new Date(centerDate).getTime();
      const halfWindow = windowDays * 86400000 / 2;
      const matched = items.filter(item => {
        const t = new Date(item[dateField]).getTime();
        return Math.abs(t - center) <= halfWindow;
      });
      if (matched.length === 0) return 0;
      return matched.reduce((s, c) => s + (c.severity || 0), 0) / matched.length;
    }

    // Generate proxy training samples
    const actionMap: Record<string, string> = {
      security: "deploy_resources",
      health: "public_health_response",
      finance: "financial_stabilization",
      energy: "infrastructure_hardening",
      food: "supply_chain_intervention",
      governance: "governance_reform",
    };

    const CONTEXT_WINDOW_DAYS = 60;

    const trainingRows = validations.map(v => {
      const snap = snapshotMap.get(`${v.iso3}-${v.domain}`);
      
      // Time-windowed, geography-specific context
      const localAnomalyCount = countInWindow(anomalies, "created_at", v.realized_date, CONTEXT_WINDOW_DAYS, 
        (a) => a.division === v.domain);
      const localAlertCount = countInWindow(alerts, "triggered_at", v.realized_date, CONTEXT_WINDOW_DAYS,
        (a) => a.iso3 === v.iso3 || a.country === v.iso3);
      const localCrisisSeverity = avgSeverityInWindow(crises, "opened_at", v.realized_date, CONTEXT_WINDOW_DAYS);

      const features = snap ? {
        performance_index: snap.performance_index || 50,
        momentum_score: snap.momentum_score || 0,
        risk_pressure_score: snap.risk_pressure_score || 0,
        systemic_fragility_score: snap.systemic_fragility_score || 0,
        confidence_score: snap.confidence_score || 50,
        structural_break_count: snap.structural_break_count || 0,
        forecast_stability_score: snap.forecast_stability_score || 50,
        anomaly_count: localAnomalyCount,
        alert_count: Math.min(localAlertCount, 15),
        crisis_severity_avg: localCrisisSeverity,
      } : {
        performance_index: 50, momentum_score: 0, risk_pressure_score: 30,
        systemic_fragility_score: 30, confidence_score: 50,
        structural_break_count: 0, forecast_stability_score: 50,
        anomaly_count: localAnomalyCount, alert_count: Math.min(localAlertCount, 15),
        crisis_severity_avg: localCrisisSeverity,
      };

      // Proxy label logic
      const directionCorrect = !!v.direction_hit;
      const errorSmall = (v.absolute_error || 999) < 5;
      const outcomeSuccess = directionCorrect && errorSmall;

      // Label confidence: based on forecast quality and signal density
      const hasSnapshot = !!snap;
      const errorQuality = errorSmall ? 0.3 : 0.1;
      const dirQuality = directionCorrect ? 0.3 : 0.0;
      const contextQuality = hasSnapshot ? 0.2 : 0.05;
      const signalDensity = (localAnomalyCount > 0 ? 0.1 : 0) + (localAlertCount > 0 ? 0.05 : 0) + (localCrisisSeverity > 0 ? 0.05 : 0);
      const labelConfidence = Math.min(0.95, errorQuality + dirQuality + contextQuality + signalDensity);

      // Proxy reason
      const reasons: string[] = [];
      if (directionCorrect) reasons.push("direction_hit");
      if (errorSmall) reasons.push(`error<5 (${(v.absolute_error || 0).toFixed(2)})`);
      if (hasSnapshot) reasons.push("snapshot_context_available");
      if (!directionCorrect) reasons.push("direction_miss");

      // Impact estimate from change magnitude
      const changeMagnitude = Math.abs((v.actual_value || 0) - (v.predicted_value || 0));
      const impactScore = Math.min(100, changeMagnitude * 10);

      return {
        iso3: v.iso3,
        domain: v.domain,
        features,
        action_type: actionMap[v.domain] || "escalate_monitoring",
        outcome_success: outcomeSuccess,
        impact_score: impactScore,
        source_type: "proxy",
        label_source: "proxy",
        label_confidence: Math.round(labelConfidence * 100) / 100,
        proxy_reason: reasons.join("; "),
        overridden_by_real: false,
        context_window_days: CONTEXT_WINDOW_DAYS,
      };
    });

    // Batch insert
    const batchSize = 100;
    let inserted = 0;
    for (let i = 0; i < trainingRows.length; i += batchSize) {
      const batch = trainingRows.slice(i, i + batchSize);
      const { error: insertErr } = await supabase
        .from("decision_training_dataset")
        .insert(batch);
      if (!insertErr) inserted += batch.length;
    }

    // Seed initial model weights if no active model exists
    const { data: existingModel } = await supabase
      .from("decision_models")
      .select("id")
      .eq("status", "active")
      .maybeSingle();

    if (!existingModel) {
      const proxyCount = trainingRows.filter(r => r.label_source === "proxy").length;
      await supabase.from("decision_models").insert({
        version: "DL-proxy-0.1",
        model_type: "weighted_scoring",
        feature_schema: { features: Object.keys(trainingRows[0]?.features || {}) },
        feature_weights: {
          performance_index: -0.15,
          momentum_score: -0.10,
          risk_pressure_score: 0.25,
          systemic_fragility_score: 0.20,
          confidence_score: 0.05,
          structural_break_count: 0.10,
          anomaly_count: 0.10,
          alert_count: 0.10,
          crisis_severity_avg: 0.10,
          forecast_stability_score: -0.05,
        },
        action_policies: {
          act_threshold: 0.75,
          consider_threshold: 0.50,
          min_impact: 40,
        },
        performance_metrics: null,
        training_sample_count: inserted,
        training_mode: "proxy",
        proxy_sample_count: proxyCount,
        real_sample_count: 0,
        measured_sample_count: 0,
        status: "active",
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      message: `Bootstrapped ${inserted} proxy training samples from ${validations.length} validated forecasts`,
      inserted,
      total_validations: validations.length,
      proxy_success_rate: Math.round(trainingRows.filter(r => r.outcome_success).length / trainingRows.length * 100),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Bootstrap training error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
