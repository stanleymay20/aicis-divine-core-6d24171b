// Pure MFA state derivation. No secrets or codes are stored anywhere;
// Supabase Auth holds the TOTP secret, the app only reads factor status.

/** @typedef {"loading"|"not_enrolled"|"challenge_required"|"verified"} MfaState */

/**
 * @param {{ currentLevel?: string|null, nextLevel?: string|null, factors?: Array<{status?: string, factor_type?: string}> }} input
 * @returns {MfaState}
 */
export function deriveMfaState(input) {
  if (!input) return "loading";
  const verifiedTotp = (input.factors ?? []).filter(
    (f) => f && f.status === "verified" && (f.factor_type ?? "totp") === "totp",
  );
  if (input.currentLevel === "aal2") return "verified";
  if (verifiedTotp.length > 0 || input.nextLevel === "aal2") return "challenge_required";
  return "not_enrolled";
}

/** Unverified factors are abandoned enrollments that must be removed before re-enrolling. */
export function staleUnverifiedFactorIds(factors) {
  return (factors ?? []).filter((f) => f && f.status !== "verified").map((f) => f.id);
}

export function isValidTotpCode(code) {
  return /^\d{6}$/.test(String(code ?? "").trim());
}

/** After password sign-in: should the user be sent to the MFA challenge? */
export function needsMfaChallenge(aal) {
  return Boolean(aal) && aal.currentLevel === "aal1" && aal.nextLevel === "aal2";
}

/** Only relative in-app paths are allowed as post-verification destinations. */
export function safeMfaNext(value) {
  const v = String(value ?? "");
  return v.startsWith("/") && !v.startsWith("//") ? v : "/morning-brief";
}
