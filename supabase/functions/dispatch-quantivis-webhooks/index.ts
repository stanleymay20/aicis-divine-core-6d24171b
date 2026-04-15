import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Fetch pending webhooks (batch of 20)
    const { data: pending, error: fetchErr } = await sb
      .from("quantivis_webhook_queue")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(20);

    if (fetchErr) throw fetchErr;
    if (!pending || pending.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, dispatched: 0, message: "No pending webhooks" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let sent = 0;
    let failed = 0;

    for (const webhook of pending) {
      try {
        const targetUrl = webhook.target_url;
        if (!targetUrl) {
          await sb.from("quantivis_webhook_queue")
            .update({ status: "failed", error_message: "No target URL", updated_at: new Date().toISOString() })
            .eq("id", webhook.id);
          failed++;
          continue;
        }

        // Create HMAC signature for payload verification
        const encoder = new TextEncoder();
        const payloadStr = JSON.stringify(webhook.payload);
        const signingKey = Deno.env.get("QUANTIVIS_WEBHOOK_SECRET") || "aicis-default-key";
        const key = await crypto.subtle.importKey(
          "raw", encoder.encode(signingKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
        );
        const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadStr));
        const sigHex = Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, "0")).join("");

        const response = await fetch(targetUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-AICIS-Signature": `sha256=${sigHex}`,
            "X-AICIS-Event": webhook.event_type,
            "X-AICIS-Delivery": webhook.id,
          },
          body: payloadStr,
        });

        if (response.ok) {
          await sb.from("quantivis_webhook_queue")
            .update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", webhook.id);
          sent++;
        } else {
          const retries = (webhook.retry_count || 0) + 1;
          const errMsg = `HTTP ${response.status}: ${await response.text().catch(() => "no body")}`.substring(0, 500);
          await sb.from("quantivis_webhook_queue")
            .update({
              status: retries >= 3 ? "failed" : "pending",
              retry_count: retries,
              error_message: errMsg,
              updated_at: new Date().toISOString(),
            })
            .eq("id", webhook.id);
          failed++;
        }
      } catch (e) {
        const retries = (webhook.retry_count || 0) + 1;
        await sb.from("quantivis_webhook_queue")
          .update({
            status: retries >= 3 ? "failed" : "pending",
            retry_count: retries,
            error_message: (e as Error).message.substring(0, 500),
            updated_at: new Date().toISOString(),
          })
          .eq("id", webhook.id);
        failed++;
      }
    }

    // Log dispatch run
    await sb.from("automation_logs").insert({
      job_name: "dispatch-quantivis-webhooks",
      status: failed === 0 ? "success" : "partial",
      message: `Dispatched ${sent} webhooks, ${failed} failed out of ${pending.length}`,
    });

    return new Response(
      JSON.stringify({ ok: true, dispatched: sent, failed, total: pending.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("dispatch-quantivis-webhooks error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
