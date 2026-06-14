import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useDemoMode } from "@/contexts/DemoModeContext";
import {
  AccessTier,
  tierMeetsRequirement,
  useUserTier,
} from "@/hooks/useUserTier";
import { Shield, Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /**
   * Minimum tier required to view this route. Defaults to "free".
   * "sovereign" or "enterprise" will redirect to /upgrade when unmet.
   */
  requiredTier?: AccessTier;
}

const FullScreenSkeleton = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <div className="absolute inset-0 bg-primary rounded-xl blur-xl opacity-30 animate-pulse" />
        <div className="relative w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
          <Shield className="h-6 w-6 text-primary-foreground" />
        </div>
      </div>
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      <p className="text-xs text-muted-foreground">Verifying access…</p>
    </div>
  </div>
);

export const ProtectedRoute = ({
  children,
  requiredTier = "free",
}: ProtectedRouteProps) => {
  const { user, loading: authLoading } = useAuth();
  const { isDemo } = useDemoMode();
  const { tier, loading: tierLoading } = useUserTier();
  const navigate = useNavigate();
  const location = useLocation();

  // Demo mode bypasses both auth and tier — read-only preview only
  const needsTierCheck = requiredTier !== "free" && !isDemo;
  const checkingTier = needsTierCheck && tierLoading;

  useEffect(() => {
    if (authLoading) return;
    if (!user && !isDemo) {
      navigate("/auth", { replace: true, state: { from: location.pathname } });
      return;
    }
    if (needsTierCheck && !tierLoading) {
      if (!tierMeetsRequirement(tier, requiredTier)) {
        navigate("/upgrade", {
          replace: true,
          state: {
            requiredTier,
            currentTier: tier,
            from: location.pathname,
          },
        });
      }
    }
  }, [
    authLoading,
    user,
    isDemo,
    needsTierCheck,
    tierLoading,
    tier,
    requiredTier,
    navigate,
    location.pathname,
  ]);

  if (authLoading || checkingTier) return <FullScreenSkeleton />;
  if (!user && !isDemo) return null;
  if (needsTierCheck && !tierMeetsRequirement(tier, requiredTier)) return null;

  return <>{children}</>;
};
