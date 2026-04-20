import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Heartbeat {
  pipeline_name: string;
  last_success_at: string | null;
  last_attempt_at: string | null;
  expected_interval_minutes: number;
  consecutive_failures: number;
  target_function: string | null;
  enabled: boolean;
  last_error: string | null;
}

interface LayerHealth {
  layer: string;
  table: string;
  total: number;
  growth_24h: number;
  hours_stale: number;
  status: "healthy" | "recent" | "stale" | "critical";
}

interface CanaryProbe {
  id: string;
  status: string;
  inserted_at: string;
  propagation_lag_seconds: number | null;
}

const statusColor = (status: string) => {
  switch (status) {
    case "healthy": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "recent": return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "stale": return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    case "critical": return "bg-red-500/15 text-red-400 border-red-500/30";
    default: return "bg-muted text-muted-foreground";
  }
};

const isStalled = (hb: Heartbeat) => {
  if (!hb.last_success_at) return true;
  const minutesAgo = (Date.now() - new Date(hb.last_success_at).getTime()) / 60000;
  return minutesAgo > hb.expected_interval_minutes * 2;
};

export default function SystemPulse() {
  const [heartbeats, setHeartbeats] = useState<Heartbeat[]>([]);
  const [layers, setLayers] = useState<LayerHealth[]>([]);
  const [canaries, setCanaries] = useState<CanaryProbe[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: hb }, { data: lh }, { data: cp }] = await Promise.all([
      supabase.from("pipeline_heartbeats").select("*").order("pipeline_name"),
      supabase.rpc("check_accumulation_health"),
      supabase.from("canary_probes").select("id,status,inserted_at,propagation_lag_seconds")
        .order("inserted_at", { ascending: false }).limit(20),
    ]);
    setHeartbeats((hb as Heartbeat[]) || []);
    const layersData = (lh as any)?.layers || [];
    setLayers(layersData);
    setCanaries((cp as CanaryProbe[]) || []);
    setLoading(false);
  };

  const triggerWatchdog = async () => {
    setRunning(true);
    await supabase.functions.invoke("pipeline-watchdog");
    await load();
    setRunning(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const stalledCount = heartbeats.filter(isStalled).length;
  const healthyLayers = layers.filter(l => l.status === "healthy").length;
  const verifiedCanaries = canaries.filter(c => c.status === "verified").length;
  const failedCanaries = canaries.filter(c => c.status === "failed").length;

  return (
    <div className="min-h-screen bg-background p-6 lg:p-10">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Activity className="h-7 w-7 text-primary" />
              <h1 className="text-3xl font-semibold tracking-tight">System Pulse</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Real-time accumulation health · auto-refresh 30s
            </p>
          </div>
          <Button onClick={triggerWatchdog} disabled={running} size="sm">
            <Zap className={`h-4 w-4 mr-2 ${running ? "animate-pulse" : ""}`} />
            {running ? "Running..." : "Run Watchdog Now"}
          </Button>
        </div>

        {/* Top KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPI
            label="Pipelines"
            value={`${heartbeats.length - stalledCount}/${heartbeats.length}`}
            sub={stalledCount > 0 ? `${stalledCount} stalled` : "all healthy"}
            tone={stalledCount > 0 ? "critical" : "healthy"}
          />
          <KPI
            label="Data Layers"
            value={`${healthyLayers}/${layers.length}`}
            sub="healthy in 24h"
            tone={healthyLayers === layers.length ? "healthy" : "stale"}
          />
          <KPI
            label="Canary 24h"
            value={`${verifiedCanaries} ✓`}
            sub={failedCanaries > 0 ? `${failedCanaries} failed` : "no failures"}
            tone={failedCanaries > 0 ? "critical" : "healthy"}
          />
          <KPI
            label="Watchdog"
            value="every 15m"
            sub="auto-restart on stall"
            tone="healthy"
          />
        </div>

        {/* Pipeline Heartbeats */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="h-4 w-4" /> Pipeline Heartbeats
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
              {!loading && heartbeats.map(hb => {
                const stalled = isStalled(hb);
                const lastSuccessText = hb.last_success_at
                  ? formatDistanceToNow(new Date(hb.last_success_at), { addSuffix: true })
                  : "never";
                return (
                  <div
                    key={hb.pipeline_name}
                    className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {stalled ? (
                        <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="font-mono text-sm truncate">{hb.pipeline_name}</div>
                        <div className="text-xs text-muted-foreground">
                          every {hb.expected_interval_minutes}m · last {lastSuccessText}
                          {hb.consecutive_failures > 0 && (
                            <span className="text-red-400 ml-2">· {hb.consecutive_failures} fails</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Badge className={statusColor(stalled ? "critical" : "healthy")}>
                      {stalled ? "STALLED" : "OK"}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Data Layers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Data Layer Accumulation (24h)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {layers.map(l => (
                <div key={l.table} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/50">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{l.layer}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.total.toLocaleString()} total · +{l.growth_24h.toLocaleString()} 24h · {l.hours_stale}h stale
                    </div>
                  </div>
                  <Badge className={statusColor(l.status)}>{l.status.toUpperCase()}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Canary probes */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Canary Probes (last 20)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-10 gap-2">
              {canaries.map(c => (
                <div
                  key={c.id}
                  title={`${c.status} · ${formatDistanceToNow(new Date(c.inserted_at), { addSuffix: true })}${c.propagation_lag_seconds ? ` · ${c.propagation_lag_seconds}s lag` : ""}`}
                  className={`h-10 rounded border ${
                    c.status === "verified"
                      ? "bg-emerald-500/15 border-emerald-500/30"
                      : c.status === "failed"
                      ? "bg-red-500/15 border-red-500/30"
                      : "bg-amber-500/15 border-amber-500/30"
                  }`}
                />
              ))}
              {canaries.length === 0 && (
                <div className="text-sm text-muted-foreground col-span-full">
                  No probes yet — first will appear within 1 hour.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KPI({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "healthy" | "critical" | "stale" }) {
  const accent = tone === "healthy"
    ? "text-emerald-400"
    : tone === "critical"
    ? "text-red-400"
    : "text-amber-400";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
        <div className={`text-2xl font-semibold ${accent}`}>{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{sub}</div>
      </CardContent>
    </Card>
  );
}
