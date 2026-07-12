import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NODE_ID = Deno.env.get("AICIS_CLUSTER_ID") ?? "aicis-local-l4-global";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

// Parse PEM-encoded PKCS#8 Ed25519 private key
async function importEd25519PrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "Ed25519", namedCurve: "Ed25519" } as any,
    false,
    ["sign"]
  );
}

// Sign payload with Ed25519, return base64
async function signPayload(payload: string, privateKey: CryptoKey): Promise<string> {
  const data = new TextEncoder().encode(payload);
  const signature = await crypto.subtle.sign("Ed25519", privateKey, data);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    console.log("Sending federation bundles...");

    // Load signing key
    const signingKeyPem = Deno.env.get("AICIS_SIGNING_KEY_PEM");
    if (!signingKeyPem) {
      throw new Error("AICIS_SIGNING_KEY_PEM secret not configured");
    }

    let privateKey: CryptoKey;
    try {
      privateKey = await importEd25519PrivateKey(signingKeyPem);
    } catch (keyErr) {
      const msg = keyErr instanceof Error ? keyErr.message : String(keyErr);
      console.error("Failed to import Ed25519 key:", msg);
      await supabase.from("system_logs").insert({
        action: "fed_send_bundles",
        result: `Key import failed: ${msg}`,
        log_level: "error",
        division: "system",
      });
      return new Response(
        JSON.stringify({ error: "Invalid signing key format. Must be PKCS#8 PEM Ed25519." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get queued bundles
    const { data: bundles } = await supabase
      .from("federation_outbound_queue")
      .select("*")
      .in("status", ["queued", "failed"])
      .lt("attempts", 5)
      .order("window_start", { ascending: true });

    if (!bundles || bundles.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "No queued bundles" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get enabled peers
    const { data: peers } = await supabase
      .from("federation_peers")
      .select("*")
      .eq("send_enabled", true);

    if (!peers || peers.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "No enabled peers" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sentCount = 0;
    let errorCount = 0;

    for (const bundle of bundles) {
      const bodyString = JSON.stringify(bundle.payload);
      const signature = await signPayload(bodyString, privateKey);
      const { data: activeKey } = await supabase
        .from("federation_signing_keys")
        .select("key_id")
        .eq("is_active", true)
        .eq("key_status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const signedBundle = {
        bundle_hash: bundle.hash,
        key_id: activeKey?.key_id ?? null,
        signature,
        algorithm: "Ed25519",
        payload_size_bytes: new TextEncoder().encode(bodyString).length,
        signed_at: new Date().toISOString(),
        verified: false,
      };

      const { data: existingSigned } = await supabase
        .from("federation_signed_bundles")
        .select("id")
        .eq("bundle_hash", bundle.hash)
        .maybeSingle();

      if (existingSigned?.id) {
        await supabase
          .from("federation_signed_bundles")
          .update(signedBundle)
          .eq("id", existingSigned.id);
      } else {
        await supabase
          .from("federation_signed_bundles")
          .insert(signedBundle);
      }

      let bundleErrors = 0;

      for (const peer of peers) {
        try {
          const isSelfPeer = SUPABASE_URL && peer.base_url?.includes(new URL(SUPABASE_URL).host);
          const response = await fetch(`${peer.base_url}/fed-ingest`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-AICIS-Node": isSelfPeer ? peer.peer_name : NODE_ID,
              "X-AICIS-Signature": signature,
              "Content-SHA256": bundle.hash,
            },
            body: bodyString,
          });

          if (response.ok) {
            sentCount++;
            await supabase
              .from("federation_peers")
              .update({ last_seen: new Date().toISOString() })
              .eq("id", peer.id);
          } else {
            bundleErrors++;
            errorCount++;
            console.error(`Failed to send to ${peer.peer_name}:`, await response.text());
          }
        } catch (error) {
          bundleErrors++;
          errorCount++;
          console.error(`Error sending to ${peer.peer_name}:`, error);
        }
      }

      await supabase
        .from("federation_outbound_queue")
        .update({
          status: bundleErrors === 0 ? "sent" : "failed",
          attempts: bundle.attempts + 1,
          last_attempt: new Date().toISOString(),
        })
        .eq("id", bundle.id);
    }

    await supabase.from("system_logs").insert({
      action: "fed_send_bundles",
      result: `Sent ${sentCount} bundles, ${errorCount} errors (Ed25519 signed)`,
      log_level: "info",
      division: "system",
      metadata: { sent: sentCount, errors: errorCount, signed: true },
    });

    console.log(`Sent ${sentCount} bundles, ${errorCount} errors`);

    return new Response(
      JSON.stringify({ ok: true, sent: sentCount, errors: errorCount, signed: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error sending bundles:", error);

    await supabase.from("system_logs").insert({
      action: "fed_send_bundles",
      result: `Error: ${errorMessage}`,
      log_level: "error",
      division: "system",
    });

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
