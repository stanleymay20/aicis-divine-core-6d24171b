import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { X, TrendingUp, TrendingDown, Minus, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EvidenceSection } from "@/components/evidence/EvidenceSection";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";

export function IntelligenceDrawer({
  iso3,
  onClose,
}: {
  iso3: string | null;
  onClose: () => void;
}) {
  const open = !!iso3;
  const { data, isLoading } = useQuery({
    queryKey: ["intel-drawer", iso3],
    enabled: open,
    staleTime: 30_000,
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const [snap, name] = await Promise.all([
        supabase
          .from("country_performance_snapshots")
          .select("domain,risk_pressure_score,confidence_score,forecast_direction,momentum_score")
          .eq("iso3", iso3!)
          .eq("snapshot_date", today),
        supabase.from("country_profiles").select("country_name").eq("iso3_code", iso3!).maybeSingle(),
      ]);
      return {
        domains: snap.data ?? [],
        countryName: (name.data as any)?.country_name ?? iso3,
      };
    },
  });

  const avg = data?.domains.length
    ? data.domains.reduce((s, d: any) => s + (d.risk_pressure_score ?? 0), 0) / data.domains.length
    : 0;
  const tone = avg >= 60 ? "text-red-500" : avg >= 40 ? "text-amber-500" : "text-emerald-500";

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-y-0 right-0 z-40 w-full max-w-md transform border-l border-border/60 bg-card shadow-2xl transition-transform duration-200",
        open ? "translate-x-0 pointer-events-auto" : "translate-x-full",
      )}
      aria-hidden={!open}
    >
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">Country dossier</div>
          <h2 className="text-base font-semibold leading-tight">{data?.countryName ?? iso3 ?? ""}</h2>
        </div>
        <div className="flex items-center gap-1">
          {iso3 && (
            <Button asChild variant="ghost" size="sm" className="h-7 text-[11px]">
              <Link to={`/deepdive/${iso3}`}>Full dossier <ExternalLink className="ml-1 h-3 w-3" /></Link>
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex h-[calc(100%-3.5rem)] flex-col gap-3 overflow-y-auto p-4">
        {isLoading ? (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        ) : (
          <>
            <div className="flex items-baseline gap-4 rounded border border-border/60 bg-muted/20 p-3">
              <div>
                <div className="text-[10px] font-mono uppercase text-muted-foreground">Market risk</div>
                <div className={cn("font-mono text-3xl font-bold tabular-nums", tone)}>{avg.toFixed(0)}</div>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Composite across {data?.domains.length ?? 0} domains. Higher = more disruption risk.
              </div>
            </div>

            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Domains</h3>
              <ul className="space-y-1">
                {data?.domains.map((d: any) => {
                  const dt = d.forecast_direction === "down" ? <TrendingDown className="h-3 w-3 text-red-500" /> :
                             d.forecast_direction === "up" ? <TrendingUp className="h-3 w-3 text-emerald-500" /> :
                             <Minus className="h-3 w-3 text-muted-foreground" />;
                  const t = d.risk_pressure_score >= 60 ? "text-red-500" : d.risk_pressure_score >= 40 ? "text-amber-500" : "text-emerald-500";
                  return (
                    <li key={d.domain} className="flex items-center justify-between rounded border border-border/40 bg-card px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        {dt}
                        <span className="text-xs font-medium capitalize">{d.domain}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={cn("font-mono text-[10px]", t)}>
                          {Number(d.risk_pressure_score).toFixed(0)}
                        </Badge>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            {iso3 && <EvidenceSection mode="country" iso3={iso3} defaultOpen />}
          </>
        )}
      </div>
    </div>
  );
}
