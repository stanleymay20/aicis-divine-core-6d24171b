import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import aicisLogo from "@/assets/aicis-logo.png";

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [isReset, setIsReset] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate("/morning-brief", { replace: true });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        navigate("/morning-brief", { replace: true });
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isReset) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast({
          title: "Password Reset Email Sent",
          description: "Check your email for the reset link.",
        });
        setIsReset(false);
      } else if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast({
          title: "Access Granted",
          description: "Welcome to AICIS",
        });
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: `${window.location.origin}/`,
          },
        });
        if (error) throw error;
        toast({
          title: "Registration Successful",
          description: "Check your email to verify your account.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Authentication Failed",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
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
          <img 
            src={aicisLogo} 
            alt="AICIS" 
            className="h-20 w-20 object-contain mb-4 drop-shadow-[0_0_20px_hsl(var(--primary))]"
          />
          <h1 className="text-3xl font-orbitron font-bold text-primary text-glow-cyber">
            AICIS
          </h1>
          <p className="text-muted-foreground mt-2 text-center">
            AI-Assisted Civilization Intelligence System
          </p>
        </div>

        <form onSubmit={handleAuth} className="space-y-6">
          {!isLogin && !isReset && (
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                type="text"
                placeholder="Your full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required={!isLogin}
                className="bg-input border-border"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="bg-input border-border"
            />
          </div>

          {!isReset && (
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
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
          )}

          <Button
            type="submit"
            className="w-full gradient-cyber text-primary-foreground font-orbitron glow-cyber"
            disabled={loading}
          >
            {loading 
              ? "Processing..." 
              : isReset 
                ? "Send Reset Link" 
                : isLogin 
                  ? "Sign In" 
                  : "Create Account"}
          </Button>

          <div className="flex flex-col gap-2">
            {!isReset && (
              <>
                <button
                  type="button"
                  onClick={() => { setIsReset(true); setIsLogin(false); }}
                  className="w-full text-center text-sm text-primary hover:underline font-medium"
                >
                  Forgot password?
                </button>
                <button
                  type="button"
                  onClick={() => setIsLogin(!isLogin)}
                  className="w-full text-center text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  {isLogin ? "Need an account? Register" : "Already have an account? Sign in"}
                </button>
              </>
            )}
            {isReset && (
              <button
                type="button"
                onClick={() => { setIsReset(false); setIsLogin(true); }}
                className="w-full text-center text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                ← Back to sign in
              </button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
};

export default Auth;
