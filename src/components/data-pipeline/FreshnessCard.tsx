import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock } from "lucide-react";
import { PanelEmpty } from "@/components/ui/panel-empty";
import { formatDistanceToNow } from "date-fns";
import { STATUS_COLORS, type FreshnessRow } from "./types";

export function FreshnessCard({
  loading, rows, filtered, filter, onFilterChange,
}: {
  loading: boolean;
  rows: FreshnessRow[] | undefined;
  filtered: FreshnessRow[];
  filter: string;
  onFilterChange: (v: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              L0 Freshness per Country
            </CardTitle>
            <CardDescription>
              Stale-flagged countries (&gt; 7 days) are excluded from defensible national rollups.
            </CardDescription>
          </div>
          <Input
            placeholder="Filter ISO3…"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            className="h-9 max-w-[200px] uppercase font-mono text-xs"
          />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : (rows ?? []).length === 0 ? (
          <PanelEmpty
            title="No L0 country has been seeded yet"
            reason="dq_village_layer_health lists every country with at least one village indicator. The table is empty — village seeding has not produced any rows."
            nextStep="Run the seed-villages edge function or check the Seed Retry Queue for abandoned attempts."
            compact
          />
        ) : (
          <ScrollArea className="h-[420px] pr-2">
            <div className="space-y-1.5">
              {filtered.map((r) => (
                <div key={r.country_iso3} className="flex items-center justify-between gap-2 p-2 rounded border border-border bg-card/40 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-semibold w-12">{r.country_iso3}</span>
                    <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[r.freshness_status]}`}>
                      {r.freshness_status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground shrink-0">
                    <span>{r.regions_with_data} regions</span>
                    <span>{r.village_rows?.toLocaleString()} rows</span>
                    <span className="hidden sm:inline">{r.rows_24h ?? 0} /24h</span>
                    <span className="hidden md:inline">
                      {r.last_observed_at
                        ? formatDistanceToNow(new Date(r.last_observed_at), { addSuffix: true })
                        : "never"}
                    </span>
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="text-sm text-muted-foreground p-4 text-center">No countries match the current ISO3 filter.</div>
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
