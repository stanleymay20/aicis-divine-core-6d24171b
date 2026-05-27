import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelEmpty } from "@/components/ui/panel-empty";
import { sevTone } from "./shared";

export function TopThreatsCard({ loading, data }: { loading: boolean; data: any[] | undefined }) {
  return (
    <Card className="border-border bg-card/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Top Emerging Threats</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-56 w-full" /> : !data?.length ? (
          <PanelEmpty
            title="No ranked risks available"
            reason="This panel lists the highest-probability country-domain risks from the ranking engine. The engine has not produced predictions yet, or none crossed the visibility threshold."
            nextStep="Trigger a run on /risk-ranking, or wait for the next scheduled ranking cycle."
            compact
          />
        ) : (
          <ol className="space-y-2">
            {(data ?? []).map((t: any, i) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded border border-border/60 bg-background/40 p-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-muted-foreground tabular-nums w-4">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{t.country_iso3} · {t.domain}</div>
                    <div className="text-[10px] text-muted-foreground">Confidence {Math.round((t.confidence_score ?? 0) * 100)}%</div>
                  </div>
                </div>
                <Badge variant="outline" className={sevTone(t.risk_score >= 75 ? "high" : t.risk_score >= 50 ? "elevated" : "low")}>
                  {Math.round(t.risk_score ?? 0)}
                </Badge>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
