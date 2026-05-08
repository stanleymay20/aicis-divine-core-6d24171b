import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { IntelligenceMemoryProvider } from "@/contexts/IntelligenceMemoryContext";
import { DemoModeProvider } from "@/contexts/DemoModeContext";
import { DemoBanner } from "@/components/demo/DemoBanner";
import { DegradedModeBanner } from "@/components/live/DegradedModeBanner";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import ScrollToTop from "@/components/ScrollToTop";
import { Loader2 } from "lucide-react";

// Eager-load: public landing, auth gate, not-found
import Landing from "./pages/Landing";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

// ── Pilot-core surfaces (lazy) ──────────────────────────────
const MorningBrief = lazy(() => import("./pages/MorningBrief"));
const LiveCommandFeed = lazy(() => import("./pages/LiveCommandFeed"));
const Decisions = lazy(() => import("./pages/Decisions"));
const DecisionOperations = lazy(() => import("./pages/DecisionOperations"));
const DailyEvidenceOps = lazy(() => import("./pages/DailyEvidenceOps"));
const EvidenceCommand = lazy(() => import("./pages/EvidenceCommand"));
const GovernanceHub = lazy(() => import("./pages/GovernanceHub"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const CountryDeepDivePage = lazy(() => import("./pages/CountryDeepDivePage"));
const ResolutionExplorer = lazy(() => import("./pages/ResolutionExplorer"));
const Watchlist = lazy(() => import("./pages/Watchlist"));
const LearningIntelligence = lazy(() => import("./pages/LearningIntelligence"));
const RiskAtlasPage = lazy(() => import("./pages/RiskAtlasPage"));
const RelevancePreferences = lazy(() => import("./pages/RelevancePreferences"));
const Advanced = lazy(() => import("./pages/Advanced"));

// ── Public pages ─────────────────────────────────────────────
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));

// ── Secondary surfaces (kept for deep-links, not in nav) ────
const SignalValidation = lazy(() => import("./pages/SignalValidation"));
const OperationalTruth = lazy(() => import("./pages/OperationalTruth"));
const SystemStatus = lazy(() => import("./pages/SystemStatus"));
const InfraOps = lazy(() => import("./pages/InfraOps"));
const DeveloperPortal = lazy(() => import("./pages/DeveloperPortal"));
const ForecastValidation = lazy(() => import("./pages/ForecastValidation"));
const Status = lazy(() => import("./pages/Status"));
const SystemPulse = lazy(() => import("./pages/SystemPulse"));
const RegionDrillDown = lazy(() => import("./pages/RegionDrillDown"));
const RegisterNode = lazy(() => import("./pages/RegisterNode"));
const Accumulation = lazy(() => import("./pages/Accumulation"));
const TrainingDataset = lazy(() => import("./pages/TrainingDataset"));
const RiskRanking = lazy(() => import("./pages/RiskRanking"));
const LearningLoop = lazy(() => import("./pages/LearningLoop"));
const IntelligenceEngine = lazy(() => import("./pages/IntelligenceEngine"));
const Simulation = lazy(() => import("./pages/Simulation"));
const Predictions = lazy(() => import("./pages/Predictions"));
const ApiAudit = lazy(() => import("./pages/ApiAudit"));
const LocalEvents = lazy(() => import("./pages/LocalEvents"));
const ExportCenter = lazy(() => import("./pages/ExportCenter"));
const LiveSignalStream = lazy(() => import("./pages/LiveSignalStream"));
const CoverageEquity = lazy(() => import("./pages/CoverageEquity"));
const PilotTruthFeed = lazy(() => import("./pages/PilotTruthFeed"));
const DataPipeline = lazy(() => import("./pages/DataPipeline"));
const OutcomeCockpit = lazy(() => import("./pages/OutcomeCockpit"));
const SystemCatalog = lazy(() => import("./pages/SystemCatalog"));

const LazyFallback = () => (
  <div className="flex items-center justify-center min-h-screen bg-background">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 1 },
  },
});

const Lazy = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<LazyFallback />}>{children}</Suspense>
);

const Protected = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>
    <Lazy>{children}</Lazy>
  </ProtectedRoute>
);

