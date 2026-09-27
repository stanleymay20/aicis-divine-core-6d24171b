import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Minus,
  ShieldCheck,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";
import { cn } from "@/lib/utils";

type RiskRankingRow =
  Database["public"]["Tables"]["risk_ranking_predictions"]["Row"];

type MovementSource = Pick<
  RiskRankingRow,
  | "country_iso3"
  | "domain"
  | "risk_probability"
  | "rank_position"
  | "confidence_lower"
  | "confidence_upper"
  | "evidence_count"
  | "generated_at"
  | "generation_batch_id"
  | "horizon_days"
  | "model_version"
  | "proxy_share"
>;

interface ForecastMovement extends MovementSource {
  previousProbability: number;
  previousModelVersion: string;
  delta: number;
}

interface ForecastMovementBundle {
  currentGeneratedAt: string | null;
  previousGeneratedAt: string | null;
  currentBatchId: string | null;
  previousBatchId: string | null;
  movements: ForecastMovement[];
  status: "ready" | "insufficient_history" | "no_overlap";
}

const movementKey = (
  row: Pick<MovementSource, "country_iso3" | "domain" | "horizon_days">,
) => [row.country_iso3, row.domain, row.horizon_days].join("|");

const percent = (value: number) => `${(value * 100).toFixed(0)}%`;

const deltaPoints = (value: number) => {
  const points = value * 100;
  const prefix = points > 0 ? "+" : "";
  return `${prefix}${points.toFixed(1)}pp`;
};

