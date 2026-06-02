import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResponsiveContainer, AreaChart, Area, Tooltip } from "recharts";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DOMAIN_META, ageHours, freshnessTone, fmt } from "./atoms";
import type { DomainStat, DailyPoint } from "./types";

export function DomainCard({ stat, series }: { stat: DomainStat; series: DailyPoint[] }) {
  const meta = DOMAIN_META[stat.domain] ?? {
    label: stat.domain, blurb: "Domain data stream",
    href: `/risk-atlas?domain=${stat.domain}`, tone: "text-muted-foreground",
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
            {stat.source === "raw" && <Badge variant="outline" className="h-4 text-[9px] px-1">RAW</Badge>}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{meta.blurb}</p>
        </div>
        <div className={cn("flex items-center gap-1 text-[10px] shrink-0", f.tone)}>
          <Icon className="h-3 w-3" />{f.label}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div><div className="text-muted-foreground text-[10px]">Total</div><div className="font-semibold tabular-nums">{fmt(stat.rows)}</div></div>
        <div><div className="text-muted-foreground text-[10px]">Countries</div><div className="font-semibold tabular-nums">{stat.countries}</div></div>
        <div><div className="text-muted-foreground text-[10px]">7-day adds</div><div className="font-semibold tabular-nums">{fmt(last7)}</div></div>
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
                labelFormatter={(l) => l} formatter={(v: number) => [fmt(v), "added"]}
              />
              <Area type="monotone" dataKey="n" stroke="hsl(var(--primary))" strokeWidth={1.5}
                fill={`url(#g-${stat.domain})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex items-center justify-between pt-1 border-t border-border/40">
        <div className="text-[10px] text-muted-foreground">
          {stat.providers} source{stat.providers !== 1 ? "s" : ""} · last {stat.last_write ?? "—"}
        </div>
        <Button asChild variant="ghost" size="sm" className="h-6 text-[11px] gap-1 group-hover:text-primary">
          <Link to={meta.href}>Query <ArrowRight className="h-3 w-3" /></Link>
        </Button>
      </div>
    </Card>
  );
}
