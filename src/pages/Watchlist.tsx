import { AICISLayout } from "@/components/aicis/AICISLayout";
import { WatchlistPanel } from "@/components/watchlist/WatchlistPanel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eye, Plus, AlertTriangle, TrendingUp, Bell, Globe } from "lucide-react";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useNavigate } from "react-router-dom";

export default function Watchlist() {
  const navigate = useNavigate();
  const { sortedItems = [] } = useWatchlist();

  const total = sortedItems.length;
  const critical = sortedItems.filter((i) => i.current_status === "critical").length;
  const rising = sortedItems.filter((i) => i.current_status === "rising").length;
  const alerts = sortedItems.filter((i) => i.alert_enabled).length;
  const avgRisk = total
    ? Math.round(
        (sortedItems.reduce((s, i) => s + (i.last_risk_value ?? 0), 0) / total) * 10,
      ) / 10
    : 0;

  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 max-w-[1100px] mx-auto overflow-y-auto h-full space-y-5 animate-fade-in">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-foreground tracking-tight flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
              Tracked Markets
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Monitor your key sourcing markets, trade routes, and supply regions for disruptions.
              Auto-scanned every 30 minutes.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground border border-border rounded px-2 py-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse mr-1.5 align-middle" />
              Live · 30m scan
            </span>
            <Button size="sm" className="h-8 gap-1.5" onClick={() => navigate("/resolution")}>
              <Plus className="h-3.5 w-3.5" />
              Add market
            </Button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Card className="p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              <Globe className="h-3 w-3" /> Tracked
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums mt-1">{total}</div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              <AlertTriangle className="h-3 w-3" /> Critical
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-destructive mt-1">{critical}</div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              <TrendingUp className="h-3 w-3" /> Rising
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-amber-500 mt-1">{rising}</div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              <Bell className="h-3 w-3" /> Alerts on
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-primary mt-1">{alerts}</div>
          </Card>
          <Card className="p-3 col-span-2 sm:col-span-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Avg risk</div>
            <div className={`text-2xl font-bold font-mono tabular-nums mt-1 ${
              avgRisk >= 70 ? "text-destructive" : avgRisk >= 50 ? "text-amber-500" : "text-emerald-500"
            }`}>
              {avgRisk || "—"}
            </div>
          </Card>
        </div>

        <WatchlistPanel />
      </div>
    </AICISLayout>
  );
}
