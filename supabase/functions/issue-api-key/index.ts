import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function generateApiKey(orgId: string): Promise<{ key: string; hash: string; prefix: string }> {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  
  const key = Array.from(randomBytes, byte => byte.toString(16).padStart(2, '0')).join('');
  const prefix = `sk_${orgId.substring(0, 8)}`;
  const fullKey = `${prefix}_${key}`;
  
  const encoder = new TextEncoder();
  const data = encoder.encode(fullKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hash = Array.from(new Uint8Array(hashBuffer), byte => byte.toString(16).padStart(2, '0')).join('');
  
  return { key: fullKey, hash, prefix };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

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

    // Check for duplicate names
    const { count: duplicateCount } = await supabase
      .from("api_keys")
      .select("*", { count: "exact", head: true })
      .eq("org_id", org_id)
      .eq("name", name)
      .eq("revoked", false);

    if (duplicateCount && duplicateCount > 0) {
      throw new Error("An API key with this name already exists");
    }

    // Verify user is org owner
    const { data: org } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", org_id)
      .eq("owner_id", user.id)
      .single();

    if (!org) throw new Error("Not authorized");

    // Check if API is enabled
    if (!org.api_enabled) {
      throw new Error("API access is not enabled for this organization");
    }

    // Check key limit
    const { count } = await supabase
      .from("api_keys")
      .select("*", { count: 'exact', head: true })
      .eq("org_id", org_id)
      .eq("revoked", false);

    if (count && count >= (org.max_api_keys || 2)) {
      throw new Error(`Maximum number of API keys (${org.max_api_keys}) reached`);
    }

    // Generate API key
    const { key, hash, prefix } = await generateApiKey(org_id);

    // Determine rate limit based on tier
    let rateLimit = rate_limit_per_minute || 60;
    if (org.tier === 'starter') rateLimit = Math.min(rateLimit, 60);
    if (org.tier === 'pro') rateLimit = Math.min(rateLimit, 300);
    if (org.tier === 'enterprise') rateLimit = Math.min(rateLimit, 1000);

    // Store API key
    const { data: apiKey, error } = await supabase
      .from("api_keys")
      .insert({
        org_id,
        key_hash: hash,
        key_prefix: prefix,
        name,
        rate_limit_per_minute: rateLimit,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) throw error;

    // Generate HMAC secret
    const hmacSecret = Deno.env.get("API_HMAC_SECRET");
    const encoder = new TextEncoder();
    const keyData = encoder.encode(hmacSecret);
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    
    const signature = await crypto.subtle.sign(
      "HMAC",
      hmacKey,
      encoder.encode(key)
    );
    
    const signatureHex = Array.from(new Uint8Array(signature), byte => 
      byte.toString(16).padStart(2, '0')
    ).join('');

    // Log action
    await supabase.from("tenant_action_log").insert({
      org_id,
      user_id: user.id,
      action: "api_key_issued",
      details: { name, key_prefix: prefix },
    });

    await supabase.from("system_logs").insert({
      division: "system",
      action: "issue_api_key",
      user_id: user.id,
      log_level: "info",
      result: "API key issued",
      metadata: { org_id, name, key_prefix: prefix },
    });

    return new Response(
      JSON.stringify({ 
        ok: true, 
        api_key: key,
        key_id: apiKey.id,
        signature: signatureHex,
        rate_limit: rateLimit,
        warning: "Store this key securely. It will not be shown again."
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Error in issue-api-key:", e);
    
    // Handle Zod validation errors
    if (e instanceof z.ZodError) {
      return new Response(
        JSON.stringify({ 
          error: "Validation failed", 
          details: e.errors 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
