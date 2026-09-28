import { createClient } from "@supabase/supabase-js";

// Recovery links must work even when the email opens in another browser. Keep
// this implicit-flow client completely separate from the application's PKCE
// client: its short-lived recovery session is never application authorization.
// Mirror the main client's fail-closed fallback so a missing deployment value
// never crashes the app at module load (blank screen).
const url = import.meta.env.VITE_SUPABASE_URL?.trim() || "https://aicis-unconfigured.invalid";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || "aicis-unconfigured-public-key";

export const recoveryAuth = createClient(url, key, {
  auth: {
    flowType: "implicit",
    storageKey: "aicis-password-recovery-only",
    persistSession: true,
    autoRefreshToken: false,
    detectSessionInUrl: true,
  },
}).auth;

let recoveryEventToken: string | null = null;

recoveryAuth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY") recoveryEventToken = session?.access_token ?? null;
  if (event === "SIGNED_OUT") recoveryEventToken = null;
});

export const getRecoveryEventToken = () => recoveryEventToken;
