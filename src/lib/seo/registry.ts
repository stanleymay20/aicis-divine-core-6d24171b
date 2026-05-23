/**
 * Centralized route → SEO metadata registry.
 *
 * Resolved at runtime by <RouteSEO />. Pages may still mount their own
 * <SEO /> component for per-page overrides; react-helmet-async dedupes
 * by name/property so the page-level tags win.
 *
 * Public/marketing/product surfaces are indexable.
 * Admin, infra, telemetry, auth, and other operational pages are noindex.
 */
export interface RouteSEOEntry {
  title: string;
  description: string;
  noindex: boolean;
}

const T = "AICIS — Adaptive Country Intelligence System";

/** Exact path → metadata. Dynamic params are handled by matchers below. */
export const SEO_REGISTRY: Record<string, RouteSEOEntry> = {
  // ---------- Public / indexable ----------
  "/": {
    title: `${T}`,
    description: "Decision-grade global intelligence across 211 countries. Real-time risks, forecasts, and actions for governments, NGOs, and enterprises.",
    noindex: false,
  },
  "/app": {
    title: `Command Center | AICIS`,
    description: "Live planetary intelligence dashboard with risk rankings, forecasts, and recommended actions.",
    noindex: false,
  },
  "/terms": {
    title: `Terms of Service | AICIS`,
    description: "AICIS terms of service, acceptable use, and licensing terms.",
    noindex: false,
  },
  "/privacy": {
    title: `Privacy & Non-Surveillance Guarantee | AICIS`,
    description: "How AICIS handles data: public/aggregate sources only, no PII, sovereign-mode controls, and Ed25519-signed federation.",
    noindex: false,
  },
  "/status": {
    title: `System Status | AICIS`,
    description: "Live operational status of AICIS ingestion, intelligence engines, and export layer.",
    noindex: false,
  },
  "/risk-atlas": {
    title: `Risk Atlas | AICIS`,
    description: "Multi-resolution global risk map. Query by country, region, or domain to drill from macro signals to micro disruptions.",
    noindex: false,
  },
  "/local-events": {
    title: `Local Events | AICIS`,
    description: "Live sub-national event stream from USGS, GDACS, NASA EONET, and resilient public feeds.",
    noindex: false,
  },

  // ---------- Auth (noindex) ----------
  "/auth": {
    title: `Sign in | AICIS`,
    description: "Sign in to AICIS to access decision-grade global intelligence.",
    noindex: true,
  },
  "/reset-password": {
    title: `Reset password | AICIS`,
    description: "Reset your AICIS account password.",
    noindex: true,
  },

  // ---------- Operational app surfaces (noindex) ----------
  "/command-center": { title: "Planetary Command Center | AICIS", description: "Operational planetary command center for live signals and decision orchestration.", noindex: true },
  "/morning-brief": { title: "Morning Brief | AICIS", description: "Prioritized daily intelligence brief with recommended actions.", noindex: true },
  "/live": { title: "Live Command Feed | AICIS", description: "Real-time signal stream across all ingestion sources.", noindex: true },
  "/live-signals": { title: "Live Signals | AICIS", description: "Real-time intelligence signal stream.", noindex: true },
  "/live-stream": { title: "Live Signal Stream | AICIS", description: "High-throughput live signal monitoring with routing precision.", noindex: true },
  "/coverage-equity": { title: "Coverage Equity | AICIS", description: "Geographic and domain coverage equity audit.", noindex: true },
  "/decision-ops": { title: "Decision Operations | AICIS", description: "Decision execution, accountability, and outcome tracking.", noindex: true },
  "/decisions": { title: "Decisions | AICIS", description: "Decision ledger with evidence, accountability, and ROI.", noindex: true },
  "/evidence-command": { title: "Evidence Command | AICIS", description: "Evidence accumulation control plane.", noindex: true },
  "/governance": { title: "Governance Hub | AICIS", description: "Human-in-the-loop governance, ethics, and ledger oversight.", noindex: true },
  "/admin": { title: "Admin | AICIS", description: "Administrative controls and tenant management.", noindex: true },
  "/resolution": { title: "Resolution Explorer | AICIS", description: "Multi-resolution drill-down from global to village level.", noindex: true },
  "/watchlist": { title: "Tracked Markets | AICIS", description: "Watchlist of tracked countries and domains with delta alerts.", noindex: true },
  "/learning": { title: "Learning Intelligence | AICIS", description: "Continuous learning loop, calibration trends, and signal reliability.", noindex: true },
  "/relevance-preferences": { title: "Relevance Preferences | AICIS", description: "Personalize signal relevance and routing preferences.", noindex: true },
  "/advanced": { title: "Advanced | AICIS", description: "Advanced analyst tooling and configuration.", noindex: true },
  "/more": { title: "More | AICIS", description: "Additional AICIS modules and tools.", noindex: true },
  "/daily-evidence-ops": { title: "Daily Evidence Ops | AICIS", description: "Daily evidence operations queue, throughput, and closure scoreboards.", noindex: true },
  "/signal-validation": { title: "Signal Validation | AICIS", description: "Forensic validation of intelligence signals.", noindex: true },
  "/operational-truth": { title: "Operational Truth | AICIS", description: "Daily operational truth audit across links, events, metrics, and forecasts.", noindex: true },
  "/system-status": { title: "System Health | AICIS", description: "Detailed system health, edge function status, and database telemetry.", noindex: true },
  "/infra-ops": { title: "Infra Ops | AICIS", description: "Infrastructure operations: pipeline health, cron jobs, and registry.", noindex: true },
  "/developers": { title: "Developer Portal | AICIS", description: "API keys, SDK reference, and webhook management.", noindex: true },
  "/forecast-validation": { title: "Forecast Validation | AICIS", description: "Prospective forecast validation system with realized accuracy scoring.", noindex: true },
  "/system-pulse": { title: "System Pulse | AICIS", description: "Planetary heartbeat and accumulation pulse.", noindex: true },
  "/register-node": { title: "Register Federation Node | AICIS", description: "Register a new federation node with Ed25519 signing.", noindex: true },
  "/accumulation": { title: "Accumulation | AICIS", description: "Production accumulation tracking across 9 domains and 211 countries.", noindex: true },
  "/training-dataset": { title: "Training Dataset | AICIS", description: "ML training dataset builder and CSV exporter.", noindex: true },
  "/risk-ranking": { title: "Risk Ranking | AICIS", description: "Country-domain risk leaderboard and recommended actions.", noindex: true },
  "/learning-loop": { title: "Learning Loop | AICIS", description: "Self-improving SGI loop with realized prediction outcomes.", noindex: true },
  "/intelligence-engine": { title: "Intelligence Engine | AICIS", description: "ML inference, propagation graph, and scenario simulation engines.", noindex: true },
  "/simulation": { title: "Simulation | AICIS", description: "Monte Carlo scenario simulation with deterministic counterfactuals.", noindex: true },
  "/predictions": { title: "Predictions | AICIS", description: "Calibrated ML predictions with bootstrap confidence intervals.", noindex: true },
  "/api-audit": { title: "API Audit Chain | AICIS", description: "SHA-256 audit chain for inference reproducibility.", noindex: true },
  "/admin/export-center": { title: "Export Center | AICIS", description: "Administrative export center for downstream platforms.", noindex: true },
  "/export-center": { title: "Export Center | AICIS", description: "Export decision-grade intelligence in CSV, JSON, and API formats.", noindex: true },
  "/data-export": { title: "Data Export | AICIS", description: "Export AICIS datasets for downstream analysis.", noindex: true },
  "/export-layer": { title: "Export Layer | AICIS", description: "High-efficiency export profiles, webhooks, and SDK endpoints.", noindex: true },
  "/exports": { title: "Exports | AICIS", description: "Manage export profiles, webhooks, and delivery audit logs.", noindex: true },
  "/quantivis-exports": { title: "Quantivis Bridge | AICIS", description: "Quantivis OS export bridge with webhook queue.", noindex: true },
  "/pilot-truth": { title: "Pilot Truth Feed | AICIS", description: "Stakeholder-facing pilot truth artifacts with empirical evidence and ROI.", noindex: true },
  "/data-pipeline": { title: "Data Pipeline | AICIS", description: "Ingestion pipeline health, run health, and orphan diagnostics.", noindex: true },
  "/outcome-cockpit": { title: "Outcome Cockpit | AICIS", description: "Outcome KPI tracker for executed decisions.", noindex: true },
  "/system-catalog": { title: "System Catalog | AICIS", description: "Catalog of AICIS modules, edge functions, and data sources.", noindex: true },
  "/analyst": { title: "Analyst Dashboard | AICIS", description: "Threat matrix, risk trends, and emerging threats for analysts.", noindex: true },
  "/analyst-dashboard": { title: "Analyst Dashboard | AICIS", description: "Threat matrix, risk trends, and emerging threats for analysts.", noindex: true },
};

