import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { SystemWorkspaceNav } from "@/components/system/SystemWorkspaceNav";
import { useUserRoles } from "@/hooks/useUserRoles";

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
    case "healthy":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "recent":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "stale":
      return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    case "critical":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const isStalled = (heartbeat: Heartbeat) => {
  if (!heartbeat.last_success_at) return true;
  const minutesAgo =
    (Date.now() - new Date(heartbeat.last_success_at).getTime()) / 60_000;
  return minutesAgo > heartbeat.expected_interval_minutes * 2;
};

export default function SystemPulse() {
  const { isOperator } = useUserRoles();
  const [heartbeats, setHeartbeats] = useState<Heartbeat[]>([]);
  const [layers, setLayers] = useState<LayerHealth[]>([]);
  const [canaries, setCanaries] = useState<CanaryProbe[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [watchdogError, setWatchdogError] = useState<string | null>(null);
  const [lastSuccessfulLoadAt, setLastSuccessfulLoadAt] = useState<Date | null>(
    null,
  );

  const load = async () => {
    setLoading(true);

    try {
      const [heartbeatResult, layerResult, canaryResult] = await Promise.all([
        supabase
          .from("pipeline_heartbeats")
          .select("*")
          .order("pipeline_name"),
        supabase.rpc("check_accumulation_health"),
        supabase
          .from("canary_probes")
          .select("id,status,inserted_at,propagation_lag_seconds")
          .order("inserted_at", { ascending: false })
          .limit(20),
      ]);

      const errorMessages = [
        heartbeatResult.error?.message,
        layerResult.error?.message,
        canaryResult.error?.message,
      ].filter((message): message is string => Boolean(message));

      if (errorMessages.length > 0) {
        setLoadError(errorMessages.join(" · "));
        return;
      }

      setHeartbeats((heartbeatResult.data as Heartbeat[]) ?? []);
      setLayers(
        (
          layerResult.data as {
            layers?: LayerHealth[];
          } | null
        )?.layers ?? [],
      );
      setCanaries((canaryResult.data as CanaryProbe[]) ?? []);
      setLoadError(null);
      setLastSuccessfulLoadAt(new Date());
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "System health telemetry could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  };

  const triggerWatchdog = async () => {
    if (!isOperator) return;

    setRunning(true);
    setWatchdogError(null);

    try {
      const { error } = await supabase.functions.invoke("pipeline-watchdog");
      if (error) {
        setWatchdogError(error.message);
        return;
      }
      await load();
    } catch (error) {
      setWatchdogError(
        error instanceof Error
          ? error.message
          : "Watchdog action could not be completed.",
      );
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  const stalledCount = heartbeats.filter(isStalled).length;
  const healthyLayers = layers.filter((layer) => layer.status === "healthy").length;
  const verifiedCanaries = canaries.filter(
    (canary) => canary.status === "verified",
  ).length;
  const failedCanaries = canaries.filter(
    (canary) => canary.status === "failed",
  ).length;

  const pipelineValue =
    heartbeats.length === 0
      ? "—"
      : `${heartbeats.length - stalledCount}/${heartbeats.length}`;
  const pipelineSub =
    heartbeats.length === 0
      ? "No heartbeat records"
      : stalledCount > 0
        ? `${stalledCount} stalled`
        : "all reported pipelines healthy";

  const layerValue =
    layers.length === 0 ? "—" : `${healthyLayers}/${layers.length}`;
  const layerSub =
    layers.length === 0 ? "No layer-health records" : "healthy in 24h";

  const canaryValue =
    canaries.length === 0 ? "—" : `${verifiedCanaries} ✓`;
  const canarySub =
    canaries.length === 0
      ? "No probe records"
      : failedCanaries > 0
        ? `${failedCanaries} failed`
        : "no failures in loaded probes";

  return (
    <div className="min-h-screen bg-background p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <SystemWorkspaceNav />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <Activity className="h-7 w-7 text-primary" />
              <h1 className="text-3xl font-semibold tracking-tight">System Pulse</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Real-time accumulation health · auto-refresh 30s
            </p>
          </div>

          {isOperator ? (
            <Button onClick={triggerWatchdog} disabled={running} size="sm">
              <Zap className={`mr-2 h-4 w-4 ${running ? "animate-pulse" : ""}`} />
              {running ? "Running..." : "Run Watchdog Now"}
            </Button>
          ) : (
            <Badge
              variant="outline"
              className="h-7 text-[10px] text-muted-foreground"
            >
              Read-only system health
            </Badge>
          )}
        </div>

        {loadError && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">
                  System health telemetry unavailable
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
                {lastSuccessfulLoadAt && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Previously loaded values remain visible from the last successful
                    fetch at {lastSuccessfulLoadAt.toLocaleTimeString()}.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {watchdogError && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
          >
            Watchdog action failed · {watchdogError}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KPI
            label="Pipelines"
            value={pipelineValue}
            sub={pipelineSub}
            tone={
              heartbeats.length === 0
                ? "neutral"
                : stalledCount > 0
                  ? "critical"
                  : "healthy"
            }
          />
          <KPI
            label="Data Layers"
            value={layerValue}
            sub={layerSub}
            tone={
              layers.length === 0
                ? "neutral"
                : healthyLayers === layers.length
                  ? "healthy"
                  : "stale"
            }
          />
          <KPI
            label="Canary 24h"
            value={canaryValue}
            sub={canarySub}
            tone={
              canaries.length === 0
                ? "neutral"
                : failedCanaries > 0
                  ? "critical"
                  : "healthy"
            }
          />
          <KPI
            label="Watchdog schedule"
            value="every 15m"
            sub="auto-restart configured"
            tone="neutral"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="h-4 w-4" /> Pipeline Heartbeats
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {loading && heartbeats.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  Loading heartbeat telemetry…
                </div>
              )}
              {!loading && !loadError && heartbeats.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  No heartbeat records were returned.
                </div>
              )}
              {heartbeats.map((heartbeat) => {
                const stalled = isStalled(heartbeat);
                const lastSuccessText = heartbeat.last_success_at
                  ? formatDistanceToNow(new Date(heartbeat.last_success_at), {
                      addSuffix: true,
                    })
                  : "never";

                return (
                  <div
                    key={heartbeat.pipeline_name}
                    className="flex items-center justify-between rounded-lg border border-border bg-card/50 p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {stalled ? (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-mono text-sm">
                          {heartbeat.pipeline_name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          every {heartbeat.expected_interval_minutes}m · last{" "}
                          {lastSuccessText}
                          {heartbeat.consecutive_failures > 0 && (
                            <span className="ml-2 text-red-400">
                              · {heartbeat.consecutive_failures} fails
                            </span>
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Data Layer Accumulation (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading && layers.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Loading layer-health telemetry…
              </div>
            ) : !loadError && layers.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No layer-health records were returned.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {layers.map((layer) => (
                  <div
                    key={layer.table}
                    className="flex items-center justify-between rounded-lg border border-border bg-card/50 p-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {layer.layer}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {layer.total.toLocaleString()} total · +
                        {layer.growth_24h.toLocaleString()} 24h · {layer.hours_stale}h stale
                      </div>
                    </div>
                    <Badge className={statusColor(layer.status)}>
                      {layer.status.toUpperCase()}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Canary Probes (last 20)</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && canaries.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Loading canary telemetry…
              </div>
            ) : !loadError && canaries.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No canary probe records were returned.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-10">
                {canaries.map((canary) => (
                  <div
                    key={canary.id}
                    title={`${canary.status} · ${formatDistanceToNow(
                      new Date(canary.inserted_at),
                      { addSuffix: true },
                    )}${
                      canary.propagation_lag_seconds
                        ? ` · ${canary.propagation_lag_seconds}s lag`
                        : ""
                    }`}
                    className={`h-10 rounded border ${
                      canary.status === "verified"
                        ? "border-emerald-500/30 bg-emerald-500/15"
                        : canary.status === "failed"
                          ? "border-red-500/30 bg-red-500/15"
                          : "border-amber-500/30 bg-amber-500/15"
                    }`}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KPI({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "healthy" | "critical" | "stale" | "neutral";
}) {
  const accent =
    tone === "healthy"
      ? "text-emerald-400"
      : tone === "critical"
        ? "text-red-400"
        : tone === "stale"
          ? "text-amber-400"
          : "text-foreground";

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className={`text-2xl font-semibold ${accent}`}>{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}
