import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EVENT_TYPES = [
  "signal.new",
  "signal.critical",
  "decision.created",
  "decision.executed",
  "outcome.recorded",
] as const;

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

  return { id: data.claims.sub as string };
}

function createSigningSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `whsec_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
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

    const schema = z.object({
      org_id: z.string().uuid(),
      url: z.string().trim().url().refine((value) => value.startsWith("https://"), {
        message: "Webhook URL must start with https://",
      }),
      events: z.array(z.enum(EVENT_TYPES)).min(1).max(EVENT_TYPES.length).optional(),
    });

    const { org_id, url, events } = schema.parse(await req.json());

    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("id, owner_id, api_enabled")
      .eq("id", org_id)
      .maybeSingle();

    if (orgError) throw orgError;
    if (!org || org.owner_id !== user.id) {
      return json({ error: "Only the workspace owner can create webhooks" }, 403);
    }

    if (!org.api_enabled) {
      return json({ error: "Developer API access is not enabled for this workspace" }, 403);
    }

    const { count: duplicateCount, error: duplicateError } = await supabaseAdmin
      .from("webhook_subscriptions")
      .select("*", { count: "exact", head: true })
      .eq("org_id", org_id)
      .eq("url", url)
      .eq("active", true);

    if (duplicateError) throw duplicateError;
    if (duplicateCount && duplicateCount > 0) {
      return json({ error: "An active webhook with this URL already exists" }, 409);
    }

    const secret = createSigningSecret();
    const selectedEvents = events ?? [...EVENT_TYPES];

    const { data: webhook, error } = await supabaseAdmin
      .from("webhook_subscriptions")
      .insert({
        org_id,
        url,
        events: selectedEvents,
        secret,
        active: true,
      })
      .select("id, url, events, active, created_at")
      .single();

    if (error) throw error;

    await Promise.allSettled([
      supabaseAdmin.from("tenant_action_log").insert({
        org_id,
        user_id: user.id,
        action: "webhook_created",
        details: { webhook_id: webhook.id, url, events: selectedEvents },
      }),
      supabaseAdmin.from("system_logs").insert({
        division: "system",
        action: "create_webhook_subscription",
        user_id: user.id,
        log_level: "info",
        result: "Webhook subscription created",
        metadata: { org_id, webhook_id: webhook.id },
      }),
    ]);

    return json({
      ok: true,
      webhook,
      signing_secret: secret,
      warning: "Store this signing secret securely. It will not be shown again.",
    });
  } catch (e) {
    console.error("Error in create-webhook-subscription:", e);

    if (e instanceof z.ZodError) {
      return json({ error: "Validation failed", details: e.errors }, 400);
    }

    const message = (e as Error).message || "Unable to create webhook";
    const status = message === "Unauthorized" ? 401 : 500;
    return json({ error: message }, status);
  }
});
