import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Shield, Loader2 } from "lucide-react";

const MIN_NEW_PASSWORD_LENGTH = 12;

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const [verificationFailed, setVerificationFailed] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    let mounted = true;
    let verified = false;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    const carriesRecoveryIntent = hash.get("type") === "recovery" || query.get("type") === "recovery" || query.has("code");

    const acceptRecovery = () => {
      if (!mounted) return;
      verified = true;
      setVerificationFailed(false);
      setIsRecovery(true);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) acceptRecovery();
    });

    void supabase.auth.getSession()
      .then(({ data: { session }, error }) => {
        if (!mounted || error || !session || !carriesRecoveryIntent) return;
        // detectSessionInUrl has already exchanged/validated the recovery token
        // before exposing a session through the configured Supabase client.
        acceptRecovery();
      })
      .catch(() => undefined);

    const timeout = window.setTimeout(() => {
      if (mounted && !verified) setVerificationFailed(true);
    }, 8000);

    return () => {
      mounted = false;
      window.clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    if (password !== confirmPassword) {
      toast({ title: "Passwords don't match", description: "Please ensure both passwords are identical.", variant: "destructive" });
      return;
    }

    if (password.length < MIN_NEW_PASSWORD_LENGTH) {
      toast({
        title: "Password too short",
        description: `Use at least ${MIN_NEW_PASSWORD_LENGTH} characters for the new password.`,
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      // End the recovery session after changing the credential so a recovery URL
      // cannot leave a privileged authenticated browser session behind.
      const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
      if (signOutError) await supabase.auth.signOut({ scope: "local" });

      toast({ title: "Password updated", description: "Sign in again with your new password." });
      navigate("/auth", { replace: true });
    } catch (error: unknown) {
      const description = error instanceof Error ? error.message : "Failed to update password.";
      toast({ title: "Reset failed", description, variant: "destructive" });
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
            {verificationFailed ? "Request a new password-reset email from the sign-in page." : "AICIS is validating the recovery session before allowing a credential change."}
          </p>
          {verificationFailed && (
            <Button type="button" variant="outline" className="mt-4" onClick={() => navigate("/auth", { replace: true })}>
              Return to sign in
            </Button>
          )}
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
          <p className="text-muted-foreground mt-2 text-center text-sm">Recovery session verified</p>
        </div>

        <form onSubmit={handleReset} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="password">New Password</Label>
            <Input id="password" type="password" autoComplete="new-password" placeholder="••••••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={MIN_NEW_PASSWORD_LENGTH} className="bg-input border-border" />
            <p className="text-xs text-muted-foreground">Use at least {MIN_NEW_PASSWORD_LENGTH} characters.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input id="confirmPassword" type="password" autoComplete="new-password" placeholder="••••••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={MIN_NEW_PASSWORD_LENGTH} className="bg-input border-border" />
          </div>

          <Button type="submit" className="w-full gradient-cyber text-primary-foreground font-orbitron glow-cyber" disabled={loading}>
            {loading ? "Updating..." : "Update Password"}
          </Button>
        </form>
      </Card>
    </div>
  );
};

export default ResetPassword;
