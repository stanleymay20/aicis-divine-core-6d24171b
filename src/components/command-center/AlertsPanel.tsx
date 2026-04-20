import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle, X, Bell, ChevronRight,
  Clock, MapPin, Shield, Activity, CheckCircle2, Filter
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAlertPreferences, applyAlertPreferences } from "@/hooks/useAlertPreferences";
import { AlertPreferencesPopover } from "./AlertPreferencesPopover";

interface Alert {
  id: string;
  title: string;
  message: string;
  severity: "critical" | "high" | "medium" | "low";
  division: string;
  country?: string;
  created_at: string;
  acknowledged: boolean;
}

interface AlertsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onAlertClick?: (alert: Alert) => void;
}

export const AlertsPanel = ({ isOpen, onClose, onAlertClick }: AlertsPanelProps) => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [filter, setFilter] = useState<"all" | "critical" | "unread">("all");
  const [loading, setLoading] = useState(true);
  const { prefs, save: savePrefs } = useAlertPreferences();

  useEffect(() => {
    const fetchAlerts = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("alerts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (data) {
        setAlerts(data.map(a => ({
          id: a.id,
          title: a.title,
          message: a.message,
          severity: a.severity as Alert["severity"],
          division: a.division,
          country: a.country || undefined,
          created_at: a.created_at || new Date().toISOString(),
          acknowledged: a.acknowledged || false,
        })));
      }
      setLoading(false);
    };

    fetchAlerts();

    // Real-time subscription
    const channel = supabase
      .channel("alerts-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newAlert = payload.new as any;
            setAlerts(prev => [{
              id: newAlert.id,
              title: newAlert.title,
              message: newAlert.message,
              severity: newAlert.severity,
              division: newAlert.division,
              country: newAlert.country,
              created_at: newAlert.created_at,
              acknowledged: newAlert.acknowledged || false,
            }, ...prev]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Apply saved per-user preferences first, then the quick-filter chip
  const prefFiltered = useMemo(
    () => applyAlertPreferences(alerts, prefs),
    [alerts, prefs]
  );

  const filteredAlerts = prefFiltered.filter((alert) => {
    if (filter === "critical") return alert.severity === "critical";
    if (filter === "unread") return !alert.acknowledged;
    return true;
  });

  // Build option lists from the live data so the popover only offers real choices
  const availableDivisions = useMemo(
    () => Array.from(new Set(alerts.map((a) => a.division).filter(Boolean))).sort(),
    [alerts]
  );
  const availableCountries = useMemo(
    () => Array.from(new Set(alerts.map((a) => a.country).filter(Boolean) as string[])).sort(),
    [alerts]
  );

  const criticalCount = prefFiltered.filter(a => a.severity === "critical" && !a.acknowledged).length;
  const unreadCount = prefFiltered.filter(a => !a.acknowledged).length;
  const hiddenByPrefs = alerts.length - prefFiltered.length;

  const getSeverityColor = (severity: Alert["severity"]) => {
    switch (severity) {
      case "critical": return "bg-destructive text-destructive-foreground";
      case "high": return "bg-warning text-background";
      case "medium": return "bg-primary text-primary-foreground";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getSeverityIcon = (severity: Alert["severity"]) => {
    switch (severity) {
      case "critical": return AlertTriangle;
      case "high": return Shield;
      case "medium": return Activity;
      default: return Bell;
    }
  };

  const formatTime = (date: string) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);

    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const acknowledgeAlert = async (alertId: string) => {
    await supabase
      .from("alerts")
      .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
      .eq("id", alertId);

    setAlerts(prev =>
      prev.map(a => a.id === alertId ? { ...a, acknowledged: true } : a)
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed top-0 right-0 h-full w-96 bg-card/95 backdrop-blur-xl border-l border-primary/20 shadow-2xl z-40 animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Bell className="h-5 w-5 text-primary" />
            {criticalCount > 0 && (
              <span className="absolute -top-1 -right-1 h-4 w-4 bg-destructive rounded-full text-[10px] flex items-center justify-center text-destructive-foreground font-bold animate-pulse">
                {criticalCount}
              </span>
            )}
          </div>
          <div>
            <h2 className="font-orbitron font-bold">Alerts</h2>
            <p className="text-xs text-muted-foreground">{unreadCount} unread</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1 p-2 border-b border-border/50">
        <div className="flex gap-1 flex-1 min-w-0 overflow-x-auto scrollbar-none">
          {[
            { key: "all", label: "All" },
            { key: "critical", label: "Critical", count: criticalCount },
            { key: "unread", label: "Unread", count: unreadCount },
          ].map(({ key, label, count }) => (
            <Button
              key={key}
              variant={filter === key ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs gap-1 shrink-0"
              onClick={() => setFilter(key as typeof filter)}
            >
              {label}
              {count !== undefined && count > 0 && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                  {count}
                </Badge>
              )}
            </Button>
          ))}
        </div>
        <AlertPreferencesPopover
          prefs={prefs}
          onChange={savePrefs}
          availableDivisions={availableDivisions}
          availableCountries={availableCountries}
        />
      </div>

      {hiddenByPrefs > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/30 border-b border-border/50 text-[10px] text-muted-foreground">
          <Filter className="h-3 w-3" />
          {hiddenByPrefs} alert{hiddenByPrefs === 1 ? "" : "s"} hidden by your filters
        </div>
      )}

      {/* Alert list */}
      <ScrollArea className="h-[calc(100vh-140px)]">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-pulse text-muted-foreground">Loading alerts...</div>
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground px-4 text-center">
            <CheckCircle2 className="h-8 w-8 mb-2 text-success" />
            <span className="text-sm">No alerts to show</span>
            {hiddenByPrefs > 0 && (
              <span className="text-[11px] mt-1">
                {hiddenByPrefs} hidden by your filters — open <strong>Filters</strong> to adjust
              </span>
            )}
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {filteredAlerts.map((alert) => {
              const Icon = getSeverityIcon(alert.severity);
              return (
                <button
                  key={alert.id}
                  className={cn(
                    "w-full text-left p-3 rounded-lg border transition-all hover:scale-[1.01]",
                    alert.acknowledged 
                      ? "bg-muted/30 border-border/50 opacity-70" 
                      : "bg-muted/50 border-primary/20 hover:border-primary/40"
                  )}
                  onClick={() => {
                    onAlertClick?.(alert);
                    if (!alert.acknowledged) acknowledgeAlert(alert.id);
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "p-1.5 rounded-md shrink-0",
                      getSeverityColor(alert.severity)
                    )}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-medium text-sm truncate">{alert.title}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                        {alert.message}
                      </p>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatTime(alert.created_at)}
                        </span>
                        {alert.country && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {alert.country}
                          </span>
                        )}
                        <Badge variant="outline" className="h-4 text-[9px]">
                          {alert.division}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};
