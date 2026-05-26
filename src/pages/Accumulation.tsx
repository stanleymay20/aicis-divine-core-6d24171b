import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Database, TrendingUp, ArrowRight, Activity, Clock,
  Globe, Sparkles, AlertTriangle, CheckCircle2, ExternalLink,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, BarChart, Bar, Cell,
} from "recharts";
import { cn } from "@/lib/utils";
import { PanelBoundary } from "@/components/ui/panel-boundary";

/** ──────────────────────────────────────────────────────────────
 *  Types
 *  ────────────────────────────────────────────────────────────── */
interface DomainStat {
  domain: string;
  rows: number;
  countries: number;
  providers: number;
  last_write: string | null;
  source: "raw" | "snapshot";
}
interface DailyPoint { day: string; n: number; }
interface DomainDaily { domain: string; series: DailyPoint[]; }
interface ProviderStat { provider: string; rows: number; last: string | null; }
interface TableTotal { tbl: string; rows: number; last: string | null; label: string; href?: string; }

/** Plain-English label per domain + a deep-link to the page that surfaces it */
const DOMAIN_META: Record<string, { label: string; blurb: string; href: string; tone: string }> = {
  health:         { label: "Health",                blurb: "Disease, healthcare access, mortality",      href: "/risk-atlas?domain=health",         tone: "text-rose-400" },
  economy:        { label: "Economy",               blurb: "GDP, inflation, growth indicators",          href: "/risk-atlas?domain=economy",        tone: "text-amber-400" },
  finance:        { label: "Finance",               blurb: "Markets, credit, monetary stability",        href: "/risk-atlas?domain=finance",        tone: "text-yellow-400" },
  energy:         { label: "Energy",                blurb: "Power, fuel, grid load, renewables",         href: "/risk-atlas?domain=energy",         tone: "text-orange-400" },
  climate:        { label: "Climate",               blurb: "Weather extremes, emissions, temperature",   href: "/risk-atlas?domain=climate",        tone: "text-cyan-400" },
  environment:    { label: "Environment",           blurb: "Ecosystems, pollution, biodiversity",        href: "/risk-atlas?domain=environment",    tone: "text-emerald-400" },
  governance:     { label: "Governance",            blurb: "Institutions, elections, democracy index",   href: "/risk-atlas?domain=governance",     tone: "text-violet-400" },
  security:       { label: "Security",              blurb: "Conflict, crime, cyber, defence",            href: "/risk-atlas?domain=security",       tone: "text-red-400" },
  population:     { label: "Population",            blurb: "Demographics, migration, density",           href: "/risk-atlas?domain=population",     tone: "text-blue-400" },
  demographics:   { label: "Demographics",          blurb: "Age structure, urban/rural splits",          href: "/risk-atlas?domain=demographics",   tone: "text-blue-300" },
  education:      { label: "Education",             blurb: "Literacy, enrolment, expenditure",           href: "/risk-atlas?domain=education",      tone: "text-indigo-400" },
  food:           { label: "Food & Agriculture",    blurb: "Crop yields, food security, prices",         href: "/risk-atlas?domain=food",           tone: "text-lime-400" },
  infrastructure: { label: "Infrastructure",        blurb: "Roads, water, telecoms, electricity access", href: "/risk-atlas?domain=infrastructure", tone: "text-slate-300" },
  labor:          { label: "Labor",                 blurb: "Employment, wages, workforce participation", href: "/risk-atlas?domain=labor",          tone: "text-fuchsia-400" },
  trade:          { label: "Trade",                 blurb: "Imports, exports, supply chains",            href: "/risk-atlas?domain=trade",          tone: "text-pink-400" },
  technology:     { label: "Technology",            blurb: "Internet, R&D, digital adoption",            href: "/risk-atlas?domain=technology",     tone: "text-teal-400" },
};

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
  : `${n}`;

const ageHours = (iso: string | null) => {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
};

