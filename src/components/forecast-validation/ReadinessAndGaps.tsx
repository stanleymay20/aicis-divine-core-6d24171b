import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, TrendingUp } from "lucide-react";

export function PromotionReadiness({ readiness }: { readiness: any }) {
  if (!readiness) return null;
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Promotion Readiness</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={`rounded-md p-3 text-sm font-medium ${readiness.ready ? "bg-emerald-500/10 text-emerald-400" : "bg-muted text-muted-foreground"}`}>
          {readiness.status === "AWAITING_DATA" && "Not enough evidence yet — forecasts are accumulating."}
          {readiness.status === "INSUFFICIENT_SAMPLE" && `Evidence building — ${readiness.sample_size} realized so far (need 30+).`}
          {readiness.status === "EMERGING" && `Evidence building — ${readiness.sample_size} realized, approaching threshold.`}
          {readiness.status === "EVALUABLE" && "Evidence is substantial but not all criteria are met for external claims."}
          {readiness.status === "DECISION_GRADE" && "Ready for external forecast claims — all criteria passed."}
        </div>
        {readiness.criteria && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
            {Object.entries(readiness.criteria as Record<string, boolean>).map(([key, passed]) => (
              <div key={key} className={`rounded-md p-2 text-center ${passed ? "bg-emerald-500/10 text-emerald-400" : "bg-destructive/10 text-destructive"}`}>
                <div className="font-medium">{passed ? "✓" : "✗"}</div>
                <div className="mt-1 opacity-80">{key.replace(/_/g, " ")}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function CoverageGaps({ coverageGaps }: { coverageGaps: any }) {
  if (!coverageGaps) return null;
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Coverage Gaps</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <p className="text-muted-foreground mb-1 font-medium">Domains with no realized data</p>
            {coverageGaps.domains_no_realized?.length > 0
              ? <div className="flex flex-wrap gap-1">{coverageGaps.domains_no_realized.map((d: string) => <Badge key={d} variant="destructive" className="text-[10px]">{d}</Badge>)}</div>
              : <span className="text-muted-foreground">None — all domains have realized data</span>}
          </div>
          <div>
            <p className="text-muted-foreground mb-1 font-medium">Countries with no realized data</p>
            {coverageGaps.countries_no_realized?.length > 0
              ? <div className="flex flex-wrap gap-1">{coverageGaps.countries_no_realized.slice(0, 20).map((c: string) => <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>)}</div>
              : <span className="text-muted-foreground">None</span>}
          </div>
        </div>
        {coverageGaps.horizon_coverage?.length > 0 && (
          <div>
            <p className="text-muted-foreground mb-1 font-medium">Horizon coverage</p>
            <div className="flex flex-wrap gap-2">
              {coverageGaps.horizon_coverage.map((h: any) => (
                <div key={h.horizon_days} className="bg-muted rounded px-2 py-1">
                  <span className="font-mono">{h.horizon_days}d</span>: {h.realized}/{h.total} realized {h.avg_mae != null && `(MAE ${h.avg_mae})`}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
