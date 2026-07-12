import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { startProviderRun, finishProviderRun, failProviderRun } from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-aicis-node, x-aicis-signature, content-sha256",
};

// Validate signature using Ed25519
async function verifyEd25519Signature(
  payload: string,
  signature: string,
  publicKeyPem: string
): Promise<boolean> {
  try {
    // Parse PEM/base64/base64url public key formats. Older self-peer rows may
    // contain escaped newlines or url-safe base64 rather than strict PEM.
    const pemContents = publicKeyPem
      .replace(/-----BEGIN PUBLIC KEY-----/g, '')
      .replace(/-----END PUBLIC KEY-----/g, '')
      .replace(/\\n/g, '')
      .replace(/\s/g, '')
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const paddedPem = pemContents.padEnd(Math.ceil(pemContents.length / 4) * 4, '=');
    const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
    
    // Import the public key
    const publicKey = await crypto.subtle.importKey(
      'spki',
      binaryKey,
      { name: 'Ed25519', namedCurve: 'Ed25519' },
      false,
      ['verify']
    );
    
    // Decode signature from base64
    const normalizedSignature = signature.replace(/-/g, '+').replace(/_/g, '/');
    const paddedSignature = normalizedSignature.padEnd(Math.ceil(normalizedSignature.length / 4) * 4, '=');
    const signatureBytes = Uint8Array.from(atob(paddedSignature), c => c.charCodeAt(0));
    const payloadBytes = new TextEncoder().encode(payload);
    
    // Verify signature
    return await crypto.subtle.verify(
      'Ed25519',
      publicKey,
      signatureBytes,
      payloadBytes
    );
  } catch (error) {
    console.error("Signature verification error:", error);
    return false;
  }
}

// Validate payload structure
const federationPayloadSchema = z.object({
  window_start: z.string(),
  window_end: z.string(),
  node_reliability: z.number().min(0).max(1).optional(),
  signals: z.array(z.object({
    sample_size: z.number().min(0)
  }).passthrough()).min(1)
});

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const run = await startProviderRun(supabase, {
    provider_name: "fed-ingest",
    endpoint: "fed-ingest",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "federation-peer",
  });

  try {
    const peerName = req.headers.get("X-AICIS-Node");
    const signature = req.headers.get("X-AICIS-Signature");
    const contentHash = req.headers.get("Content-SHA256");

    if (!peerName || !signature || !contentHash) {
      return new Response(JSON.stringify({ error: "Missing required headers" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Find peer
    const { data: peer } = await supabase
      .from("federation_peers")
      .select("*")
      .eq("peer_name", peerName)
      .eq("recv_enabled", true)
      .single();

    if (!peer) {
      return new Response(JSON.stringify({ error: "Unknown or disabled peer" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const rawPayload = await req.text();
    const payload = JSON.parse(rawPayload);
    
    // Validate payload structure
    const validatedPayload = federationPayloadSchema.parse(payload);

    // Verify Content-SHA256 hash
    const payloadHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(rawPayload)
    );
    const payloadHashHex = Array.from(new Uint8Array(payloadHash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    if (contentHash && contentHash !== payloadHashHex) {
      console.error("Content hash mismatch");
      return new Response(JSON.stringify({ error: "Content hash verification failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Verify cryptographic signature
    const signatureValid = await verifyEd25519Signature(
      rawPayload,
      signature,
      peer.pubkey_pem
    );
    
    if (!signatureValid) {
      console.error("Invalid signature from peer:", peerName);
      await supabase.from("system_logs").insert({
        action: "fed_ingest_failed",
        result: `Signature verification failed for ${peerName}`,
        log_level: "warn",
        division: "system",
        metadata: { peer: peerName, reason: "invalid_signature" }
      });
      
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Validate window
    const windowStart = new Date(validatedPayload.window_start);
    const windowEnd = new Date(validatedPayload.window_end);
    const now = new Date();
    const clockSkew = Math.abs(now.getTime() - windowEnd.getTime());

    if (clockSkew > 10 * 60 * 1000) { // 10 minutes
      return new Response(JSON.stringify({ error: "Clock skew too large" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Compute summary strength
    const nodeReliability = validatedPayload.node_reliability || 0.5;
    const avgSampleSize = validatedPayload.signals.reduce((sum: number, s: any) => sum + s.sample_size, 0) / validatedPayload.signals.length;
    const summaryStrength = (peer.trust_score / 100) * nodeReliability * Math.min(1, avgSampleSize / 100);

    // Insert inbound signal
    const { error: insertError } = await supabase
      .from("federation_inbound_signals")
      .insert({
        peer_id: peer.id,
        window_start: windowStart.toISOString(),
        window_end: windowEnd.toISOString(),
        signals: validatedPayload.signals,
        signature_valid: signatureValid,
        peer_trust: peer.trust_score,
        summary_strength: summaryStrength
      });

    if (insertError) throw insertError;

    await supabase.from("system_logs").insert({
      action: "fed_ingest",
      result: `Ingested bundle from ${peerName} with ${validatedPayload.signals.length} signals`,
      log_level: "info",
      division: "system",
      metadata: { peer: peerName, signals: validatedPayload.signals.length }
    });

    console.log(`Ingested bundle from ${peerName}`);

    await finishProviderRun(supabase, run, {
      records_fetched: validatedPayload.signals.length,
      records_inserted: validatedPayload.signals.length,
    });

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error ingesting bundle:", error);
    await failProviderRun(supabase, run, error);

    if (error instanceof z.ZodError) {
      return new Response(
        JSON.stringify({
          error: "Invalid federation payload",
          details: error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
