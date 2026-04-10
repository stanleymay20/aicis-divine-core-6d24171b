import { useWatchlist, WatchlistItem, WatchType } from "@/hooks/useWatchlist";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Eye, Globe, Map, Zap, Trash2, ArrowRight, Star, StarOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";

const TYPE_META: Record<WatchType, { icon: any; color: string; bg: string }> = {
  country: { icon: Globe, color: "text-blue-500", bg: "bg-blue-500/10" },
  region: { icon: Map, color: "text-amber-500", bg: "bg-amber-500/10" },
  hotspot: { icon: Zap, color: "text-red-500", bg: "bg-red-500/10" },
};

export const WatchlistPanel = () => {
  const { items, events, isLoading, removeItem, updatePriority } = useWatchlist();
  const navigate = useNavigate();

  const grouped = {
    country: items.filter((i) => i.watch_type === "country"),
    region: items.filter((i) => i.watch_type === "region"),
    hotspot: items.filter((i) => i.watch_type === "hotspot"),
  };

  const getEventsForItem = (id: string) => events.filter((e) => e.watchlist_item_id === id).slice(0, 3);

  const handleNavigate = (item: WatchlistItem) => {
    if (item.watch_type === "country" && item.country_iso3) {
      navigate(`/resolution?country=${item.country_iso3}`);
    } else if (item.watch_type === "region" && item.region_id) {
      navigate(`/resolution?region=${item.region_id}`);
    } else {
      navigate("/resolution");
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="border-dashed border-border">
        <CardContent className="py-12 text-center">
          <Eye className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
          <h3 className="text-sm font-semibold text-foreground mb-1">No Watch Items Yet</h3>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            Save countries, regions, or hotspots from the Resolution Explorer to monitor ongoing changes.
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate("/resolution")}>
            Open Resolution Explorer
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {(["country", "region", "hotspot"] as WatchType[]).map((type) => {
        const group = grouped[type];
        if (group.length === 0) return null;
        const meta = TYPE_META[type];
        const Icon = meta.icon;

        return (
          <Card key={type}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Icon className={`h-4 w-4 ${meta.color}`} />
                {type === "country" ? "Countries" : type === "region" ? "Regions" : "Hotspots"}
                <Badge variant="secondary" className="text-[10px] ml-auto">{group.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {group.map((item) => {
                  const itemEvents = getEventsForItem(item.id);
                  const isPriority = item.priority_level === "high";
                  return (
                    <div key={item.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`p-1.5 rounded ${meta.bg} shrink-0`}>
                            <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{item.label}</p>
                            <p className="text-[10px] text-muted-foreground">
                              Added {format(new Date(item.created_at), "MMM d")}
                              {item.country_iso3 && ` · ${item.country_iso3}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => updatePriority.mutate({ id: item.id, priority: isPriority ? "normal" : "high" })}
                          >
                            {isPriority ? <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" /> : <StarOff className="h-3.5 w-3.5 text-muted-foreground" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-red-500"
                            onClick={() => removeItem.mutate(item.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleNavigate(item)}
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      {itemEvents.length > 0 && (
                        <div className="mt-2 ml-8 space-y-1">
                          {itemEvents.map((ev) => (
                            <div key={ev.id} className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className={`text-[9px] ${ev.severity === "critical" ? "border-red-500/30 text-red-500" : ev.severity === "high" ? "border-amber-500/30 text-amber-500" : "border-border text-muted-foreground"}`}
                              >
                                {ev.event_type}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground truncate">{ev.event_summary}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
