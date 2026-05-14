import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe2, RadioTower, Route, ShieldAlert } from "lucide-react";

type MapSignal = {
  title?: string | null;
  category?: string | null;
  impact_score?: number | null;
  urgency_score?: number | null;
  affected_countries?: string[] | null;
  created_at?: string | null;
  ingested_at?: string | null;
};

type CausalEvent = {
  source_event?: string | null;
  source_domain?: string | null;
  impacted_system?: string | null;
  impact_probability?: number | null;
  impact_severity?: number | null;
  projected_time_window?: string | null;
};

const regionAnchors: Record<string, { label: string; x: number; y: number }> = {
  USA: { label: "North America", x: 18, y: 38 },
  BRA: { label: "Latin America", x: 30, y: 67 },
  DEU: { label: "Europe", x: 50, y: 34 },
  FRA: { label: "Europe", x: 48, y: 38 },
  ESP: { label: "Europe", x: 46, y: 43 },
  GHA: { label: "West Africa", x: 48, y: 58 },
  NGA: { label: "West Africa", x: 51, y: 57 },
  KEN: { label: "East Africa", x: 57, y: 61 },
  ZAF: { label: "Southern Africa", x: 54, y: 76 },
  EGY: { label: "North Africa", x: 56, y: 47 },
  TUR: { label: "Middle Corridor", x: 59, y: 40 },
  IND: { label: "South Asia", x: 69, y: 53 },
  CHN: { label: "East Asia", x: 77, y: 42 },
  JPN: { label: "Pacific Rim", x: 86, y: 42 },
  IDN: { label: "Southeast Asia", x: 78, y: 68 },
  GLOBAL: { label: "Global", x: 52, y: 50 },
};

const domainTone = (domain?: string | null) => {
  if (!domain) return "bg-muted text-muted-foreground border-border";
  if (domain.includes("climate") || domain.includes("disaster")) return "bg-amber-500/10 text-amber-300 border-amber-500/30";
  if (domain.includes("cyber") || domain.includes("governance")) return "bg-violet-500/10 text-violet-300 border-violet-500/30";
  if (domain.includes("logistics") || domain.includes("shipping") || domain.includes("aviation")) return "bg-blue-500/10 text-blue-300 border-blue-500/30";
  if (domain.includes("health") || domain.includes("food") || domain.includes("humanitarian")) return "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
  return "bg-primary/10 text-primary border-primary/30";
};

const signalSeverity = (impact?: number | null, urgency?: number | null) => {
  const score = Math.max(Number(impact ?? 0), Number(urgency ?? 0));
  if (score >= 85) return "critical";
  if (score >= 70) return "strategic";
  return "monitor";
};

