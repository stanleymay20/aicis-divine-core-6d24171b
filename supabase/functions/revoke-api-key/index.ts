import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await authClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const userId = claimsData.claims.sub as string;

    const { org_id, key_id } = await req.json().catch(() => ({}));
    if (!org_id || !key_id) return json({ error: "org_id and key_id are required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .select("id, owner_id")
      .eq("id", org_id)
      .maybeSingle();
    if (orgErr) throw orgErr;
    if (!org || org.owner_id !== userId) return json({ error: "Only the workspace owner can revoke keys" }, 403);

    const { data: key, error: keyErr } = await admin
      .from("api_keys")
      .select("id, name, revoked")
      .eq("id", key_id)
      .eq("org_id", org_id)
      .maybeSingle();
    if (keyErr) throw keyErr;
    if (!key) return json({ error: "API key not found" }, 404);
    if (key.revoked) return json({ ok: true, already_revoked: true });

    const { error: updErr } = await admin
      .from("api_keys")
      .update({
        revoked: true,
        revoked_at: new Date().toISOString(),
        revoked_by: userId,
      })
      .eq("id", key_id)
      .eq("org_id", org_id);
    if (updErr) throw updErr;

    await Promise.allSettled([
      admin.from("tenant_action_log").insert({
        org_id, user_id: userId, action: "api_key_revoked", details: { key_id, name: key.name },
      }),
      admin.from("system_logs").insert({
        division: "system", action: "revoke_api_key", user_id: userId,
        log_level: "info", result: "API key revoked", metadata: { org_id, key_id },
      }),
    ]);

    return json({ ok: true, message: "API key revoked" });
  } catch (e) {
    console.error("Error in revoke-api-key:", e);
    return json({ error: (e as Error).message || "Failed to revoke key" }, 500);
  }
});
