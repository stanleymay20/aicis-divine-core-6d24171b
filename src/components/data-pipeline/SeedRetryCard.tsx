import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Repeat } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { SEED_COLORS, type SeedRow } from "./types";

export function SeedRetryCard({ loading, rows }: { loading: boolean; rows: SeedRow[] | undefined }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Repeat className="h-4 w-4 text-primary" />
          Seed Retry Queue
        </CardTitle>
        <CardDescription>
          Countries with zero villages get exponential-backoff retries. The daily{" "}
          <span className="font-mono">seed-retry-zero-result</span> job picks up due rows.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <ScrollArea className="h-[300px] pr-2">
            <div className="space-y-1">
              {(rows ?? []).map((r) => (
                <div key={r.country_iso3} className="flex items-center justify-between gap-2 p-2 rounded border border-border bg-card/40 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold w-12">{r.country_iso3}</span>
                    <Badge variant="outline" className={`text-[10px] ${SEED_COLORS[r.retry_state]}`}>
                      {r.retry_state}
                    </Badge>
                    {(r.retry_count ?? 0) > 0 && (
                      <span className="text-muted-foreground">retry #{r.retry_count}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground shrink-0">
                    <span className="hidden sm:inline">
                      last:{" "}
                      {r.last_attempt_at
                        ? formatDistanceToNow(new Date(r.last_attempt_at), { addSuffix: true })
                        : "—"}
                    </span>
                    <span>
                      next:{" "}
                      {r.next_retry_at
                        ? formatDistanceToNow(new Date(r.next_retry_at), { addSuffix: true })
                        : "—"}
                    </span>
                  </div>
                </div>
              ))}
              {(rows ?? []).length === 0 && (
                <div className="text-sm text-muted-foreground p-4 text-center">
                  No seed attempts on record.
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
