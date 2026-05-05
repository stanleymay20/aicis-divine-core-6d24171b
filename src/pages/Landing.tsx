import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { PublicIntelligenceShowcase } from "@/components/landing/PublicIntelligenceShowcase";
import { PlanetaryPulseMap } from "@/components/planetary/PlanetaryPulseMap";
import { PlanetaryHeartbeat } from "@/components/planetary/PlanetaryHeartbeat";
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
} from "lucide-react";

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
      {/* SEO */}
      <head>
        <title>AICIS — Decision Intelligence for Sovereign Operators</title>
        <meta
          name="description"
          content="Planetary-scale risk intelligence with auditable forecasts, decision tracking, and zero-surveillance guarantees."
        />
        <link rel="canonical" href="/" />
      </head>

      {/* Nav */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center">
              <Shield className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="text-base font-semibold tracking-tight">AICIS</span>
            <Badge variant="outline" className="ml-1 text-[10px] uppercase tracking-wider border-primary/30 text-primary">
              Decision Intelligence
            </Badge>
          </Link>
          <nav className="flex items-center gap-2">
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
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-background to-background pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-6 pt-20 pb-24 text-center">
          <Badge className="mb-6 bg-primary/10 text-primary border-primary/20 hover:bg-primary/15">
            <Activity className="h-3 w-3 mr-1.5" />
            Live across 211 countries · 10M+ metrics
          </Badge>

          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter mb-6 leading-[1.05]">
            Decision intelligence
            <br />
            <span className="bg-gradient-to-r from-primary via-primary-glow to-secondary bg-clip-text text-transparent">
              at planetary scale.
            </span>
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            AICIS turns global signals into auditable decisions for sovereign operators —
            without surveillance, without black boxes, without compromise.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button size="lg" asChild className="text-base px-8 h-12">
              <Link to="/morning-brief?demo=true">
                Explore Live Demo <ArrowRight className="h-4 w-4 ml-2" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="text-base px-8 h-12">
              <Link to="/auth">Request Access</Link>
            </Button>
          </div>

          <div className="mt-12 max-w-5xl mx-auto">
            <PlanetaryPulseMap height={420} />
          </div>

          <div className="mt-8 flex items-center justify-center gap-6 text-xs text-muted-foreground">
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
              GDPR · ISO 27001
            </span>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-y border-border bg-card/30">
        <div className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { v: "211", l: "Countries Tracked" },
            { v: "10M+", l: "Live Metrics" },
            { v: "<10min", l: "Threat Auto-Response" },
            { v: "92%", l: "Forecast Accuracy" },
          ].map((s) => (
            <div key={s.l}>
              <div className="text-3xl md:text-4xl font-bold font-mono text-primary tracking-tight">{s.v}</div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mt-1">{s.l}</div>
            </div>
          ))}
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
