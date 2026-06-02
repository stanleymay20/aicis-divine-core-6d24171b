import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DomainStat, DomainDaily, ProviderStat, TableTotal } from "./types";

async function fetchDomainStats(): Promise<DomainStat[]> {
  const { data: nm } = await supabase
    .from("normalized_metrics")
    .select("domain, iso3, provider_name, created_at")
    .order("created_at", { ascending: false })
    .limit(50_000);

  const byDomain = new Map<string, { rows: number; countries: Set<string>; providers: Set<string>; last: string | null }>();
  (nm ?? []).forEach((r: any) => {
    const d = r.domain as string;
    if (!d) return;
    const e = byDomain.get(d) ?? { rows: 0, countries: new Set(), providers: new Set(), last: null };
    e.rows += 1;
    if (r.iso3) e.countries.add(r.iso3);
    if (r.provider_name) e.providers.add(r.provider_name);
    const ts = r.created_at as string;
    if (!e.last || ts > e.last) e.last = ts;
    byDomain.set(d, e);
  });

  return Array.from(byDomain.entries()).map(([domain, e]) => ({
    domain, rows: e.rows, countries: e.countries.size, providers: e.providers.size,
    last_write: e.last, source: "raw",
  }));
}

async function fetchDailyByDomain(): Promise<DomainDaily[]> {
  const { data } = await supabase
    .from("normalized_metrics")
    .select("domain, created_at")
    .gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
    .order("created_at", { ascending: true })
    .limit(50_000);

  const grouped = new Map<string, Map<string, number>>();
  (data ?? []).forEach((r: any) => {
    const d = r.domain as string;
    const day = (r.created_at as string).slice(0, 10);
    if (!grouped.has(d)) grouped.set(d, new Map());
    const m = grouped.get(d)!;
    m.set(day, (m.get(day) ?? 0) + 1);
  });

  return Array.from(grouped.entries()).map(([domain, m]) => ({
    domain,
    series: Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([day, n]) => ({ day, n })),
  }));
}

async function fetchProviderStats(): Promise<ProviderStat[]> {
  const { data } = await supabase
    .from("normalized_metrics")
    .select("provider_name, created_at")
    .order("created_at", { ascending: false })
    .limit(20_000);

  const m = new Map<string, { rows: number; last: string | null }>();
  (data ?? []).forEach((r: any) => {
    const p = r.provider_name as string;
    if (!p) return;
    const e = m.get(p) ?? { rows: 0, last: null };
    e.rows += 1;
    const ts = r.created_at as string;
    if (!e.last || ts > e.last) e.last = ts;
    m.set(p, e);
  });

  return Array.from(m.entries())
    .map(([provider, e]) => ({ provider, rows: e.rows, last: e.last?.slice(0, 10) ?? null }))
    .sort((a, b) => b.rows - a.rows);
}

async function fetchTableTotals(): Promise<TableTotal[]> {
  const queries: { tbl: string; label: string; href?: string; col: string }[] = [
    { tbl: "normalized_metrics",            label: "Raw normalized signals",        href: "/risk-atlas",                col: "created_at" },
    { tbl: "country_performance_snapshots", label: "Country performance snapshots", href: "/resolution",                col: "created_at" },
    { tbl: "economic_indicators",           label: "World Bank indicators",         href: "/risk-atlas?domain=economy", col: "created_at" },
    { tbl: "calibration_metrics",           label: "Forecast calibration",          href: "/learning",                  col: "computed_at" },
    { tbl: "global_signals",                label: "Real-time signals",             href: "/live",                      col: "created_at" },
    { tbl: "community_metrics",             label: "Community-reported metrics",    href: "/governance",                col: "created_at" },
  ];

  const results = await Promise.all(
    queries.map(async (q) => {
      const { count } = await supabase.from(q.tbl as any).select("*", { count: "exact", head: true });
      const { data: latest } = await supabase
        .from(q.tbl as any).select(q.col).order(q.col, { ascending: false }).limit(1).maybeSingle();
      return {
        tbl: q.tbl, label: q.label, href: q.href, rows: count ?? 0,
        last: latest ? ((latest as any)[q.col] as string).slice(0, 10) : null,
      };
    })
  );

  return results.sort((a, b) => b.rows - a.rows);
}

export const useAccumulationData = () =>
  useQuery({
    queryKey: ["accumulation-data"],
    staleTime: 60_000,
    queryFn: async () => {
      const [domains, daily, providers, tables] = await Promise.all([
        fetchDomainStats(), fetchDailyByDomain(), fetchProviderStats(), fetchTableTotals(),
      ]);
      return { domains, daily, providers, tables };
    },
  });
