import { Card } from "@/components/ui/card";
import { CheckCircle2, Clock, AlertTriangle } from "lucide-react";

export const DOMAIN_META: Record<string, { label: string; blurb: string; href: string; tone: string }> = {
  health:         { label: "Health",                blurb: "Disease, healthcare access, mortality",      href: "/risk-atlas?domain=health",         tone: "text-rose-400" },
  economy:        { label: "Economy",               blurb: "GDP, inflation, growth indicators",          href: "/risk-atlas?domain=economy",        tone: "text-amber-400" },
  finance:        { label: "Finance",               blurb: "Markets, credit, monetary stability",        href: "/risk-atlas?domain=finance",        tone: "text-yellow-400" },
  energy:         { label: "Energy",                blurb: "Power, fuel, grid load, renewables",         href: "/risk-atlas?domain=energy",         tone: "text-orange-400" },
  climate:        { label: "Climate",               blurb: "Weather extremes, emissions, temperature",   href: "/risk-atlas?domain=climate",        tone: "text-cyan-400" },
  environment:    { label: "Environment",           blurb: "Ecosystems, pollution, biodiversity",        href: "/risk-atlas?domain=environment",    tone: "text-emerald-400" },
  governance:     { label: "Governance",            blurb: "Institutions, elections, democracy index",   href: "/risk-atlas?domain=governance",     tone: "text-violet-400" },
  security:       { label: "Security",              blurb: "Conflict, crime, cyber, defence",            href: "/risk-atlas?domain=security",       tone: "text-red-400" },
  population:     { label: "Population",            blurb: "Demographics, migration, density",           href: "/risk-atlas?domain=population",     tone: "text-blue-400" },
  demographics:   { label: "Demographics",          blurb: "Age structure, urban/rural splits",          href: "/risk-atlas?domain=demographics",   tone: "text-blue-300" },
  education:      { label: "Education",             blurb: "Literacy, enrolment, expenditure",           href: "/risk-atlas?domain=education",      tone: "text-indigo-400" },
  food:           { label: "Food & Agriculture",    blurb: "Crop yields, food security, prices",         href: "/risk-atlas?domain=food",           tone: "text-lime-400" },
  infrastructure: { label: "Infrastructure",        blurb: "Roads, water, telecoms, electricity access", href: "/risk-atlas?domain=infrastructure", tone: "text-slate-300" },
  labor:          { label: "Labor",                 blurb: "Employment, wages, workforce participation", href: "/risk-atlas?domain=labor",          tone: "text-fuchsia-400" },
  trade:          { label: "Trade",                 blurb: "Imports, exports, supply chains",            href: "/risk-atlas?domain=trade",          tone: "text-pink-400" },
  technology:     { label: "Technology",            blurb: "Internet, R&D, digital adoption",            href: "/risk-atlas?domain=technology",     tone: "text-teal-400" },
};

export const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
  : `${n}`;

export const ageHours = (iso: string | null) => {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
};

export const freshnessTone = (h: number) =>
  h < 26 ? { tone: "text-success", label: "Fresh", icon: CheckCircle2 }
  : h < 72 ? { tone: "text-warning", label: "Slowing", icon: Clock }
  : { tone: "text-destructive", label: "Stale", icon: AlertTriangle };

export function KPI({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon: React.ElementType }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-1 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}

export function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="p-4 h-40 animate-pulse bg-muted/20" />
      ))}
    </div>
  );
}
