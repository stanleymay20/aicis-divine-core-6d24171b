import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const jsonHeaders = { "Content-Type": "application/json" };

const authHeaders = (extraHeaders: Record<string, string> = {}) => ({
  ...extraHeaders,
  ...jsonHeaders,
});

const bearerToken = (req: Request) => {
  const value = req.headers.get("authorization");
  if (!value?.toLowerCase().startsWith("bearer ")) return null;
  return value.replace(/^[Bb]earer\s+/, "");
};

export type AuthenticatorAssuranceLevel = "aal1" | "aal2" | null;

type ValidatedJwtClaims = {
  sub?: string;
  aal?: string;
  amr?: Array<{ method?: string; timestamp?: number }>;
};

/**
 * Decode claims only after the exact token has been validated by Supabase Auth.
 * This function does not verify signatures and must never be used independently
 * as an authentication boundary.
 */
function decodeValidatedJwtClaims(token: string): ValidatedJwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as ValidatedJwtClaims;
    return claims && typeof claims === "object" ? claims : null;
  } catch {
    return null;
  }
}

function validatedTokenAssurance(token: string, validatedUserId: string): AuthenticatorAssuranceLevel {
  const claims = decodeValidatedJwtClaims(token);
  if (!claims || claims.sub !== validatedUserId) return null;
  return claims.aal === "aal2" ? "aal2" : claims.aal === "aal1" ? "aal1" : null;
}

function mfaRequiredResponse(headers: Record<string, string>) {
  return new Response(
    JSON.stringify({
      error: "Forbidden",
      reason: "mfa_required",
      required_aal: "aal2",
      message: "This privileged action requires multi-factor authentication.",
    }),
    { status: 403, headers },
  );
}

export async function requireCronSecret(
  req: Request,
  extraHeaders: Record<string, string> = {},
) {
  const expected = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret") || bearerToken(req);

  if (!expected || !provided || provided !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized cron request" }), {
      status: 401,
      headers: authHeaders(extraHeaders),
    });
  }

  return null;
}

/**
 * Fast-path check for trusted auth claims only. `user_metadata` is intentionally
 * excluded because Supabase users can edit it themselves.
 */
export function userIsAdmin(user: any): boolean {
  return (
    user?.app_metadata?.role === "admin" ||
    user?.app_metadata?.roles?.includes?.("admin")
  );
}

async function userHasDatabaseRole(userId: string, role: string): Promise<boolean> {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", role)
    .limit(1);

  if (error) {
    console.error(JSON.stringify({
      level: "error",
      function: "auth",
      message: "role_lookup_failed",
      role,
      user_id: userId,
      error: error.message,
      timestamp: new Date().toISOString(),
    }));
    return false;
  }

  return (data?.length ?? 0) > 0;
}

export async function requireAdminUser(
  req: Request,
  extraHeaders: Record<string, string> = {},
) {
  const headers = authHeaders(extraHeaders);
  const authHeader = req.headers.get("authorization");
  const token = bearerToken(req);

  if (!authHeader || !token) {
    return {
      user: null,
      aal: null as AuthenticatorAssuranceLevel,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers,
      }),
    };
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return {
      user: null,
      aal: null as AuthenticatorAssuranceLevel,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers,
      }),
    };
  }

  const isAdmin =
    userIsAdmin(data.user) ||
    (await userHasDatabaseRole(data.user.id, "admin"));

  if (!isAdmin) {
    return {
      user: data.user,
      aal: validatedTokenAssurance(token, data.user.id),
      response: new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers,
      }),
    };
  }

  const aal = validatedTokenAssurance(token, data.user.id);
  if (aal !== "aal2") {
    return { user: data.user, aal, response: mfaRequiredResponse(headers) };
  }

  return { user: data.user, aal, response: null };
}

/**
 * Privileged scheduled jobs may be called either by a trusted cron secret or
 * by an authenticated AAL2 administrator. This keeps scheduled execution
 * possible without weakening the human administrator boundary.
 */
