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

    const applyValidatedUser = async (nextSession: Session | null) => {
      if (!nextSession) {
        if (!mounted) return;
        setSession(null);
        setUser(null);
        setUnavailable(false);
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase.auth.getUser();
        if (!mounted) return;

        if (error || !data.user) {
          // Only remove a definitively rejected token. A network outage must
          // not destroy a valid refresh token or create a redirect loop.
          if (!isNetworkError(error)) {
            await supabase.auth.signOut({ scope: "local" });
          }
          if (!mounted) return;
          setSession(null);
          setUser(null);
          setUnavailable(isNetworkError(error));
          setLoading(false);
          return;
        }

        setSession(nextSession);
        setUser(data.user);
        setUnavailable(false);
        setLoading(false);
      } catch (error) {
        if (!mounted) return;
        setSession(null);
        setUser(null);
        setUnavailable(isNetworkError(error));
        setLoading(false);
      }
    };

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!mounted) return;
        // Defer network validation until after the auth callback completes;
        // awaiting another auth method inside this callback can deadlock.
        window.setTimeout(() => void applyValidatedUser(session), 0);
      }
    );

    // THEN check for an existing session and validate it with the auth server.
    void supabase.auth.getSession()
      .then(({ data: { session } }) => applyValidatedUser(session))
      .catch((error) => {
        if (!mounted) return;
        setUnavailable(isNetworkError(error));
        setLoading(false);
      });

    // Refresh token on tab visibility change to prevent stale sessions
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void supabase.auth.getSession()
          .then(({ data: { session } }) => {
            if (mounted && session) void applyValidatedUser(session);
          })
          .catch(() => {
            if (mounted) setUnavailable(true);
          });
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      mounted = false;
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
