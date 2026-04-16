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
      return json({ ok: true, dispatched: 0, message: "No pending webhooks" });
    }

    const signingKey = Deno.env.get("QUANTIVIS_WEBHOOK_SECRET") || "";
    let sent = 0;
    let failed = 0;

    for (const webhook of pending) {
      try {
        const targetUrl = webhook.target_url;
        if (!targetUrl) {
          await sb.from("quantivis_webhook_queue")
            .update({ status: "failed", last_error: "No target URL" })
            .eq("id", webhook.id);
          failed++;
          continue;
        }

        const encoder = new TextEncoder();
        const payloadStr = JSON.stringify(webhook.payload);

        // Send with x-api-key header (Quantivis expects this)
        const response = await fetch(targetUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": signingKey,
            "x-request-id": webhook.id,
            "X-AICIS-Event": webhook.event_type,
          },
          body: payloadStr,
        });

        const attempts = (webhook.attempts || 0) + 1;

        if (response.ok) {
          await sb.from("quantivis_webhook_queue")
            .update({ status: "sent", delivered_at: new Date().toISOString(), attempts })
            .eq("id", webhook.id);
          sent++;
        } else {
          const errMsg = `HTTP ${response.status}: ${await response.text().catch(() => "no body")}`.substring(0, 500);
          const maxAttempts = webhook.max_attempts || 5;
          await sb.from("quantivis_webhook_queue")
            .update({
              status: attempts >= maxAttempts ? "failed" : "pending",
              attempts,
              last_error: errMsg,
              next_retry_at: new Date(Date.now() + attempts * 60000).toISOString(),
            })
            .eq("id", webhook.id);
          failed++;
        }
      } catch (e) {
        const attempts = (webhook.attempts || 0) + 1;
        const maxAttempts = webhook.max_attempts || 5;
        await sb.from("quantivis_webhook_queue")
          .update({
            status: attempts >= maxAttempts ? "failed" : "pending",
            attempts,
            last_error: (e as Error).message.substring(0, 500),
            next_retry_at: new Date(Date.now() + attempts * 60000).toISOString(),
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

    return json({ ok: true, dispatched: sent, failed, total: pending.length });
  } catch (e) {
    console.error("dispatch-quantivis-webhooks error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
