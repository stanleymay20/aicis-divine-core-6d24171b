// Delivers signed webhook payloads to subscribers for a completed run.
// HMAC-SHA256 signatures, idempotency keys, retry-aware delivery metadata.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as baseCorsHeaders, signWebhook, sha256Hex } from "../_shared/export-schema.ts";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

async function deliver(runId: string) {
  const { data: run, error: runError } = await admin
    .from("export_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (runError) throw runError;
  if (!run) throw new Error("run_not_found");

  const { data: hooks, error: hookError } = await admin
    .from("export_webhooks")
    .select("*")
    .eq("enabled", true)
    .or(`profile_id.eq.${run.profile_id},profile_id.is.null`);
  if (hookError) throw hookError;
  if (!hooks?.length) return { delivered: 0, total: 0 };

  let signedUrl: string | null = null;
  if (run.storage_path) {
    const { data: signed, error: signedError } = await admin.storage
      .from("aicis-exports")
      .createSignedUrl(run.storage_path, 3600);
    if (signedError) throw signedError;
    signedUrl = signed?.signedUrl ?? null;
  }

  const eventType = "export.completed";
  let delivered = 0;

  for (const hook of hooks) {
    if ((run.records_exported ?? 0) === 0) continue;

    const payload = {
      event_type: eventType,
      export_batch_id: run.export_batch_id,
      run_id: run.id,
      profile_id: run.profile_id,
      organization_id: hook.organization_id,
      records_exported: run.records_exported,
      clusters_exported: run.clusters_exported,
      recommendations_exported: run.recommendations_exported,
      schema_version: "v1",
      generated_at: new Date().toISOString(),
      download_url: signedUrl,
      download_expires_in_seconds: 3600,
    };

    const body = JSON.stringify(payload);
    const idempotencyKey = `${hook.id}:${run.id}:${eventType}`;

    // Legacy schema note: despite its name, secret_hash currently contains the
    // shared signing secret supplied by the admin UI. A separate migration will
    // move this secret to protected server-side storage without changing the
    // on-wire HMAC contract.
    const signingSecret = String(hook.secret_hash ?? "");
    if (!signingSecret) {
      console.error(`Webhook ${hook.id} has no signing secret; skipping delivery`);
      continue;
    }

    const signature = await signWebhook(signingSecret, body);
    const payloadHash = await sha256Hex(body);

    let status = 0;
    let excerpt = "";
    try {
      const response = await fetch(hook.endpoint_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AICIS-Signature": signature,
          "X-AICIS-Event": eventType,
          "X-AICIS-Idempotency-Key": idempotencyKey,
          "X-AICIS-Schema-Version": "v1",
        },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      status = response.status;
      excerpt = (await response.text()).slice(0, 500);
    } catch (error) {
      excerpt = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    }

    const success = status >= 200 && status < 300;
    const { error: deliveryError } = await admin.from("export_webhook_deliveries").insert({
      webhook_id: hook.id,
      run_id: run.id,
      event_type: eventType,
      idempotency_key: idempotencyKey,
      payload_hash: payloadHash,
      signature,
      http_status: status,
      attempt: 1,
      response_excerpt: excerpt,
      delivered_at: success ? new Date().toISOString() : null,
    });
    if (deliveryError && deliveryError.code !== "23505") throw deliveryError;

    const { error: webhookUpdateError } = await admin.from("export_webhooks").update({
      last_success_at: success ? new Date().toISOString() : hook.last_success_at,
      last_error_at: success ? hook.last_error_at : new Date().toISOString(),
      consecutive_failures: success ? 0 : (hook.consecutive_failures ?? 0) + 1,
    }).eq("id", hook.id);
    if (webhookUpdateError) throw webhookUpdateError;

    if (success) delivered += 1;
  }

  return { delivered, total: hooks.length };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const runId = typeof body.run_id === "string" && body.run_id ? body.run_id : null;
    if (!runId) {
      return new Response(JSON.stringify({ error: "run_id_required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await deliver(runId);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
