import { supabase } from "../supabase/client";

type SignInOptions = {
  redirect_uri?: string;
  extraParams?: Record<string, string>;
};

type LegacyProvider = "google" | "apple" | "microsoft" | "lovable";

const providerMap: Record<Exclude<LegacyProvider, "lovable">, "google" | "apple" | "azure"> = {
  google: "google",
  apple: "apple",
  microsoft: "azure",
};

/**
 * Backwards-compatible auth adapter retained under the existing export name so
 * callers do not need a coordinated UI rewrite during the infrastructure
 * migration. Authentication is performed directly by Supabase; there is no
 * Lovable Cloud/Auth runtime dependency here.
 */
export const lovable = {
  auth: {
    signInWithOAuth: async (provider: LegacyProvider, opts?: SignInOptions) => {
      if (provider === "lovable") {
        return {
          redirected: false,
          error: new Error("The legacy Lovable identity provider is no longer supported."),
        };
      }

      const redirectTo = opts?.redirect_uri || window.location.origin;
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: providerMap[provider],
        options: {
          redirectTo,
          queryParams: opts?.extraParams,
          // Keep the previous adapter contract: return before navigation, then
          // explicitly redirect below and report redirected=true to the caller.
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        return { redirected: false, error };
      }

      if (!data?.url) {
        return {
          redirected: false,
          error: new Error("OAuth provider did not return a redirect URL."),
        };
      }

      window.location.assign(data.url);
      return { redirected: true, error: null };
    },
  },
};
