import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Network } from "lucide-react";

const NODES = [
  { x: 18, y: 35, label: "Political Instability", color: "#ef4444" },
  { x: 50, y: 28, label: "Social Unrest", color: "#f59e0b" },
  { x: 80, y: 38, label: "Disinformation", color: "#a78bfa" },
  { x: 38, y: 70, label: "Economic Stress", color: "#fb923c" },
  { x: 70, y: 78, label: "Cyber Threats", color: "#ef4444" },
];
const EDGES = [["18","35","50","28"],["50","28","80","38"],["50","28","38","70"],["38","70","70","78"],["18","35","38","70"],["80","38","70","78"]];

export function CausalNetworkCard() {
  return (
    <Card className="border-border bg-card/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><Network className="h-4 w-4 text-fuchsia-400" /> Causal Network (live)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative h-56 rounded border border-border/60 bg-[radial-gradient(ellipse_at_center,rgba(168,85,247,0.12),transparent_60%)] overflow-hidden">
          {NODES.map((n, i) => (
            <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2 text-center" style={{ left: `${n.x}%`, top: `${n.y}%` }}>
              <div className="h-10 w-10 rounded-full mx-auto" style={{ background: `radial-gradient(circle, ${n.color}cc, ${n.color}22)`, boxShadow: `0 0 20px ${n.color}66` }} />
              <div className="text-[10px] mt-1 text-muted-foreground whitespace-nowrap">{n.label}</div>
            </div>
          ))}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 100 100">
            {EDGES.map((c, i) => (
              <line key={i} x1={c[0]} y1={c[1]} x2={c[2]} y2={c[3]} stroke="#f59e0b" strokeWidth="0.3" strokeDasharray="1 1" opacity="0.6" />
            ))}
          </svg>
        </div>
      </CardContent>
    </Card>
  );
}
