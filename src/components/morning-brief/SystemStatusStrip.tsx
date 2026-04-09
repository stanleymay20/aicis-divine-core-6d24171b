import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, Clock, Activity, Radio } from "lucide-react";

export function SystemStatusStrip() {
  const { data } = useQuery({
    queryKey: ["system-status-strip"],
    queryFn: async () => {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();

      const [logsRes, signalsRes, healthRes] = await Promise.all([
        supabase
          .from("automation_logs")
          .select("status, executed_at")
          .gte("executed_at", sixHoursAgo)
          .order("executed_at", { ascending: false }),
        supabase
          .from("global_signals")
          .select("id", { count: "exact", head: true })
          .gte("first_detected_at", today),
        supabase
          .from("automation_logs")
          .select("executed_at")
          .eq("status", "success")
          .order("executed_at", { ascending: false })
          .limit(1),
      ]);

      const logs = logsRes.data || [];
      const errors = logs.filter(l => l.status === "error" || l.status === "timeout").length;
      const total = logs.length;

      let state: "healthy" | "delayed" | "degraded" = "healthy";
      if (total === 0) state = "delayed";
      else if (errors / total > 0.3) state = "degraded";
      else if (errors > 0) state = "delayed";

      const lastRun = healthRes.data?.[0]?.executed_at;
      const lastRunLabel = lastRun
        ? `${Math.round((Date.now() - new Date(lastRun).getTime()) / 60000)}m ago`
        : "Unknown";

      return {
        state,
        signalsToday: signalsRes.count || 0,
        jobsRun: total,
        errors,
        lastRun: lastRunLabel,
      };
    },
    staleTime: 60_000,
  });

  if (!data) return null;

  const stateConfig = {
    healthy: { icon: CheckCircle2, label: "Healthy", cls: "text-emerald-400" },
    delayed: { icon: Clock, label: "Delayed", cls: "text-yellow-400" },
    degraded: { icon: AlertTriangle, label: "Degraded", cls: "text-destructive" },
  };

  const cfg = stateConfig[data.state];
  const Icon = cfg.icon;

  return (
    <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 border border-border/50">
      <span className={`flex items-center gap-1 font-medium ${cfg.cls}`}>
        <Icon className="h-3 w-3" />
        {cfg.label}
      </span>
      <span className="hidden sm:inline">•</span>
      <span className="flex items-center gap-1">
        <Activity className="h-3 w-3" />
        Last run: {data.lastRun}
      </span>
      <span className="hidden sm:inline">•</span>
      <span className="flex items-center gap-1">
        <Radio className="h-3 w-3" />
        {data.signalsToday} signals today
      </span>
      {data.errors > 0 && (
        <>
          <span className="hidden sm:inline">•</span>
          <span className="flex items-center gap-1 text-destructive">
            <AlertTriangle className="h-3 w-3" />
            {data.errors} errors
          </span>
        </>
      )}
    </div>
  );
}
