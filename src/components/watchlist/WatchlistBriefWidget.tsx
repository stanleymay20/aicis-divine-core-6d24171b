import { useWatchlist } from "@/hooks/useWatchlist";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Eye, ArrowRight, Globe, Map, Zap, AlertTriangle,
  TrendingUp, CheckCircle2, Shield, Package
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

const ICONS: Record<string, any> = { country: Globe, region: Map, hotspot: Zap };

const STATUS_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  critical: { icon: AlertTriangle, color: "text-destructive", label: "Critical" },
  rising: { icon: TrendingUp, color: "text-amber-500", label: "Rising" },
  improving: { icon: TrendingUp, color: "text-emerald-500", label: "Improving" },
  stable: { icon: CheckCircle2, color: "text-muted-foreground", label: "Stable" },
};

export const WatchlistBriefWidget = () => {
  const { sortedItems, events } = useWatchlist();
  const navigate = useNavigate();

  if (sortedItems.length === 0) return null;

  // Only show items with events or non-stable status
  const changedItems = sortedItems.filter((item) => {
    if (item.current_status !== "stable") return true;
    return events.some((e) => e.watchlist_item_id === item.id);
  });

  const hasChanges = changedItems.length > 0;
  const displayItems = hasChanges ? changedItems.slice(0, 5) : sortedItems.slice(0, 3);

  return (
    <Card className={cn(
      "border-border",
      hasChanges && changedItems.some((i) => i.current_status === "critical") && "border-destructive/20",
    )}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            Tracked Markets Today
          </h3>
          <div className="flex items-center gap-2">
            {hasChanges ? (
              <Badge variant="destructive" className="text-[10px]">
                {changedItems.length} changed
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">
                {sortedItems.length} tracked
              </Badge>
            )}
            <button
              onClick={() => navigate("/watchlist")}
              className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
            >
              Manage <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>

        {!hasChanges && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50 mb-3">
            <Shield className="h-4 w-4 text-emerald-500 shrink-0" />
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">No significant changes detected.</span>{" "}
              All {sortedItems.length} tracked markets remain stable.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {displayItems.map((item) => {
            const Icon = ICONS[item.watch_type] || Globe;
            const latestEvent = events.find((e) => e.watchlist_item_id === item.id);
            const statusConfig = STATUS_CONFIG[item.current_status] || STATUS_CONFIG.stable;
            const StatusIcon = statusConfig.icon;

            return (
              <button
                key={item.id}
                onClick={() => {
                  if (item.watch_type === "country" && item.country_iso3) {
                    navigate(`/resolution?country=${item.country_iso3}`);
                  } else if (item.watch_type === "region" && item.region_id) {
                    navigate(`/resolution?region=${item.region_id}`);
                  } else {
                    navigate("/resolution");
                  }
                }}
                className={cn(
                  "w-full flex items-center gap-3 p-2.5 rounded-lg border transition-all text-left group",
                  item.current_status === "critical"
                    ? "border-destructive/30 bg-destructive/5 hover:border-destructive/50"
                    : item.current_status === "rising"
                    ? "border-amber-500/20 bg-amber-500/5 hover:border-amber-500/40"
                    : "border-border hover:border-primary/30 hover:bg-primary/5",
                )}
              >
                <Icon className={cn("h-4 w-4 shrink-0", statusConfig.color)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium group-hover:text-primary transition-colors truncate">
                      {item.label}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn("text-[9px] shrink-0", statusConfig.color)}
                    >
                      {statusConfig.label}
                    </Badge>
                    {item.priority_level === "high" && (
                      <Badge className="text-[9px] bg-amber-500/10 text-amber-600 border-amber-500/30" variant="outline">
                        Priority
                      </Badge>
                    )}
                  </div>
                  {latestEvent ? (
                    <p className="text-[11px] text-muted-foreground truncate">
                      {latestEvent.delta_value != null && (
                        <span className={cn(
                          "font-mono font-medium mr-1",
                          latestEvent.delta_value > 0 ? "text-destructive" : "text-emerald-500"
                        )}>
                          {latestEvent.delta_value > 0 ? "+" : ""}{latestEvent.delta_value.toFixed(1)} pts
                        </span>
                      )}
                      {latestEvent.event_summary}
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">Monitoring · No disruptions</p>
                  )}
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
              </button>
            );
          })}
        </div>

        {sortedItems.length > displayItems.length && (
          <button
            onClick={() => navigate("/watchlist")}
            className="mt-2 text-xs text-primary hover:underline w-full text-center"
          >
            View all {sortedItems.length} tracked markets →
          </button>
        )}
      </CardContent>
    </Card>
  );
};
