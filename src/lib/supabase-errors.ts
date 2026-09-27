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
