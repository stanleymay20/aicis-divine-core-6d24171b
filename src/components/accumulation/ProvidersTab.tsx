import { Card } from "@/components/ui/card";
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip } from "recharts";
import { cn } from "@/lib/utils";
import { ageHours, freshnessTone, fmt } from "./atoms";
import type { ProviderStat } from "./types";

export function ProvidersTab({ providers }: { providers: ProviderStat[] }) {
  return (
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
              {providers.map((_, i) => <Cell key={i} fill="hsl(var(--primary))" />)}
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
  );
}
