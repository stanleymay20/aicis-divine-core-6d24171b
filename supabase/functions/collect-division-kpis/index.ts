import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const DIVISIONS = ["finance", "energy", "health", "food", "governance", "defense", "diplomacy", "crisis", "system"] as const;
type Division = typeof DIVISIONS[number];

interface KpiSnapshot {
  division: Division;
  metric: Record<string, unknown>;
  composite_score: null;
  risk_score: null;
}

const finiteNumbers = (values: unknown[]): number[] => values
  .map((value) => Number(value))
  .filter((value) => Number.isFinite(value));

const average = (values: number[]): number | null =>
  values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const baseMetric = (sourceTable: string, recordCount: number, sourceError: string | null = null) => ({
  source_table: sourceTable,
  record_count: recordCount,
  score_status: "uncalibrated",
  observation_status: sourceError ? "source_error" : recordCount > 0 ? "observed" : "no_observation",
  source_error: sourceError,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const [revenue, energy, health, food, crisis] = await Promise.all([
      supabase.from("revenue_streams").select("amount_usd")
        .gte("timestamp", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      supabase.from("energy_grid").select("stability_index, renewable_percentage")
        .order("updated_at", { ascending: false }).limit(10),
      supabase.from("health_data").select("severity_index")
        .order("updated_at", { ascending: false }).limit(10),
      supabase.from("food_security").select("yield_index")
        .order("updated_at", { ascending: false }).limit(10),
      supabase.from("crisis_events").select("id").neq("status", "resolved"),
    ]);

    const revenueValues = finiteNumbers((revenue.data ?? []).map((row) => row.amount_usd));
    const stabilityValues = finiteNumbers((energy.data ?? []).map((row) => row.stability_index));
    const renewableValues = finiteNumbers((energy.data ?? []).map((row) => row.renewable_percentage));
    const severityValues = finiteNumbers((health.data ?? []).map((row) => row.severity_index));
    const yieldValues = finiteNumbers((food.data ?? []).map((row) => row.yield_index));

    const snapshots = new Map<Division, KpiSnapshot>();
    snapshots.set("finance", {
      division: "finance",
      metric: {
        ...baseMetric("revenue_streams", revenue.data?.length ?? 0, revenue.error?.message ?? null),
        window_hours: 24,
        revenue_usd_sum: revenueValues.length > 0 ? revenueValues.reduce((sum, value) => sum + value, 0) : null,
      },
      composite_score: null,
      risk_score: null,
    });
    snapshots.set("energy", {
      division: "energy",
      metric: {
        ...baseMetric("energy_grid", energy.data?.length ?? 0, energy.error?.message ?? null),
        avg_stability_index: average(stabilityValues),
        avg_renewable_percentage: average(renewableValues),
      },
      composite_score: null,
      risk_score: null,
    });
    snapshots.set("health", {
      division: "health",
      metric: {
        ...baseMetric("health_data", health.data?.length ?? 0, health.error?.message ?? null),
        avg_severity_index: average(severityValues),
      },
      composite_score: null,
      risk_score: null,
    });
    snapshots.set("food", {
      division: "food",
      metric: {
        ...baseMetric("food_security", food.data?.length ?? 0, food.error?.message ?? null),
        avg_yield_index: average(yieldValues),
      },
      composite_score: null,
      risk_score: null,
    });
    snapshots.set("crisis", {
      division: "crisis",
      metric: {
        ...baseMetric("crisis_events", crisis.data?.length ?? 0, crisis.error?.message ?? null),
        active_crises: crisis.error ? null : crisis.data?.length ?? 0,
      },
      composite_score: null,
      risk_score: null,
    });

    for (const division of ["governance", "defense", "diplomacy", "system"] as const) {
      snapshots.set(division, {
        division,
        metric: {
          source_table: null,
          record_count: 0,
          score_status: "uncalibrated",
          observation_status: "collector_not_configured",
          note: "No calibrated division-level KPI source is configured for this collector.",
        },
        composite_score: null,
        risk_score: null,
      });
    }

    const rows = DIVISIONS.map((division) => snapshots.get(division)).filter((row): row is KpiSnapshot => Boolean(row));
    const { data: inserted, error: insertError } = await supabase.from("division_kpis").insert(rows).select();
    if (insertError) throw insertError;

    const { error: logError } = await supabase.from("system_logs").insert({
      action: "collect_division_kpis",
      result: `Collected ${rows.length} evidence-only KPI snapshots; composite and risk scores remain uncalibrated`,
      log_level: "info",
      division: "system",
    });
    if (logError) console.error("collect-division-kpis audit log failed", logError.message);

    return json({
      ok: true,
      divisions: rows.length,
      score_status: "uncalibrated",
      kpis: inserted,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("system_logs").insert({
      action: "collect_division_kpis",
      result: `Error: ${message}`,
      log_level: "error",
      division: "system",
    });
    return json({ error: message }, 500);
  }
});
