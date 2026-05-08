import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const user = await requireUser(req);
    const { name } = z.object({
      name: z.string().trim().min(2, "Workspace name is required").max(100, "Workspace name is too long"),
    }).parse(await req.json());

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    await supabaseAdmin.from("profiles").upsert({
      id: user.id,
      email: user.email,
      full_name: user.email ?? "Workspace owner",
    });

    const { data: existingOrg, error: existingError } = await supabaseAdmin
      .from("organizations")
      .select("id, name, api_enabled, max_api_keys")
      .eq("owner_id", user.id)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existingOrg) {
      if (!existingOrg.api_enabled) {
        const { data: enabledOrg, error: enableError } = await supabaseAdmin
          .from("organizations")
          .update({ api_enabled: true, max_api_keys: existingOrg.max_api_keys || 3 })
          .eq("id", existingOrg.id)
          .select()
          .single();
        if (enableError) throw enableError;
        return json({ ok: true, organization: enabledOrg });
      }
      return json({ ok: true, organization: existingOrg });
    }

    const { data: starterPlan } = await supabaseAdmin
      .from("subscription_plans")
      .select("*")
      .eq("key", "starter")
      .maybeSingle();

    const featureFlags = {
      ...(starterPlan?.features ?? {}),
      api_access: true,
    };

    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .insert({
        name,
        owner_id: user.id,
        tier: "starter",
        feature_flags: featureFlags,
        api_enabled: true,
        max_api_keys: 3,
      })
      .select()
      .single();

    if (orgError) throw orgError;

    const { error: memberError } = await supabaseAdmin
      .from("organization_members")
      .upsert({
        org_id: org.id,
        user_id: user.id,
        role: "owner",
      }, { onConflict: "org_id,user_id" });

    if (memberError) throw memberError;

    if (starterPlan?.id) {
      const { error: subError } = await supabaseAdmin
        .from("organization_subscriptions")
        .insert({
          org_id: org.id,
          plan_id: starterPlan.id,
          status: "active",
        });
      if (subError) throw subError;
    }

    await supabaseAdmin.from("system_logs").insert({
      division: "system",
      action: "create_organization",
      user_id: user.id,
      log_level: "info",
      result: "Developer workspace created",
      metadata: { org_id: org.id, org_name: name },
    });

    return json({ ok: true, organization: org });
  } catch (e) {
    console.error("Error in create-organization:", e);

    if (e instanceof z.ZodError) {
      return json({ error: "Validation failed", details: e.errors }, 400);
    }

    const message = (e as Error).message || "Unable to create workspace";
    const status = message === "Unauthorized" ? 401 : 500;
    return json({ error: message }, status);
  }
});
