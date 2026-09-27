import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { AICISMainView } from "@/components/aicis/AICISMainView";
import { Shield } from "lucide-react";
import { DecisionWorkspaceNav } from "@/components/decisions/DecisionWorkspaceNav";

const Decisions = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth', { replace: true });
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 bg-primary rounded-xl blur-xl opacity-50 animate-pulse" />
            <div className="relative w-16 h-16 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
              <Shield className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <div className="text-primary text-xl font-orbitron animate-pulse">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <AICISLayout>
      <div className="mx-auto flex h-full w-full max-w-[1500px] flex-col gap-4 overflow-y-auto p-4 md:p-6">
        <DecisionWorkspaceNav />
        <AICISMainView />
      </div>
    </AICISLayout>
  );
};

export default Decisions;
