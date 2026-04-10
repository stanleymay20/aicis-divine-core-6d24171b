import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Zap, ArrowRight } from "lucide-react";

// Detect cross-domain temporal correlations from country_performance_snapshots
export const CrossDomainPatterns = () => {
  const { data: patterns, isLoading } = useQuery({
    queryKey: ["learning-cross-domain-patterns"],
    queryFn: async () => {
      // Fetch recent snapshots to detect co-occurring domain stress
      const { data } = await supabase
        .from("country_performance_snapshots")
        .select("iso3, domain, risk_pressure_score, momentum_score, forecast_direction, snapshot_date")
        .gte("risk_pressure_score", 50)
        .order("snapshot_date", { ascending: false })
        .limit(500);

      if (!data?.length) return [];

      // Group by country+date and find multi-domain stress
      const groups: Record<string, Array<{ domain: string; risk: number; direction: string }>> = {};
      for (const row of data) {
        const key = `${row.iso3}|${row.snapshot_date}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push({ domain: row.domain, risk: row.risk_pressure_score, direction: row.forecast_direction });
      }

      // Find countries with 3+ stressed domains (cross-domain risk)
      const crossDomainPatterns: Array<{
        iso3: string;
        date: string;
        domains: Array<{ domain: string; risk: number; direction: string }>;
        pattern: string;
      }> = [];

      for (const [key, domains] of Object.entries(groups)) {
        if (domains.length >= 3) {
          const [iso3, date] = key.split("|");
          const downDomains = domains.filter((d) => d.direction === "down");
          const pattern = downDomains.length >= 2
            ? `${downDomains.map((d) => d.domain).join(" + ")} → compounding risk`
            : `${domains.map((d) => d.domain).join(", ")} elevated simultaneously`;

          crossDomainPatterns.push({
            iso3,
            date,
            domains: domains.sort((a, b) => b.risk - a.risk),
            pattern,
          });
        }
      }

      // Deduplicate by country, keep latest
      const seen = new Set<string>();
      return crossDomainPatterns
        .sort((a, b) => b.date.localeCompare(a.date))
        .filter((p) => {
          if (seen.has(p.iso3)) return false;
          seen.add(p.iso3);
          return true;
        })
        .slice(0, 10);
    },
    staleTime: 60_000,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-500" />
          Cross-Domain Risk Patterns
          <Badge variant="secondary" className="text-[10px] ml-auto">Detected</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : patterns?.length === 0 ? (
          <div className="py-6 text-center">
            <Zap className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">No cross-domain stress patterns detected</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Patterns emerge when 3+ domains show elevated risk simultaneously in a country
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {patterns?.map((p, idx) => (
              <div key={idx} className="p-3 rounded-lg border border-border/50 hover:border-primary/30 transition-colors">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-bold font-mono">{p.iso3}</span>
                  <span className="text-[10px] text-muted-foreground">{p.date}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  {p.domains.map((d, i) => (
                    <span key={i} className="inline-flex items-center gap-1">
                      <Badge
                        variant="outline"
                        className={`text-[9px] ${d.risk >= 70 ? "border-red-500/30 text-red-500" : d.risk >= 50 ? "border-amber-500/30 text-amber-500" : "border-border"}`}
                      >
                        {d.domain} {d.risk.toFixed(0)}
                      </Badge>
                      {i < p.domains.length - 1 && <ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />}
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">{p.pattern}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