// Wraps lazy-loaded orphan pages in the standard shell so users always
// have the topbar (with Back button) and sidebar — no dead-end pages.
const Shell = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>
    <AICISLayout>
      <div className="overflow-y-auto h-full">
        <Lazy>{children}</Lazy>
      </div>
    </AICISLayout>
  </ProtectedRoute>
);

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <ScrollToTop />
          <DemoModeProvider>
            <IntelligenceMemoryProvider>
              <DegradedModeBanner />
              <DemoBanner />
              <Routes>
                {/* ── Public routes ───────────────────────────── */}
                <Route path="/" element={<Landing />} />
                <Route path="/app" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
              <Route path="/terms" element={<Lazy><Terms /></Lazy>} />
              <Route path="/privacy" element={<Lazy><Privacy /></Lazy>} />
              <Route path="/reset-password" element={<Lazy><ResetPassword /></Lazy>} />
              <Route path="/status" element={<Lazy><Status /></Lazy>} />

              {/* ── Core pilot routes (6 nav items) ──────────── */}
              <Route path="/morning-brief" element={<Protected><MorningBrief /></Protected>} />
              <Route path="/live" element={<Protected><LiveCommandFeed /></Protected>} />
              <Route path="/live-signals" element={<Protected><LiveCommandFeed /></Protected>} />
              <Route path="/live-stream" element={<Protected><LiveSignalStream /></Protected>} />
              <Route path="/coverage-equity" element={<Shell><CoverageEquity /></Shell>} />
              <Route path="/decision-ops" element={<Protected><DecisionOperations /></Protected>} />
              <Route path="/decisions" element={<Protected><Decisions /></Protected>} />
              <Route path="/evidence-command" element={<Protected><EvidenceCommand /></Protected>} />
              <Route path="/governance" element={<Protected><GovernanceHub /></Protected>} />
              <Route path="/admin" element={<Protected><AdminDashboard /></Protected>} />
              <Route path="/deepdive/:iso3" element={<Protected><CountryDeepDivePage /></Protected>} />
              <Route path="/resolution" element={<Protected><ResolutionExplorer /></Protected>} />
              <Route path="/watchlist" element={<Protected><Watchlist /></Protected>} />
              <Route path="/learning" element={<Protected><LearningIntelligence /></Protected>} />
              <Route path="/risk-atlas" element={<Protected><RiskAtlasPage /></Protected>} />
              <Route path="/relevance-preferences" element={<Protected><RelevancePreferences /></Protected>} />
              <Route path="/advanced" element={<Protected><Advanced /></Protected>} />
              {/* legacy aliases */}
              <Route path="/more" element={<Protected><Advanced /></Protected>} />

              {/* ── Secondary (deep-link only, not in nav) ───── */}
              <Route path="/daily-evidence-ops" element={<Protected><DailyEvidenceOps /></Protected>} />
              <Route path="/signal-validation" element={<Protected><SignalValidation /></Protected>} />
              <Route path="/operational-truth" element={<Protected><OperationalTruth /></Protected>} />
              <Route path="/system-status" element={<Protected><SystemStatus /></Protected>} />
              <Route path="/infra-ops" element={<Protected><InfraOps /></Protected>} />
              <Route path="/developers" element={<Protected><DeveloperPortal /></Protected>} />
              <Route path="/forecast-validation" element={<Shell><ForecastValidation /></Shell>} />
              <Route path="/system-pulse" element={<Shell><SystemPulse /></Shell>} />
              <Route path="/atlas/region/:id" element={<Shell><RegionDrillDown /></Shell>} />
              <Route path="/register-node" element={<Shell><RegisterNode /></Shell>} />
              <Route path="/accumulation" element={<Shell><Accumulation /></Shell>} />
              <Route path="/training-dataset" element={<Shell><TrainingDataset /></Shell>} />
              <Route path="/risk-ranking" element={<Protected><RiskRanking /></Protected>} />
              <Route path="/learning-loop" element={<Protected><LearningLoop /></Protected>} />
              <Route path="/intelligence-engine" element={<Shell><IntelligenceEngine /></Shell>} />
              <Route path="/simulation" element={<Protected><Simulation /></Protected>} />
              <Route path="/predictions" element={<Protected><Predictions /></Protected>} />
              <Route path="/api-audit" element={<Protected><ApiAudit /></Protected>} />

              {/* ── LRIL: Local Reality Intelligence ─────────── */}
              <Route path="/local-events" element={<Shell><LocalEvents /></Shell>} />
              <Route path="/local-events/:iso3" element={<Shell><LocalEvents /></Shell>} />
              <Route path="/local-events/:iso3/:locality" element={<Shell><LocalEvents /></Shell>} />

              {/* ── Export Center (admin/operator only at edge fn level) ── */}
              <Route path="/admin/export-center" element={<Protected><ExportCenter /></Protected>} />
              <Route path="/export-center" element={<Protected><ExportCenter /></Protected>} />
              <Route path="/data-export" element={<Protected><ExportCenter /></Protected>} />
              <Route path="/pilot-truth" element={<Shell><PilotTruthFeed /></Shell>} />
              <Route path="/data-pipeline" element={<Shell><DataPipeline /></Shell>} />
              <Route path="/outcome-cockpit" element={<Shell><OutcomeCockpit /></Shell>} />
              <Route path="/system-catalog" element={<Shell><SystemCatalog /></Shell>} />
              {/* ── Catch-all ───────────────────────────────── */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            </IntelligenceMemoryProvider>
          </DemoModeProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
