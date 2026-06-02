import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
        supabase.from("data_source_log" as any).select("status").limit(500),
      ]);
      const cur = evCur.count ?? 0;
      const prev = evPrev.count ?? 0;
      const delta = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0;
      const ackRows = alerts.data ?? [];
      const critCount = ackRows.filter(a => (a.level ?? "").toLowerCase() === "critical").length;
      const rankRows = (ranks.data ?? []) as any[];
      const scores = rankRows.map((r: any) => Math.round((r.risk_probability ?? 0) * 100));
      const avgRisk = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : 0;
      const countriesAtRisk = new Set(
        rankRows.filter((r: any) => (r.risk_probability ?? 0) >= 0.75).map((r: any) => r.country_iso3)
      ).size;
      const sourceRows = (sources.data as any[]) ?? [];
      const total = sourceRows.length;
      const online = sourceRows.filter(s => {
        const st = (s.status ?? "").toLowerCase();
        return st === "active" || st === "online" || st === "success";
      }).length;
      return {
        events6h: cur, eventsDelta: delta,
        activeAlerts: ackRows.length, criticalAlerts: critCount,
        systemicThreats: scores.filter(v => v >= 75).length,
        globalRisk: Math.min(100, avgRisk),
        confidence: 76,
        countriesAtRisk,
        sourcesTotal: total, sourcesOnline: online,
      };
    },
  });

export const useTrendSeries = () =>
  useQuery({
    queryKey: ["analyst-trend-24h"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data } = await supabase
        .from("normalized_events")
        .select("occurred_at,category,severity")
        .gte("occurred_at", since)
        .limit(2000);
      const buckets: Record<string, any> = {};
      (data ?? []).forEach((r: any) => {
        const h = new Date(r.occurred_at);
        h.setMinutes(0, 0, 0);
        const k = h.toISOString();
        const cat = (r.category ?? "other").toLowerCase();
        const slot = (buckets[k] ||= { t: k, geopolitical: 0, cyber: 0, economic: 0, environmental: 0, global: 0 });
        slot.global += 1;
        if (slot[cat] != null) slot[cat] += 1;
      });
      return Object.values(buckets).sort((a: any, b: any) => a.t.localeCompare(b.t)).map((r: any) => ({
        ...r, hh: new Date(r.t).getUTCHours().toString().padStart(2, "0") + ":00",
      }));
    },
  });

export const useThreatMatrix = () =>
  useQuery({
    queryKey: ["analyst-threat-matrix"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("critical_alerts")
        .select("severity,level")
        .order("triggered_at", { ascending: false })
        .limit(500);
      const buckets: Record<string, Record<string, number>> = {
        Critical: { Low: 0, Medium: 0, High: 0, Critical: 0 },
        High: { Low: 0, Medium: 0, High: 0, Critical: 0 },
        Elevated: { Low: 0, Medium: 0, High: 0, Critical: 0 },
        Medium: { Low: 0, Medium: 0, High: 0, Critical: 0 },
        Low: { Low: 0, Medium: 0, High: 0, Critical: 0 },
      };
      (data ?? []).forEach((r: any) => {
        const sev = Number(r.severity ?? 0);
        const sevRow = sev >= 9 ? "Critical" : sev >= 7 ? "High" : sev >= 5 ? "Elevated" : sev >= 3 ? "Medium" : "Low";
        const lvl = (r.level ?? "low") as string;
        const lik = lvl === "critical" ? "Critical" : lvl === "high" ? "High" : lvl === "elevated" ? "Medium" : "Low";
        buckets[sevRow][lik] += 1;
      });
      return buckets;
    },
  });

export const useTopThreats = () =>
  useQuery({
    queryKey: ["analyst-top-threats"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("risk_ranking_predictions")
        .select("country_iso3,domain,risk_probability,factors,evidence_count,generated_at")
        .order("risk_probability", { ascending: false })
        .limit(5);
      return (data ?? []).map((r: any) => ({
        country_iso3: r.country_iso3,
        domain: r.domain,
        risk_score: Math.round((r.risk_probability ?? 0) * 100),
        confidence_score: Number(r.factors?.confidence_score ?? 0) / 100,
        evidence_count: r.evidence_count ?? 0,
      }));
    },
  });
