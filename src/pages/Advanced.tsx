import { AICISLayout } from "@/components/aicis/AICISLayout";
import { Card, CardContent } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import {
  Radio, Activity, Eye, Brain, Shield, Cog, Database, FlaskConical,
  LineChart, GitBranch, Server, Code2, Layers, Globe, BookOpen, Gauge,
  ClipboardCheck, Sparkles, Workflow, MapPin, Send, ArrowRight, Download,
} from "lucide-react";

type Item = { label: string; desc: string; path: string; icon: any };
type Group = { title: string; items: Item[] };

const groups: Group[] = [
  {
    title: "Operations",
    items: [
      { label: "Live Signal Stream", desc: "Raw firehose of incoming events", path: "/live-stream", icon: Radio },
      { label: "Daily Evidence Ops", desc: "Operator console for evidence production", path: "/daily-evidence-ops", icon: Workflow },
      { label: "Outcome Cockpit", desc: "Track measured outcomes by operator", path: "/outcome-cockpit", icon: ClipboardCheck },
      { label: "Pilot Truth Feed", desc: "Pilot evidence and lifecycle review", path: "/pilot-truth", icon: FlaskConical },
      { label: "Tracked Markets", desc: "Watchlist of countries and routes", path: "/watchlist", icon: Eye },
    ],
  },
  {
    title: "Intelligence & Models",
    items: [
      { label: "Risk Ranking", desc: "Top emerging risks leaderboard", path: "/risk-ranking", icon: LineChart },
      { label: "Predictions", desc: "ML predictions and calibration", path: "/predictions", icon: Sparkles },
      { label: "Simulation", desc: "Monte Carlo what-if scenarios", path: "/simulation", icon: GitBranch },
      { label: "Intelligence Engine", desc: "ML / graph / simulation engines", path: "/intelligence-engine", icon: Brain },
      { label: "Learning Loop", desc: "Self-improving model performance", path: "/learning-loop", icon: BookOpen },
      { label: "System Accuracy", desc: "Calibration and learning dashboard", path: "/learning", icon: Gauge },
      { label: "Forecast Validation", desc: "Locked prospective evaluation", path: "/forecast-validation", icon: ClipboardCheck },
      { label: "Training Dataset", desc: "Build and export ML datasets", path: "/training-dataset", icon: Database },
      { label: "Relevance Preferences", desc: "Personalize signal scoring", path: "/relevance-preferences", icon: Sparkles },
    ],
  },
  {
    title: "Geography",
    items: [
      { label: "Country & Region Map", desc: "Drill-down resolution explorer", path: "/resolution", icon: Globe },
      { label: "Local Events (LRIL)", desc: "Sub-national reality intelligence", path: "/local-events", icon: MapPin },
      { label: "Coverage Equity", desc: "Data coverage by country/region", path: "/coverage-equity", icon: Layers },
    ],
  },
  {
    title: "Governance & Trust",
    items: [
      { label: "Governance Hub", desc: "Decision ledger, human-in-loop", path: "/governance", icon: Shield },
      { label: "Operational Truth", desc: "Live database evidence audit", path: "/operational-truth", icon: ClipboardCheck },
      { label: "Signal Validation", desc: "Source quality & validation", path: "/signal-validation", icon: ClipboardCheck },
      { label: "API Audit", desc: "Inference audit chain (SHA-256)", path: "/api-audit", icon: Shield },
    ],
  },
  {
    title: "System & Infra",
    items: [
      { label: "System Status", desc: "Health and uptime", path: "/system-status", icon: Server },
      { label: "System Pulse", desc: "Real-time pipeline pulse", path: "/system-pulse", icon: Activity },
      { label: "System Catalog", desc: "All modules and capabilities", path: "/system-catalog", icon: Layers },
      { label: "Data Pipeline", desc: "Ingestion orchestrator", path: "/data-pipeline", icon: Workflow },
      { label: "Infrastructure", desc: "Edge functions, cron, jobs", path: "/infra-ops", icon: Server },
      { label: "Accumulation", desc: "Heartbeat & metric accumulation", path: "/accumulation", icon: Gauge },
      { label: "Data Export", desc: "Permissioned, logged dataset exports", path: "/data-export", icon: Send },
      { label: "Developer Portal", desc: "API keys, webhooks, docs", path: "/developers", icon: Code2 },
      { label: "Register Node", desc: "Federation node registration", path: "/register-node", icon: GitBranch },
      { label: "Settings", desc: "Account & admin settings", path: "/admin", icon: Cog },
    ],
  },
];

export default function Advanced() {
  const navigate = useNavigate();
  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 max-w-[1200px] mx-auto overflow-y-auto h-full space-y-6 animate-fade-in">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Cog className="h-5 w-5 text-primary" /> Advanced
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Power-user surfaces, engines, and audit tools. Hidden from the executive view to keep daily operations clean.
          </p>
        </div>

        {groups.map((g) => (
          <section key={g.title} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {g.items.map((it) => {
                const Icon = it.icon;
                return (
                  <Card
                    key={it.path}
                    className="border-border hover:border-primary/30 hover:bg-primary/5 transition-all cursor-pointer group"
                    onClick={() => navigate(it.path)}
                  >
                    <CardContent className="p-3 flex items-start gap-3">
                      <div className="shrink-0 mt-0.5">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium group-hover:text-primary transition-colors truncate">
                          {it.label}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{it.desc}</p>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-1" />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </AICISLayout>
  );
}
