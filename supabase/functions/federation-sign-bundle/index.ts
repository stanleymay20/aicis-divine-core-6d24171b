// Signs an arbitrary payload with the active federation Ed25519 key.
// Records the signature in federation_signed_bundles with the embedded key_id.
// Body: { payload: any } or { bundle_hash: string }
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
function toB64(arr: Uint8Array): string {
  let s = ""; for (const b of arr) s += String.fromCharCode(b); return btoa(s);
}
async function sha256Hex(data: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(h).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const privKeyB64 = Deno.env.get("FEDERATION_ED25519_PRIVATE_KEY");
    if (!privKeyB64) {
      return new Response(JSON.stringify({
        error: "FEDERATION_ED25519_PRIVATE_KEY not configured. Run federation-init-key first and save the returned private_key_pkcs8_base64 as a secret.",
      }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: activeKey, error: keyErr } = await supabase
      .from("federation_active_key").select("key_id, public_key").maybeSingle();
    if (keyErr || !activeKey) {
      return new Response(JSON.stringify({ error: "No active federation signing key registered" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const payload = body.payload ?? null;
    let bundleHash: string = body.bundle_hash ?? "";
    let payloadBytes: Uint8Array;

    if (payload !== null) {
      const canonical = JSON.stringify(payload);
      payloadBytes = new TextEncoder().encode(canonical);
      bundleHash = await sha256Hex(payloadBytes);
    } else if (bundleHash) {
      payloadBytes = new TextEncoder().encode(bundleHash);
    } else {
      return new Response(JSON.stringify({ error: "Provide { payload } or { bundle_hash }" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const privKey = await crypto.subtle.importKey(
      "pkcs8", fromB64(privKeyB64), { name: "Ed25519" } as any, false, ["sign"],
    );
    const sigBytes = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" } as any, privKey, payloadBytes));
    const signature = toB64(sigBytes);

    const { data: inserted, error: insErr } = await supabase
      .from("federation_signed_bundles")
      .insert({
        bundle_hash: bundleHash,
        key_id: activeKey.key_id,
        signature,
        algorithm: "Ed25519",
        payload_size_bytes: payloadBytes.length,
        verified: true,
        verified_at: new Date().toISOString(),
      })
      .select().single();
    if (insErr) throw insErr;

    return new Response(JSON.stringify({
      ok: true,
      bundle_hash: bundleHash,
      key_id: activeKey.key_id,
      algorithm: "Ed25519",
      signature,
      record_id: inserted.id,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
