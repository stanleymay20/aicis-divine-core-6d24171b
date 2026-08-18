import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User, Session } from "@supabase/supabase-js";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  unavailable: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const isNetworkError = (error: unknown) =>
  error instanceof TypeError ||
  (error instanceof Error && /failed to fetch|network|load failed/i.test(error.message));

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    // Apply session state synchronously. Never await another auth method here:
    // the Supabase client holds an internal lock during sign-in, so calling
    // getUser()/getSession() from inside the callback can deadlock and leave
    // the UI stuck on "Processing...".
    const applySession = (nextSession: Session | null) => {
      if (!mounted) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setUnavailable(false);
      setLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        applySession(nextSession);
      }
    );

    void supabase.auth.getSession()
      .then(({ data: { session: existing } }) => applySession(existing))
      .catch((error) => {
        if (!mounted) return;
        setUnavailable(isNetworkError(error));
        setLoading(false);
      });

    // Background validation (outside the auth callback) — clears definitively
    // rejected tokens without blocking navigation into the app.
    const validate = () => {
      void supabase.auth.getUser()
        .then(async ({ data, error }) => {
          if (!mounted || !error) return;
          if (isNetworkError(error)) {
            setUnavailable(true);
            return;
          }
          if (!data?.user) {
            await supabase.auth.signOut({ scope: "local" });
            if (!mounted) return;
            setSession(null);
            setUser(null);
          }
        })
        .catch(() => {
          if (mounted) setUnavailable(true);
        });
    };

    const validateTimer = window.setTimeout(validate, 1200);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void supabase.auth.getSession()
          .then(({ data: { session: current } }) => {
            if (mounted && current) applySession(current);
          })
          .catch(() => {
            if (mounted) setUnavailable(true);
          });
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      mounted = false;
      window.clearTimeout(validateTimer);
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error && isNetworkError(error)) {
      await supabase.auth.signOut({ scope: "local" });
    }
    navigate('/auth');
  }, [navigate]);

  const value = useMemo(
    () => ({ user, session, loading, unavailable, signOut }),
    [user, session, loading, unavailable, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
