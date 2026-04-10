import { useWatchlist } from "@/hooks/useWatchlist";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eye, ArrowRight, Globe, Map, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";

const ICONS: Record<string, any> = { country: Globe, region: Map, hotspot: Zap };

export const WatchlistBriefWidget = () => {
  const { items, events } = useWatchlist();
  const navigate = useNavigate();

  if (items.length === 0) return null;

  // Priority items first, then by recency of events
  const priorityItems = items.filter((i) => i.priority_level === "high");
  const recentEvents = events.slice(0, 5);

  // Items with recent events
  const changedItemIds = new Set(recentEvents.map((e) => e.watchlist_item_id));
  const changedItems = items.filter((i) => changedItemIds.has(i.id));
  const displayItems = [...new Map([...priorityItems, ...changedItems, ...items].map((i) => [i.id, i])).values()].slice(0, 5);

  return (
    <Card className="border-border">
      <CardContent className="p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          Your Watchlist Today
          <Badge variant="secondary" className="text-[10px] ml-auto">{items.length} monitored</Badge>
        </h3>
        <div className="space-y-2">
          {displayItems.map((item) => {
            const Icon = ICONS[item.watch_type] || Globe;
            const itemEvents = events.filter((e) => e.watchlist_item_id === item.id);
            const latestEvent = itemEvents[0];
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
                className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-border hover:border-primary/30 hover:bg-primary/5 transition-all text-left group"
              >
                <Icon className="h-4 w-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium group-hover:text-primary transition-colors truncate">{item.label}</span>
                    {item.priority_level === "high" && (
                      <Badge className="text-[9px] bg-amber-500/10 text-amber-600 border-amber-500/30" variant="outline">Priority</Badge>
                    )}
                  </div>
                  {latestEvent ? (
                    <p className="text-[11px] text-muted-foreground truncate">{latestEvent.event_summary}</p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">Monitoring · No changes detected</p>
                  )}
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
              </button>
            );
          })}
        </div>
        {items.length > 5 && (
          <button
            onClick={() => navigate("/watchlist")}
            className="mt-2 text-xs text-primary hover:underline"
          >
            View all {items.length} watch items →
          </button>
        )}
      </CardContent>
    </Card>
  );
};
