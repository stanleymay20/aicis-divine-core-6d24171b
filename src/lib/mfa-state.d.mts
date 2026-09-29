export type MfaState = "loading" | "not_enrolled" | "challenge_required" | "verified";
export function deriveMfaState(input: {
  currentLevel?: string | null;
  nextLevel?: string | null;
  factors?: Array<{ status?: string; factor_type?: string }>;
} | null | undefined): MfaState;
export function staleUnverifiedFactorIds(factors: Array<{ id: string; status?: string }> | null | undefined): string[];
export function isValidTotpCode(code: unknown): boolean;
export function needsMfaChallenge(aal: { currentLevel?: string | null; nextLevel?: string | null } | null | undefined): boolean;
export function safeMfaNext(value: unknown): string;
