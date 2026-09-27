import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database } from "lucide-react";
import { PanelEmpty } from "@/components/ui/panel-empty";
import { ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

export function DataSourceHealthCard({ sourceHealth }: { sourceHealth: { name: string; value: number; color: string }[] }) {
  return (
    <Card className="border-border bg-card/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4 text-emerald-400" /> Data Source Health</CardTitle>
      </CardHeader>
      <CardContent>
        {sourceHealth.length === 0 ? (
          <PanelEmpty
            title="Source health not available yet"
            reason="No attributable source-status rows were returned. AICIS will not infer online, degraded, or offline counts."
            nextStep="Restore or populate the live source-health contract, then refresh this panel."
            compact
          />
        ) : (
        <div className="flex items-center gap-3">
          <div className="h-32 w-32">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={sourceHealth} dataKey="value" innerRadius={36} outerRadius={56} paddingAngle={2}>
                  {sourceHealth.map((s, i) => <Cell key={i} fill={s.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5 text-xs flex-1">
            {sourceHealth.map(s => (
              <div key={s.name} className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.name}
                </span>
                <span className="tabular-nums text-muted-foreground">{s.value}</span>
              </div>
            ))}
            <div className="border-t border-border/40 pt-1.5 mt-1.5 flex justify-between font-medium">
              <span>Total</span>
              <span className="tabular-nums">{sourceHealth.reduce((s, x) => s + x.value, 0)}</span>
            </div>
          </div>
        </div>
        )}
      </CardContent>
    </Card>
  );
}
