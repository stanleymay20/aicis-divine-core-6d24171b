import { BrainCircuit } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelEmpty } from "@/components/ui/panel-empty";
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";
import { sevTone } from "./shared";
import type { AnalystTopThreat } from "./queries";

const percent = (value: number | null) =>
  value == null ? "Unknown" : `${Math.round(value * 100)}%`;

export function TopThreatsCard({
  loading,
  data,
}: {
  loading: boolean;
  data: AnalystTopThreat[] | undefined;
}) {
  const { selectEntity } = useIntelligenceOS();

  const inspect = (threat: AnalystTopThreat) => {
    selectEntity({
      id: threat.id,
      type: "forecast",
      name: `${threat.country_iso3} · ${threat.domain}`,
      description: `Stored ${threat.horizon_days}-day risk-ranking estimate from the latest generation batch.`,
      confidence:
        threat.confidence_score == null
          ? undefined
          : threat.confidence_score * 100,
      sourceCount: threat.evidence_count ?? undefined,
      observedAt: threat.generated_at,
      updatedAt: threat.generated_at,
      geography: {
        country: threat.country_iso3,
      },
      metadata: {
        probability: percent(threat.risk_probability),
        horizonDays: threat.horizon_days,
        rankPosition: threat.rank_position,
        modelVersion: threat.model_version,
        batchId: threat.generation_batch_id,
        confidenceLower:
          threat.confidence_lower == null
            ? null
            : percent(threat.confidence_lower),
        confidenceUpper:
          threat.confidence_upper == null
            ? null
            : percent(threat.confidence_upper),
        proxyShare: threat.proxy_share,
      },
    });
  };

  return (
    <Card className="border-border bg-card/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Top Emerging Threats</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-56 w-full" />
        ) : !data?.length ? (
          <PanelEmpty
            title="No ranked risks available"
            reason="This panel lists the highest-probability country-domain risks from the latest stored ranking batch. The engine has not produced predictions yet, or the latest batch is empty."
            nextStep="Trigger a run on /risk-ranking, or wait for the next scheduled ranking cycle."
            compact
          />
        ) : (
          <ol className="space-y-2">
            {data.map((threat, index) => (
              <li key={threat.id}>
                <button
                  type="button"
                  onClick={() => inspect(threat)}
                  className="flex w-full items-center justify-between gap-2 rounded border border-border/60 bg-background/40 p-2 text-left transition-colors hover:border-primary/30 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Inspect forecast for ${threat.country_iso3} ${threat.domain}`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-4 text-xs tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <BrainCircuit className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium">
                        {threat.country_iso3} · {threat.domain}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {threat.horizon_days}d
                        {" · "}
                        {threat.evidence_count == null
                          ? "evidence unknown"
                          : `${threat.evidence_count} evidence`}
                        {" · "}
                        confidence{" "}
                        {threat.confidence_score == null
                          ? "unknown"
                          : `${Math.round(threat.confidence_score * 100)}%`}
                      </div>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={sevTone(
                      threat.risk_score >= 75
                        ? "high"
                        : threat.risk_score >= 50
                          ? "elevated"
                          : "low",
                    )}
                  >
                    {threat.risk_score}
                  </Badge>
                </button>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
