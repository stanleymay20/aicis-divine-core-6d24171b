import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Globe2 } from "lucide-react";

const Index = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        navigate('/auth', { replace: true });
      } else {
        // Enterprise landing: authenticated users now enter the full command center.
        navigate('/command-center', { replace: true });
      }
    }
  }, [user, loading, navigate]);

  // Always show loading spinner — this page is a redirect gate
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="absolute inset-0 bg-primary rounded-xl blur-xl opacity-30 animate-pulse" />
          <div className="relative w-14 h-14 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
            <Globe2 className="h-7 w-7 text-primary-foreground" />
          </div>
        </div>
        <div className="text-foreground text-lg font-semibold">Loading AICIS Command Center…</div>
        <div className="text-muted-foreground text-sm">Preparing enterprise planetary intelligence</div>
      </div>
    </div>
  );
};

export default Index;
