import { AICISLayout } from "@/components/aicis/AICISLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useUserRoles } from "@/hooks/useUserRoles";
import {
  Radio,
  Eye,
  Brain,
  Shield,
  Cog,
  Database,
  LineChart,
  GitBranch,
  Server,
  Code2,
  Globe,
  ClipboardCheck,
  Sparkles,
  Workflow,
  MapPin,
  ArrowRight,
  Lock,
} from "lucide-react";

type Item = {
  label: string;
  desc: string;
  path: string;
  icon: any;
  audience: "operator" | "admin";
};

type Workspace = {
  title: string;
  desc: string;
  icon: any;
  items: Item[];
  audience: "operator" | "admin";
};

const workspaces: Workspace[] = [
  {
    title: "Operations",
    desc: "Investigate live events, review routed signals, and track outcomes.",
    icon: Workflow,
    audience: "operator",
    items: [
      { label: "Live Signal Stream", desc: "Raw event stream for analysts", path: "/live-stream", icon: Radio, audience: "operator" },
      { label: "Signal Validation", desc: "Source quality and human review", path: "/signal-validation", icon: ClipboardCheck, audience: "operator" },
      { label: "Outcome Cockpit", desc: "Track measured decisions and impact", path: "/outcome-cockpit", icon: LineChart, audience: "operator" },
      { label: "Local Events", desc: "Sub-national intelligence drilldown", path: "/local-events", icon: MapPin, audience: "operator" },
    ],
  },
  {
    title: "Model Intelligence",
    desc: "Use forecasts, simulations, training data, and calibration tools.",
    icon: Brain,
    audience: "operator",
    items: [
      { label: "Predictions", desc: "Forecasts and probability signals", path: "/predictions", icon: Sparkles, audience: "operator" },
      { label: "Simulation", desc: "What-if and scenario modelling", path: "/simulation", icon: GitBranch, audience: "operator" },
      { label: "Forecast Validation", desc: "Locked prospective evaluation", path: "/forecast-validation", icon: ClipboardCheck, audience: "operator" },
      { label: "Relevance Preferences", desc: "Tune what matters to the user", path: "/relevance-preferences", icon: Sparkles, audience: "operator" },
    ],
  },
  {
    title: "Trust & Governance",
    desc: "Audit evidence, governance flows, source integrity, and accountability.",
    icon: Shield,
    audience: "operator",
    items: [
      { label: "Governance Hub", desc: "Decision ledger and human-in-loop", path: "/governance", icon: Shield, audience: "operator" },
      { label: "Operational Truth", desc: "Database-backed evidence audit", path: "/operational-truth", icon: ClipboardCheck, audience: "operator" },
      { label: "API Audit", desc: "Inference and output traceability", path: "/api-audit", icon: Shield, audience: "admin" },
      { label: "Coverage Equity", desc: "Coverage balance across regions", path: "/coverage-equity", icon: Globe, audience: "operator" },
    ],
  },
  {
    title: "System Console",
    desc: "Admin-only platform infrastructure, exports, APIs, and pipeline health.",
    icon: Server,
    audience: "admin",
    items: [
      { label: "Pipeline Health", desc: "Ingestion and freshness monitoring", path: "/data-pipeline", icon: Workflow, audience: "admin" },
      { label: "Infrastructure", desc: "Edge functions, cron, and jobs", path: "/infra-ops", icon: Server, audience: "admin" },
      { label: "System Pulse", desc: "Platform health and telemetry", path: "/system-pulse", icon: LineChart, audience: "admin" },
      { label: "Data Export", desc: "Permissioned intelligence exports", path: "/data-export", icon: Database, audience: "admin" },
      { label: "Developer Platform", desc: "API keys, webhooks, and usage", path: "/developers", icon: Code2, audience: "admin" },
      { label: "Settings", desc: "Account and system administration", path: "/admin", icon: Cog, audience: "admin" },
    ],
  },
];

export default function Advanced() {
  const navigate = useNavigate();
  const { isAdmin, isOperator } = useUserRoles();

  const canSee = (audience: "operator" | "admin") => audience === "admin" ? isAdmin : isOperator;
  const visibleWorkspaces = workspaces
    .map((workspace) => ({
      ...workspace,
      items: workspace.items.filter((item) => canSee(item.audience)),
    }))
    .filter((workspace) => canSee(workspace.audience) && workspace.items.length > 0);

  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 max-w-[1180px] mx-auto overflow-y-auto h-full space-y-6 animate-fade-in">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Cog className="h-5 w-5 text-primary" />
              <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Operator Console</h1>
              <Badge variant="outline" className="text-[10px] uppercase tracking-wider">Role-aware</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Advanced workflows are kept behind operator and admin permissions so the daily intelligence experience stays calm.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/morning-brief")}>Back to Brief</Button>
            <Button size="sm" onClick={() => navigate("/intelligence-engine")}>Ask AICIS</Button>
          </div>
        </div>

        {!isOperator && !isAdmin && (
          <Card className="border-border bg-card/60">
            <CardContent className="p-6 flex items-start gap-3">
              <Lock className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium">No advanced workspace assigned</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Your default command view is the Brief, Signals, Decisions, Atlas, Ask AICIS, and Watchlist. Operator and system tools stay hidden unless assigned by an admin.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {visibleWorkspaces.map((workspace) => {
            const WorkspaceIcon = workspace.icon;
            return (
              <Card key={workspace.title} className="border-border bg-card/70">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <WorkspaceIcon className="h-4 w-4 text-primary" />
                    {workspace.title}
                    {workspace.audience === "admin" && <Badge variant="outline" className="text-[10px]">Admin</Badge>}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">{workspace.desc}</p>
                </CardHeader>
                <CardContent className="space-y-2">
                  {workspace.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.path}
                        className="w-full text-left rounded-lg border border-border hover:border-primary/30 hover:bg-primary/5 transition-all p-3 group"
                        onClick={() => navigate(item.path)}
                      >
                        <div className="flex items-start gap-3">
                          <Icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium group-hover:text-primary transition-colors truncate">{item.label}</p>
                              {item.audience === "admin" && <Badge variant="outline" className="text-[10px]">Admin</Badge>}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                          </div>
                          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-0.5" />
                        </div>
                      </button>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AICISLayout>
  );
}