export async function requireAdminOrCron(
  req: Request,
  extraHeaders: Record<string, string> = {},
): Promise<{
  user: any | null;
  via: "admin" | "cron" | null;
  response: Response | null;
}> {
  const expected = Deno.env.get("CRON_SECRET");
  const providedCronSecret = req.headers.get("x-cron-secret");

  if (expected && providedCronSecret && providedCronSecret === expected) {
    return { user: null, via: "cron", response: null };
  }

  const { user, response } = await requireAdminUser(req, extraHeaders);
  if (response) return { user, via: null, response };
  return { user, via: "admin", response: null };
}

// ──────────────────────────────────────────────────────────────────
// User auth + tier/AAL gating (for intelligence endpoints)
// ──────────────────────────────────────────────────────────────────

export type AccessTier = "free" | "sovereign" | "enterprise";

const TIER_RANK: Record<AccessTier, number> = {
  free: 0,
  sovereign: 1,
  enterprise: 2,
};

export interface UserAuthContext {
  user: any;
  tier: AccessTier;
  aal: AuthenticatorAssuranceLevel;
}

/**
 * Validates the exact Authorization bearer token with Supabase Auth, validates
 * subject binding, and returns a fail-closed user context.
 */
export async function requireUser(
  req: Request,
  extraCorsHeaders: Record<string, string> = {},
): Promise<{ ctx: UserAuthContext | null; response: Response | null }> {
  const headers = authHeaders(extraCorsHeaders);
  const authHeader = req.headers.get("authorization");
  const token = bearerToken(req);

  if (!authHeader || !token) {
    return {
      ctx: null,
      response: new Response(
        JSON.stringify({ error: "Unauthorized", reason: "missing_or_malformed_authorization_header" }),
        { status: 401, headers },
      ),
    };
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return {
      ctx: null,
      response: new Response(
        JSON.stringify({ error: "Unauthorized", reason: "invalid_or_expired_token" }),
        { status: 401, headers },
      ),
    };
  }

  const aal = validatedTokenAssurance(token, data.user.id);
  if (!aal) {
    return {
      ctx: null,
      response: new Response(
        JSON.stringify({ error: "Unauthorized", reason: "invalid_token_subject_or_assurance_claims" }),
        { status: 401, headers },
      ),
    };
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let tier: AccessTier = "free";
  try {
    const { data: tierData, error: tierError } = await admin.rpc("get_user_tier", {
      _user_id: data.user.id,
    });
    if (tierError) throw tierError;
    const t = (tierData as string) ?? "free";
    if (t === "enterprise" || t === "sovereign" || t === "free") {
      tier = t;
    }
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      function: "auth",
      message: "tier_lookup_failed",
      user_id: data.user.id,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
    tier = "free";
  }

  return { ctx: { user: data.user, tier, aal }, response: null };
}

/**
 * Like requireUser, but additionally enforces an AAL2 user session.
 */
export async function requireAal2User(
  req: Request,
  extraCorsHeaders: Record<string, string> = {},
): Promise<{ ctx: UserAuthContext | null; response: Response | null }> {
  const { ctx, response } = await requireUser(req, extraCorsHeaders);
  if (response || !ctx) return { ctx: null, response };

  if (ctx.aal !== "aal2") {
    return { ctx: null, response: mfaRequiredResponse(authHeaders(extraCorsHeaders)) };
  }

  return { ctx, response: null };
}

/**
 * Like requireUser, but additionally enforces a minimum access tier.
 */
export async function requireTier(
  req: Request,
  minTier: AccessTier,
  extraCorsHeaders: Record<string, string> = {},
): Promise<{ ctx: UserAuthContext | null; response: Response | null }> {
  const { ctx, response } = await requireUser(req, extraCorsHeaders);
  if (response || !ctx) return { ctx: null, response };

  if (TIER_RANK[ctx.tier] < TIER_RANK[minTier]) {
    const headers = authHeaders(extraCorsHeaders);
    return {
      ctx: null,
      response: new Response(
        JSON.stringify({
          error: "Forbidden",
          reason: "tier_insufficient",
          required_tier: minTier,
          current_tier: ctx.tier,
          message: `This endpoint requires ${minTier} access.`,
        }),
        { status: 403, headers },
      ),
    };
  }

  return { ctx, response: null };
}

/**
 * Global privileged workers accept only an AAL2 administrator, the independently
 * configured CRON_SECRET, or an exact service-role Bearer token. Machine paths
 * are checked before the human admin path and never masquerade as user sessions.
 */
function hasServiceRoleBearer(req: Request): boolean {
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const provided = bearerToken(req);
  return Boolean(expected && provided && provided === expected);
}

export async function requireAdminOrTrustedWorker(
  req: Request,
  extraHeaders: Record<string, string> = {},
): Promise<{
  user: unknown | null;
  via: "admin" | "cron" | "service_role" | null;
  response: Response | null;
}> {
  if (req.method === "OPTIONS") return { user: null, via: null, response: null };

  const expectedCron = Deno.env.get("CRON_SECRET");
  const providedCron = req.headers.get("x-cron-secret");
  if (expectedCron && providedCron && providedCron === expectedCron) {
    return { user: null, via: "cron", response: null };
  }

  if (hasServiceRoleBearer(req)) {
    return { user: null, via: "service_role", response: null };
  }

  const { user, response } = await requireAdminUser(req, extraHeaders);
  if (response) return { user, via: null, response };
  return { user, via: "admin", response: null };
}

/**
 * User-facing analytical workers may be called by an authenticated user or by
 * the same trusted scheduler/service-role paths used for internal orchestration.
 */
export async function requireUserOrTrustedWorker(
  req: Request,
  extraHeaders: Record<string, string> = {},
): Promise<{
  ctx: UserAuthContext | null;
  via: "user" | "cron" | "service_role" | null;
  response: Response | null;
}> {
  if (req.method === "OPTIONS") return { ctx: null, via: null, response: null };

  const expectedCron = Deno.env.get("CRON_SECRET");
  const providedCron = req.headers.get("x-cron-secret");
  if (expectedCron && providedCron && providedCron === expectedCron) {
    return { ctx: null, via: "cron", response: null };
  }

  if (hasServiceRoleBearer(req)) {
    return { ctx: null, via: "service_role", response: null };
  }

  const { ctx, response } = await requireUser(req, extraHeaders);
  if (response) return { ctx: null, via: null, response };
  return { ctx, via: "user", response: null };
}

export async function enforceRateLimit(options: {
  supabase: ReturnType<typeof createClient>;
  req: Request;
  route: string;
  limit?: number;
  windowSeconds?: number;
  extraHeaders?: Record<string, string>;
}) {
  const {
    supabase,
    req,
    route,
    limit = 60,
    windowSeconds = 60,
    extraHeaders = {},
  } = options;
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const subject = forwardedFor || req.headers.get("cf-connecting-ip") || "unknown";
  const now = new Date();
  const windowStartMs = Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000;
  const windowStart = new Date(windowStartMs).toISOString();

  const { data: current } = await supabase
    .from("api_rate_limits")
    .select("id, request_count")
    .eq("subject", subject)
    .eq("route", route)
    .eq("window_start", windowStart)
    .maybeSingle();

  if (current && current.request_count >= limit) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: {
        ...authHeaders(extraHeaders),
        "Retry-After": String(windowSeconds),
      },
    });
  }

  if (current) {
    await supabase
      .from("api_rate_limits")
      .update({ request_count: current.request_count + 1, updated_at: now.toISOString() })
      .eq("id", current.id);
  } else {
    await supabase.from("api_rate_limits").insert({
      subject,
      route,
      window_start: windowStart,
      request_count: 1,
    });
  }

  return null;
}

export async function recordPipelineHealth(options: {
  supabase: ReturnType<typeof createClient>;
  jobName: string;
  status: "started" | "success" | "partial" | "failed" | "degraded";
  source?: string;
  insertedCount?: number;
  skippedCount?: number;
  errorCount?: number;
  durationMs?: number;
  message?: string;
  metadata?: Record<string, unknown>;
}) {
  const {
    supabase,
    jobName,
    status,
    source,
    insertedCount = 0,
    skippedCount = 0,
    errorCount = 0,
    durationMs,
    message,
    metadata = {},
  } = options;
  await supabase.from("pipeline_health_events").insert({
    job_name: jobName,
    status,
    source,
    inserted_count: insertedCount,
    skipped_count: skippedCount,
    error_count: errorCount,
    duration_ms: durationMs,
    message,
    metadata,
  });
}
