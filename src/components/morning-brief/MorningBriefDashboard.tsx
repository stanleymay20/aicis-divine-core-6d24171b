import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sunrise, ArrowRight, CheckCircle2, Radio, Activity, TrendingUp, Layers
} from "lucide-react";
import { format } from "date-fns";
import { PriorityDecisionsPanel } from "./PriorityDecisionsPanel";
import { ExecutiveProofPanel } from "./ExecutiveProofPanel";
import { GlobalSignalsBrief } from "./GlobalSignalsBrief";
import { RecentDecisionsWidget } from "./RecentDecisionsWidget";
import { TopRisksWidget } from "./TopRisksWidget";
import { SystemStatusStrip } from "./SystemStatusStrip";
import { SystemHealthBadge } from "./SystemHealthBadge";
import { WatchlistBriefWidget } from "@/components/watchlist/WatchlistBriefWidget";
import { useNavigate } from "react-router-dom";

export const MorningBriefDashboard = () => {
  const navigate = useNavigate();

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

      {/* ── SYSTEM STATUS STRIP ── */}
      <SystemStatusStrip />

      {/* ── VALUE PROPOSITION — what this system does for you ── */}
      <div className="rounded-lg border border-primary/20 bg-gradient-to-r from-primary/5 via-transparent to-transparent px-4 py-3">
        <p className="text-sm leading-relaxed">
          <span className="text-primary font-bold">AICIS</span>{" "}
          <span className="text-muted-foreground">tells you </span>
          <span className="text-foreground font-medium">what to do</span>
          <span className="text-muted-foreground">, </span>
          <span className="text-foreground font-medium">why it matters</span>
          <span className="text-muted-foreground">, and </span>
          <span className="text-foreground font-medium">how much it saves</span>
          <span className="text-muted-foreground"> — backed by data, not guesswork.</span>
        </p>
      </div>

      {/* ── 1. PROVEN VALUE — show ROI first ── */}
      <ExecutiveProofPanel />

      {/* ── 2. WHAT YOU MUST DECIDE — Priority Decisions (now with ROI + precedent) ── */}
      <PriorityDecisionsPanel />

      {/* ── WATCHLIST ── */}
      <WatchlistBriefWidget />

      {/* ── 3. WHAT MATTERS — Top Signals (now with action + estimated impact) ── */}
      <GlobalSignalsBrief />

      {/* ── 4. WHAT WE DID — Recent Decisions ── */}
      <RecentDecisionsWidget />

      {/* ── 5. RISK RADAR ── */}
      <TopRisksWidget />

      {/* ── 6. WHAT TO DO NEXT ── */}
      <Card className="border-border">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            What To Do Next
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <ActionCard
              icon={<Radio className="h-4 w-4 text-primary" />}
              title="Review Signals"
              desc="Check new intelligence"
              onClick={() => navigate("/live")}
            />
            <ActionCard
              icon={<Activity className="h-4 w-4 text-primary" />}
              title="Execute Decisions"
              desc="Act on open items"
              onClick={() => navigate("/decision-ops")}
            />
            <ActionCard
              icon={<TrendingUp className="h-4 w-4 text-primary" />}
              title="Record Outcomes"
              desc="Close the loop with evidence"
              onClick={() => navigate("/evidence-command")}
            />
            <ActionCard
              icon={<Layers className="h-4 w-4 text-primary" />}
              title="Drill Down"
              desc="Global → Country → Village"
              onClick={() => navigate("/resolution")}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const ActionCard = ({ icon, title, desc, onClick }: {
  icon: React.ReactNode; title: string; desc: string; onClick: () => void;
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
    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
  </button>
);
