import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import aicisLogo from "@/assets/aicis-logo.png";
import { useAuth } from "@/hooks/useAuth";

const NEXT_PATH_KEY = "aicis.auth.next";
const GOOGLE_OAUTH_ENABLED = import.meta.env.VITE_ENABLE_GOOGLE_OAUTH === "true";
const MIN_NEW_PASSWORD_LENGTH = 12;

const safeNextPath = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return "/world";
  }

  const pathname = value.split(/[?#]/, 1)[0];
  if (pathname === "/auth" || pathname.startsWith("/reset-password")) return "/world";
  return value;
};

const authErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : "An unexpected error occurred.";
  return /failed to fetch|network|load failed/i.test(message)
    ? "The secure authentication service is temporarily unavailable. Please retry shortly."
    : message;
};

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [isReset, setIsReset] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();

  const stateFrom = (location.state as { from?: string } | null)?.from;
  const queryNext = new URLSearchParams(location.search).get("next");
  const nextPath = safeNextPath(stateFrom ?? queryNext ?? sessionStorage.getItem(NEXT_PATH_KEY));

  useEffect(() => {
    if (!authLoading && user) {
      sessionStorage.removeItem(NEXT_PATH_KEY);
      navigate(nextPath, { replace: true });
    }
  }, [authLoading, navigate, nextPath, user]);

  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();

      if (isReset) {
        const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast({
          title: "Password reset requested",
          description: "If the address is eligible, a recovery link will arrive shortly.",
        });
        setIsReset(false);
        setIsLogin(true);
      } else if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (error) throw error;
        toast({ title: "Access granted", description: "Welcome to AICIS" });
      } else {
        if (password.length < MIN_NEW_PASSWORD_LENGTH) {
          throw new Error(`New passwords must be at least ${MIN_NEW_PASSWORD_LENGTH} characters.`);
        }
        const { error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: { full_name: fullName.trim() },
            emailRedirectTo: `${window.location.origin}/auth?next=${encodeURIComponent(nextPath)}`,
          },
        });
        if (error) throw error;
        toast({
          title: "Registration received",
          description: "Check your email for the verification link if confirmation is required.",
        });
      }
    } catch (error: unknown) {
      toast({
        title: "Authentication failed",
        description: authErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (loading) return;
    setLoading(true);

    try {
      sessionStorage.setItem(NEXT_PATH_KEY, nextPath);
      const redirectTo = `${window.location.origin}/auth?next=${encodeURIComponent(nextPath)}`;
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (!data.url) throw new Error("Google sign-in did not return a secure authorization URL.");
      window.location.assign(data.url);
    } catch (error: unknown) {
      sessionStorage.removeItem(NEXT_PATH_KEY);
      toast({
        title: "Google sign-in failed",
        description: authErrorMessage(error),
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4" role="main">
      <h1 className="sr-only">AICIS Authentication</h1>
      <div className="fixed inset-0 bg-[linear-gradient(to_right,hsl(189_40%_20%_/_0.1)_1px,transparent_1px),linear-gradient(to_bottom,hsl(189_40%_20%_/_0.1)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)]" aria-hidden="true" />
      <div className="fixed top-0 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-[128px] pointer-events-none" aria-hidden="true" />
      <div className="fixed bottom-0 right-1/4 w-96 h-96 bg-secondary/10 rounded-full blur-[128px] pointer-events-none" aria-hidden="true" />

      <Card className="w-full max-w-md p-8 bg-card/50 backdrop-blur-sm border-primary/20 relative z-10">
        <div className="flex flex-col items-center mb-6">
          <img src={aicisLogo} alt="AICIS" className="h-20 w-20 object-contain mb-4 drop-shadow-[0_0_20px_hsl(var(--primary))]" />
          <h1 className="text-3xl font-orbitron font-bold text-primary text-glow-cyber">AICIS</h1>
          <p className="text-muted-foreground mt-2 text-center">AI-Assisted Civilization Intelligence System</p>
        </div>

        <form onSubmit={handleAuth} className="space-y-6">
          {!isLogin && !isReset && (
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input id="fullName" type="text" autoComplete="name" placeholder="Your full name" value={fullName} onChange={(event) => setFullName(event.target.value)} required className="bg-input border-border" />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" inputMode="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required className="bg-input border-border" />
          </div>

          {!isReset && (
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete={isLogin ? "current-password" : "new-password"} placeholder="••••••••••••" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={isLogin ? 6 : MIN_NEW_PASSWORD_LENGTH} className="bg-input border-border" />
              {!isLogin && <p className="text-xs text-muted-foreground">Use at least {MIN_NEW_PASSWORD_LENGTH} characters for new accounts.</p>}
            </div>
          )}

          <Button type="submit" className="w-full gradient-cyber text-primary-foreground font-orbitron glow-cyber" disabled={loading || authLoading}>
            {loading ? "Processing..." : isReset ? "Send Reset Link" : isLogin ? "Sign In" : "Create Account"}
          </Button>

          {GOOGLE_OAUTH_ENABLED && !isReset && (
            <>
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
                <div className="relative flex justify-center text-xs uppercase"><span className="bg-card/50 px-2 text-muted-foreground">Or continue with</span></div>
              </div>
              <Button type="button" variant="outline" className="w-full border-border hover:bg-accent" disabled={loading || authLoading} onClick={handleGoogleSignIn}>
                Sign in with Google
              </Button>
            </>
          )}

          {!GOOGLE_OAUTH_ENABLED && !isReset && (
            <p className="text-center text-xs text-muted-foreground">Google sign-in is unavailable until the configured Supabase project has the provider enabled.</p>
          )}

          <div className="flex flex-col gap-2">
            {!isReset ? (
              <>
                <button type="button" onClick={() => { setIsReset(true); setIsLogin(false); setPassword(""); }} className="w-full text-center text-sm text-primary hover:underline font-medium">Forgot password?</button>
                <button type="button" onClick={() => { setIsLogin(!isLogin); setPassword(""); }} className="w-full text-center text-sm text-muted-foreground hover:text-primary transition-colors">
                  {isLogin ? "Need an account? Register" : "Already have an account? Sign in"}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => { setIsReset(false); setIsLogin(true); }} className="w-full text-center text-sm text-muted-foreground hover:text-primary transition-colors">← Back to sign in</button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
};

export default Auth;