const freshnessTone = (h: number) =>
  h < 26 ? { tone: "text-success", label: "Fresh", icon: CheckCircle2 }
  : h < 72 ? { tone: "text-warning", label: "Slowing", icon: Clock }
  : { tone: "text-destructive", label: "Stale", icon: AlertTriangle };

/** ──────────────────────────────────────────────────────────────
 *  Page
 *  ────────────────────────────────────────────────────────────── */
export default function Accumulation() {
  const [domains, setDomains] = useState<DomainStat[]>([]);
  const [daily, setDaily] = useState<DomainDaily[]>([]);
  const [providers, setProviders] = useState<ProviderStat[]>([]);
  const [tables, setTables] = useState<TableTotal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [domStats, dayRows, provStats, tblTotals] = await Promise.all([
        fetchDomainStats(),
        fetchDailyByDomain(),
        fetchProviderStats(),
        fetchTableTotals(),
      ]);
      if (cancelled) return;
      setDomains(domStats);
      setDaily(dayRows);
      setProviders(provStats);
      setTables(tblTotals);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const totalRows = useMemo(
    () => tables.reduce((s, t) => s + t.rows, 0),
    [tables]
  );
  const freshDomains = domains.filter(d => ageHours(d.last_write) < 26).length;
  const totalDomains = domains.length;
  const totalCountries = useMemo(
    () => Math.max(...domains.map(d => d.countries), 0),
    [domains]
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

        {/* Header */}
        <header className="space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Live Data Accumulation</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Every signal we ingest, in plain English. Click any domain to query it.
          </p>
        </header>

        {/* Top-line numbers */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI label="Total signals" value={fmt(totalRows)} icon={Database} />
          <KPI label="Active domains" value={`${totalDomains}`} sub={`${freshDomains} fresh`} icon={Activity} />
          <KPI label="Countries covered" value={`${totalCountries}`} icon={Globe} />
          <KPI label="Live providers" value={`${providers.length}`} sub="streams" icon={TrendingUp} />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="domains" className="space-y-4">
          <TabsList>
            <TabsTrigger value="domains">By domain</TabsTrigger>
            <TabsTrigger value="providers">By source</TabsTrigger>
            <TabsTrigger value="storage">Storage breakdown</TabsTrigger>
          </TabsList>

          {/* DOMAINS */}
          <TabsContent value="domains" className="space-y-3">
            {loading ? (
              <PanelBoundary><SkeletonGrid /></PanelBoundary>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {domains
                  .slice()
                  .sort((a, b) => b.rows - a.rows)
                  .map((d) => (
                    <DomainCard
                      key={d.domain}
                      stat={d}
                      series={daily.find((x) => x.domain === d.domain)?.series ?? []}
                    />
                  ))}
              </div>
            )}
          </TabsContent>

          {/* PROVIDERS */}
          <TabsContent value="providers" className="space-y-3">
            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3">Where the data comes from</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={providers} layout="vertical" margin={{ left: 100 }}>
                    <XAxis type="number" hide />
                    <YAxis dataKey="provider" type="category" tick={{ fontSize: 11 }} width={120} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                      formatter={(v: number) => [fmt(v), "rows"]}
                    />
                    <Bar dataKey="rows" radius={[0, 4, 4, 0]}>
                      {providers.map((_, i) => (
                        <Cell key={i} fill="hsl(var(--primary))" />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {providers.map((p) => {
                  const h = ageHours(p.last);
                  const f = freshnessTone(h);
                  const Icon = f.icon;
                  return (
                    <div key={p.provider} className="flex items-center justify-between text-xs px-3 py-2 rounded-md bg-muted/30 border border-border/50">
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className={cn("h-3.5 w-3.5 shrink-0", f.tone)} />
                        <span className="font-mono truncate">{p.provider}</span>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <div className="font-semibold">{fmt(p.rows)}</div>
                        <div className="text-[10px] text-muted-foreground">{p.last ?? "—"}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </TabsContent>

          {/* STORAGE */}
          <TabsContent value="storage" className="space-y-3">
            <Card className="p-4 space-y-3">
              <h3 className="text-sm font-semibold">What's stored, and where you can use it</h3>
              <div className="space-y-2">
                {tables.map((t) => {
                  const pct = totalRows ? (t.rows / totalRows) * 100 : 0;
                  const h = ageHours(t.last);
                  const f = freshnessTone(h);
                  return (
                    <div key={t.tbl} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">{t.label}</span>
                          {t.href && (
                            <Link to={t.href} className="text-primary hover:underline inline-flex items-center gap-0.5 text-[10px]">
                              open <ExternalLink className="h-2.5 w-2.5" />
                            </Link>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={cn("text-[10px]", f.tone)}>{f.label}</span>
                          <span className="font-mono">{fmt(t.rows)}</span>
                        </div>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>
                  );
                })}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/** ──────────────────────────────────────────────────────────────
 *  Sub-components
 *  ────────────────────────────────────────────────────────────── */
function KPI({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon: React.ElementType }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-1 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}

function DomainCard({ stat, series }: { stat: DomainStat; series: DailyPoint[] }) {
  const meta = DOMAIN_META[stat.domain] ?? {
    label: stat.domain,
    blurb: "Domain data stream",
    href: `/risk-atlas?domain=${stat.domain}`,
    tone: "text-muted-foreground",
  };
  const h = ageHours(stat.last_write);
  const f = freshnessTone(h);
  const Icon = f.icon;
  const last7 = series.slice(-7).reduce((s, p) => s + p.n, 0);

  return (
    <Card className="p-4 space-y-3 hover:border-primary/40 transition-colors group">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className={cn("text-base font-semibold truncate", meta.tone)}>{meta.label}</h3>
            {stat.source === "raw" && (
              <Badge variant="outline" className="h-4 text-[9px] px-1">RAW</Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{meta.blurb}</p>
        </div>
        <div className={cn("flex items-center gap-1 text-[10px] shrink-0", f.tone)}>
          <Icon className="h-3 w-3" />
          {f.label}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-muted-foreground text-[10px]">Total</div>
          <div className="font-semibold tabular-nums">{fmt(stat.rows)}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-[10px]">Countries</div>
          <div className="font-semibold tabular-nums">{stat.countries}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-[10px]">7-day adds</div>
          <div className="font-semibold tabular-nums">{fmt(last7)}</div>
        </div>
      </div>

      {series.length > 1 && (
        <div className="h-12 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series}>
              <defs>
                <linearGradient id={`g-${stat.domain}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11, padding: "4px 8px" }}
                labelFormatter={(l) => l}
                formatter={(v: number) => [fmt(v), "added"]}
              />
              <Area
                type="monotone"
                dataKey="n"
                stroke="hsl(var(--primary))"
                strokeWidth={1.5}
                fill={`url(#g-${stat.domain})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex items-center justify-between pt-1 border-t border-border/40">
        <div className="text-[10px] text-muted-foreground">
          {stat.providers} source{stat.providers !== 1 ? "s" : ""} · last {stat.last_write ?? "—"}
        </div>
        <Button asChild variant="ghost" size="sm" className="h-6 text-[11px] gap-1 group-hover:text-primary">
          <Link to={meta.href}>
            Query <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      </div>
    </Card>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="p-4 h-40 animate-pulse bg-muted/20" />
      ))}
    </div>
  );
}

/** ──────────────────────────────────────────────────────────────
 *  Data loaders — direct supabase queries (RLS-respecting)
 *  ────────────────────────────────────────────────────────────── */
async function fetchDomainStats(): Promise<DomainStat[]> {
  // We aggregate client-side over a recent window using RPC-free queries.
  // normalized_metrics covers the broad raw layer (16 domains).
  const { data: nm } = await supabase
    .from("normalized_metrics")
    .select("domain, iso3, provider_name, created_at")
    .order("created_at", { ascending: false })
    .limit(50_000);

  const byDomain = new Map<string, { rows: number; countries: Set<string>; providers: Set<string>; last: string | null }>();
  (nm ?? []).forEach((r) => {
    const d = (r as any).domain as string;
    if (!d) return;
    const e = byDomain.get(d) ?? { rows: 0, countries: new Set(), providers: new Set(), last: null };
    e.rows += 1;
    if ((r as any).iso3) e.countries.add((r as any).iso3);
    if ((r as any).provider_name) e.providers.add((r as any).provider_name);
    const ts = (r as any).created_at as string;
    if (!e.last || ts > e.last) e.last = ts;
    byDomain.set(d, e);
  });

  return Array.from(byDomain.entries()).map(([domain, e]) => ({
    domain,
    rows: e.rows,
    countries: e.countries.size,
    providers: e.providers.size,
    last_write: e.last,
    source: "raw",
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
  (data ?? []).forEach((r) => {
    const d = (r as any).domain as string;
    const day = ((r as any).created_at as string).slice(0, 10);
    if (!grouped.has(d)) grouped.set(d, new Map());
    const m = grouped.get(d)!;
    m.set(day, (m.get(day) ?? 0) + 1);
  });

  return Array.from(grouped.entries()).map(([domain, m]) => ({
    domain,
    series: Array.from(m.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, n]) => ({ day, n })),
  }));
}

async function fetchProviderStats(): Promise<ProviderStat[]> {
  const { data } = await supabase
    .from("normalized_metrics")
    .select("provider_name, created_at")
    .order("created_at", { ascending: false })
    .limit(20_000);

  const m = new Map<string, { rows: number; last: string | null }>();
  (data ?? []).forEach((r) => {
    const p = (r as any).provider_name as string;
    if (!p) return;
    const e = m.get(p) ?? { rows: 0, last: null };
    e.rows += 1;
    const ts = (r as any).created_at as string;
    if (!e.last || ts > e.last) e.last = ts;
    m.set(p, e);
  });

  return Array.from(m.entries())
    .map(([provider, e]) => ({ provider, rows: e.rows, last: e.last?.slice(0, 10) ?? null }))
    .sort((a, b) => b.rows - a.rows);
}

async function fetchTableTotals(): Promise<TableTotal[]> {
  // Use head:true count queries — cheap, no payload.
  const queries: { tbl: string; label: string; href?: string; col: string }[] = [
    { tbl: "normalized_metrics",            label: "Raw normalized signals",        href: "/risk-atlas",            col: "created_at" },
    { tbl: "country_performance_snapshots", label: "Country performance snapshots", href: "/resolution",            col: "created_at" },
    { tbl: "economic_indicators",           label: "World Bank indicators",         href: "/risk-atlas?domain=economy", col: "created_at" },
    { tbl: "calibration_metrics",           label: "Forecast calibration",          href: "/learning",              col: "computed_at" },
    { tbl: "global_signals",                label: "Real-time signals",             href: "/live",                  col: "created_at" },
    { tbl: "community_metrics",             label: "Community-reported metrics",    href: "/governance",            col: "created_at" },
  ];

  const results = await Promise.all(
    queries.map(async (q) => {
      const { count } = await supabase.from(q.tbl as any).select("*", { count: "exact", head: true });
      const { data: latest } = await supabase
        .from(q.tbl as any)
        .select(q.col)
        .order(q.col, { ascending: false })
        .limit(1)
        .maybeSingle();
      return {
        tbl: q.tbl,
        label: q.label,
        href: q.href,
        rows: count ?? 0,
        last: latest ? ((latest as any)[q.col] as string).slice(0, 10) : null,
      };
    })
  );

  return results.sort((a, b) => b.rows - a.rows);
}
