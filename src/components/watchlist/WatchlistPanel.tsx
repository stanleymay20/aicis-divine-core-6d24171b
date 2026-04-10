import { useWatchlist, WatchlistItem, WatchlistEvent, WatchType } from "@/hooks/useWatchlist";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Eye, Globe, Map, Zap, Trash2, ArrowRight, Star, StarOff,
  Bell, BellOff, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle2, Clock, Package, Layers, Target
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

const TYPE_META: Record<WatchType, { icon: any; color: string; bg: string; label: string }> = {
  country: { icon: Globe, color: "text-blue-500", bg: "bg-blue-500/10", label: "Market" },
  region: { icon: Map, color: "text-amber-500", bg: "bg-amber-500/10", label: "Region" },
  hotspot: { icon: Zap, color: "text-red-500", bg: "bg-red-500/10", label: "Hotspot" },
};

const STATUS_META: Record<string, { label: string; icon: any; color: string; bg: string }> = {
  critical: { label: "Critical", icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/10 border-destructive/30" },
  rising: { label: "Rising Risk", icon: TrendingUp, color: "text-amber-500", bg: "bg-amber-500/10 border-amber-500/30" },
  improving: { label: "Improving", icon: TrendingDown, color: "text-emerald-500", bg: "bg-emerald-500/10 border-emerald-500/30" },
  stable: { label: "Stable", icon: CheckCircle2, color: "text-muted-foreground", bg: "bg-muted/50 border-border" },
};

const EVENT_LABELS: Record<string, string> = {
  risk_increase: "Risk increased",
  risk_decrease: "Risk decreased",
  new_signal: "New risk detected",
  signal_escalation: "Risk escalation",
  region_deterioration: "Region worsened",
  region_improvement: "Region improved",
  multi_domain_stress: "Compounding disruption",
  propagation_alert: "Risk propagation",
};

const BUSINESS_CONTEXT: Record<string, string> = {
  country: "May affect shipment timing, fuel costs, port reliability, or supplier continuity",
  region: "Regional instability may disrupt local sourcing, transport, or workforce availability",
  hotspot: "Active risk zone — may cause immediate delays or cost escalations",
};

export const WatchlistPanel = () => {
  const { sortedItems, events, isLoading, removeItem, updatePriority, toggleAlert } = useWatchlist();
  const navigate = useNavigate();

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
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
      </div>
    );
  }

  if (sortedItems.length === 0) {
    return (
      <Card className="border-dashed border-border">
        <CardContent className="py-12 text-center">
          <Eye className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
          <h3 className="text-sm font-semibold text-foreground mb-1">No Tracked Markets Yet</h3>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto mb-1">
            Track the countries, regions, and trade routes that matter to your supply chain.
          </p>
          <p className="text-[10px] text-muted-foreground max-w-xs mx-auto">
            AICIS will monitor your tracked markets and alert you when risks change, new disruptions appear, or conditions worsen.
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate("/resolution")}>
            Open Risk Map
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {/* Summary strip */}
      <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
        <span>{sortedItems.length} tracked</span>
        <span>·</span>
        <span className="text-destructive font-medium">
          {sortedItems.filter((i) => i.current_status === "critical").length} critical
        </span>
        <span>·</span>
        <span className="text-amber-500 font-medium">
          {sortedItems.filter((i) => i.current_status === "rising").length} rising risk
        </span>
        <span>·</span>
        <span>
          {sortedItems.filter((i) => i.alert_enabled).length} alerts active
        </span>
      </div>

      {sortedItems.map((item) => {
        const meta = TYPE_META[item.watch_type];
        const statusMeta = STATUS_META[item.current_status] || STATUS_META.stable;
        const Icon = meta.icon;
        const StatusIcon = statusMeta.icon;
        const itemEvents = getEventsForItem(item.id);
        const isPriority = item.priority_level === "high";
        const isAlerting = item.alert_enabled && item.last_alerted_at && item.current_status !== "stable";
        const isCritical = item.current_status === "critical";

        return (
          <Card
            key={item.id}
            className={cn(
              "transition-all hover:shadow-sm",
              isCritical && "border-destructive/30",
              item.current_status === "rising" && "border-amber-500/20",
              isAlerting && "ring-1 ring-destructive/20",
            )}
          >
            <CardContent className="p-3 sm:p-4 space-y-2">
              {/* Header row */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`p-1.5 rounded ${meta.bg} shrink-0`}>
                    <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold truncate">{item.label}</p>
                      {isPriority && <Star className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />}
                      <Badge variant="outline" className="text-[9px] shrink-0">{meta.label}</Badge>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span>Tracked since {format(new Date(item.created_at), "MMM d")}</span>
                      {item.last_checked_at && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-0.5">
                            <Clock className="h-2.5 w-2.5" />
                            Checked {formatDistanceToNow(new Date(item.last_checked_at), { addSuffix: true })}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Status badge */}
                <Badge variant="outline" className={cn("text-[10px] gap-1 shrink-0", statusMeta.bg, statusMeta.color)}>
                  <StatusIcon className="h-3 w-3" />
                  {statusMeta.label}
                </Badge>
              </div>

              {/* Risk value + delta */}
              {item.last_risk_value != null && (
                <div className="flex items-center gap-3 ml-8">
                  <span className="text-xs text-muted-foreground">Market risk:</span>
                  <span className={cn(
                    "text-sm font-bold",
                    item.last_risk_value >= 70 ? "text-destructive" : item.last_risk_value >= 50 ? "text-amber-500" : "text-emerald-500"
                  )}>
                    {item.last_risk_value.toFixed(1)}
                  </span>
                  {itemEvents[0]?.delta_value != null && (
                    <span className={cn(
                      "text-xs font-mono",
                      itemEvents[0].delta_value > 0 ? "text-destructive" : "text-emerald-500"
                    )}>
                      {itemEvents[0].delta_value > 0 ? "+" : ""}{itemEvents[0].delta_value.toFixed(1)} pts
                    </span>
                  )}
                </div>
              )}

              {/* Business context */}
              <div className="ml-8 flex items-start gap-1.5 text-[10px] text-muted-foreground">
                <Package className="h-3 w-3 mt-0.5 shrink-0" />
                <span>{BUSINESS_CONTEXT[item.watch_type]}</span>
              </div>

              {/* Latest events */}
              {itemEvents.length > 0 && (
                <div className="ml-8 space-y-1">
                  {itemEvents.map((ev) => (
                    <div key={ev.id} className="flex items-start gap-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] shrink-0",
                          ev.severity === "critical" ? "border-destructive/30 text-destructive" :
                          ev.severity === "high" ? "border-amber-500/30 text-amber-500" :
                          "border-border text-muted-foreground"
                        )}
                      >
                        {EVENT_LABELS[ev.event_type] || ev.event_type}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground leading-snug">{ev.event_summary}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Recommended next step for critical/rising items */}
              {(isCritical || item.current_status === "rising") && (
                <div className="ml-8 bg-primary/5 rounded px-2.5 py-1.5 flex items-start gap-1.5">
                  <Target className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                  <span className="text-[11px] font-medium">
                    {isCritical
                      ? "Review immediately — consider alternative sourcing or hedging"
                      : "Monitor closely — prepare contingency plans for this market"}
                  </span>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-1 ml-8 pt-1 flex-wrap">
                <Button
                  variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => updatePriority.mutate({ id: item.id, priority: isPriority ? "normal" : "high" })}
                  title={isPriority ? "Remove priority" : "Set as priority"}
                >
                  {isPriority ? <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" /> : <StarOff className="h-3.5 w-3.5 text-muted-foreground" />}
                </Button>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => toggleAlert.mutate({ id: item.id, enabled: !item.alert_enabled })}
                  title={item.alert_enabled ? "Mute alerts" : "Enable alerts"}
                >
                  {item.alert_enabled ? <Bell className="h-3.5 w-3.5 text-primary" /> : <BellOff className="h-3.5 w-3.5 text-muted-foreground" />}
                </Button>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => removeItem.mutate(item.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>

                {isCritical && (
                  <Button
                    variant="outline" size="sm" className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => navigate("/decision-ops")}
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Escalate to action
                  </Button>
                )}
                <Button
                  variant="ghost" size="sm" className="h-7 text-xs gap-1 ml-auto text-primary"
                  onClick={() => handleNavigate(item)}
                >
                  <Layers className="h-3 w-3" />
                  Open in map
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
