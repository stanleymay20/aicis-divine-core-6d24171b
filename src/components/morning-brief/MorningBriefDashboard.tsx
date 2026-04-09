import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sunrise, AlertTriangle, TrendingUp, Activity, Shield, Clock, Info } from "lucide-react";
import { format } from "date-fns";
import { TopRisksWidget } from "./TopRisksWidget";
import { OvernightChanges } from "./OvernightChanges";
import { SystemPulse } from "./SystemPulse";
import { GlobalSignalsBrief } from "./GlobalSignalsBrief";
import { WelcomeBanner } from "./WelcomeBanner";
import { RecentDecisionsWidget } from "./RecentDecisionsWidget";
import { ProofOfValueWidget } from "./ProofOfValueWidget";

export const MorningBriefDashboard = () => {
  const today = format(new Date(), "yyyy-MM-dd");

  const { data: healthData } = useQuery({
    queryKey: ["morning-brief-health", today],
    queryFn: async () => {
      const { data } = await supabase
        .from("daily_system_health")
        .select("*")
        .order("health_date", { ascending: false })
        .limit(2);
      return data || [];
    },
    staleTime: 60_000,
  });

  const { data: alertStats } = useQuery({
    queryKey: ["morning-brief-alerts"],
    queryFn: async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const { data } = await supabase
        .from("alerts")
        .select("severity, acknowledged")
        .gte("created_at", yesterday.toISOString());
      const all = data || [];
      return {
        total: all.length,
        critical: all.filter(a => a.severity === "critical").length,
        unack: all.filter(a => !a.acknowledged).length,
      };
    },
    staleTime: 60_000,
  });

  const todayHealth = healthData?.[0] || null;
  const yesterdayHealth = healthData?.[1] || null;

  return (
    <div className="space-y-6 animate-fade-in">
      <WelcomeBanner />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Sunrise className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Morning Brief</h1>
            <p className="text-sm text-muted-foreground">{format(new Date(), "EEEE, MMMM d, yyyy · HH:mm")} UTC</p>
          </div>
        </div>
        <Badge variant="outline" className="gap-1.5">
          <Clock className="h-3 w-3" />
          Updated {format(new Date(), "HH:mm")}
        </Badge>
      </div>

      {/* ── PROOF OF VALUE — first thing an executive sees ── */}
      <ProofOfValueWidget />

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Alerts (24h)"
          value={alertStats?.total ?? 0}
          sub={`${alertStats?.critical ?? 0} critical · ${alertStats?.unack ?? 0} unack`}
          alert={!!alertStats?.critical}
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Inferences Today"
          value={todayHealth?.inferences_generated ?? 0}
          sub={yesterdayHealth ? `vs ${yesterdayHealth.inferences_generated ?? 0} yesterday` : ""}
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Decisions Captured"
          value={todayHealth?.decisions_captured ?? 0}
          sub={`${todayHealth?.executions_started ?? 0} started`}
        />
        <StatCard
          icon={<Shield className="h-4 w-4" />}
          label="Outcomes Recorded"
          value={todayHealth?.outcomes_recorded ?? 0}
          sub={`${todayHealth?.measured_outcomes ?? 0} measured`}
        />
      </div>

      {/* Global Signals */}
      <GlobalSignalsBrief />

      {/* Top 5 Risks */}
      <TopRisksWidget />

      {/* Recent Decisions */}
      <RecentDecisionsWidget />

      {/* Two columns */}
      <div className="grid md:grid-cols-2 gap-4">
        <OvernightChanges />
        <SystemPulse />
      </div>
    </div>
  );
};

const EMPTY_HINTS: Record<string, string> = {
  "Alerts (24h)": "No alerts yet — signals will appear as data flows in",
  "Inferences Today": "AI analysis starts once live signals are ingested",
  "Decisions Captured": "Use 'Ask AI' to create your first decision",
  "Outcomes Recorded": "Outcomes are tracked after decisions are acted on",
};

const StatCard = ({
  icon, label, value, sub, alert,
}: {
  icon: React.ReactNode; label: string; value: number; sub: string; alert?: boolean;
}) => (
  <Card className={alert ? "border-destructive/50" : ""}>
    <CardContent className="p-3">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-2xl font-semibold">{value}</p>
      {value === 0 && EMPTY_HINTS[label] ? (
        <p className="text-[11px] text-muted-foreground/70 mt-1 leading-snug">{EMPTY_HINTS[label]}</p>
      ) : (
        sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
      )}
    </CardContent>
  </Card>
);
