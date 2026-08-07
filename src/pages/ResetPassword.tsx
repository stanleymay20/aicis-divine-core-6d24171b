import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Shield, Loader2 } from "lucide-react";

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const [verificationFailed, setVerificationFailed] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    if (params.get("type") === "recovery" || query.get("type") === "recovery") {
      setIsRecovery(true);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setIsRecovery(true);
    });

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && (params.get("type") === "recovery" || query.get("type") === "recovery")) {
        setIsRecovery(true);
      }
    });

    const timeout = window.setTimeout(() => setVerificationFailed(true), 8000);
    return () => {
      window.clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "Please ensure both passwords are identical.",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 6) {
      toast({
        title: "Password too short",
        description: "Password must be at least 6 characters.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      toast({
        title: "Password Updated",
        description: "Your password has been reset successfully. Redirecting...",
      });

      setTimeout(() => navigate("/"), 2000);
    } catch (error: any) {
      toast({
        title: "Reset Failed",
        description: error.message || "Failed to update password.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!isRecovery) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4" role="main">
        <Card className="w-full max-w-md p-8 bg-card/50 backdrop-blur-sm border-primary/20 text-center">
          {!verificationFailed && <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />}
          <p className="text-muted-foreground">
            {verificationFailed ? "This recovery link is invalid or has expired." : "Verifying recovery link..."}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            If nothing happens,{" "}
            <button onClick={() => navigate("/auth")} className="text-primary hover:underline">
              return to login
            </button>
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4" role="main">
      <h1 className="sr-only">Reset Password</h1>
      <div className="fixed inset-0 bg-[linear-gradient(to_right,hsl(189_40%_20%_/_0.1)_1px,transparent_1px),linear-gradient(to_bottom,hsl(189_40%_20%_/_0.1)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)]" aria-hidden="true" />

      <Card className="w-full max-w-md p-8 bg-card/50 backdrop-blur-sm border-primary/20 relative z-10">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center mb-4">
            <Shield className="h-8 w-8 text-primary-foreground" />
          </div>
          <h2 className="text-2xl font-orbitron font-bold text-primary">Set New Password</h2>
          <p className="text-muted-foreground mt-2 text-center text-sm">
            Enter your new password below
          </p>
        </div>

        <form onSubmit={handleReset} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="password">New Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="bg-input border-border"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              className="bg-input border-border"
            />
          </div>

          <Button
            type="submit"
            className="w-full gradient-cyber text-primary-foreground font-orbitron glow-cyber"
            disabled={loading}
          >
            {loading ? "Updating..." : "Update Password"}
          </Button>

          <button
            type="button"
            onClick={() => navigate("/auth")}
            className="w-full text-center text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            ← Back to login
          </button>
        </form>
      </Card>
    </div>
  );
};

export default ResetPassword;