export const ForecastMovementPanel = () => {
  const navigate = useNavigate();
  const { selectEntity } = useIntelligenceOS();

  const { data, isLoading } = useQuery<ForecastMovementBundle>({
    queryKey: ["brief-forecast-movement"],
    queryFn: async () => {
      const { data: markers, error: markerError } = await supabase
        .from("risk_ranking_predictions")
        .select("generation_batch_id, generated_at")
        .order("generated_at", { ascending: false })
        .limit(500);

      if (markerError) throw markerError;

      const batches: Array<{ id: string; generatedAt: string }> = [];
      const seen = new Set<string>();

      for (const marker of markers ?? []) {
        if (seen.has(marker.generation_batch_id)) continue;
        seen.add(marker.generation_batch_id);
        batches.push({
          id: marker.generation_batch_id,
          generatedAt: marker.generated_at,
        });
        if (batches.length === 2) break;
      }

      if (batches.length < 2) {
        return {
          currentGeneratedAt: batches[0]?.generatedAt ?? null,
          previousGeneratedAt: null,
          currentBatchId: batches[0]?.id ?? null,
          previousBatchId: null,
          movements: [],
          status: "insufficient_history",
        };
      }

      const [currentBatch, previousBatch] = batches;

      const { data: rows, error: rowsError } = await supabase
        .from("risk_ranking_predictions")
        .select(
          "country_iso3, domain, risk_probability, rank_position, confidence_lower, confidence_upper, evidence_count, generated_at, generation_batch_id, horizon_days, model_version, proxy_share",
        )
        .in("generation_batch_id", [currentBatch.id, previousBatch.id])
        .limit(1000);

      if (rowsError) throw rowsError;

      const currentRows = (rows ?? []).filter(
        (row) => row.generation_batch_id === currentBatch.id,
      );
      const previousRows = new Map(
        (rows ?? [])
          .filter((row) => row.generation_batch_id === previousBatch.id)
          .map((row) => [movementKey(row), row]),
      );

      const movements: ForecastMovement[] = currentRows
        .flatMap((row) => {
          const previous = previousRows.get(movementKey(row));
          if (!previous) return [];

          return [
            {
              ...row,
              previousProbability: previous.risk_probability,
              previousModelVersion: previous.model_version,
              delta: row.risk_probability - previous.risk_probability,
            },
          ];
        })
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 6);

      return {
        currentGeneratedAt: currentBatch.generatedAt,
        previousGeneratedAt: previousBatch.generatedAt,
        currentBatchId: currentBatch.id,
        previousBatchId: previousBatch.id,
        movements,
        status: movements.length > 0 ? "ready" : "no_overlap",
      };
    },
    staleTime: 60_000,
  });

  const inspect = (movement: ForecastMovement) => {
    const delta = deltaPoints(movement.delta);
    selectEntity({
      id: [
        movement.country_iso3,
        movement.domain,
        movement.horizon_days,
        movement.generation_batch_id,
      ].join(":"),
      type: "forecast",
      name: `${movement.country_iso3} · ${movement.domain}`,
      description: `Stored ${movement.horizon_days}-day risk-ranking estimate moved ${delta} between the two latest comparable batches.`,
      sourceCount: movement.evidence_count ?? undefined,
      observedAt: movement.generated_at,
      updatedAt: movement.generated_at,
      geography: {
        country: movement.country_iso3,
      },
      metadata: {
        currentEstimate: percent(movement.risk_probability),
        previousEstimate: percent(movement.previousProbability),
        changePercentagePoints: delta,
        horizonDays: movement.horizon_days,
        rankPosition: movement.rank_position,
        modelVersion: movement.model_version,
        previousModelVersion: movement.previousModelVersion,
        confidenceLower:
          movement.confidence_lower == null
            ? null
            : percent(movement.confidence_lower),
        confidenceUpper:
          movement.confidence_upper == null
            ? null
            : percent(movement.confidence_upper),
        proxyShare: movement.proxy_share,
      },
    });
  };

  if (isLoading) {
    return (
      <Card className="border-border">
        <CardContent className="space-y-2 p-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.status !== "ready") {
    return (
      <Card className="border-border">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium">
                {data?.status === "no_overlap"
                  ? "No comparable forecast movement"
                  : "Not enough forecast history yet"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                AICIS needs two stored ranking batches with matching country,
                domain, and horizon keys before it can report what became more
                or less likely. No delta is being invented.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border">
      <CardContent className="space-y-3 p-4">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-foreground">
              Largest stored estimate changes
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 shrink-0 gap-1 text-xs"
              onClick={() => navigate("/risk-ranking")}
            >
              Open Forecasts
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Comparison of the two latest stored risk-ranking batches. These are
            model estimates; this panel does not claim calibration beyond the
            recorded model evidence.
          </p>
        </div>

        <div className="space-y-1.5">
          {data.movements.map((movement) => {
            const rising = movement.delta > 0;
            const falling = movement.delta < 0;
            const Direction = rising ? ArrowUp : falling ? ArrowDown : Minus;

            return (
              <button
                key={[
                  movement.country_iso3,
                  movement.domain,
                  movement.horizon_days,
                  movement.generation_batch_id,
                ].join("-")}
                type="button"
                onClick={() => inspect(movement)}
                className="flex w-full items-center gap-3 rounded-lg border border-border/60 px-3 py-2 text-left transition-colors hover:border-primary/30 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="w-10 shrink-0 font-mono text-xs font-semibold">
                  {movement.country_iso3}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium capitalize">
                    {movement.domain}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {movement.horizon_days}d horizon
                    {movement.evidence_count == null
                      ? ""
                      : ` · ${movement.evidence_count} evidence item${movement.evidence_count === 1 ? "" : "s"}`}
                    {movement.model_version !== movement.previousModelVersion
                      ? " · model changed"
                      : ""}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <div className="font-mono text-xs font-semibold">
                    {percent(movement.risk_probability)}
                  </div>
                  <div
                    className={cn(
                      "mt-0.5 flex items-center justify-end gap-0.5 font-mono text-[10px]",
                      rising
                        ? "text-destructive"
                        : falling
                          ? "text-emerald-500"
                          : "text-muted-foreground",
                    )}
                  >
                    <Direction className="h-3 w-3" />
                    {deltaPoints(movement.delta)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border/60 pt-2 text-[9px] font-mono text-muted-foreground">
          <span>
            Current ·{" "}
            {data.currentGeneratedAt
              ? new Date(data.currentGeneratedAt).toISOString()
              : "unknown"}
          </span>
          <span>
            Previous ·{" "}
            {data.previousGeneratedAt
              ? new Date(data.previousGeneratedAt).toISOString()
              : "unknown"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
};
