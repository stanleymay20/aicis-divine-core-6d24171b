import { ResponsiveContainer, AreaChart, Area } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Gauge, ChevronDown } from "lucide-react";

export const fmt = (n: number | null | undefined, d = 0) =>
  n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: d });

export const sevTone = (lvl?: string | null) => {
  const v = (lvl ?? "").toLowerCase();
  if (["critical", "high"].includes(v)) return "bg-rose-500/10 text-rose-300 border-rose-500/30";
  if (["elevated", "warning", "medium"].includes(v)) return "bg-amber-500/10 text-amber-300 border-amber-500/30";
  if (["low", "stable", "cleared"].includes(v)) return "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
  return "bg-cyan-500/10 text-cyan-300 border-cyan-500/30";
};

export function KpiTile({ icon: Icon, label, value, suffix, delta, deltaLabel, sparkColor = "#22d3ee", sparkData, loading }: any) {
  return (
    <Card className="border-border bg-card/70 hover:bg-card/85 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <Icon className="h-3.5 w-3.5" /> {label}
          </div>
          <Gauge className="h-3.5 w-3.5 text-muted-foreground/60" />
        </div>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className="text-3xl font-semibold tabular-nums leading-none">
            {value}
            {suffix && <span className="text-sm text-muted-foreground ml-1">{suffix}</span>}
          </div>
        )}
        <div className="flex items-center justify-between mt-2 h-6">
          <span className={`text-[11px] ${delta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
            {delta != null && (delta >= 0 ? "▲" : "▼")} {delta != null ? `${Math.abs(delta)}%` : ""} {deltaLabel}
          </span>
          {sparkData && (
            <div className="w-20 h-6 opacity-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkData}>
                  <defs>
                    <linearGradient id={`g-${label}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={sparkColor} stopOpacity={0.6} />
                      <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={1.5} fill={`url(#g-${label})`} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function FilterChip({ label }: { label: string }) {
  return (
    <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-background/40 border-border/70 text-xs">
      {label} <ChevronDown className="h-3 w-3 opacity-60" />
    </Button>
  );
}
