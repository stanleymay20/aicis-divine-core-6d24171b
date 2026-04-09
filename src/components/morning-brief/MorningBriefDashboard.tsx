import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sunrise, AlertTriangle, TrendingUp, Activity, Clock,
  ArrowRight, CheckCircle2, Target, Radio, Zap
} from "lucide-react";
import { format } from "date-fns";
import { TopRisksWidget } from "./TopRisksWidget";
import { GlobalSignalsBrief } from "./GlobalSignalsBrief";
import { RecentDecisionsWidget } from "./RecentDecisionsWidget";
import { SystemHealthBadge } from "./SystemHealthBadge";
import { RecentWinWidget } from "./RecentWinWidget";
import { useNavigate } from "react-router-dom";

export const MorningBriefDashboard = () => {
  const today = format(new Date(), "yyyy-MM-dd");
  const navigate = useNavigate();

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

  const { data: valueData } = useQuery({
    queryKey: ["brief-value-summary"],
    queryFn: async () => {
      const [decisionsRes, outcomesRes] = await Promise.all([
        supabase
          .from("decision_outcome_log")
          .select("id, action_taken, execution_status")
          .eq("action_taken", true),
        supabase
          .from("decision_outcome_log")
          .select("id, outcome_success, roi_estimate, net_value, evidence_type")
          .not("outcome_success", "is", null),
      ]);
      const decisions = decisionsRes.data || [];
      const outcomes = outcomesRes.data || [];
      const totalNetValue = outcomes.reduce((s, o) => s + (Number(o.net_value) || 0), 0);
      const successRate = outcomes.length > 0
        ? Math.round((outcomes.filter(o => o.outcome_success).length / outcomes.length) * 100)
        : 0;
      const avgROI = outcomes.length > 0
        ? outcomes.reduce((s, o) => s + (Number(o.roi_estimate) || 0), 0) / outcomes.length
        : 0;
      return {
        acted: decisions.length,
        outcomes: outcomes.length,
        inProgress: decisions.filter(d => d.execution_status === "in_progress").length,
        successRate,
        avgROI,
        totalNetValue,
        measured: outcomes.filter(o => o.evidence_type === "measured").length,
      };
    },
    staleTime: 120_000,
  });

  const todayHealth = healthData?.[0] || null;

  const formatCurrency = (val: number) => {
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
    return `$${val.toFixed(0)}`;
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* ── HERO HEADER ── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Sunrise className="h-4.5 w-4.5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">Today's Brief</h1>
              <p className="text-xs text-muted-foreground">{format(new Date(), "EEEE, MMMM d · HH:mm")} UTC</p>
            </div>
          </div>
        </div>
        <SystemHealthBadge />
      </div>

      {/* ── TAGLINE — 30-second understanding ── */}
      <div className="rounded-lg border border-border bg-card/50 px-4 py-3">
        <p className="text-sm text-muted-foreground leading-relaxed">
          <span className="text-foreground font-medium">AICIS</span> monitors global signals, recommends decisions, tracks execution, and measures outcomes —{" "}
          <span className="text-primary font-medium">proving the value of every action taken</span>.
        </p>
      </div>

      {/* ── VALUE SCORECARD — the first thing that proves worth ── */}
      {valueData && valueData.acted > 0 && (
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-transparent overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">System Impact</span>
              {valueData.measured > 0 && (
                <Badge variant="outline" className="text-[10px] border-primary/30 text-primary ml-auto">
                  {valueData.measured} measured
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <MetricBlock
                value={String(valueData.acted)}
                label="Decisions Acted"
                sub={`${valueData.inProgress} in progress`}
                accent={false}
              />
              <MetricBlock
                value={`${valueData.successRate}%`}
                label="Success Rate"
                sub={`${valueData.outcomes} outcomes`}
                accent={valueData.successRate >= 70}
              />
              <MetricBlock
                value={valueData.totalNetValue > 0 ? formatCurrency(valueData.totalNetValue) : "—"}
                label="Value Created"
                sub={valueData.totalNetValue > 0 ? "net captured" : "Pending"}
                accent={valueData.totalNetValue > 0}
              />
              <MetricBlock
                value={valueData.avgROI > 0 ? `${valueData.avgROI.toFixed(1)}x` : "—"}
                label="Avg ROI"
                sub={valueData.avgROI > 0 ? "per decision" : "Pending"}
                accent={valueData.avgROI > 1}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* No data yet — onboarding CTA */}
      {(!valueData || valueData.acted === 0) && (
        <Card className="border-primary/20">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Target className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">No decisions yet</p>
              <p className="text-xs text-muted-foreground">Review live signals and create your first decision to start tracking value.</p>
            </div>
            <Button size="sm" onClick={() => navigate("/live")} className="shrink-0 gap-1">
              View Signals <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── RECENT WIN — proof story ── */}
      <RecentWinWidget />

      {/* ── WHAT MATTERS — top signals ── */}
      <GlobalSignalsBrief />

      {/* ── WHAT WE DID — recent decisions ── */}
      <RecentDecisionsWidget />

      {/* ── RISK RADAR ── */}
      <TopRisksWidget />

      {/* ── WHAT TO DO NEXT ── */}
      <Card className="border-border">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            What To Do Next
          </h3>
          <div className="grid sm:grid-cols-3 gap-2">
            <ActionCard
              icon={<Radio className="h-4 w-4 text-primary" />}
              title="Review Signals"
              desc="Check new intelligence"
              onClick={() => navigate("/live")}
              count={todayHealth?.inferences_generated ?? undefined}
            />
            <ActionCard
              icon={<Activity className="h-4 w-4 text-primary" />}
              title="Manage Decisions"
              desc="Execute or close open items"
              onClick={() => navigate("/decision-ops")}
              count={valueData?.inProgress ?? undefined}
            />
            <ActionCard
              icon={<TrendingUp className="h-4 w-4 text-primary" />}
              title="Record Outcomes"
              desc="Capture results and evidence"
              onClick={() => navigate("/decision-ops")}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

/* ── Sub-components ── */

const MetricBlock = ({ value, label, sub, accent }: {
  value: string; label: string; sub: string; accent: boolean;
}) => (
  <div>
    <p className={`text-xl font-semibold ${accent ? "text-primary" : ""}`}>{value}</p>
    <p className="text-[11px] font-medium text-muted-foreground mt-0.5">{label}</p>
    <p className="text-[10px] text-muted-foreground/70">{sub}</p>
  </div>
);

const ActionCard = ({ icon, title, desc, onClick, count }: {
  icon: React.ReactNode; title: string; desc: string; onClick: () => void; count?: number;
}) => (
  <button
    onClick={onClick}
    className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/30 hover:bg-primary/5 transition-all text-left group"
  >
    <div className="shrink-0">{icon}</div>
    <div className="flex-1 min-w-0">
      <p className="text-sm font-medium group-hover:text-primary transition-colors">{title}</p>
      <p className="text-[11px] text-muted-foreground">{desc}</p>
    </div>
    {count !== undefined && count > 0 && (
      <Badge variant="secondary" className="text-[10px] shrink-0">{count}</Badge>
    )}
    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
  </button>
);
