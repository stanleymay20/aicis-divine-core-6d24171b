import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MapQuery, getContinentISOs } from "./queryParser";

export interface CountryRiskRow {
  iso3: string;
  domain: string;
  risk: number;
  momentum: number;
  direction: string;
  confidence: number;
}

export interface SignalRow {
  id: string;
  title: string;
  category: string;
  impact_score: number;
  confidence_score: number;
  affected_countries: string[] | null;
  recommended_actions: any;
  created_at: string;
}

/** Fetch country-level domain scores filtered by query */
export function useCountryRiskData(query: MapQuery) {
  return useQuery({
    queryKey: ["atlas-country-risk", query.geography, query.domains.join(","), query.threshold, query.trend],
    queryFn: async (): Promise<CountryRiskRow[]> => {
      let q = supabase
        .from("country_performance_snapshots")
        .select("iso3, domain, risk_pressure_score, momentum_score, forecast_direction, confidence_score")
        .order("risk_pressure_score", { ascending: false })
        .limit(1000);

      // Filter by domain
      if (query.domains.length > 0) {
        q = q.in("domain", query.domains);
      }

      const { data } = await q;
      if (!data?.length) return [];

      let rows: CountryRiskRow[] = data.map((r: any) => ({
        iso3: r.iso3,
        domain: r.domain,
        risk: r.risk_pressure_score,
        momentum: r.momentum_score,
        direction: r.forecast_direction,
        confidence: r.confidence_score,
      }));

      // Filter by continent/geography
      if (query.scope === "continent" && query.geography) {
        const isos = getContinentISOs(query.geography);
        rows = rows.filter(r => isos.includes(r.iso3));
      } else if (query.scope === "country" && query.geography && !query.comparison) {
        rows = rows.filter(r => r.iso3 === query.geography);
      }

      // Filter by comparison
      if (query.comparison) {
        rows = rows.filter(r => r.iso3 === query.comparison!.a || r.iso3 === query.comparison!.b);
      }

      // Filter by threshold
      if (query.threshold !== null) {
        rows = rows.filter(r => r.risk >= query.threshold!);
      }

      // Filter by trend
      if (query.trend === "rising") {
        rows = rows.filter(r => r.direction === "up");
      } else if (query.trend === "falling") {
        rows = rows.filter(r => r.direction === "down");
      }

      return rows;
    },
    staleTime: 30_000,
  });
}

/** Aggregate rows by country for map rendering */
export function aggregateByCountry(rows: CountryRiskRow[]): Record<string, {
  iso3: string;
  avgRisk: number;
  maxRisk: number;
  domains: number;
  direction: string;
  domainBreakdown: { domain: string; risk: number; direction: string }[];
}> {
  const agg: Record<string, {
    iso3: string;
    totalRisk: number;
    maxRisk: number;
    count: number;
    directions: string[];
    domainBreakdown: { domain: string; risk: number; direction: string }[];
  }> = {};

  for (const r of rows) {
    if (!agg[r.iso3]) {
      agg[r.iso3] = { iso3: r.iso3, totalRisk: 0, maxRisk: 0, count: 0, directions: [], domainBreakdown: [] };
    }
    agg[r.iso3].totalRisk += r.risk;
    agg[r.iso3].maxRisk = Math.max(agg[r.iso3].maxRisk, r.risk);
    agg[r.iso3].count += 1;
    agg[r.iso3].directions.push(r.direction);
    agg[r.iso3].domainBreakdown.push({ domain: r.domain, risk: r.risk, direction: r.direction });
  }

  const result: Record<string, any> = {};
  for (const [iso, v] of Object.entries(agg)) {
    const upCount = v.directions.filter(d => d === "up").length;
    const downCount = v.directions.filter(d => d === "down").length;
    result[iso] = {
      iso3: v.iso3,
      avgRisk: v.totalRisk / v.count,
      maxRisk: v.maxRisk,
      domains: v.count,
      direction: upCount > downCount ? "up" : downCount > upCount ? "down" : "stable",
      domainBreakdown: v.domainBreakdown.sort((a: any, b: any) => b.risk - a.risk),
    };
  }
  return result;
}

/** Fetch related signals for a geography */
export function useRelatedSignals(iso3: string | null, domains: string[]) {
  return useQuery({
    queryKey: ["atlas-signals", iso3, domains.join(",")],
    queryFn: async (): Promise<SignalRow[]> => {
      let q = supabase
        .from("global_signals")
        .select("id, title, category, impact_score, confidence_score, affected_countries, recommended_actions, created_at")
        .order("created_at", { ascending: false })
        .limit(20);

      if (domains.length > 0) {
        // Don't filter by category enum — just fetch all and filter client-side
      }

      const { data } = await q;
      if (!data?.length) return [];

      let signals = data as unknown as SignalRow[];
      if (iso3) {
        const filtered = signals.filter(s =>
          s.affected_countries && Array.isArray(s.affected_countries) && s.affected_countries.includes(iso3)
        );
        if (filtered.length > 0) return filtered.slice(0, 10);
      }
      return signals.slice(0, 10);
    },
    staleTime: 30_000,
    enabled: true,
  });
}

/** Fetch region data for a specific country */
export function useCountryRegions(iso3: string | null) {
  return useQuery({
    queryKey: ["atlas-regions", iso3],
    queryFn: async () => {
      if (!iso3) return [];
      const { data } = await supabase
        .from("admin_regions")
        .select("id, name, admin_level, lat, lon, population_est, urban_rural")
        .eq("country_iso3", iso3)
        .not("lat", "is", null)
        .in("admin_level", [1, 2])
        .limit(200);
      return data || [];
    },
    enabled: !!iso3,
    staleTime: 60_000,
  });
}
