import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type RiskRankRow = {
  risk_probability: number | null;
  country_iso3: string | null;
};

type SourceStatusRow = {
  status: string | null;
};

type TrendRow = {
  occurred_at: string;
  category: string | null;
  severity: number | null;
};

type TrendBucket = {
  t: string;
  geopolitical: number;
  cyber: number;
  economic: number;
  environmental: number;
  global: number;
};

type ThreatRow = {
  severity: number | null;
  level: string | null;
};

type TopThreatRow = {
  country_iso3: string;
  domain: string;
  risk_probability: number | null;
  factors: unknown;
  generated_at: string;
};

const confidenceFromFactors = (factors: unknown): number | null => {
  if (!factors || typeof factors !== "object" || Array.isArray(factors)) return null;
  const value = (factors as Record<string, unknown>).confidence_score;
  return typeof value === "number" && Number.isFinite(value) ? value / 100 : null;
};

export const useAnalystKpis = () =>
  useQuery({
    queryKey: ["analyst-kpis"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const since6h = new Date(Date.now() - 6 * 3600_000).toISOString();
      const sincePrev = new Date(Date.now() - 12 * 3600_000).toISOString();
      const [evCur, evPrev, alerts, ranks, sources] = await Promise.all([
        supabase.from("normalized_events").select("severity", { count: "exact", head: true }).gte("occurred_at", since6h),
        supabase.from("normalized_events").select("severity", { count: "exact", head: true }).gte("occurred_at", sincePrev).lt("occurred_at", since6h),
        supabase.from("critical_alerts").select("level,severity").eq("acknowledged", false).order("triggered_at", { ascending: false }).limit(200),
        supabase.from("risk_ranking_predictions").select("risk_probability,country_iso3").order("risk_probability", { ascending: false }).limit(200),
        supabase.from("data_source_log" as never).select("status").limit(500),
      ]);

      const cur = evCur.count ?? 0;
      const prev = evPrev.count ?? 0;
      const delta = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0;
      const ackRows = alerts.data ?? [];
      const critCount = ackRows.filter((row) => (row.level ?? "").toLowerCase() === "critical").length;

      const rankRows = (ranks.data ?? []) as unknown as RiskRankRow[];
      const scores = rankRows
        .filter((row) => typeof row.risk_probability === "number")
        .map((row) => Math.round((row.risk_probability ?? 0) * 100));
      const avgRisk = scores.length
        ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
        : null;
      const countriesAtRisk = new Set(
        rankRows
          .filter((row) => (row.risk_probability ?? 0) >= 0.75 && row.country_iso3)
          .map((row) => row.country_iso3 as string),
      ).size;

      const sourceRows = (sources.data ?? []) as unknown as SourceStatusRow[];
      const total = sourceRows.length;
      const online = sourceRows.filter((row) => {
        const status = (row.status ?? "").toLowerCase();
        return status === "active" || status === "online" || status === "success";
      }).length;

      return {
        events6h: cur,
        eventsDelta: delta,
        activeAlerts: ackRows.length,
        criticalAlerts: critCount,
        systemicThreats: scores.filter((value) => value >= 75).length,
        globalRisk: avgRisk == null ? null : Math.min(100, avgRisk),
        confidence: null as number | null,
        countriesAtRisk,
        sourcesTotal: total,
        sourcesOnline: online,
      };
    },
  });

export const useTrendSeries = () =>
  useQuery({
    queryKey: ["analyst-trend-24h"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data, error } = await supabase
        .from("normalized_events")
        .select("occurred_at,category,severity")
        .gte("occurred_at", since)
        .limit(2000);
      if (error) throw error;

      const buckets: Record<string, TrendBucket> = {};
      for (const row of (data ?? []) as unknown as TrendRow[]) {
        const hour = new Date(row.occurred_at);
        hour.setMinutes(0, 0, 0);
        const key = hour.toISOString();
        const slot = buckets[key] ??= {
          t: key,
          geopolitical: 0,
          cyber: 0,
          economic: 0,
          environmental: 0,
          global: 0,
        };
        slot.global += 1;
        switch ((row.category ?? "").toLowerCase()) {
          case "geopolitical": slot.geopolitical += 1; break;
          case "cyber": slot.cyber += 1; break;
          case "economic": slot.economic += 1; break;
          case "environmental": slot.environmental += 1; break;
          default: break;
        }
      }

      return Object.values(buckets)
        .sort((left, right) => left.t.localeCompare(right.t))
        .map((row) => ({
          ...row,
          hh: new Date(row.t).getUTCHours().toString().padStart(2, "0") + ":00",
        }));
    },
  });

export const useThreatMatrix = () =>
  useQuery({
    queryKey: ["analyst-threat-matrix"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("critical_alerts")
        .select("severity,level")
        .order("triggered_at", { ascending: false })
        .limit(500);
      if (error) throw error;

      const buckets: Record<string, Record<string, number>> = {
        Critical: { Low: 0, Medium: 0, High: 0, Critical: 0 },
        High: { Low: 0, Medium: 0, High: 0, Critical: 0 },
        Elevated: { Low: 0, Medium: 0, High: 0, Critical: 0 },
        Medium: { Low: 0, Medium: 0, High: 0, Critical: 0 },
        Low: { Low: 0, Medium: 0, High: 0, Critical: 0 },
      };

      for (const row of (data ?? []) as unknown as ThreatRow[]) {
        const severity = Number(row.severity ?? 0);
        const severityRow = severity >= 9
          ? "Critical"
          : severity >= 7
            ? "High"
            : severity >= 5
              ? "Elevated"
              : severity >= 3
                ? "Medium"
                : "Low";
        const level = (row.level ?? "low").toLowerCase();
        const likelihood = level === "critical"
          ? "Critical"
          : level === "high"
            ? "High"
            : level === "elevated"
              ? "Medium"
              : "Low";
        buckets[severityRow][likelihood] += 1;
      }
      return buckets;
    },
  });

export const useTopThreats = () =>
  useQuery({
    queryKey: ["analyst-top-threats"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("risk_ranking_predictions")
        .select("country_iso3,domain,risk_probability,factors,generated_at")
        .order("risk_probability", { ascending: false })
        .limit(5);
      if (error) throw error;

      return ((data ?? []) as unknown as TopThreatRow[]).map((row) => ({
        country_iso3: row.country_iso3,
        domain: row.domain,
        risk_score: Math.round((row.risk_probability ?? 0) * 100),
        confidence_score: confidenceFromFactors(row.factors),
        evidence_count: null as number | null,
      }));
    },
  });
