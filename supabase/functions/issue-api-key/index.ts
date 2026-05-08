import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function requireUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }

  const authClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await authClient.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    throw new Error("Unauthorized");
  }

  return {
    id: data.claims.sub as string,
    email: typeof data.claims.email === "string" ? data.claims.email : null,
  };
}

async function generateApiKey(orgId: string): Promise<{ key: string; hash: string; prefix: string }> {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);

  const key = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const prefix = `sk_${orgId.substring(0, 8)}`;
  const fullKey = `${prefix}_${key}`;

  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fullKey));
  const hash = Array.from(new Uint8Array(hashBuffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

  return { key: fullKey, hash, prefix };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const user = await requireUser(req);
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const apiKeySchema = z.object({
      org_id: z.string().uuid(),
      name: z.string()
        .trim()
        .min(3, "Name too short")
        .max(100, "Name too long")
        .regex(/^[a-zA-Z0-9\s-]+$/, "Only alphanumeric, spaces, and hyphens allowed"),
      rate_limit_per_minute: z.number().int().min(1).max(10000).optional(),
      scopes: z.array(z.enum(["read", "write", "admin"])).min(1).max(3).optional(),
      expires_in_days: z.number().int().min(1).max(3650).optional(),
    });

    const { org_id, name, rate_limit_per_minute, scopes, expires_in_days } = apiKeySchema.parse(await req.json());

    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("id, owner_id, tier, api_enabled, max_api_keys")
      .eq("id", org_id)
      .maybeSingle();

    if (orgError) throw orgError;
    if (!org || org.owner_id !== user.id) {
      return json({ error: "Only the workspace owner can create API keys" }, 403);
    }

    if (!org.api_enabled) {
      return json({ error: "Developer API access is not enabled for this workspace" }, 403);
    }

    const { count: duplicateCount, error: duplicateError } = await supabaseAdmin
      .from("api_keys")
      .select("*", { count: "exact", head: true })
      .eq("org_id", org_id)
      .eq("name", name)
      .eq("revoked", false);

    if (duplicateError) throw duplicateError;
    if (duplicateCount && duplicateCount > 0) {
      return json({ error: "An active API key with this name already exists" }, 409);
    }

    const { count, error: countError } = await supabaseAdmin
      .from("api_keys")
      .select("*", { count: "exact", head: true })
      .eq("org_id", org_id)
      .eq("revoked", false);

    if (countError) throw countError;
    const maxKeys = org.max_api_keys || 2;
    if (count && count >= maxKeys) {
      return json({ error: `Maximum number of active API keys (${maxKeys}) reached` }, 409);
    }

    const { key, hash, prefix } = await generateApiKey(org_id);

    let rateLimit = rate_limit_per_minute || 60;
    if (org.tier === "starter") rateLimit = Math.min(rateLimit, 60);
    if (org.tier === "pro") rateLimit = Math.min(rateLimit, 300);
    if (org.tier === "enterprise") rateLimit = Math.min(rateLimit, 1000);

    const expiresAt = expires_in_days
      ? new Date(Date.now() + expires_in_days * 86_400_000).toISOString()
      : null;

    const { data: apiKey, error } = await supabaseAdmin
      .from("api_keys")
      .insert({
        org_id,
        key_hash: hash,
        key_prefix: prefix,
        name,
        rate_limit_per_minute: rateLimit,
        scopes: scopes ?? ["read"],
        expires_at: expiresAt,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error) throw error;

    await Promise.allSettled([
      supabaseAdmin.from("tenant_action_log").insert({
        org_id,
        user_id: user.id,
        action: "api_key_issued",
        details: { name, key_prefix: prefix, scopes: scopes ?? ["read"], expires_at: expiresAt },
      }),
      supabaseAdmin.from("system_logs").insert({
        division: "system",
        action: "issue_api_key",
        user_id: user.id,
        log_level: "info",
        result: "API key issued",
        metadata: { org_id, name, key_prefix: prefix },
      }),
    ]);

    return json({
      ok: true,
      api_key: key,
      key_id: apiKey.id,
      rate_limit: rateLimit,
      expires_at: expiresAt,
      scopes: scopes ?? ["read"],
      warning: "Store this key securely. It will not be shown again.",
    });
  } catch (e) {
    console.error("Error in issue-api-key:", e);

    if (e instanceof z.ZodError) {
      return json({ error: "Validation failed", details: e.errors }, 400);
    }

    const message = (e as Error).message || "Unable to create API key";
    const status = message === "Unauthorized" ? 401 : 500;
    return json({ error: message }, status);
  }
});
