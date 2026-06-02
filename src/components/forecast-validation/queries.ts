import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SummaryStats, DomainRow, HorizonRow, ModelRow, DomainPolicy, HealthAlert } from "./atoms";

export interface ForecastValidationBundle {
  stats: SummaryStats | null;
  domains: DomainRow[];
  horizons: HorizonRow[];
  models: ModelRow[];
  readiness: any;
  accumulation: any;
  matchQuality: any;
  coverageGaps: any;
  snapshots: any[];
  policies: DomainPolicy[];
  health: { ok: boolean; alerts: HealthAlert[] } | null;
}

async function loadHealth(): Promise<{ ok: boolean; alerts: HealthAlert[] } | null> {
  try {
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const resp = await fetch(`https://${projectId}.supabase.co/functions/v1/prospective-lifecycle-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
      body: JSON.stringify({ action: "health_check" }),
    });
    if (resp.ok) { const data = await resp.json(); if (data.health) return data.health; }
  } catch { /* optional */ }
  return null;
}

export const useForecastValidation = () =>
  useQuery<ForecastValidationBundle>({
    queryKey: ["forecast-validation"],
    staleTime: 30_000,
    queryFn: async () => {
      const [statsRes, domainsRes, horizonsRes, modelsRes, readinessRes, accumRes, matchRes, gapsRes, snapshotsRes, policiesRes, health] = await Promise.all([
        supabase.rpc("prospective_summary_stats"),
        supabase.rpc("prospective_domain_breakdown"),
        supabase.rpc("prospective_horizon_breakdown"),
        supabase.rpc("prospective_model_breakdown"),
        supabase.rpc("evaluate_forecast_readiness"),
        supabase.rpc("prospective_accumulation_monitor"),
        supabase.rpc("audit_prospective_match_quality"),
        supabase.rpc("prospective_coverage_gaps"),
        supabase.from("forecast_prospective_health_snapshots").select("*").order("snapshot_date", { ascending: false }).limit(30),
        supabase.from("forecast_domain_match_policies").select("*").order("domain"),
        loadHealth(),
      ]);
      return {
        stats: (statsRes.data as unknown as SummaryStats) ?? null,
        domains: (domainsRes.data as unknown as DomainRow[]) ?? [],
        horizons: (horizonsRes.data as unknown as HorizonRow[]) ?? [],
        models: (modelsRes.data as unknown as ModelRow[]) ?? [],
        readiness: readinessRes.data ?? null,
        accumulation: accumRes.data ?? null,
        matchQuality: matchRes.data ?? null,
        coverageGaps: gapsRes.data ?? null,
        snapshots: snapshotsRes.data ?? [],
        policies: (policiesRes.data as unknown as DomainPolicy[]) ?? [],
        health,
      };
    },
  });

export async function runLifecycleTest() {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const resp = await fetch(`https://${projectId}.supabase.co/functions/v1/prospective-lifecycle-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
    body: JSON.stringify({ action: "lifecycle_test" }),
  });
  return resp.json();
}

export async function takeSnapshot() {
  return supabase.rpc("snapshot_prospective_health");
}
