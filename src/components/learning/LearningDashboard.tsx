import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Brain, TrendingUp, Target, Activity, BarChart3, Gauge, Shield, Zap
} from "lucide-react";
import { CalibrationTrendChart } from "./CalibrationTrendChart";
import { SignalReliabilityPanel } from "./SignalReliabilityPanel";
import { FeedbackSummaryPanel } from "./FeedbackSummaryPanel";
import { CrossDomainPatterns } from "./CrossDomainPatterns";

const GRADE_COLORS: Record<string, string> = {
  ANTICIPATING: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30",
  PREDICTING: "text-blue-500 bg-blue-500/10 border-blue-500/30",
  DETECTING: "text-amber-500 bg-amber-500/10 border-amber-500/30",
  SENSING: "text-muted-foreground bg-muted border-border",
};

export const LearningDashboard = () => {
  // Latest intelligence score snapshot
  const { data: latestScore, isLoading: scoreLoading } = useQuery({
    queryKey: ["learning-intelligence-score"],
    queryFn: async () => {
      const { data } = await supabase
        .from("intelligence_score_snapshots")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1);
      return data?.[0] || null;
    },
  });

  // Historical snapshots for trend
  const { data: scoreHistory } = useQuery({
    queryKey: ["learning-score-history"],
    queryFn: async () => {
      const { data } = await supabase
        .from("intelligence_score_snapshots")
        .select("turning_point_accuracy, break_detection_score, intelligence_grade, total_forecasts_evaluated, created_at")
        .order("created_at", { ascending: false })
        .limit(30);
      return (data || []).reverse();
    },
  });

  // Model registry
  const { data: model } = useQuery({
    queryKey: ["learning-model-info"],
    queryFn: async () => {
      const { data } = await supabase
        .from("model_registry")
        .select("model_version, status, created_at")
        .order("created_at", { ascending: false })
        .limit(1);
      return data?.[0] || null;
    },
  });

  // Calibration metrics latest
  const { data: calibration } = useQuery({
    queryKey: ["learning-calibration"],
    queryFn: async () => {
      const { data } = await supabase
        .from("calibration_metrics")
        .select("metric_name, metric_value, domain, computed_at")
        .order("computed_at", { ascending: false })
        .limit(20);
      return data || [];
    },
  });

  const grade = latestScore?.intelligence_grade || "SENSING";
  const gradeStyle = GRADE_COLORS[grade] || GRADE_COLORS.SENSING;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          Learning & Calibration
        </h1>
        <p className="text-sm text-muted-foreground">
          How AICIS improves — calibration trends, signal reliability, and feedback loops
        </p>
      </div>

      {/* Intelligence Grade Hero */}
      <Card className="border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
                <Gauge className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Intelligence Grade</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge className={`text-sm px-3 py-1 ${gradeStyle}`} variant="outline">
                    {grade}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {grade === "ANTICIPATING" && "System predicts changes before they happen"}
                    {grade === "PREDICTING" && "System reliably forecasts direction"}
                    {grade === "DETECTING" && "System catches turning points ~20% of the time"}
                    {grade === "SENSING" && "System is still learning from data"}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Shield className="h-3.5 w-3.5" />
              Model: {model?.model_version || "—"} · {model?.status || "—"}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Key Metrics Strip */}
      {scoreLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              icon: Target, label: "Turning Point Accuracy",
              value: `${latestScore?.turning_point_accuracy?.toFixed(1) || 0}%`,
              sub: `${latestScore?.turning_point_hits || 0}/${latestScore?.turning_point_total || 0} caught`,
              color: "text-primary",
            },
            {
              icon: Activity, label: "Break Detection",
              value: `${latestScore?.break_detection_score?.toFixed(1) || 0}%`,
              sub: `${latestScore?.break_detection_hits || 0}/${latestScore?.break_detection_total || 0}`,
              color: "text-amber-500",
            },
            {
              icon: BarChart3, label: "Total Forecasts",
              value: latestScore?.total_forecasts_evaluated ? `${(latestScore.total_forecasts_evaluated / 1000).toFixed(1)}K` : "0",
              sub: `${latestScore?.evaluation_window_days || 30}d window`,
              color: "text-blue-500",
            },
            {
              icon: TrendingUp, label: "vs Naive Baseline",
              value: `+${latestScore?.filtered_delta?.toFixed(1) || 0}%`,
              sub: "During change periods",
              color: "text-emerald-500",
            },
          ].map((m) => (
            <Card key={m.label} className="border-border/50">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <m.icon className={`h-4 w-4 ${m.color}`} />
                  <span className="text-[10px] text-muted-foreground font-medium">{m.label}</span>
                </div>
                <p className={`text-xl font-bold ${m.color}`}>{m.value}</p>
                <p className="text-[10px] text-muted-foreground">{m.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Calibration Trend Chart */}
      <CalibrationTrendChart history={scoreHistory || []} calibration={calibration || []} />

      {/* Signal Reliability + Feedback side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SignalReliabilityPanel />
        <FeedbackSummaryPanel />
      </div>

      {/* Cross-Domain Pattern Detection */}
      <CrossDomainPatterns />
    </div>
  );
};
