import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, errorResponse, jsonResponse } from "../_shared/resilience.ts";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "generate-alerts";

interface AlertCandidate {
  severity: "critical" | "high" | "medium";
  title: string;
  message: string;
  division: string;
  country: string;
  metadata: Record<string, unknown>;
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "POST" },
    });
  }

  const { response: authResponse } = await requireAdminOrCron(req);
  if (authResponse) return authResponse;

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    structuredLog("info", FN, "Scanning for critical conditions");

    const alerts: AlertCandidate[] = [];

    const [foodData, healthData, energyData, crisisData, vulnerabilityData] = await Promise.all([
      resilientCall(`${FN}:food`, () => supabase.from("food_security").select("*").eq("alert_level", "critical").order("updated_at", { ascending: false }).limit(10).then((result) => result.data || []), { maxRetries: 1 }),
      resilientCall(`${FN}:health`, () => supabase.from("health_data").select("*").eq("risk_level", "critical").order("updated_at", { ascending: false }).limit(10).then((result) => result.data || []), { maxRetries: 1 }),
      resilientCall(`${FN}:energy`, () => supabase.from("energy_grid").select("*").eq("outage_risk", "risk").order("updated_at", { ascending: false }).limit(10).then((result) => result.data || []), { maxRetries: 1 }),
      resilientCall(`${FN}:crisis`, () => supabase.from("crisis_events").select("*").eq("status", "monitoring").gte("severity", 7).order("opened_at", { ascending: false }).limit(10).then((result) => result.data || []), { maxRetries: 1 }),
      resilientCall(`${FN}:vuln`, () => supabase.from("vulnerability_scores").select("*").gte("overall_score", 75).order("overall_score", { ascending: false }).limit(10).then((result) => result.data || []), { maxRetries: 1 }),
    ]);

    for (const food of foodData) {
      alerts.push({
        severity: "critical",
        title: `Critical Food Shortage: ${food.region}`,
        message: `${food.crop} supply critically low with ${food.supply_days} days remaining.`,
        division: "food",
        country: String(food.region ?? "Unknown"),
        metadata: { source: "food_security", record_id: food.id },
      });
    }

    for (const health of healthData) {
      alerts.push({
        severity: "critical",
        title: `Health Crisis: ${health.region}`,
        message: `${health.disease} outbreak with severity ${health.severity_index}. Affected: ${health.affected_count}.`,
        division: "health",
        country: String(health.region ?? "Unknown"),
        metadata: { source: "health_data", record_id: health.id },
      });
    }

    for (const energy of energyData) {
      alerts.push({
        severity: "high",
        title: `Grid Instability: ${energy.region}`,
        message: `Power grid at ${energy.grid_load}% capacity with ${energy.stability_index}% stability.`,
        division: "energy",
        country: String(energy.region ?? "Unknown"),
        metadata: { source: "energy_grid", record_id: energy.id },
      });
    }

    for (const crisis of crisisData) {
      alerts.push({
        severity: Number(crisis.severity ?? 0) >= 9 ? "critical" : "high",
        title: `${crisis.kind}: ${crisis.region}`,
        message: String(crisis.details_md || `Severity ${crisis.severity} event.`),
        division: "crisis",
        country: String(crisis.region ?? "Unknown"),
        metadata: { source: "crisis_events", record_id: crisis.id },
      });
    }

    for (const vulnerability of vulnerabilityData) {
      alerts.push({
        severity: Number(vulnerability.overall_score ?? 0) >= 85 ? "high" : "medium",
        title: `High Vulnerability: ${vulnerability.country}`,
        message: `Vulnerability index ${vulnerability.overall_score}. Health: ${vulnerability.health_risk}, Food: ${vulnerability.food_risk}, Energy: ${vulnerability.energy_risk}.`,
        division: "intelligence",
        country: String(vulnerability.country ?? "Unknown"),
        metadata: { source: "vulnerability_scores", record_id: vulnerability.id },
      });
    }

    let inserted = 0;
    for (const alert of alerts) {
      const { data: existing } = await supabase
        .from("alerts")
        .select("id")
        .eq("title", alert.title)
        .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .limit(1);

      if (!existing || existing.length === 0) {
        const { error } = await supabase.from("alerts").insert(alert);
        if (!error) inserted += 1;
      }
    }

    await supabase.from("system_logs").insert({
      division: "intelligence",
      action: "generate_alerts",
      result: "success",
      log_level: "info",
      metadata: { alerts_generated: inserted, conditions_scanned: alerts.length },
    });

    structuredLog("info", FN, `Generated ${inserted} alerts`, undefined, start);
    return jsonResponse({ success: true, alerts_generated: inserted, total_conditions: alerts.length });
  } catch (error) {
    structuredLog("error", FN, error instanceof Error ? error.message : String(error), undefined, start);
    return errorResponse(error);
  }
});
