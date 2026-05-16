import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { GitCompare } from "lucide-react";

const DOMAINS = ["governance", "health", "energy", "finance", "food", "security", "education", "climate", "population"];
const COLORS = ["#22d3ee", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#f87171", "#60a5fa", "#fb923c", "#c084fc"];

type Row = { iso3: string; values: Record<string, number> };

export function ParallelCoordinatesChart() {
  const { data, isLoading } = useQuery({
    queryKey: ["parallel-coords-domains"],
    refetchInterval: 120_000,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("risk_ranking_predictions")
        .select("country_iso3,domain,risk_probability")
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      const map = new Map<string, Record<string, number>>();
      for (const r of (data ?? []) as any[]) {
        if (!r.country_iso3 || !r.domain) continue;
        if (!map.has(r.country_iso3)) map.set(r.country_iso3, {});
        const obj = map.get(r.country_iso3)!;
        if (obj[r.domain] == null) obj[r.domain] = Math.round((r.risk_probability ?? 0) * 100);
      }
      // keep countries with ≥4 domains, top 12 by avg risk
      const rows: Row[] = Array.from(map.entries())
        .filter(([, v]) => Object.keys(v).length >= 4)
        .map(([iso3, values]) => ({ iso3, values }))
        .sort((a, b) => {
          const avg = (r: Row) => {
            const vs = Object.values(r.values);
            return vs.reduce((s, x) => s + x, 0) / vs.length;
          };
          return avg(b) - avg(a);
        })
        .slice(0, 12);
      return rows;
    },
  });

  const { width, height, padX, padY, axisX } = useMemo(() => {
    const w = 720, h = 280, pX = 56, pY = 24;
    const ax = DOMAINS.map((_, i) => pX + (i * (w - 2 * pX)) / (DOMAINS.length - 1));
    return { width: w, height: h, padX: pX, padY: pY, axisX: ax };
  }, []);

  const yFor = (v: number) => padY + (1 - v / 100) * (height - 2 * padY);

  return (
    <Card className="border-border bg-card/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <GitCompare className="h-4 w-4 text-cyan-400" />
          Cross-Domain Risk Profiles — Parallel Coordinates
        </CardTitle>
        <CardDescription className="text-xs">
          Top 12 countries by average risk across 9 domains. Each line = one country.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : !data?.length ? (
          <p className="text-xs text-muted-foreground">No risk predictions available.</p>
        ) : (
          <div className="overflow-x-auto">
            <svg width={width} height={height} className="text-muted-foreground">
              {DOMAINS.map((d, i) => (
                <g key={d}>
                  <line x1={axisX[i]} y1={padY} x2={axisX[i]} y2={height - padY} stroke="currentColor" strokeOpacity={0.25} />
                  <text x={axisX[i]} y={height - 6} textAnchor="middle" fontSize="10" fill="currentColor">
                    {d.slice(0, 4)}
                  </text>
                  <text x={axisX[i]} y={padY - 6} textAnchor="middle" fontSize="9" fill="currentColor" opacity={0.5}>100</text>
                  <text x={axisX[i]} y={height - padY + 12} textAnchor="middle" fontSize="9" fill="currentColor" opacity={0.5}>0</text>
                </g>
              ))}
              {data.map((row, ri) => {
                const pts = DOMAINS.map((d, i) => {
                  const v = row.values[d];
                  return v == null ? null : `${axisX[i]},${yFor(v)}`;
                }).filter(Boolean) as string[];
                return (
                  <g key={row.iso3}>
                    <polyline
                      points={pts.join(" ")}
                      fill="none"
                      stroke={COLORS[ri % COLORS.length]}
                      strokeWidth={1.5}
                      strokeOpacity={0.75}
                    />
                  </g>
                );
              })}
            </svg>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px]">
              {data.map((row, ri) => (
                <span key={row.iso3} className="flex items-center gap-1">
                  <span className="h-2 w-3 rounded-sm" style={{ background: COLORS[ri % COLORS.length] }} />
                  <span className="tabular-nums text-muted-foreground">{row.iso3}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
