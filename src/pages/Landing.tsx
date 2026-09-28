import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { PublicIntelligenceShowcase } from "@/components/landing/PublicIntelligenceShowcase";
import { PlanetaryPulseMap } from "@/components/planetary/PlanetaryPulseMap";
import { PlanetaryHeartbeat } from "@/components/planetary/PlanetaryHeartbeat";
import { SEO } from "@/components/SEO";
import {
  Shield,
  Activity,
  Globe,
  TrendingUp,
  Lock,
  Zap,
  CheckCircle2,
  ArrowRight,
  BarChart3,
  Network,
  Eye,
  Menu,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const Landing = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  // Authenticated users skip landing
  useEffect(() => {
    if (!loading && user) {
      navigate("/morning-brief", { replace: true });
    }
  }, [user, loading, navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEO
        title="AICIS — Decision Intelligence for Sovereign Operators"
        description="Planetary-scale risk intelligence with auditable forecasts, decision tracking, and zero-surveillance guarantees across 211 countries."
        path="/"
      />

      {/* Nav */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-background/90 border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center">
              <Shield className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="text-base font-semibold tracking-tight">AICIS</span>
            <Badge variant="outline" className="hidden sm:inline-flex ml-1 text-[10px] uppercase tracking-wider border-primary/30 text-primary">
              Decision Intelligence
            </Badge>
          </Link>
          <nav className="hidden md:flex items-center gap-2">
            <PlanetaryHeartbeat />
            <Button variant="ghost" size="sm" asChild>
              <Link to="/status">Status</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/morning-brief?demo=true">View Demo</Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/auth">
                Sign In <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </Button>
          </nav>
          <div className="flex md:hidden items-center gap-2">
            <Button size="sm" asChild>
              <Link to="/auth">Sign In</Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Open navigation menu">
                  <Menu className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild>
                  <Link to="/morning-brief?demo=true" className="min-h-9 cursor-pointer">View Live Demo</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/status" className="min-h-9 cursor-pointer">System Status</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-background to-background pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-10 sm:pt-20 pb-10 sm:pb-20 text-center">
          <Badge className="mb-4 sm:mb-6 bg-primary/10 text-primary border-primary/20 hover:bg-primary/15 max-w-full">
            <Activity className="h-3 w-3 mr-1.5" />
            Live planetary intelligence
          </Badge>

          <p className="text-xs font-mono uppercase tracking-wider text-primary mb-3">AICIS · Decision Intelligence</p>
          <h1 className="text-[2.6rem] sm:text-5xl md:text-7xl font-bold mb-4 sm:mb-6 leading-[1.02] max-w-5xl mx-auto">
            Make better decisions with intelligence <span className="text-primary">you can verify.</span>
          </h1>

          <p className="text-sm sm:text-lg md:text-xl text-foreground/70 max-w-2xl mx-auto mb-6 sm:mb-10 leading-relaxed">
            Global signals become evidence-backed priorities, actions, and outcomes — without surveillance or black boxes.
          </p>

          <div className="grid grid-cols-1 sm:flex sm:flex-row items-center justify-center gap-3 max-w-sm sm:max-w-none mx-auto">
            <Button size="lg" asChild className="text-sm sm:text-base px-8 h-12 w-full sm:w-auto">
              <Link to="/morning-brief?demo=true">
                Open Live Brief <ArrowRight className="h-4 w-4 ml-2" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="text-sm sm:text-base px-8 h-12 w-full sm:w-auto">
              <Link to="/auth">Request Access</Link>
            </Button>
          </div>

          <div className="mt-8 sm:mt-12 max-w-5xl mx-auto">
            <PlanetaryPulseMap height="clamp(280px, 45vw, 420px)" />
          </div>

          <div className="mt-5 sm:mt-8 grid grid-cols-1 sm:flex sm:items-center sm:justify-center gap-2 sm:gap-6 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-success" />
              Non-Surveillance Guaranteed
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              SOC 2 In-Progress
            </span>
            <span className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-success" />
              Privacy-first · ISO 27001 principles
            </span>
          </div>
        </div>
      </section>

      {/* Live Intelligence Showcase — real data from production engines */}
      <PublicIntelligenceShowcase />

      {/* Capabilities */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <Badge variant="outline" className="mb-4">Capabilities</Badge>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
            From global signal to defensible decision.
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Everything you need to turn raw world events into auditable institutional action.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {[
            {
              icon: Globe,
              title: "Risk Atlas",
              desc: "Multi-resolution map drilling from global to village level. Natural-language queries to live risk surfaces.",
            },
            {
              icon: TrendingUp,
              title: "Prospective Forecasts",
              desc: "Locked, immutable predictions with auto-realization. Provable accuracy, not retrospective storytelling.",
            },
            {
              icon: Network,
              title: "Decision Propagation",
              desc: "Trace causal chains: macro signal → country exposure → operational disruption → recommended action.",
            },
            {
              icon: BarChart3,
              title: "Outcome Tracking",
              desc: "Every recommendation linked to a measured outcome. ROI attribution per signal, per operator.",
            },
            {
              icon: Eye,
              title: "Zero-Trust Audit",
              desc: "SHA-256 inference chain, full audit log, SIEM-ready forwarding. Procurement-grade evidence.",
            },
            {
              icon: Zap,
              title: "Auto-Response",
              desc: "IP auto-block, anomaly triggers, dual-approval workflows. Critical events handled in under 10 minutes.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="group p-6 rounded-xl border border-border bg-card hover:border-primary/40 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-4 group-hover:bg-primary/15 transition-colors">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Proof / Differentiation */}
      <section className="border-t border-border bg-card/20">
        <div className="max-w-7xl mx-auto px-6 py-24 grid md:grid-cols-2 gap-16 items-center">
          <div>
            <Badge variant="outline" className="mb-4">Why AICIS</Badge>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-6">
              Built for operators who must defend every decision.
            </h2>
            <p className="text-muted-foreground mb-8 leading-relaxed">
              Generic risk feeds tell you what happened. Compliance tools track what you did.
              AICIS connects them — with cryptographic auditability and statistical rigor that
              survives regulatory scrutiny.
            </p>
            <div className="space-y-3">
              {[
                "Forecasts locked before realization — no hindsight bias",
                "70/30 measured-vs-proxy weighting on every score",
                "Wilson score intervals on outcome confidence",
                "Public-data-only mandate — no PII, no surveillance",
              ].map((p) => (
                <div key={p} className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
                  <span className="text-sm">{p}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 bg-gradient-to-br from-primary/20 to-secondary/20 rounded-2xl blur-2xl" />
            <div className="relative rounded-xl border border-border bg-card p-6 font-mono text-xs">
              <div className="flex items-center gap-2 pb-3 border-b border-border mb-3">
                <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                <span className="text-success">SIGNAL_INTAKE</span>
                <span className="text-muted-foreground ml-auto">live</span>
              </div>
              <div className="space-y-1.5 text-muted-foreground">
                <div><span className="text-primary">→</span> GDELT event 1184293 ingested</div>
                <div><span className="text-primary">→</span> Entity resolved: ETH (canonical)</div>
                <div><span className="text-warning">⚠</span> Energy disruption probability: 0.73</div>
                <div><span className="text-primary">→</span> Decision card generated · sev 7</div>
                <div><span className="text-success">✓</span> Inference hash: 0x4a7f...c2e1</div>
                <div><span className="text-success">✓</span> Forecast locked · realize_at +7d</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-5xl mx-auto px-6 py-24 text-center">
        <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">
          See it operating live.
        </h2>
        <p className="text-lg text-muted-foreground mb-10 max-w-xl mx-auto">
          Walk through a real operator workflow with pre-loaded global scenarios.
          No signup. No commitment.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button size="lg" asChild className="text-base px-8 h-12">
            <Link to="/morning-brief?demo=true">
              Launch Demo Workspace <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild className="text-base px-8 h-12">
            <Link to="/auth">Create Account</Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <span>© {new Date().getFullYear()} AICIS · Sovereign Decision Intelligence</span>
          </div>
          <div className="flex items-center gap-5">
            <Link to="/status" className="hover:text-foreground transition-colors">Status</Link>
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <span className="flex items-center gap-1.5">
              <Lock className="h-3 w-3 text-success" />
              Non-Surveillance Guaranteed
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
