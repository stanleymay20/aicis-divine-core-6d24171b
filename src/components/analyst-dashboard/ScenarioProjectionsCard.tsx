import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Workflow } from "lucide-react";
import { sevTone } from "./shared";

const SCENARIOS = [
  { s: "Regional conflict escalation", p: 34, i: "High", w: "1–7d", tone: "high" },
  { s: "Cyber attack on critical infra", p: 28, i: "High", w: "1–3d", tone: "high" },
  { s: "Economic shock expansion", p: 22, i: "Medium", w: "3–10d", tone: "elevated" },
  { s: "Supply chain collapse", p: 16, i: "High", w: "1–14d", tone: "high" },
];

export function ScenarioProjectionsCard() {
  return (
    <Card className="border-border bg-card/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><Workflow className="h-4 w-4 text-cyan-400" /> Scenario Projections</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="font-normal pb-2">Scenario</th>
              <th className="font-normal pb-2 text-right">Probability</th>
              <th className="font-normal pb-2 text-right">Impact</th>
              <th className="font-normal pb-2 text-right">Window</th>
            </tr>
          </thead>
          <tbody>
            {SCENARIOS.map((r) => (
              <tr key={r.s} className="border-t border-border/40">
                <td className="py-2">{r.s}</td>
                <td className="py-2 text-right tabular-nums">{r.p}%</td>
                <td className="py-2 text-right"><Badge variant="outline" className={sevTone(r.tone)}>{r.i}</Badge></td>
                <td className="py-2 text-right text-muted-foreground">{r.w}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
