import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { IntelligenceMemoryProvider } from "@/contexts/IntelligenceMemoryContext";
import { Loader2 } from "lucide-react";

// Only eager-load the landing page and auth — everything else is lazy
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

const Onboarding = lazy(() => import("./pages/Onboarding"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const CitizenPortal = lazy(() => import("./pages/CitizenPortal"));
const CountryDeepDivePage = lazy(() => import("./pages/CountryDeepDivePage"));
const AICISCommandCenter = lazy(() => import("./pages/AICISCommandCenter"));
const Debug = lazy(() => import("./pages/Debug"));
const SystemHealth = lazy(() => import("./pages/SystemHealth"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const GovernanceHub = lazy(() => import("./pages/GovernanceHub"));
const PredictionsCenter = lazy(() => import("./pages/PredictionsCenter"));
const CompliancePortal = lazy(() => import("./pages/CompliancePortal"));
const FederationHub = lazy(() => import("./pages/FederationHub"));
const Ethics = lazy(() => import("./pages/Ethics"));
const SecurityDashboard = lazy(() => import("./pages/SecurityDashboard"));
const HealthDashboard = lazy(() => import("./pages/HealthDashboard"));
const ComparePage = lazy(() => import("./pages/ComparePage"));
const IntelligenceThread = lazy(() => import("./pages/IntelligenceThread"));
const MethodologyPage = lazy(() => import("./pages/MethodologyPage"));
const EnterpriseGovernance = lazy(() => import("./pages/EnterpriseGovernance"));
const CalibrationDashboard = lazy(() => import("./pages/CalibrationDashboard"));
const GovernanceLegal = lazy(() => import("./pages/GovernanceLegal"));
const ReadinessReport = lazy(() => import("./pages/ReadinessReport"));
const CompareModels = lazy(() => import("./pages/CompareModels"));
const OperationalDashboard = lazy(() => import("./pages/OperationalDashboard"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const WeeklyBriefs = lazy(() => import("./pages/WeeklyBriefs"));
const PredictionAccuracy = lazy(() => import("./pages/PredictionAccuracy"));
const ADIDashboard = lazy(() => import("./pages/ADIDashboard"));
const TrustLayer = lazy(() => import("./pages/TrustLayer"));
const CompetitiveLandscape = lazy(() => import("./pages/CompetitiveLandscape"));
const EnterpriseReadiness = lazy(() => import("./pages/EnterpriseReadiness"));
const ValidatedPredictions = lazy(() => import("./pages/ValidatedPredictions"));
const MicrodataRegistry = lazy(() => import("./pages/MicrodataRegistry"));
const FirstSignal = lazy(() => import("./pages/FirstSignal"));
const DecisionOutcomeLog = lazy(() => import("./pages/DecisionOutcomeLog"));
const InfraOps = lazy(() => import("./pages/InfraOps"));
const GovReadiness = lazy(() => import("./pages/GovReadiness"));
const DecisionEngine = lazy(() => import("./pages/DecisionEngine"));
const OperationalTruth = lazy(() => import("./pages/OperationalTruth"));
const DecisionOperations = lazy(() => import("./pages/DecisionOperations"));
const MeasuredAcceleration = lazy(() => import("./pages/MeasuredAcceleration"));
const EvidenceClosure = lazy(() => import("./pages/EvidenceClosure"));
const EvidenceCommand = lazy(() => import("./pages/EvidenceCommand"));
const SystemStatus = lazy(() => import("./pages/SystemStatus"));
const MorningBrief = lazy(() => import("./pages/MorningBrief"));
const DailyEvidenceOps = lazy(() => import("./pages/DailyEvidenceOps"));
const Decisions = lazy(() => import("./pages/Decisions"));
const LiveCommandFeed = lazy(() => import("./pages/LiveCommandFeed"));
const SignalValidation = lazy(() => import("./pages/SignalValidation"));

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
    mutations: {
      retry: 1,
    },
  },
});

const Lazy = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<LazyFallback />}>{children}</Suspense>
);

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <IntelligenceMemoryProvider>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/decisions" element={<Lazy><Decisions /></Lazy>} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/onboarding" element={<Lazy><Onboarding /></Lazy>} />
              <Route path="/citizen-portal" element={<Lazy><CitizenPortal /></Lazy>} />
              <Route path="/deepdive/:iso3" element={<Lazy><CountryDeepDivePage /></Lazy>} />
              <Route path="/command" element={<Lazy><AICISCommandCenter /></Lazy>} />
              <Route path="/debug" element={<Lazy><Debug /></Lazy>} />
              <Route path="/system-health" element={<Lazy><SystemHealth /></Lazy>} />
              <Route path="/health" element={<Lazy><HealthDashboard /></Lazy>} />
              <Route path="/security" element={<Lazy><SecurityDashboard /></Lazy>} />
              <Route path="/intelligence" element={<Lazy><IntelligenceThread /></Lazy>} />
              <Route path="/terms" element={<Lazy><Terms /></Lazy>} />
              <Route path="/privacy" element={<Lazy><Privacy /></Lazy>} />
              <Route path="/admin" element={<Lazy><AdminDashboard /></Lazy>} />
              <Route path="/governance" element={<Lazy><GovernanceHub /></Lazy>} />
              <Route path="/predictions" element={<Lazy><PredictionsCenter /></Lazy>} />
              <Route path="/compliance" element={<Lazy><CompliancePortal /></Lazy>} />
              <Route path="/federation" element={<Lazy><FederationHub /></Lazy>} />
              <Route path="/compare" element={<Lazy><ComparePage /></Lazy>} />
              <Route path="/methodology" element={<Lazy><MethodologyPage /></Lazy>} />
              <Route path="/enterprise-governance" element={<Lazy><EnterpriseGovernance /></Lazy>} />
              <Route path="/calibration" element={<Lazy><CalibrationDashboard /></Lazy>} />
              <Route path="/governance-legal" element={<Lazy><GovernanceLegal /></Lazy>} />
              <Route path="/readiness-report" element={<Lazy><ReadinessReport /></Lazy>} />
              <Route path="/compare-models" element={<Lazy><CompareModels /></Lazy>} />
              <Route path="/operations" element={<Lazy><OperationalDashboard /></Lazy>} />
              <Route path="/ethics" element={<Lazy><Ethics /></Lazy>} />
              <Route path="/reset-password" element={<Lazy><ResetPassword /></Lazy>} />
              <Route path="/weekly-briefs" element={<Lazy><WeeklyBriefs /></Lazy>} />
              <Route path="/prediction-accuracy" element={<Lazy><PredictionAccuracy /></Lazy>} />
              <Route path="/adi" element={<Lazy><ADIDashboard /></Lazy>} />
              <Route path="/trust" element={<Lazy><TrustLayer /></Lazy>} />
              <Route path="/competitive-landscape" element={<Lazy><CompetitiveLandscape /></Lazy>} />
              <Route path="/enterprise-readiness" element={<Lazy><EnterpriseReadiness /></Lazy>} />
              <Route path="/validated-predictions" element={<Lazy><ValidatedPredictions /></Lazy>} />
              <Route path="/microdata" element={<Lazy><MicrodataRegistry /></Lazy>} />
              <Route path="/first-signal" element={<Lazy><FirstSignal /></Lazy>} />
              <Route path="/decision-log" element={<Lazy><DecisionOutcomeLog /></Lazy>} />
              <Route path="/infra-ops" element={<Lazy><InfraOps /></Lazy>} />
              <Route path="/gov-readiness" element={<Lazy><GovReadiness /></Lazy>} />
              <Route path="/decision-engine" element={<Lazy><DecisionEngine /></Lazy>} />
              <Route path="/operational-truth" element={<Lazy><OperationalTruth /></Lazy>} />
              <Route path="/decision-ops" element={<Lazy><DecisionOperations /></Lazy>} />
              <Route path="/measured-acceleration" element={<Lazy><MeasuredAcceleration /></Lazy>} />
              <Route path="/evidence-closure" element={<Lazy><EvidenceClosure /></Lazy>} />
              <Route path="/evidence-command" element={<Lazy><EvidenceCommand /></Lazy>} />
              <Route path="/system-status" element={<Lazy><SystemStatus /></Lazy>} />
              <Route path="/morning-brief" element={<Lazy><MorningBrief /></Lazy>} />
              <Route path="/daily-evidence-ops" element={<Lazy><DailyEvidenceOps /></Lazy>} />
              <Route path="/live" element={<Lazy><LiveCommandFeed /></Lazy>} />
              <Route path="/signal-validation" element={<Lazy><SignalValidation /></Lazy>} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </IntelligenceMemoryProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
