import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  AccessTier,
  tierMeetsRequirement,
  useUserTier,
} from "@/hooks/useUserTier";
import { AICISRole, useUserRoles } from "@/hooks/useUserRoles";
import { Shield, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Minimum commercial access tier. */
  requiredTier?: AccessTier;
  /** Minimum operational role. */
  requiredRole?: "admin" | "operator" | "analyst";
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

const roleMeetsRequirement = (
  roles: AICISRole[],
  requiredRole?: "admin" | "operator" | "analyst",
) => {
  if (!requiredRole) return true;
  if (roles.includes("admin")) return true;
  if (requiredRole === "admin") return false;
  if (roles.includes("operator")) return true;
  if (requiredRole === "operator") return false;
  return roles.includes("analyst");
};

export const ProtectedRoute = ({
  children,
  requiredTier = "free",
  requiredRole,
}: ProtectedRouteProps) => {
  const { user, loading: authLoading, unavailable } = useAuth();
  const { tier, loading: tierLoading } = useUserTier();
  const { roles, isLoading: rolesLoading } = useUserRoles();
  const navigate = useNavigate();
  const location = useLocation();

  // Authentication, commercial entitlement, and operational authorization are
  // independent fail-closed boundaries. User-controlled presentation state
  // (including Demo Mode) may never weaken any of them.
  const needsTierCheck = requiredTier !== "free";
  const needsRoleCheck = Boolean(requiredRole);
  const checkingTier = Boolean(user) && needsTierCheck && tierLoading;
  const checkingRole = Boolean(user) && needsRoleCheck && rolesLoading;

  useEffect(() => {
    if (authLoading || unavailable) return;

    if (!user) {
      navigate("/auth", {
        replace: true,
        state: { from: `${location.pathname}${location.search}${location.hash}` },
      });
      return;
    }

    if (needsRoleCheck && !rolesLoading && !roleMeetsRequirement(roles, requiredRole)) {
      navigate("/world", {
        replace: true,
        state: { accessDenied: true, requiredRole, from: location.pathname },
      });
      return;
    }

    if (needsTierCheck && !tierLoading && !tierMeetsRequirement(tier, requiredTier)) {
      navigate("/upgrade", {
        replace: true,
        state: {
          requiredTier,
          currentTier: tier,
          from: location.pathname,
        },
      });
    }
  }, [
    authLoading,
    unavailable,
    user,
    needsTierCheck,
    needsRoleCheck,
    tierLoading,
    tier,
    requiredTier,
    rolesLoading,
    roles,
    requiredRole,
    navigate,
    location.pathname,
    location.search,
    location.hash,
  ]);

  if (authLoading || checkingTier || checkingRole) return <FullScreenSkeleton />;
  if (unavailable) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <Shield className="h-10 w-10 text-primary mx-auto" />
          <h1 className="text-xl font-semibold text-foreground">Authentication is temporarily unavailable</h1>
          <p className="text-sm text-muted-foreground">
            Access is paused because AICIS cannot currently verify the authentication service. Your local session has not been promoted to trusted access.
          </p>
          <Button type="button" onClick={() => window.location.reload()}>Retry authentication</Button>
        </div>
      </div>
    );
  }
  if (!user) return null;
  if (needsRoleCheck && !roleMeetsRequirement(roles, requiredRole)) return null;
  if (needsTierCheck && !tierMeetsRequirement(tier, requiredTier)) return null;

  return <>{children}</>;
};
