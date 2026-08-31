export type AuthTokenClaims = {
  sub?: string;
  amr?: Array<{ method?: string; timestamp?: number }>;
  [key: string]: unknown;
};

/**
 * Decode JWT payload claims without asserting trust.
 *
 * Callers MUST cryptographically/server-validate the exact token first (for
 * example with Supabase Auth getUser(accessToken)) before relying on these
 * claims for an authorization decision.
 */
export const decodeAuthTokenClaims = (accessToken: string): AuthTokenClaims | null => {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const json = decodeURIComponent(
      Array.from(atob(padded), (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""),
    );
    const claims = JSON.parse(json) as AuthTokenClaims;
    return claims && typeof claims === "object" ? claims : null;
  } catch {
    return null;
  }
};

export const tokenClaimsContainAuthMethod = (
  claims: AuthTokenClaims | null,
  method: string,
): boolean => Array.isArray(claims?.amr) && claims.amr.some((entry) => entry?.method === method);
