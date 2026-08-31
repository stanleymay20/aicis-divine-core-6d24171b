import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import { AuthContext } from "@/contexts/AuthContext";
import { decodeAuthTokenClaims, tokenClaimsContainAuthMethod } from "@/lib/authTokenClaims";

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
    if (!isSupabaseConfigured) {
      // Public routes must remain renderable if deployment configuration is
      // missing, while every authenticated route sees auth as unavailable and
      // therefore fails closed through ProtectedRoute.
      initialValidationComplete.current = true;
      setSession(null);
      setUser(null);
      setUnavailable(true);
      setLoading(false);
      return;
    }

    let mounted = true;
    let validationGeneration = 0;

    const clearSession = () => {
      if (!mounted) return;
      setSession(null);
      setUser(null);
      setUnavailable(false);
      setLoading(false);
    };

    const isolateRecoverySession = () => {
      if (!mounted) return;
      // Supabase keeps the recovery credential internally so /reset-password can
      // use it, but the application AuthContext deliberately exposes no normal
      // user/session. Recovery possession is not general AICIS authorization.
      setSession(null);
      setUser(null);
      setUnavailable(false);
      setLoading(false);
    };

    const applyTrustedSession = (candidate: Session, verifiedUser: User) => {
      if (!mounted) return;
      setSession({ ...candidate, user: verifiedUser });
      setUser(verifiedUser);
      setUnavailable(false);
      setLoading(false);
    };

    const rejectInvalidSession = async () => {
      try {
        await supabase.auth.signOut({ scope: "local" });
      } finally {
        clearSession();
      }
    };

    const validateSessionCandidate = async (candidate: Session | null, generation: number) => {
      if (!candidate) {
        if (mounted && generation === validationGeneration) clearSession();
        return;
      }

      try {
        // Never trust the user object loaded from browser storage. Validate the
        // exact access token with the Auth server before exposing it to routes.
        const { data, error } = await supabase.auth.getUser(candidate.access_token);
        if (!mounted || generation !== validationGeneration) return;

        if (error || !data.user) {
          if (isNetworkError(error)) {
            setUnavailable(true);
            setLoading(false);
            return;
          }

          await rejectInvalidSession();
          return;
        }

        const claims = decodeAuthTokenClaims(candidate.access_token);
        const sameSubject = claims?.sub === data.user.id && candidate.user.id === data.user.id;
        if (!sameSubject) {
          await rejectInvalidSession();
          return;
        }

        if (tokenClaimsContainAuthMethod(claims, "recovery")) {
          isolateRecoverySession();
          return;
        }

        applyTrustedSession(candidate, data.user);
      } catch (error) {
        if (!mounted || generation !== validationGeneration) return;

        if (isNetworkError(error)) {
          setUnavailable(true);
          setLoading(false);
          return;
        }

        await rejectInvalidSession();
      }
    };

    const beginValidation = (candidate: Session | null, clearWhileValidating: boolean) => {
      const generation = ++validationGeneration;
      if (clearWhileValidating && mounted) {
        setSession(null);
        setUser(null);
        setUnavailable(false);
        setLoading(true);
      }
      void validateSessionCandidate(candidate, generation);
    };

    const validateInitialSession = (candidate: Session | null) => {
      initialValidationComplete.current = true;
      beginValidation(candidate, true);
    };

    const handleAuthChange = (event: AuthChangeEvent, nextSession: Session | null) => {
      if (event === "INITIAL_SESSION") {
        if (!initialValidationComplete.current) validateInitialSession(nextSession);
        return;
      }

      if (event === "SIGNED_OUT") {
        initialValidationComplete.current = true;
        validationGeneration += 1;
        clearSession();
        return;
      }

      if (event === "PASSWORD_RECOVERY") {
        initialValidationComplete.current = true;
        validationGeneration += 1;
        isolateRecoverySession();
        return;
      }

      if (event === "SIGNED_IN") {
        initialValidationComplete.current = true;
        beginValidation(nextSession, true);
        return;
      }

      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        initialValidationComplete.current = true;
        beginValidation(nextSession, false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(handleAuthChange);

    const bootstrapTimer = window.setTimeout(() => {
      if (initialValidationComplete.current) return;
      void supabase.auth.getSession()
        .then(({ data: { session: candidate } }) => {
          if (!initialValidationComplete.current) validateInitialSession(candidate);
        })
        .catch((error) => {
          if (!mounted) return;
          initialValidationComplete.current = true;
          setUnavailable(isNetworkError(error));
          setLoading(false);
        });
    }, 250);

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" || !initialValidationComplete.current) return;

      // getSession only discovers the current candidate. validateSessionCandidate
      // server-confirms it and preserves the recovery-session isolation boundary.
      void supabase.auth.getSession()
        .then(({ data: { session: candidate } }) => {
          if (!mounted) return;
          beginValidation(candidate, false);
        })
        .catch((error) => {
          if (mounted && isNetworkError(error)) setUnavailable(true);
        });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      mounted = false;
      validationGeneration += 1;
      window.clearTimeout(bootstrapTimer);
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setSession(null);
      setUser(null);
      setUnavailable(true);
      navigate("/auth", { replace: true });
      return;
    }

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