/** Dynamic-route matchers. First match wins. */
const DYNAMIC_MATCHERS: Array<{ test: RegExp; entry: (m: RegExpMatchArray) => RouteSEOEntry }> = [
  {
    test: /^\/deepdive\/([A-Z]{2,3})$/i,
    entry: (m) => ({
      title: `${m[1].toUpperCase()} Country Deep Dive | AICIS`,
      description: `Decision-grade intelligence for ${m[1].toUpperCase()}: risks, forecasts, recommended actions, and evidence trail.`,
      noindex: false,
    }),
  },
  {
    test: /^\/local-events\/([A-Z]{2,3})(?:\/([^/]+))?$/i,
    entry: (m) => {
      const iso3 = m[1].toUpperCase();
      const locality = m[2] ? decodeURIComponent(m[2]) : null;
      return {
        title: locality
          ? `${locality}, ${iso3} — Local Events | AICIS`
          : `${iso3} — Local Events | AICIS`,
        description: locality
          ? `Live local event stream for ${locality}, ${iso3}: disasters, alerts, and operational signals.`
          : `Live local event stream for ${iso3}: disasters, alerts, and operational signals.`,
        noindex: false,
      };
    },
  },
  {
    test: /^\/atlas\/region\/([^/]+)$/,
    entry: (m) => ({
      title: `Region ${decodeURIComponent(m[1])} | Risk Atlas | AICIS`,
      description: `Sub-national risk drill-down for region ${decodeURIComponent(m[1])}.`,
      noindex: false,
    }),
  },
];

const NOT_FOUND_ENTRY: RouteSEOEntry = {
  title: "Page not found | AICIS",
  description: "The page you are looking for does not exist.",
  noindex: true,
};

/** Resolve a pathname to SEO metadata. Falls back to NotFound (noindex). */
export function resolveRouteSEO(pathname: string): RouteSEOEntry {
  const exact = SEO_REGISTRY[pathname];
  if (exact) return exact;
  for (const { test, entry } of DYNAMIC_MATCHERS) {
    const m = pathname.match(test);
    if (m) return entry(m);
  }
  return NOT_FOUND_ENTRY;
}
