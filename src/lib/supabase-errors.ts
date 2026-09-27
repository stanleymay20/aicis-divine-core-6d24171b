export type SupabaseLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

const SCHEMA_UNAVAILABLE_CODES = new Set([
  "42P01", // undefined_table / relation
  "42883", // undefined_function
  "42703", // undefined_column
  "PGRST200",
  "PGRST202",
  "PGRST204",
  "PGRST205",
]);

export function isSchemaUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as SupabaseLikeError;
  if (value.code && SCHEMA_UNAVAILABLE_CODES.has(value.code)) return true;

  const text = [value.message, value.details, value.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    /relation .* does not exist/.test(text) ||
    /function .* does not exist/.test(text) ||
    /column .* does not exist/.test(text) ||
    /could not find the table/.test(text) ||
    /could not find the function/.test(text) ||
    /schema cache/.test(text)
  );
}

export function isAuthorizationDeniedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as SupabaseLikeError;
  if (value.code === "42501") return true;
  const text = [value.message, value.details, value.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /permission denied|row-level security|forbidden|not authorized/.test(text);
}

/** Reads the real reason from a failed edge function call and returns a user-facing message. */
export async function describeFunctionError(error: unknown, fallback = "Request failed"): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.clone === "function") {
    try {
      const body = await ctx.clone().json();
      if (body?.reason === "mfa_required") {
        return "This action needs two-step sign-in (MFA), which isn't enabled on your account yet. It still runs automatically on schedule.";
      }
      if (body?.message || body?.error) return String(body.message ?? body.error);
    } catch { /* not JSON */ }
  }
  return (error as Error)?.message || fallback;
}