export function PlanetaryOperationsMap() {
  const signals = useQuery({
    queryKey: ["planetary-map-signals"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("global_signals" as any)
        .select("title,category,impact_score,urgency_score,affected_countries,created_at,ingested_at")
        .order("impact_score", { ascending: false, nullsFirst: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as MapSignal[];
    },
  });

  const causal = useQuery({
    queryKey: ["planetary-map-causal"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("planetary_causal_command_view" as any)
        .select("source_event,source_domain,impacted_system,impact_probability,impact_severity,projected_time_window")
        .limit(8);
      if (error) throw error;
      return (data ?? []) as CausalEvent[];
    },
  });

  const hotspots = useMemo(() => {
    const grouped = new Map<string, { country: string; label: string; x: number; y: number; count: number; maxImpact: number; domains: Set<string> }>();
    for (const signal of signals.data ?? []) {
      const countries = signal.affected_countries?.length ? signal.affected_countries : ["GLOBAL"];
      for (const country of countries.slice(0, 4)) {
        const anchor = regionAnchors[country] ?? regionAnchors.GLOBAL;
        const current = grouped.get(country) ?? { country, label: anchor.label, x: anchor.x, y: anchor.y, count: 0, maxImpact: 0, domains: new Set<string>() };
        current.count += 1;
        current.maxImpact = Math.max(current.maxImpact, Number(signal.impact_score ?? signal.urgency_score ?? 0));
        if (signal.category) current.domains.add(signal.category);
        grouped.set(country, current);
      }
    }
    return Array.from(grouped.values()).sort((a, b) => b.maxImpact - a.maxImpact).slice(0, 10);
  }, [signals.data]);

  const topSignals = (signals.data ?? []).slice(0, 6);
  const loading = signals.isLoading || causal.isLoading;

  return (
    <Card className="border-border bg-card/70 overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-primary" />
              Live Planetary Operations Map
            </CardTitle>
            <CardDescription>
              Spatial view of global signals, risk hotspots, and causal propagation pressure.
            </CardDescription>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">Global</Badge>
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30">Live signals</Badge>
            <Badge variant="outline" className="bg-amber-500/10 text-amber-300 border-amber-500/30">Propagation</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[420px] w-full" />
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-4">
            <div className="relative h-[420px] rounded-xl border border-border overflow-hidden bg-[radial-gradient(circle_at_50%_45%,hsl(var(--primary)/0.16),transparent_38%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--card)))]">
              <div className="absolute inset-0 opacity-30 bg-[linear-gradient(to_right,hsl(var(--border))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border))_1px,transparent_1px)] bg-[size:42px_42px]" />
              <div className="absolute inset-x-8 top-16 h-[1px] bg-primary/30" />
              <div className="absolute inset-x-12 top-40 h-[1px] bg-primary/20" />
              <div className="absolute inset-x-16 top-64 h-[1px] bg-primary/20" />
              <div className="absolute left-[18%] top-0 bottom-0 w-[1px] bg-primary/20" />
              <div className="absolute left-[50%] top-0 bottom-0 w-[1px] bg-primary/20" />
              <div className="absolute left-[78%] top-0 bottom-0 w-[1px] bg-primary/20" />

              {hotspots.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  No geocoded signals yet. Populate global_signals to activate the map.
                </div>
              )}

              {hotspots.map((hotspot, index) => {
                const size = Math.max(18, Math.min(54, 16 + hotspot.maxImpact / 2.5));
                const severity = signalSeverity(hotspot.maxImpact, hotspot.maxImpact);
                return (
                  <div
                    key={hotspot.country}
                    className="absolute -translate-x-1/2 -translate-y-1/2 group"
                    style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%` }}
                  >
                    <div
                      className={`rounded-full border flex items-center justify-center shadow-lg ${severity === "critical" ? "bg-rose-500/20 border-rose-400/60" : severity === "strategic" ? "bg-amber-500/20 border-amber-400/60" : "bg-primary/20 border-primary/60"}`}
                      style={{ width: size, height: size }}
                    >
                      <div className={`rounded-full animate-pulse ${severity === "critical" ? "bg-rose-300" : severity === "strategic" ? "bg-amber-300" : "bg-primary"}`} style={{ width: Math.max(6, size / 4), height: Math.max(6, size / 4) }} />
                    </div>
                    <div className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[10px] shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      <div className="font-medium">{hotspot.label}</div>
                      <div className="text-muted-foreground">{hotspot.count} signals · max {Math.round(hotspot.maxImpact)}</div>
                    </div>
                    {index < 3 && <div className="absolute left-1/2 top-1/2 h-px w-24 origin-left rotate-[-18deg] bg-primary/30" />}
                  </div>
                );
              })}

              <div className="absolute left-4 bottom-4 right-4 rounded-lg border border-border bg-background/80 backdrop-blur p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
                  <RadioTower className="h-3.5 w-3.5" /> Operational map layer
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Hotspots</span><div className="font-semibold">{hotspots.length}</div></div>
                  <div><span className="text-muted-foreground">Signals</span><div className="font-semibold">{signals.data?.length ?? 0}</div></div>
                  <div><span className="text-muted-foreground">Causal paths</span><div className="font-semibold">{causal.data?.length ?? 0}</div></div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-background/40 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <ShieldAlert className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Top Spatial Signals</h3>
                </div>
                <div className="space-y-2">
                  {topSignals.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No live global signals available yet.</p>
                  ) : topSignals.map((signal, idx) => (
                    <div key={`${signal.title}-${idx}`} className="rounded-lg border border-border bg-card/60 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium line-clamp-1">{signal.title ?? "Untitled signal"}</p>
                        <Badge variant="outline" className={domainTone(signal.category)}>{Math.round(Number(signal.impact_score ?? 0))}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{signal.category ?? "unknown"} · {(signal.affected_countries ?? ["GLOBAL"]).join(", ")}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background/40 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Route className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Propagation Watch</h3>
                </div>
                <div className="space-y-2">
                  {(causal.data ?? []).slice(0, 4).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No causal watch events generated yet.</p>
                  ) : (causal.data ?? []).slice(0, 4).map((event, idx) => (
                    <div key={`${event.source_event}-${idx}`} className="rounded-lg border border-border bg-card/60 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium line-clamp-1">{event.source_event ?? "Propagation event"}</p>
                        <Badge variant="outline" className={domainTone(event.source_domain)}>{Math.round(Number(event.impact_probability ?? 0))}%</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{event.source_domain ?? "domain"} → {event.impacted_system ?? "system"} · {event.projected_time_window ?? "window"}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
