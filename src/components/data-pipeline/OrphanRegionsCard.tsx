import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { GitBranch } from "lucide-react";
import { PanelEmpty } from "@/components/ui/panel-empty";
import type { OrphanRow } from "./types";

export function OrphanRegionsCard({ loading, rows }: { loading: boolean; rows: OrphanRow[] | undefined }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-primary" />
          Orphan Regions (hierarchy integrity)
        </CardTitle>
        <CardDescription>
          Regions missing parent_id, centroid, ISO3, or population cannot participate in weighted rollups.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : (rows ?? []).length === 0 ? (
          <PanelEmpty
            title="No orphan regions detected"
            reason="Every region currently has parent_id, centroid, ISO3, and population — hierarchy is intact. (Or the dq_orphan_regions view has not refreshed yet.)"
            nextStep="No action required. Refreshes nightly via pg_cron."
            compact
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left p-2">Admin Level</th>
                  <th className="text-right p-2">Missing ISO3</th>
                  <th className="text-right p-2">Missing Parent</th>
                  <th className="text-right p-2">Missing Centroid</th>
                  <th className="text-right p-2">Missing Population</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((r) => (
                  <tr key={r.admin_level} className="border-b border-border/40">
                    <td className="p-2 font-mono">L{r.admin_level}</td>
                    <td className="p-2 text-right">{r.missing_iso3}</td>
                    <td className="p-2 text-right">{r.missing_parent}</td>
                    <td className="p-2 text-right">{r.missing_centroid}</td>
                    <td className="p-2 text-right">{r.missing_population}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
