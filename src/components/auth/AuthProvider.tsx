import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { AuthContext } from "@/contexts/AuthContext";

const isNetworkError = (error: unknown) =>
  error instanceof TypeError ||
  (error instanceof Error && /failed to fetch|network|load failed|fetch/i.test(error.message));

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const initialValidationComplete = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    const clearSession = () => {
      if (!mounted) return;
      setSession(null);
      setUser(null);
      setUnavailable(false);
      setLoading(false);
    };

    const applyTrustedSession = (nextSession: Session | null) => {
      if (!mounted) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setUnavailable(false);
      setLoading(false);
    };

    const validateInitialSession = async (candidate: Session | null) => {
      if (!candidate) {
        initialValidationComplete.current = true;
        clearSession();
        return;
      }

      try {
        const { data, error } = await supabase.auth.getUser(candidate.access_token);
        if (!mounted) return;

        if (error || !data.user) {
          if (isNetworkError(error)) {
            setUnavailable(true);
            setLoading(false);
            return;
          }

          initialValidationComplete.current = true;
          await supabase.auth.signOut({ scope: "local" });
          clearSession();
          return;
        }

        initialValidationComplete.current = true;
        applyTrustedSession({ ...candidate, user: data.user });
      } catch (error) {
        if (!mounted) return;

        if (isNetworkError(error)) {
          setUnavailable(true);
          setLoading(false);
          return;
        }

        initialValidationComplete.current = true;
        await supabase.auth.signOut({ scope: "local" });
        clearSession();
      }
    };

    const handleAuthChange = (event: AuthChangeEvent, nextSession: Session | null) => {
      if (event === "INITIAL_SESSION") {
        if (!initialValidationComplete.current) void validateInitialSession(nextSession);
        return;
      }

      if (event === "SIGNED_OUT") {
        initialValidationComplete.current = true;
        clearSession();
        return;
      }

      if (["SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED", "PASSWORD_RECOVERY"].includes(event)) {
        initialValidationComplete.current = true;
        applyTrustedSession(nextSession);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(handleAuthChange);

    const bootstrapTimer = window.setTimeout(() => {
      if (initialValidationComplete.current) return;
      void supabase.auth.getSession()
        .then(({ data: { session: candidate } }) => {
          if (!initialValidationComplete.current) void validateInitialSession(candidate);
        })
        .catch((error) => {
          if (!mounted) return;
          setUnavailable(isNetworkError(error));
          setLoading(false);
        });
    }, 250);

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" || !initialValidationComplete.current) return;

      void supabase.auth.getUser()
        .then(({ data, error }) => {
          if (!mounted) return;

          if (error || !data.user) {
            if (isNetworkError(error)) {
              setUnavailable(true);
              return;
            }

            void supabase.auth.signOut({ scope: "local" });
            clearSession();
            return;
          }

          setUser(data.user);
          setUnavailable(false);
        })
        .catch((error) => {
          if (mounted && isNetworkError(error)) setUnavailable(true);
        });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      mounted = false;
      window.clearTimeout(bootstrapTimer);
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const signOut = useCallback(async () => {
    try {
      const { error } = await supabase.auth.signOut({ scope: "global" });
      if (error) throw error;
    } catch {
      await supabase.auth.signOut({ scope: "local" });
    } finally {
      setSession(null);
      setUser(null);
      setUnavailable(false);
      navigate("/auth", { replace: true });
    }
  }, [navigate]);

  const value = useMemo(
    () => ({ user, session, loading, unavailable, signOut }),
    [user, session, loading, unavailable, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
