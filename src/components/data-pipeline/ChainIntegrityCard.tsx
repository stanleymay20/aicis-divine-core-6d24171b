import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GitBranch } from "lucide-react";
import { PanelEmpty } from "@/components/ui/panel-empty";

export function ChainIntegrityCard({
  loading, summary,
}: {
  loading: boolean;
  summary: { total: number; by: Record<string, number> };
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-primary" />
          Local → National Chain Integrity ({summary.total} countries)
        </CardTitle>
        <CardDescription>
          Per-country chain status across L0 villages → L1 community → L2 urban → national snapshot.
          Sourced live from <span className="font-mono">v_local_to_national_freshness</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : Object.keys(summary.by).length === 0 ? (
          <PanelEmpty
            title="No chain-integrity records"
            reason="v_local_to_national_freshness has no rows. Either no country has seeded L0 yet, or the view is being rebuilt."
            nextStep="Trigger village seeding via the Seed Retry Queue below, or wait for the 6h federation cycle."
            compact
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary.by)
              .sort((a, b) => b[1] - a[1])
              .map(([status, n]) => {
                const tone =
                  status === "healthy"
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                    : status.includes("stale")
                    ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                    : "bg-rose-500/15 text-rose-300 border-rose-500/30";
                return (
                  <Badge key={status} variant="outline" className={`text-xs ${tone}`}>
                    {status}: {n}
                  </Badge>
                );
              })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
