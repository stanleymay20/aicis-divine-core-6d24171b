import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User, Session } from "@supabase/supabase-js";

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    const applyValidatedUser = async (nextSession: Session | null) => {
      if (!nextSession) {
        if (!mounted) return;
        setSession(null);
        setUser(null);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.getUser();
      if (!mounted) return;

      if (error || !data.user) {
        // A locally cached token is not proof of authentication. Remove an
        // invalid session so protected routes cannot enter a redirect loop.
        await supabase.auth.signOut({ scope: "local" });
        if (!mounted) return;
        setSession(null);
        setUser(null);
        setLoading(false);
        return;
      }

      setSession(nextSession);
      setUser(data.user);
      setLoading(false);
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
    void supabase.auth.getSession().then(({ data: { session } }) =>
      applyValidatedUser(session)
    );

    // Refresh token on tab visibility change to prevent stale sessions
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (!mounted) return;
          if (session) {
            void applyValidatedUser(session);
          }
          // Do NOT reset to null on transient failures — only trust onAuthStateChange for sign-out
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
    await supabase.auth.signOut();
    navigate('/auth');
  }, [navigate]);

  return { user, session, loading, signOut };
};
