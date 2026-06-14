import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const jsonHeaders = { "Content-Type": "application/json" };

export async function requireCronSecret(req: Request) {
  const expected = Deno.env.get("CRON_SECRET");

  const provided =
    req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace("Bearer ", "");

  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized cron request" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  return null;
}

export function userIsAdmin(user: any): boolean {
  return (
    user?.app_metadata?.role === "admin" ||
    user?.user_metadata?.role === "admin" ||
    user?.app_metadata?.roles?.includes?.("admin")
  );
}

export async function requireAdminUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return { user: null, response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders }) };
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return { user: null, response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders }) };
  }

  if (!userIsAdmin(data.user)) {
    return { user: data.user, response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: jsonHeaders }) };
  }

  return { user: data.user, response: null };
}

// ──────────────────────────────────────────────────────────────────
// User auth + tier gating (for intelligence endpoints)
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
}

/**
 * Validates the Authorization header (Bearer JWT) and returns either
 *   { ctx: { user, tier }, response: null }  on success, or
 *   { ctx: null, response: Response }        with status 401 on failure.
 *
 * Use `extraCorsHeaders` to merge in your function's CORS headers so
 * the error response is not blocked by the browser.
 */
export async function requireUser(
  req: Request,
  extraCorsHeaders: Record<string, string> = {},
): Promise<{ ctx: UserAuthContext | null; response: Response | null }> {
  const headers = { ...extraCorsHeaders, ...jsonHeaders };
  const authHeader = req.headers.get("authorization");

  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
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

  const token = authHeader.replace(/^[Bb]earer\s+/, "");
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

  // Tier lookup uses the service role to bypass RLS on organizations,
  // but only ever returns the tier for THIS user_id.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let tier: AccessTier = "free";
  try {
    const { data: tierData } = await admin.rpc("get_user_tier", {
      _user_id: data.user.id,
    });
    const t = (tierData as string) ?? "free";
    if (t === "enterprise" || t === "sovereign" || t === "free") {
      tier = t;
    }
  } catch {
    tier = "free";
  }

  return { ctx: { user: data.user, tier }, response: null };
}

/**
 * Like requireUser, but additionally enforces a minimum access tier.
 * Returns 403 with the user's current tier when the requirement is not met.
 */
export async function requireTier(
  req: Request,
  minTier: AccessTier,
  extraCorsHeaders: Record<string, string> = {},
): Promise<{ ctx: UserAuthContext | null; response: Response | null }> {
  const { ctx, response } = await requireUser(req, extraCorsHeaders);
  if (response || !ctx) return { ctx: null, response };

  if (TIER_RANK[ctx.tier] < TIER_RANK[minTier]) {
    const headers = { ...extraCorsHeaders, ...jsonHeaders };
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

export async function enforceRateLimit(options: {
  supabase: ReturnType<typeof createClient>;
  req: Request;
  route: string;
  limit?: number;
  windowSeconds?: number;
}) {
  const { supabase, req, route, limit = 60, windowSeconds = 60 } = options;
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
      headers: { ...jsonHeaders, "Retry-After": String(windowSeconds) },
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
  const { supabase, jobName, status, source, insertedCount = 0, skippedCount = 0, errorCount = 0, durationMs, message, metadata = {} } = options;
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
